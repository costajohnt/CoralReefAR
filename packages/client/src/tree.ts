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
import { installLighting } from './scene/lighting.js';
import { installSway } from './scene/currentSway.js';
import { installPulse } from './scene/pulse.js';
import { readTreeConfig } from './tree/config.js';
import { createTreePedestal, createBloomComposer } from './tree/scene.js';
import { TreeReef } from './tree/reef.js';
import { AttachIndicators } from './tree/indicators.js';
import { TreePlacement } from './tree/placement.js';
import { fetchTree, submitTreePolyp, TreeSocket, defaultTreeWsUrl } from './tree/api.js';
import { TreePicker } from './ui/treePicker.js';

// ------------------------------------------------------------------
// Sentinel symbols so sway/pulse are installed at most once per mesh.
// ------------------------------------------------------------------
const SWAY_INSTALLED = Symbol('sway-installed');
const PULSE_INSTALLED = Symbol('pulse-installed');

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
scene.background = null;
renderer.setClearColor(0x01060d, 1);

installLighting(scene);
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

// ------------------------------------------------------------------
// Bloom composer
// ------------------------------------------------------------------
const bloomSetup = createBloomComposer(renderer, scene, camera);

// ------------------------------------------------------------------
// Tree objects
// ------------------------------------------------------------------
const treeReef = new TreeReef();
scene.add(treeReef.anchor);

const attachIndicators = new AttachIndicators();
scene.add(attachIndicators.group);

const placement = new TreePlacement(treeReef);
scene.add(placement.ghostAnchor);

// ------------------------------------------------------------------
// Shared clock for sway/pulse animations
// ------------------------------------------------------------------
const swayClock = { value: 0 };

// ------------------------------------------------------------------
// Sway/pulse helpers
// ------------------------------------------------------------------

/**
 * Walk all pieces in treeReef and install sway/pulse on any new meshes.
 * Tree emissive baseline is higher (see Task 15), so pulse amplitude
 * is applied at the same rate — the higher baseline is set in the
 * material itself; installPulse drives around it.
 */
function installEffectsOnNewPieces(): void {
  for (const { polyp, mesh } of treeReef.allPieces()) {
    const flags = mesh.userData as Record<PropertyKey, unknown>;
    if (!flags[SWAY_INSTALLED]) {
      installSway(mesh as Mesh, swayClock);
      flags[SWAY_INSTALLED] = true;
    }
    if (!flags[PULSE_INSTALLED]) {
      installPulse(mesh as Mesh, swayClock, polyp.seed);
      flags[PULSE_INSTALLED] = true;
    }
  }
}

// ------------------------------------------------------------------
// Picker (tree variant)
// ------------------------------------------------------------------
const pickerRoot = document.getElementById('picker')!;
const picker = new TreePicker(pickerRoot);
const hintEl = document.getElementById('hint')!;

let currentSeed = Math.floor(Math.random() * 0xffffffff);

// ------------------------------------------------------------------
// Pending attach slot — set on click, cleared on commit/cancel
// ------------------------------------------------------------------
let pendingParentId: number | null = null;
let pendingAttachIndex = 0;

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
// Interactive mode: click handler + picker wiring
// ------------------------------------------------------------------
if (config.mode === 'interactive') {
  picker.show();

  const raycaster = new Raycaster();
  // Make raycaster threshold generous enough to pick small indicator spheres.
  raycaster.params.Points = { threshold: 0.01 };

  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    );

    raycaster.setFromCamera(ndc, camera);
    const intersects = raycaster.intersectObjects(attachIndicators.group.children, false);
    if (intersects.length === 0) {
      hintEl.textContent = 'Click a glowing dot to attach your piece.';
      return;
    }

    const hit = intersects[0]!;
    const ud = hit.object.userData as { parentId?: number; attachIndex?: number };
    if (ud.parentId === undefined || ud.attachIndex === undefined) return;

    pendingParentId = ud.parentId;
    pendingAttachIndex = ud.attachIndex;
    currentSeed = Math.floor(Math.random() * 0xffffffff);

    const s = picker.get();
    const ghost = placement.showGhost(
      s.variant,
      currentSeed,
      s.colorKey,
      pendingParentId,
      pendingAttachIndex,
    );

    if (ghost) {
      picker.setCommittable(true);
      hintEl.textContent = 'Happy with it? Click Grow.';
    } else {
      hintEl.textContent = 'That spot is blocked. Try another dot.';
    }
  });

  picker.onChange(({ variant, colorKey }) => {
    if (pendingParentId === null) return;
    const ghost = placement.showGhost(
      variant,
      currentSeed,
      colorKey,
      pendingParentId,
      pendingAttachIndex,
    );
    picker.setCommittable(!!ghost);
    if (!ghost) hintEl.textContent = 'That spot is blocked. Try another dot.';
  });

  picker.onReroll(() => {
    if (pendingParentId === null) return;
    currentSeed = Math.floor(Math.random() * 0xffffffff);
    const s = picker.get();
    const ghost = placement.showGhost(
      s.variant,
      currentSeed,
      s.colorKey,
      pendingParentId,
      pendingAttachIndex,
    );
    picker.setCommittable(!!ghost);
  });

  picker.onCancel(() => {
    placement.reset();
    pendingParentId = null;
    picker.setCommittable(false);
    hintEl.textContent = 'Cancelled. Click a dot to try again.';
  });

  picker.onCommit(async () => {
    if (config.readonly) {
      hintEl.textContent = 'Readonly mode — Grow is disabled.';
      return;
    }
    const pending = placement.getPending();
    if (!pending) return;

    picker.setSubmitting(true);
    try {
      await submitTreePolyp(
        {
          variant: pending.variant,
          seed: pending.seed,
          colorKey: pending.colorKey,
          parentId: pending.parentId,
          attachIndex: pending.attachIndex,
        },
        config.apiBase,
      );
      // The socket echo (tree_polyp_added) will call treeReef.addPiece and
      // placement.reset(). No need to add the piece locally here — let the
      // server broadcast drive it (consistent with the playground pattern).
      picker.setSubmitting(false);
      picker.setCommittable(false);
      hintEl.textContent = 'Grown! Click another dot to plant again.';
      pendingParentId = null;
    } catch (e) {
      picker.setSubmitting(false);
      hintEl.textContent = 'Server rejected the piece. Check the console.';
      console.error(e);
    }
  });
}

if (config.mode === 'screen') {
  picker.hide();
  controls.enabled = false;
}

// ------------------------------------------------------------------
// WebSocket
// ------------------------------------------------------------------
function buildTreeWsUrl(): string {
  if (!config.apiBase) return defaultTreeWsUrl();
  const u = new URL(config.apiBase);
  const proto = u.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${u.host}/ws/tree`;
}

const socket = new TreeSocket(buildTreeWsUrl());
socket.on((msg) => {
  if (msg.type === 'tree_hello') {
    console.log(`[tree] connected — server has ${msg.polypCount} piece(s)`);
  } else if (msg.type === 'tree_polyp_added') {
    // Avoid double-adding if the addPiece call throws on duplicate.
    try {
      addAndRefresh(msg.polyp);
    } catch (err) {
      // Parent might not be registered yet in a race — log and ignore.
      console.warn('[tree] tree_polyp_added could not add piece', err);
      return;
    }
    // If this matches the current pending ghost, resolve it.
    const pending = placement.getPending();
    if (
      pending &&
      pending.parentId === msg.polyp.parentId &&
      pending.attachIndex === msg.polyp.attachIndex &&
      pending.variant === msg.polyp.variant &&
      pending.seed === msg.polyp.seed
    ) {
      placement.reset();
    }
  } else if (msg.type === 'tree_polyp_removed') {
    treeReef.removePiece(msg.id);
    attachIndicators.refresh(treeReef.getAvailableAttachPoints());
  }
});

function addAndRefresh(polyp: PublicTreePolyp): void {
  treeReef.addPiece(polyp);
  installEffectsOnNewPieces();
  attachIndicators.refresh(treeReef.getAvailableAttachPoints());
}

// ------------------------------------------------------------------
// Initial fetch
// ------------------------------------------------------------------
async function loadInitial(): Promise<void> {
  try {
    const state = await fetchTree(config.apiBase);
    // Sort ascending so parents are always inserted before children.
    const sorted = [...state.polyps].sort((a, b) => a.createdAt - b.createdAt);
    for (const polyp of sorted) {
      treeReef.addPiece(polyp);
    }
    installEffectsOnNewPieces();
    attachIndicators.refresh(treeReef.getAvailableAttachPoints());
    if (hintEl && config.mode === 'interactive') {
      hintEl.textContent = 'Click a glowing dot to attach your piece.';
    }
  } catch (e) {
    console.error('[tree] Failed to load tree', e);
  }
}

// ------------------------------------------------------------------
// Render loop
// ------------------------------------------------------------------
function loop(t: number): void {
  swayClock.value = t / 1000;

  controls.update();
  bloomSetup.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

void loadInitial();
socket.connect();
