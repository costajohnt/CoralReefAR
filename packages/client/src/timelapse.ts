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

resize();
requestAnimationFrame(render);
player.init().catch(console.error);
