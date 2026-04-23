import {
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer,
  type Mesh,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PublicTreePolyp } from '@reef/shared';
import { installSway } from './scene/currentSway.js';
import { installTreePulse } from './tree/pulse.js';
import { readTreeConfig } from './tree/config.js';
import {
  createTreePedestal,
  createBloomComposer,
  createUnderwaterBackground,
  createUnderwaterFog,
  installUnderwaterLighting,
} from './tree/scene.js';
import { TreeReef } from './tree/reef.js';
import { AttachIndicators } from './tree/indicators.js';
import { TreePlacement } from './tree/placement.js';
import { fetchTree, TreeSocket, defaultTreeWsUrl } from './tree/api.js';
import { TREE_VARIANTS, TreePicker } from './ui/treePicker.js';
import { computeOrbitPose } from './playground/autoOrbit.js';
import { Shark } from './tree/shark.js';
import { Clownfish } from './tree/clownfish.js';
import { initialState, reduce, type TreeAction, type TreeState } from './tree/state.js';
import { createEffects } from './tree/effects.js';

// ------------------------------------------------------------------
// Config + canvas
// ------------------------------------------------------------------
const config = readTreeConfig();
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const modeBadge = document.getElementById('mode-badge')!;
modeBadge.textContent = `${config.mode}${config.readonly ? ' · readonly' : ''}`;

// ------------------------------------------------------------------
// Renderer + scene
// ------------------------------------------------------------------
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));

const scene = new Scene();
scene.background = createUnderwaterBackground();
scene.fog = createUnderwaterFog();
renderer.setClearColor(0x01060d, 1);

installUnderwaterLighting(scene);
scene.add(createTreePedestal());

// ------------------------------------------------------------------
// Camera + controls
// ------------------------------------------------------------------
const camera = new PerspectiveCamera(50, 1, 0.01, 20);
camera.position.set(0.45, 0.2, 0);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.minDistance = 0.2;
controls.maxDistance = 1.2;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.enableDamping = true;

const bloomSetup = createBloomComposer(renderer, scene, camera);

// ------------------------------------------------------------------
// Tree content + placement
// ------------------------------------------------------------------
const treeReef = new TreeReef();
scene.add(treeReef.anchor);

const attachIndicators = new AttachIndicators();
scene.add(attachIndicators.group);

const placement = new TreePlacement(treeReef);
scene.add(placement.ghostAnchor);

// ------------------------------------------------------------------
// Sway/pulse effect installer (used on every newly-added piece).
// ------------------------------------------------------------------
const SWAY_INSTALLED = Symbol('sway-installed');
const PULSE_INSTALLED = Symbol('pulse-installed');
const swayClock = { value: 0 };

function installEffectsOnNewPieces(): void {
  for (const { polyp, mesh } of treeReef.allPieces()) {
    const flags = mesh.userData as Record<PropertyKey, unknown>;
    if (!flags[SWAY_INSTALLED]) {
      installSway(mesh as Mesh, swayClock);
      flags[SWAY_INSTALLED] = true;
    }
    if (!flags[PULSE_INSTALLED]) {
      installTreePulse(mesh as Mesh, swayClock, polyp.seed);
      flags[PULSE_INSTALLED] = true;
    }
  }
}

function addPiecesAndRefresh(polyps: PublicTreePolyp[]): void {
  const sorted = [...polyps].sort((a, b) => a.createdAt - b.createdAt);
  for (const polyp of sorted) treeReef.addPiece(polyp);
  installEffectsOnNewPieces();
  attachIndicators.refresh(treeReef.getAvailableAttachPoints());
}

// ------------------------------------------------------------------
// Spawnable sea life — empty by default.
// ------------------------------------------------------------------
interface SwimmingCreature { update: (clockSec: number) => void; }
const creatures: SwimmingCreature[] = [];
function spawnShark(): void {
  const s = new Shark({
    orbitRadius: 0.25 + Math.random() * 0.15,
    orbitHeight: 0.05 + Math.random() * 0.2,
    orbitPeriodSec: 14 + Math.random() * 10,
    phaseRad: Math.random() * Math.PI * 2,
    direction: Math.random() < 0.5 ? 1 : -1,
  });
  scene.add(s.group);
  creatures.push(s);
}
function spawnClownfish(): void {
  const c = new Clownfish({
    orbitRadius: 0.15 + Math.random() * 0.15,
    orbitHeight: 0.04 + Math.random() * 0.2,
    orbitPeriodSec: 5 + Math.random() * 6,
    phaseRad: Math.random() * Math.PI * 2,
    direction: Math.random() < 0.5 ? 1 : -1,
  });
  scene.add(c.group);
  creatures.push(c);
}

// ------------------------------------------------------------------
// Picker + state machine
// ------------------------------------------------------------------
const pickerRoot = document.getElementById('picker')!;
const picker = new TreePicker(pickerRoot);
const hintEl = document.getElementById('hint')!;

const effects = createEffects({
  placement, treeReef, indicators: attachIndicators, picker, controls,
  hintEl, apiBase: config.apiBase,
  dispatch: (action) => dispatch(action),
  addPiecesAndRefresh,
});

let state: TreeState = initialState(picker.get());

function dispatch(action: TreeAction): void {
  const prev = state;
  state = reduce(state, action);
  if (state !== prev) effects.apply(prev, state, action);
}

// Wire picker → dispatch.
picker.onChange((sel) => {
  const current = state.picker;
  if (sel.variant !== current.variant) {
    const seed = Math.floor(Math.random() * 0xffffffff);
    dispatch({ type: 'VARIANT_CHOSEN', variant: sel.variant, seed });
  }
  if (sel.colorKey !== current.colorKey) {
    dispatch({ type: 'COLOR_CHOSEN', colorKey: sel.colorKey });
  }
});
picker.onReroll(() => {
  if (state.kind !== 'placing') return;
  const options = TREE_VARIANTS.filter((v) => v !== state.picker.variant);
  const variant = options[Math.floor(Math.random() * options.length)]!;
  const seed = Math.floor(Math.random() * 0xffffffff);
  dispatch({ type: 'REROLL_CLICKED', variant, seed });
});
picker.onCancel(() => dispatch({ type: 'CANCEL_CLICKED' }));
picker.onCommit(() => dispatch({ type: 'GROW_CLICKED' }));

// ------------------------------------------------------------------
// Toolbar → dispatch / direct spawn
// ------------------------------------------------------------------
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement | null;
const addSharkBtn = document.getElementById('addSharkBtn') as HTMLButtonElement | null;
const addClownfishBtn = document.getElementById('addClownfishBtn') as HTMLButtonElement | null;
if (clearBtn) clearBtn.addEventListener('click', () => dispatch({ type: 'CLEAR_CLICKED' }));
if (addSharkBtn) addSharkBtn.addEventListener('click', spawnShark);
if (addClownfishBtn) addClownfishBtn.addEventListener('click', spawnClownfish);

// ------------------------------------------------------------------
// Pointer-drag: rotate ghost in place instead of orbiting while placing.
// ------------------------------------------------------------------
let dragState: { lastX: number; moved: boolean } | null = null;
let suppressNextClick = false;
const DRAG_THRESHOLD_PX = 3;
const ROT_SENSITIVITY = 0.0055;

canvas.addEventListener(
  'pointerdown',
  (ev) => {
    if (state.kind !== 'placing') return;
    if (config.mode !== 'screen') controls.enabled = false;
    dragState = { lastX: ev.clientX, moved: false };
    canvas.setPointerCapture(ev.pointerId);
  },
  { capture: true },
);
canvas.addEventListener('pointermove', (ev) => {
  if (!dragState) return;
  const dx = ev.clientX - dragState.lastX;
  if (!dragState.moved && Math.abs(dx) > DRAG_THRESHOLD_PX) dragState.moved = true;
  if (dragState.moved) {
    placement.rotateGhost(dx * ROT_SENSITIVITY);
    dragState.lastX = ev.clientX;
  }
});
canvas.addEventListener('pointerup', (ev) => {
  if (!dragState) return;
  if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
  suppressNextClick = dragState.moved;
  dragState = null;
  if (config.mode !== 'screen') controls.enabled = true;
});

// ------------------------------------------------------------------
// Click (attach-orb pick) — interactive mode only
// ------------------------------------------------------------------
if (config.mode === 'interactive') {
  picker.show();
  const raycaster = new Raycaster();
  raycaster.params.Points = { threshold: 0.01 };

  canvas.addEventListener('click', (ev) => {
    if (suppressNextClick) { suppressNextClick = false; return; }
    const rect = canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -(((ev.clientY - rect.top) / rect.height) * 2 - 1),
    );
    raycaster.setFromCamera(ndc, camera);
    const intersects = raycaster.intersectObjects(attachIndicators.group.children, false);
    if (intersects.length === 0) {
      if (state.kind === 'idle') {
        hintEl.textContent = 'Click a glowing dot to attach your piece.';
      }
      return;
    }
    const hit = intersects[0]!;
    const ud = hit.object.userData as { parentId?: number; attachIndex?: number };
    if (ud.parentId === undefined || ud.attachIndex === undefined) return;
    const seed = Math.floor(Math.random() * 0xffffffff);
    dispatch({
      type: 'ATTACH_CLICKED',
      parentId: ud.parentId,
      attachIndex: ud.attachIndex,
      seed,
    });
  });
}

// ------------------------------------------------------------------
// Resize
// ------------------------------------------------------------------
function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  bloomSetup.composer.setSize(w, h);
  bloomSetup.bloomPass.resolution.set(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------
// Initial fetch
// ------------------------------------------------------------------
(async () => {
  try {
    const { polyps } = await fetchTree(config.apiBase);
    addPiecesAndRefresh(polyps);
    if (config.mode === 'interactive') {
      hintEl.textContent = polyps.length
        ? 'Click a glowing dot to attach your piece.'
        : 'Click Clear and grow something new.';
    }
  } catch (e) {
    console.error('[tree] Failed to load tree', e);
    hintEl.textContent = 'Failed to load tree. Check the server.';
  }
})();

// ------------------------------------------------------------------
// WebSocket: tree content updates (idempotent on polyp id)
// ------------------------------------------------------------------
function buildTreeWsUrl(): string {
  if (config.apiBase) {
    return config.apiBase.replace(/^http/, 'ws') + '/ws/tree';
  }
  return defaultTreeWsUrl();
}
const socket = new TreeSocket(buildTreeWsUrl());
socket.on((msg) => {
  if (msg.type === 'tree_hello') {
    // No-op; initial state was fetched via HTTP.
  } else if (msg.type === 'tree_polyp_added') {
    treeReef.addPiece(msg.polyp);
    installEffectsOnNewPieces();
    attachIndicators.refresh(treeReef.getAvailableAttachPoints());
  } else if (msg.type === 'tree_polyp_removed') {
    treeReef.removePiece(msg.id);
    attachIndicators.refresh(treeReef.getAvailableAttachPoints());
  } else if (msg.type === 'tree_reset') {
    treeReef.clear();
    attachIndicators.refresh([]);
    dispatch({ type: 'TREE_RESET_EXTERNAL' });
  }
});
socket.connect();

// ------------------------------------------------------------------
// Render loop
// ------------------------------------------------------------------
function loop(t: number): void {
  const tSec = t / 1000;
  swayClock.value = tSec;
  for (const c of creatures) c.update(tSec);

  if (config.mode === 'screen') {
    const pose = computeOrbitPose(tSec);
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
  } else {
    controls.update();
  }
  bloomSetup.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
