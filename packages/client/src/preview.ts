import {
  AmbientLight, DirectionalLight, HemisphereLight, PerspectiveCamera,
  Scene, WebGLRenderer,
} from 'three';
import { SPECIES, REEF_PALETTE, type Species } from '@reef/shared';
import { generatePolyp } from '@reef/generator';
import { polypMesh } from './scene/meshAdapter.js';
import { disposeTree } from './scene/dispose.js';

interface Cell {
  species: Species;
  seed: number;
  colorKey: string;
  canvas: HTMLCanvasElement;
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  azim: number;
  elev: number;
  dragging: boolean;
  lastX: number;
  lastY: number;
}

const grid = document.getElementById('grid')!;
const countInput = document.getElementById('count') as HTMLInputElement;
const colorSelect = document.getElementById('color') as HTMLSelectElement;
const reseedBtn = document.getElementById('reseed') as HTMLButtonElement;
const cells: Cell[] = [];

for (const p of REEF_PALETTE) {
  const opt = document.createElement('option');
  opt.value = p.key;
  opt.textContent = p.name;
  colorSelect.appendChild(opt);
}

function makeCell(species: Species, seed: number, colorKey: string): Cell {
  const wrap = document.createElement('div');
  wrap.className = 'cell';
  const canvas = document.createElement('canvas');
  canvas.width = 340; canvas.height = 340;
  const label = document.createElement('div');
  label.className = 'label';
  const nameEl = document.createElement('span');
  nameEl.textContent = species;
  const colorEl = document.createElement('b');
  colorEl.textContent = colorKey;
  label.appendChild(nameEl);
  label.appendChild(colorEl);
  wrap.appendChild(canvas);
  wrap.appendChild(label);
  grid.appendChild(wrap);

  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvas.clientWidth || 170, canvas.clientHeight || 170, false);
  renderer.setClearColor(0x061726, 1);

  const scene = new Scene();
  scene.add(new AmbientLight(0x223344, 0.5));
  scene.add(new HemisphereLight(0x87b7ff, 0x14263a, 0.6));
  const dir = new DirectionalLight(0xfff0d0, 1);
  dir.position.set(0.4, 1, 0.3);
  scene.add(dir);

  const { mesh, boundingRadius, approxHeight } = generatePolyp({ species, seed, colorKey });
  const node = polypMesh(mesh);
  scene.add(node);

  const extent = Math.max(boundingRadius, approxHeight) * 2 + 0.02;
  const camera = new PerspectiveCamera(35, 1, 0.01, 20);
  camera.position.set(0, approxHeight * 0.8, extent * 2.4);
  camera.lookAt(0, approxHeight * 0.4, 0);

  const cell: Cell = {
    species, seed, colorKey, canvas, renderer, scene, camera,
    azim: 0, elev: 0.3, dragging: false, lastX: 0, lastY: 0,
  };

  canvas.addEventListener('pointerdown', (e) => {
    cell.dragging = true; cell.lastX = e.clientX; cell.lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointerup', (e) => {
    cell.dragging = false;
    canvas.releasePointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!cell.dragging) return;
    cell.azim -= (e.clientX - cell.lastX) * 0.01;
    cell.elev = Math.max(-1.2, Math.min(1.2, cell.elev - (e.clientY - cell.lastY) * 0.01));
    cell.lastX = e.clientX; cell.lastY = e.clientY;
    layoutCamera(cell, extent, approxHeight);
  });

  layoutCamera(cell, extent, approxHeight);
  return cell;
}

function layoutCamera(cell: Cell, extent: number, h: number): void {
  const r = extent * 2.4;
  cell.camera.position.set(
    Math.cos(cell.azim) * Math.cos(cell.elev) * r,
    Math.sin(cell.elev) * r + h * 0.5,
    Math.sin(cell.azim) * Math.cos(cell.elev) * r,
  );
  cell.camera.lookAt(0, h * 0.4, 0);
}

function build(): void {
  // Dispose existing cells so their WebGL contexts are released. Browsers
  // cap live contexts per page (~16 on mobile); without this, a few Reseed
  // clicks will start dropping the oldest canvases.
  for (const c of cells) {
    disposeTree(c.scene);
    c.renderer.dispose();
    c.renderer.forceContextLoss();
  }
  grid.replaceChildren();
  cells.length = 0;
  const count = Math.max(1, Math.min(24, Number(countInput.value) || 6));
  const fixedColor = colorSelect.value;
  let paletteIdx = 0;
  for (const species of SPECIES) {
    for (let i = 0; i < count; i++) {
      const seed = Math.floor(Math.random() * 0xffffffff);
      const colorKey = fixedColor
        || REEF_PALETTE[(paletteIdx++) % REEF_PALETTE.length]!.key;
      cells.push(makeCell(species, seed, colorKey));
    }
  }
}

function render(): void {
  for (const c of cells) {
    const w = c.canvas.clientWidth;
    const h = c.canvas.clientHeight;
    if (w > 0 && h > 0) {
      c.renderer.setSize(w, h, false);
      c.camera.aspect = w / h;
      c.camera.updateProjectionMatrix();
    }
    c.renderer.render(c.scene, c.camera);
  }
  requestAnimationFrame(render);
}

reseedBtn.addEventListener('click', build);
countInput.addEventListener('change', build);
colorSelect.addEventListener('change', build);

build();
requestAnimationFrame(render);
