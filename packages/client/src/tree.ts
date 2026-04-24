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
import { Jellyfish } from './tree/jellyfish.js';
import { SeaTurtle } from './tree/seaTurtle.js';
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
type CreatureType = 'shark' | 'clownfish' | 'jellyfish' | 'seaTurtle';
interface SwimmingCreature { update: (clockSec: number) => void; }
interface TrackedCreature {
  type: CreatureType;
  instance: SwimmingCreature;
  group: import('three').Group;
}
const creatures: TrackedCreature[] = [];

function removeCreature(type: CreatureType): boolean {
  const idx = [...creatures].map((c, i) => ({ c, i })).reverse()
    .find(({ c }) => c.type === type)?.i ?? -1;
  if (idx === -1) return false;
  const [removed] = creatures.splice(idx, 1);
  if (!removed) return false;
  scene.remove(removed.group);
  removed.group.traverse((obj) => {
    const mesh = obj as import('three').Mesh;
    if (mesh.isMesh) {
      mesh.geometry?.dispose();
      if (Array.isArray(mesh.material)) {
        for (const m of mesh.material) (m as import('three').Material).dispose();
      } else {
        (mesh.material as import('three').Material | undefined)?.dispose();
      }
    }
  });
  return true;
}

function countCreatures(type: CreatureType): number {
  return creatures.filter((c) => c.type === type).length;
}

function spawnShark(): void {
  const s = new Shark({
    orbitRadius: 0.25 + Math.random() * 0.15,
    orbitHeight: 0.05 + Math.random() * 0.2,
    orbitPeriodSec: 14 + Math.random() * 10,
    phaseRad: Math.random() * Math.PI * 2,
    direction: Math.random() < 0.5 ? 1 : -1,
  });
  scene.add(s.group);
  creatures.push({ type: 'shark', instance: s, group: s.group });
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
  creatures.push({ type: 'clownfish', instance: c, group: c.group });
}
function spawnJellyfish(): void {
  const j = new Jellyfish({
    orbitRadius: 0.18 + Math.random() * 0.14,
    orbitHeight: 0.1 + Math.random() * 0.2,
    orbitPeriodSec: 20 + Math.random() * 12,
    phaseRad: Math.random() * Math.PI * 2,
    direction: Math.random() < 0.5 ? 1 : -1,
  });
  scene.add(j.group);
  creatures.push({ type: 'jellyfish', instance: j, group: j.group });
}
function spawnSeaTurtle(): void {
  const t = new SeaTurtle({
    orbitRadius: 0.28 + Math.random() * 0.12,
    orbitHeight: 0.04 + Math.random() * 0.12,
    orbitPeriodSec: 28 + Math.random() * 12,
    phaseRad: Math.random() * Math.PI * 2,
    direction: Math.random() < 0.5 ? 1 : -1,
  });
  scene.add(t.group);
  creatures.push({ type: 'seaTurtle', instance: t, group: t.group });
}

// ------------------------------------------------------------------
// Picker + state machine
// ------------------------------------------------------------------
const pickerRoot = document.getElementById('picker')!;
const picker = new TreePicker(pickerRoot);
const hintEl = document.getElementById('hint')!;

const effects = createEffects({
  placement, treeReef, indicators: attachIndicators, picker,
  hintEl, apiBase: config.apiBase,
  dispatch: (action) => dispatch(action),
  addPiecesAndRefresh,
});

let state: TreeState = initialState(picker.get());

function dispatch(action: TreeAction): void {
  const prev = state;
  state = reduce(state, action);
  if (state !== prev) {
    effects.apply(prev, state, action);
    refreshUndoBtn();
  }
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
const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement | null;
const seaLifeBtn = document.getElementById('seaLifeBtn') as HTMLButtonElement | null;
const seaLifePanel = document.getElementById('sea-life-panel') as HTMLElement | null;
const seaLifeCloseBtn = document.getElementById('sea-life-close-btn') as HTMLButtonElement | null;

const addSharkBtn = document.getElementById('addSharkBtn') as HTMLButtonElement | null;
const removeSharkBtn = document.getElementById('removeSharkBtn') as HTMLButtonElement | null;
const addClownfishBtn = document.getElementById('addClownfishBtn') as HTMLButtonElement | null;
const removeClownfishBtn = document.getElementById('removeClownfishBtn') as HTMLButtonElement | null;
const addJellyfishBtn = document.getElementById('addJellyfishBtn') as HTMLButtonElement | null;
const removeJellyfishBtn = document.getElementById('removeJellyfishBtn') as HTMLButtonElement | null;
const addSeaTurtleBtn = document.getElementById('addSeaTurtleBtn') as HTMLButtonElement | null;
const removeSeaTurtleBtn = document.getElementById('removeSeaTurtleBtn') as HTMLButtonElement | null;

if (clearBtn) clearBtn.addEventListener('click', () => dispatch({ type: 'CLEAR_CLICKED' }));
if (undoBtn) undoBtn.addEventListener('click', () => dispatch({ type: 'UNDO_CLICKED' }));

// Sea life panel toggle
function setPanelOpen(open: boolean): void {
  if (!seaLifePanel || !seaLifeBtn) return;
  if (open) {
    seaLifePanel.classList.add('open');
    seaLifeBtn.setAttribute('aria-expanded', 'true');
    seaLifeBtn.setAttribute('aria-pressed', 'true');
  } else {
    seaLifePanel.classList.remove('open');
    seaLifeBtn.setAttribute('aria-expanded', 'false');
    seaLifeBtn.removeAttribute('aria-pressed');
  }
}
if (seaLifeBtn) seaLifeBtn.addEventListener('click', () => {
  const isOpen = seaLifePanel?.classList.contains('open') ?? false;
  setPanelOpen(!isOpen);
});
if (seaLifeCloseBtn) seaLifeCloseBtn.addEventListener('click', () => setPanelOpen(false));

// Close panel on Escape or click-outside
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') setPanelOpen(false);
});
document.addEventListener('click', (ev) => {
  if (!seaLifePanel?.classList.contains('open')) return;
  const target = ev.target as Node;
  if (!seaLifePanel.contains(target) && target !== seaLifeBtn && !seaLifeBtn?.contains(target)) {
    setPanelOpen(false);
  }
});

// Panel creature counts — call after every spawn/remove
function refreshPanel(): void {
  const types: CreatureType[] = ['shark', 'clownfish', 'jellyfish', 'seaTurtle'];
  const ids: Record<CreatureType, string> = {
    shark: 'shark', clownfish: 'clownfish', jellyfish: 'jellyfish', seaTurtle: 'seaTurtle',
  };
  for (const type of types) {
    const n = countCreatures(type);
    const countEl = document.getElementById(`count-${ids[type]}`);
    if (countEl) countEl.textContent = String(n);
    const removeBtn = document.getElementById(`remove${type.charAt(0).toUpperCase()}${type.slice(1)}Btn`) as HTMLButtonElement | null;
    if (removeBtn) removeBtn.disabled = n === 0;
  }
}

if (addSharkBtn) addSharkBtn.addEventListener('click', () => { spawnShark(); refreshPanel(); });
if (removeSharkBtn) removeSharkBtn.addEventListener('click', () => { removeCreature('shark'); refreshPanel(); });
if (addClownfishBtn) addClownfishBtn.addEventListener('click', () => { spawnClownfish(); refreshPanel(); });
if (removeClownfishBtn) removeClownfishBtn.addEventListener('click', () => { removeCreature('clownfish'); refreshPanel(); });
if (addJellyfishBtn) addJellyfishBtn.addEventListener('click', () => { spawnJellyfish(); refreshPanel(); });
if (removeJellyfishBtn) removeJellyfishBtn.addEventListener('click', () => { removeCreature('jellyfish'); refreshPanel(); });
if (addSeaTurtleBtn) addSeaTurtleBtn.addEventListener('click', () => { spawnSeaTurtle(); refreshPanel(); });
if (removeSeaTurtleBtn) removeSeaTurtleBtn.addEventListener('click', () => { removeCreature('seaTurtle'); refreshPanel(); });

// Undo button enabled/disabled: update after every dispatch
function refreshUndoBtn(): void {
  if (!undoBtn) return;
  undoBtn.disabled = !(state.kind === 'idle' && state.lastCommittedId !== null);
}

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
    dispatch({ type: 'GHOST_ROTATED', deltaRad: dx * ROT_SENSITIVITY });
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
    // If someone built on top of our last commit, we can no longer undo it
    // (the server enforces leaf-only deletes). Invalidate lastCommittedId.
    if (
      state.kind !== 'undoing' &&
      'lastCommittedId' in state &&
      state.lastCommittedId !== null &&
      msg.polyp.parentId === state.lastCommittedId
    ) {
      dispatch({ type: 'LAST_COMMITTED_INVALIDATED' });
    }
  } else if (msg.type === 'tree_polyp_removed') {
    treeReef.removePiece(msg.id);
    attachIndicators.refresh(treeReef.getAvailableAttachPoints());
    dispatch({ type: 'TREE_POLYP_REMOVED_EXTERNAL', id: msg.id });
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
  for (const c of creatures) c.instance.update(tSec);

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
