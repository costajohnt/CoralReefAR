import {
  AmbientLight, Color, DirectionalLight, Group, HemisphereLight, Mesh,
  PerspectiveCamera, Scene, WebGLRenderer,
} from 'three';
import type { PublicPolyp } from '@reef/shared';
import { generatePolyp } from '@reef/generator';
import { polypMesh } from './scene/meshAdapter.js';
import { disposeTree } from './scene/dispose.js';

interface SnapshotMeta { id: number; takenAt: number; polypCount: number }
interface SnapshotBody { polyps: PublicPolyp[] }

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

let azim = 0;
function render(t: number): void {
  azim = t * 0.00015;
  camera.position.set(Math.cos(azim) * 0.7, 0.35, Math.sin(azim) * 0.7);
  camera.lookAt(0, 0.06, 0);
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

function clearReef(): void {
  // Iterate by always pulling the first element so that `reefGroup.remove`
  // mutating `children` mid-loop doesn't skip entries.
  while (reefGroup.children.length > 0) {
    const child = reefGroup.children[0]!;
    reefGroup.remove(child);
    disposeTree(child);
  }
}

function applySnapshot(body: SnapshotBody): void {
  clearReef();
  for (const p of body.polyps) {
    const { mesh } = generatePolyp({ species: p.species, seed: p.seed, colorKey: p.colorKey });
    const node: Mesh = polypMesh(mesh);
    node.position.fromArray(p.position as unknown as number[]);
    node.quaternion.fromArray(p.orientation as unknown as number[]);
    node.scale.setScalar(p.scale);
    reefGroup.add(node);
  }
}

async function load(): Promise<SnapshotMeta[]> {
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

function fmt(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16);
}

let snapshots: SnapshotMeta[] = [];
let playing = false;
let scrubToken = 0;

scrubEl.addEventListener('input', async () => {
  const token = ++scrubToken;
  const idx = Number(scrubEl.value);
  const snap = snapshots[idx];
  if (!snap) return;
  timeEl.textContent = fmt(snap.takenAt);
  const body = await loadSnapshot(snap.id);
  // Rapid scrubbing stacks fetches; discard responses that arrive out of
  // order so we only apply the most recently requested snapshot.
  if (token !== scrubToken) return;
  applySnapshot(body);
});

playBtn.addEventListener('click', () => {
  playing = !playing;
  playBtn.textContent = playing ? 'Pause' : 'Play';
  if (playing) tick();
});

async function tick(): Promise<void> {
  while (playing) {
    const cur = Number(scrubEl.value);
    const next = (cur + 1) % snapshots.length;
    scrubEl.value = String(next);
    scrubEl.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 400));
  }
}

(async () => {
  resize();
  requestAnimationFrame(render);
  try {
    snapshots = await load();
  } catch (e) {
    metaEl.textContent = 'Failed to load snapshots.';
    console.error(e);
    return;
  }
  if (snapshots.length === 0) {
    metaEl.textContent = 'No snapshots yet. The server writes one per day.';
    playBtn.disabled = true;
    return;
  }
  metaEl.textContent = `${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'}`;
  scrubEl.max = String(snapshots.length - 1);
  scrubEl.value = String(snapshots.length - 1);
  scrubEl.dispatchEvent(new Event('input'));
})().catch(console.error);
