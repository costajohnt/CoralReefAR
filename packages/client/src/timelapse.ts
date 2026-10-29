import {
  AmbientLight, Color, DirectionalLight, Group, HemisphereLight, Mesh,
  PerspectiveCamera, Scene, WebGLRenderer,
} from 'three';
import { generatePolyp } from '@reef/generator';
import { polypMesh } from './scene/meshAdapter.js';
import { disposeTree } from './scene/dispose.js';
import {
  createTimelapsePlayer,
  type SnapshotBody,
  type SnapshotMeta,
} from './timelapse/player.js';
import { createSnapshotScene } from './timelapse/reefDiff.js';
import {
  outputSize, pickMimeType, recordTimelapse, type RecorderLike,
} from './timelapse/recorder.js';
import { wireVideoExport } from './timelapse/videoExport.js';
import { downloadBlob } from './ui/download.js';

const canvas = document.getElementById('gl') as HTMLCanvasElement;
const metaEl = document.getElementById('meta')!;
const scrubEl = document.getElementById('scrub') as HTMLInputElement;
const timeEl = document.getElementById('time')!;
const playBtn = document.getElementById('playBtn') as HTMLButtonElement;

const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setClearColor(new Color(0x02111d), 1);

const scene = new Scene();
scene.add(new AmbientLight(0x1b3348, 0.5));
scene.add(new HemisphereLight(0x87b7ff, 0x14263a, 0.6));
const dir = new DirectionalLight(0xfff0d0, 1);
dir.position.set(0.3, 1, 0.2);
scene.add(dir);

const camera = new PerspectiveCamera(45, 1, 0.01, 20);
const reefGroup = new Group();
scene.add(reefGroup);

function resize(): void {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// Orbit speed shared by the live view and recorded video (rad per ms).
const ORBIT_RAD_PER_MS = 0.00015;

function renderAt(azim: number): void {
  camera.position.set(Math.cos(azim) * 0.7, 0.35, Math.sin(azim) * 0.7);
  camera.lookAt(0, 0.06, 0);
  renderer.render(scene, camera);
}

// While a video records, the recorder drives rendering frame by frame; the
// live loop keeps ticking but doesn't draw.
let recording = false;
function render(t: number): void {
  if (!recording) renderAt(t * ORBIT_RAD_PER_MS);
  requestAnimationFrame(render);
}

// Snapshots are applied as a diff by polyp id: stepping a day forward only
// generates that day's new polyps (see timelapse/reefDiff.ts).
const reefScene = createSnapshotScene(reefGroup, {
  makeNode: (p) => {
    const { mesh } = generatePolyp({ species: p.species, seed: p.seed, colorKey: p.colorKey });
    const node: Mesh = polypMesh(mesh);
    node.position.fromArray(p.position as unknown as number[]);
    node.quaternion.fromArray(p.orientation as unknown as number[]);
    node.scale.setScalar(p.scale);
    return node;
  },
  disposeNode: disposeTree,
});

function applySnapshot(body: SnapshotBody): void {
  reefScene.apply(body);
}

async function loadList(): Promise<SnapshotMeta[]> {
  const r = await fetch('/api/snapshots');
  if (!r.ok) throw new Error(`snapshots ${r.status}`);
  return r.json() as Promise<SnapshotMeta[]>;
}

async function loadSnapshot(id: number): Promise<SnapshotBody> {
  const r = await fetch(`/api/snapshots/${id}`);
  if (!r.ok) throw new Error(`snapshot ${id}: ${r.status}`);
  const wrapper = await r.json() as { stateJson: string };
  return JSON.parse(wrapper.stateJson) as SnapshotBody;
}

// The scrub + autoplay state machine lives in ./timelapse/player.ts (tested in
// isolation); this entry just supplies the WebGL render + fetch dependencies.
const player = createTimelapsePlayer(
  { metaEl, scrubEl, timeEl, playBtn },
  { loadList, loadSnapshot, applySnapshot },
);

// --- Video export (#111) ---------------------------------------------------
// Frames are rendered into the WebGL canvas, then centre-cropped into a fixed
// size 2D canvas (with a date caption) that MediaRecorder captures. The
// visible canvas is never resized, and no second GL context is needed.
const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
const MAX_W = coarse ? 854 : 1280;
const MAX_H = coarse ? 480 : 720;
const BITRATE = coarse ? 2_500_000 : 5_000_000;

const fmtDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

function canRecord(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') return null;
  return pickMimeType((t) => MediaRecorder.isTypeSupported(t));
}

function record(opts: {
  durationS: number; fps: number; mimeType: string; signal: AbortSignal;
  onProgress(done: number, total: number): void;
}): Promise<Blob> {
  const out = outputSize(canvas.width, canvas.height, MAX_W, MAX_H);
  const frame = document.createElement('canvas');
  frame.width = out.w;
  frame.height = out.h;
  const ctx = frame.getContext('2d');
  if (!ctx) return Promise.reject(new Error('2D canvas unavailable'));
  const fontPx = Math.round(out.h / 24);

  const drawFrame = (i: number, _total: number, snap: SnapshotMeta): void => {
    renderAt((i / opts.fps) * 1000 * ORBIT_RAD_PER_MS);
    // Same task as the render, so the WebGL drawing buffer is still intact.
    ctx.drawImage(canvas, out.sx, out.sy, out.sw, out.sh, 0, 0, out.w, out.h);
    const label = `${fmtDay(snap.takenAt)}  ·  ${snap.polypCount} ${snap.polypCount === 1 ? 'coral' : 'corals'}`;
    ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
    ctx.textBaseline = 'bottom';
    ctx.fillStyle = 'rgba(2, 17, 29, 0.55)';
    const pad = Math.round(fontPx * 0.6);
    ctx.fillRect(pad, out.h - pad - fontPx * 1.5, ctx.measureText(label).width + pad * 2, fontPx * 1.5);
    ctx.fillStyle = '#eef';
    ctx.fillText(label, pad * 2, out.h - pad - fontPx * 0.25);
  };

  const createRecorder = () => {
    // captureStream(0): frames are captured only when we call requestFrame,
    // so the video gets exactly the frames we draw. Fall back to a fixed-rate
    // stream where requestFrame isn't implemented.
    let stream = frame.captureStream(0);
    let track = stream.getVideoTracks()[0] as (MediaStreamTrack & { requestFrame?: () => void }) | undefined;
    if (!track || typeof track.requestFrame !== 'function') {
      stream.getTracks().forEach((t) => t.stop());
      stream = frame.captureStream(opts.fps);
      track = undefined;
    }
    const recorder = new MediaRecorder(stream, { mimeType: opts.mimeType, videoBitsPerSecond: BITRATE });
    const origStop = recorder.stop.bind(recorder);
    recorder.stop = () => { origStop(); stream.getTracks().forEach((t) => t.stop()); };
    return {
      recorder: recorder as unknown as RecorderLike,
      requestFrame: () => track?.requestFrame?.(),
    };
  };

  return recordTimelapse({
    snapshots: player.snapshots(),
    durationS: opts.durationS,
    fps: opts.fps,
    loadSnapshot,
    applySnapshot,
    drawFrame,
    createRecorder,
    waitUntil: (t) => new Promise((r) => setTimeout(r, Math.max(0, t - performance.now()))),
    now: () => performance.now(),
    signal: opts.signal,
    onProgress: opts.onProgress,
  });
}

wireVideoExport(
  {
    recordBtn: document.getElementById('recordBtn') as HTMLButtonElement,
    durationSel: document.getElementById('videoDuration') as HTMLSelectElement,
    fpsSel: document.getElementById('videoFps') as HTMLSelectElement,
    statusEl: document.getElementById('videoStatus')!,
  },
  {
    mimeType: canRecord,
    getSnapshots: () => player.snapshots(),
    record,
    download: downloadBlob,
    setBusy: (busy) => {
      recording = busy;
      player.setLocked(busy);
    },
  },
);

resize();
requestAnimationFrame(render);
player.init().catch(console.error);
