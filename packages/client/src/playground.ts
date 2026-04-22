import { PerspectiveCamera, Scene, WebGLRenderer, Vector2, type Mesh } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PublicPolyp } from '@reef/shared';
import { installLighting } from './scene/lighting.js';
import { installSway } from './scene/currentSway.js';
import { installPulse } from './scene/pulse.js';
import { Reef } from './scene/reef.js';
import { FishSchool } from './sim/fish.js';
import { fetchReef, submitPolyp, RateLimitError } from './net/api.js';
import { ReefSocket, defaultWsUrl } from './net/ws.js';
import { createPedestal } from './playground/scene.js';
import { readPlaygroundConfig } from './playground/config.js';
import { Placement } from './placement.js';
import { Picker } from './ui/picker.js';
import { computePlacementFromClick } from './playground/interaction.js';
import { computeOrbitPose } from './playground/autoOrbit.js';

const SWAY_INSTALLED = Symbol('sway-installed');
const PULSE_INSTALLED = Symbol('pulse-installed');

const config = readPlaygroundConfig();
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const modeBadge = document.getElementById('mode-badge')!;
modeBadge.textContent = `${config.mode}${config.readonly ? ' · readonly' : ''}`;

const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
renderer.setClearColor(0x02111d, 1);

const scene = new Scene();
installLighting(scene);
scene.add(createPedestal());

const reef = new Reef();
scene.add(reef.anchor);

const fish = new FishSchool();
reef.anchor.add(fish.points);

const swayClock = { value: 0 };

const camera = new PerspectiveCamera(50, 1, 0.01, 20);
camera.position.set(0.45, 0.2, 0);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.minDistance = 0.2;
controls.maxDistance = 1.2;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.enableDamping = true;

const placement = new Placement(reef, camera, reef.anchor);
const pickerRoot = document.getElementById('picker')!;
const picker = new Picker(pickerRoot);
const hintEl = document.getElementById('hint')!;

let currentSeed = Math.floor(Math.random() * 0xffffffff);

if (config.mode === 'interactive') {
  picker.show();
  canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -(((e.clientY - rect.top) / rect.height) * 2 - 1),
    );
    const hit = computePlacementFromClick(ndc, camera);
    if (!hit) {
      hintEl.textContent = 'Click on the pedestal top to place your polyp.';
      return;
    }
    currentSeed = Math.floor(Math.random() * 0xffffffff);
    const s = picker.get();
    placement.showGhost(s.species, currentSeed, s.colorKey, hit);
    picker.setCommittable(true);
    hintEl.textContent = 'Happy with it? Click Grow.';
  });

  picker.onChange(({ species, colorKey }) => {
    if (placement.getLast()) placement.updateGhost(species, currentSeed, colorKey);
  });

  picker.onReroll(() => {
    if (!placement.getLast()) return;
    currentSeed = Math.floor(Math.random() * 0xffffffff);
    const s = picker.get();
    placement.updateGhost(s.species, currentSeed, s.colorKey);
  });

  picker.onCancel(() => {
    placement.reset();
    picker.setCommittable(false);
  });

  picker.onCommit(async () => {
    if (config.readonly) {
      hintEl.textContent = 'Readonly mode — Grow is disabled.';
      return;
    }
    const r = placement.getLast();
    if (!r) return;
    const s = picker.get();
    picker.setSubmitting(true);
    try {
      const saved = await submitPolyp({
        species: s.species,
        seed: currentSeed,
        colorKey: s.colorKey,
        position: [r.position.x, r.position.y, r.position.z],
        orientation: [r.orientation.x, r.orientation.y, r.orientation.z, r.orientation.w],
        scale: r.scale,
      });
      placement.reset();
      reef.addPolyp(saved, true);
      installEffectsOnNewMeshes();
      picker.setSubmitting(false);
      picker.setCommittable(false);
      hintEl.textContent = 'Grown. Click another spot to plant again.';
    } catch (e) {
      picker.setSubmitting(false);
      if (e instanceof RateLimitError) {
        hintEl.textContent = `Rate limit — try again in ${Math.ceil(e.retryAfterMs / 1000)}s.`;
      } else {
        hintEl.textContent = 'Server rejected the polyp. Check the console.';
        console.error(e);
      }
    }
  });
}

if (config.mode === 'screen') {
  // Hide the picker and take over camera movement.
  picker.hide();
  (document.getElementById('picker') as HTMLElement).classList.add('hidden');
  controls.enabled = false;
}

function installEffectsOnNewMeshes(): void {
  for (const obj of reef.all()) {
    const m = obj as Mesh;
    if (!m.isMesh) continue;
    const flags = m.userData as Record<PropertyKey, unknown>;
    if (!flags[SWAY_INSTALLED]) {
      installSway(m, swayClock);
      flags[SWAY_INSTALLED] = true;
    }
    if (!flags[PULSE_INSTALLED]) {
      const polyp = m.userData.polyp as PublicPolyp | undefined;
      if (polyp) {
        installPulse(m, swayClock, polyp.seed);
        flags[PULSE_INSTALLED] = true;
      }
    }
  }
}

async function loadInitial(): Promise<void> {
  try {
    const state = await fetchReef();
    for (const p of state.polyps) reef.addPolyp(p, false);
    for (const d of state.sim) reef.applySim(d);
    installEffectsOnNewMeshes();
  } catch (e) {
    console.error('Failed to load reef', e);
  }
}

// Build the WebSocket URL. If config.apiBase is set (dev override), swap the
// protocol + host onto the default path. Otherwise use same-origin default.
function buildWsUrl(): string {
  if (!config.apiBase) return defaultWsUrl();
  const u = new URL(config.apiBase);
  const proto = u.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${u.host}/ws`;
}

const socket = new ReefSocket(buildWsUrl());
socket.on((msg) => {
  if (msg.type === 'polyp_added' && !reef.hasPolyp(msg.polyp.id)) {
    reef.addPolyp(msg.polyp, true);
    installEffectsOnNewMeshes();
  } else if (msg.type === 'polyp_removed') {
    reef.removePolyp(msg.id);
  } else if (msg.type === 'sim_update') {
    for (const d of msg.updates) reef.applySim(d);
  }
});

function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let lastT = 0;
function loop(t: number): void {
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  swayClock.value = t / 1000;
  fish.update(dt);
  reef.animateGrowth(t);

  if (config.mode === 'screen') {
    const pose = computeOrbitPose(t / 1000);
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
  } else {
    controls.update();
  }

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

void loadInitial();
socket.connect();
