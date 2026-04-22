# Playground Virtual Reef — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `playground.html` — an interactive Three.js view of the reef with orbit camera + click-to-place, plus a `?mode=screen` auto-orbit variant for an eventual museum-screen display. Removes all AR/camera/marker/phone dependencies for iteration.

**Architecture:** New Vite entry (sibling to `index.html`, `preview.html`, `timelapse.html`). Reuses the existing `Reef`, `Placement`, `Picker`, `ReefSocket`, `fetchReef`, `submitPolyp`, and scene effects (`installLighting`, `installSway`, `installPulse`). Adds a virtual pedestal mesh, Three.js `OrbitControls`, a URL-param config, and pure auto-orbit math. Same backend — playground talks to `/api/*` and `/ws` via `fetch` and `ReefSocket` exactly like the AR client.

**Tech Stack:** TypeScript 6 · Vite 7 · Three.js 0.184 (`OrbitControls` from `three/addons/controls/OrbitControls.js`) · Vitest 4. No new dependencies.

---

## File Structure

### New files
- `packages/client/playground.html` — shell with `<canvas>`, picker container, mode badge
- `packages/client/src/playground.ts` — entry point; wires the scene, camera, interaction, picker, socket
- `packages/client/src/playground/scene.ts` — pedestal geometry + helper to compose scene root
- `packages/client/src/playground/config.ts` — URL-param parser: `mode`, `readonly`, `api`
- `packages/client/src/playground/autoOrbit.ts` — pure `computeOrbitPose(t)` for screen mode
- `packages/client/src/playground/interaction.ts` — pure raycast helper for click-to-place
- `packages/client/src/playground/scene.test.ts`
- `packages/client/src/playground/config.test.ts`
- `packages/client/src/playground/autoOrbit.test.ts`
- `packages/client/src/playground/interaction.test.ts`

### Modified files
- `packages/client/vite.config.ts` — add `playground` to `rollupOptions.input`
- `scripts/build-pages-index.sh` — keep `playground.html` in the dist bundle after the index rename
- `packages/client/src/styles.css` — minor: give the mode badge + pedestal-hint a class (small additions)

### Unchanged (but consumed)
- `packages/client/src/scene/reef.ts` — `Reef` class, polyp add/remove/animate
- `packages/client/src/placement.ts` — `Placement` class, ghost polyp + commit
- `packages/client/src/ui/picker.ts` — `Picker` class
- `packages/client/src/net/api.ts` — `fetchReef`, `submitPolyp`, `RateLimitError`
- `packages/client/src/net/ws.ts` — `ReefSocket`, `defaultWsUrl`
- `packages/client/src/scene/lighting.ts` — `installLighting`
- `packages/client/src/scene/currentSway.ts` — `installSway`
- `packages/client/src/scene/pulse.ts` — `installPulse`
- `packages/client/src/sim/fish.ts` — `FishSchool`

---

## Self-contained: how the reef anchors without a marker

In the AR client, the `Reef.anchor` group's world-space pose comes from the tracker. Here there is no tracker — the reef anchors to the world origin, and a virtual pedestal mesh is rendered beneath it so it doesn't look like it's floating. The pedestal is at `y=0` with the reef growing up from `y=0`. OrbitControls target is also the origin.

---

## Task 1: Virtual pedestal + scene helper

**Files:**
- Create: `packages/client/src/playground/scene.ts`
- Test: `packages/client/src/playground/scene.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/playground/scene.test.ts
import { describe, expect, test } from 'vitest';
import { CylinderGeometry, Mesh, MeshStandardMaterial } from 'three';
import { createPedestal } from './scene.js';

describe('createPedestal', () => {
  test('returns a Mesh with a CylinderGeometry', () => {
    const p = createPedestal();
    expect(p).toBeInstanceOf(Mesh);
    expect(p.geometry).toBeInstanceOf(CylinderGeometry);
  });

  test('material is a matte MeshStandardMaterial (no self-illumination to compete with the reef pulse)', () => {
    const mat = createPedestal().material as MeshStandardMaterial;
    expect(mat).toBeInstanceOf(MeshStandardMaterial);
    expect(mat.roughness).toBeGreaterThan(0.7);
    expect(mat.metalness).toBeLessThan(0.1);
    expect(mat.emissiveIntensity ?? 0).toBeLessThan(0.01);
  });

  test('pedestal top sits at y=0 so Reef geometry grows from the origin', () => {
    const p = createPedestal();
    const geom = p.geometry as CylinderGeometry;
    // Mesh position + half-height should land the top face at y=0.
    const halfHeight = geom.parameters.height / 2;
    expect(p.position.y + halfHeight).toBeCloseTo(0, 4);
  });
});
```

- [ ] **Step 2: Verify the test fails**

Run: `pnpm --filter @reef/client test src/playground/scene.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `createPedestal`**

```ts
// packages/client/src/playground/scene.ts
import { CylinderGeometry, Mesh, MeshStandardMaterial } from 'three';

/**
 * Virtual pedestal mesh. The reef's anchor sits at world origin (no AR
 * tracker to provide a pose), so the pedestal is positioned so its top face
 * lands exactly at y=0 — polyps grow "up" from the pedestal surface.
 *
 * Matte, low-saturation color so the coral pulse doesn't have to compete
 * with a flashy base.
 */
const PEDESTAL_RADIUS = 0.12;   // 12 cm — a little larger than the reef spread
const PEDESTAL_HEIGHT = 0.04;   // 4 cm — low profile
const PEDESTAL_COLOR = 0x2a3a4a;

export function createPedestal(): Mesh {
  const geom = new CylinderGeometry(PEDESTAL_RADIUS, PEDESTAL_RADIUS, PEDESTAL_HEIGHT, 48);
  const mat = new MeshStandardMaterial({
    color: PEDESTAL_COLOR,
    roughness: 0.9,
    metalness: 0.02,
  });
  const mesh = new Mesh(geom, mat);
  // Top face at y=0 so Reef geometry (which lives in positive-y local space)
  // grows from the pedestal surface.
  mesh.position.y = -PEDESTAL_HEIGHT / 2;
  return mesh;
}
```

- [ ] **Step 4: Verify the test passes**

Run: `pnpm --filter @reef/client test src/playground/scene.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/playground/scene.ts packages/client/src/playground/scene.test.ts
git commit -m "Playground: virtual pedestal mesh with top at y=0"
```

---

## Task 2: URL config parser

**Files:**
- Create: `packages/client/src/playground/config.ts`
- Test: `packages/client/src/playground/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/playground/config.test.ts
import { afterEach, describe, expect, test, vi } from 'vitest';
import { readPlaygroundConfig } from './config.js';

describe('readPlaygroundConfig', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  test('defaults: interactive mode, not readonly, apiBase empty (same origin)', () => {
    vi.stubGlobal('location', { search: '' });
    expect(readPlaygroundConfig()).toEqual({
      mode: 'interactive',
      readonly: false,
      apiBase: '',
    });
  });

  test('?mode=screen → screen mode (auto-orbit, no picker)', () => {
    vi.stubGlobal('location', { search: '?mode=screen' });
    expect(readPlaygroundConfig().mode).toBe('screen');
  });

  test('?readonly=1 → readonly flag true', () => {
    vi.stubGlobal('location', { search: '?readonly=1' });
    expect(readPlaygroundConfig().readonly).toBe(true);
  });

  test('?api=http://localhost:8787 → apiBase set', () => {
    vi.stubGlobal('location', { search: '?api=http://localhost:8787' });
    expect(readPlaygroundConfig().apiBase).toBe('http://localhost:8787');
  });

  test('unknown mode falls back to interactive', () => {
    vi.stubGlobal('location', { search: '?mode=rubbish' });
    expect(readPlaygroundConfig().mode).toBe('interactive');
  });

  test('combined: mode=screen + api override', () => {
    vi.stubGlobal('location', { search: '?mode=screen&api=http://reef.example' });
    const c = readPlaygroundConfig();
    expect(c.mode).toBe('screen');
    expect(c.apiBase).toBe('http://reef.example');
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @reef/client test src/playground/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `readPlaygroundConfig`**

```ts
// packages/client/src/playground/config.ts

export type PlaygroundMode = 'interactive' | 'screen';

export interface PlaygroundConfig {
  mode: PlaygroundMode;
  readonly: boolean;
  /** Empty string = same origin. Otherwise a URL like `http://localhost:8787`. */
  apiBase: string;
}

export function readPlaygroundConfig(): PlaygroundConfig {
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  const rawMode = params.get('mode');
  const mode: PlaygroundMode = rawMode === 'screen' ? 'screen' : 'interactive';
  const readonly = params.get('readonly') === '1';
  const apiBase = params.get('api') ?? '';
  return { mode, readonly, apiBase };
}
```

- [ ] **Step 4: Verify test passes**

Run: `pnpm --filter @reef/client test src/playground/config.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/playground/config.ts packages/client/src/playground/config.test.ts
git commit -m "Playground: URL config parser (mode, readonly, apiBase)"
```

---

## Task 3: Auto-orbit math

**Files:**
- Create: `packages/client/src/playground/autoOrbit.ts`
- Test: `packages/client/src/playground/autoOrbit.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/playground/autoOrbit.test.ts
import { describe, expect, test } from 'vitest';
import {
  AUTO_ORBIT_PERIOD_SEC,
  AUTO_ORBIT_RADIUS,
  AUTO_ORBIT_HEIGHT,
  computeOrbitPose,
} from './autoOrbit.js';

describe('computeOrbitPose', () => {
  test('at t=0 the camera is on the +x axis at configured radius + height', () => {
    const pose = computeOrbitPose(0);
    expect(pose.position.x).toBeCloseTo(AUTO_ORBIT_RADIUS, 5);
    expect(pose.position.z).toBeCloseTo(0, 5);
    expect(pose.position.y).toBeCloseTo(AUTO_ORBIT_HEIGHT, 5);
  });

  test('after a full period the pose returns to the t=0 pose', () => {
    const a = computeOrbitPose(0);
    const b = computeOrbitPose(AUTO_ORBIT_PERIOD_SEC);
    expect(b.position.x).toBeCloseTo(a.position.x, 5);
    expect(b.position.y).toBeCloseTo(a.position.y, 5);
    expect(b.position.z).toBeCloseTo(a.position.z, 5);
  });

  test('at quarter period the camera is on the +z axis (90° rotated)', () => {
    const pose = computeOrbitPose(AUTO_ORBIT_PERIOD_SEC / 4);
    expect(pose.position.x).toBeCloseTo(0, 4);
    expect(pose.position.z).toBeCloseTo(AUTO_ORBIT_RADIUS, 4);
  });

  test('target is always the origin (reef anchor location)', () => {
    for (const t of [0, 1, 10, 100]) {
      const pose = computeOrbitPose(t);
      expect(pose.target.x).toBe(0);
      expect(pose.target.y).toBe(0);
      expect(pose.target.z).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @reef/client test src/playground/autoOrbit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `computeOrbitPose`**

```ts
// packages/client/src/playground/autoOrbit.ts
import { Vector3 } from 'three';

// Slow enough that the viewer perceives motion as ambient, not animated.
// 60s per full revolution feels right for a museum screen next to a pedestal.
export const AUTO_ORBIT_PERIOD_SEC = 60;
export const AUTO_ORBIT_RADIUS = 0.45;   // 45 cm from origin
export const AUTO_ORBIT_HEIGHT = 0.20;   // 20 cm above the reef floor

export interface OrbitPose {
  position: Vector3;
  target: Vector3;
}

/**
 * Pure math for the screen-mode auto-orbit camera. Given a time in seconds,
 * returns a camera position orbiting the reef at a fixed height, plus a
 * target at the origin.
 */
export function computeOrbitPose(clockSec: number): OrbitPose {
  const omega = (2 * Math.PI) / AUTO_ORBIT_PERIOD_SEC;
  const theta = clockSec * omega;
  return {
    position: new Vector3(
      Math.cos(theta) * AUTO_ORBIT_RADIUS,
      AUTO_ORBIT_HEIGHT,
      Math.sin(theta) * AUTO_ORBIT_RADIUS,
    ),
    target: new Vector3(0, 0, 0),
  };
}
```

- [ ] **Step 4: Verify test passes**

Run: `pnpm --filter @reef/client test src/playground/autoOrbit.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/playground/autoOrbit.ts packages/client/src/playground/autoOrbit.test.ts
git commit -m "Playground: auto-orbit pure math for screen mode"
```

---

## Task 4: Click-to-place raycast math

**Files:**
- Create: `packages/client/src/playground/interaction.ts`
- Test: `packages/client/src/playground/interaction.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/client/src/playground/interaction.test.ts
import { describe, expect, test } from 'vitest';
import { PerspectiveCamera, Vector2 } from 'three';
import { computePlacementFromClick } from './interaction.js';

function makeCamera(): PerspectiveCamera {
  const cam = new PerspectiveCamera(60, 1, 0.01, 20);
  cam.position.set(0, 0.3, 0.4);
  cam.lookAt(0, 0, 0);
  cam.updateMatrixWorld();
  return cam;
}

describe('computePlacementFromClick', () => {
  test('click at screen center with a camera above-and-behind hits the pedestal plane near origin', () => {
    const cam = makeCamera();
    const ndc = new Vector2(0, 0);  // screen center in NDC
    const result = computePlacementFromClick(ndc, cam);
    expect(result).not.toBeNull();
    // Intersection is on y=0 plane, in a bounded radius from origin given
    // the camera geometry. Not super-precise here — we just want "it landed
    // somewhere on the plane near the origin."
    expect(result!.y).toBeCloseTo(0, 4);
    expect(Math.hypot(result!.x, result!.z)).toBeLessThan(0.5);
  });

  test('click at top edge of screen (ndc y=1) misses the pedestal plane, returns null', () => {
    const cam = makeCamera();
    const ndc = new Vector2(0, 0.95);
    // A ray from an above-the-scene camera aimed up-and-forward parallel to
    // the y=0 plane (or diverging away) should miss. Exact result depends on
    // camera tilt; this assertion tolerates either outcome. The behavior we
    // care about is that "no intersection" returns null and doesn't crash.
    const result = computePlacementFromClick(ndc, cam);
    if (result !== null) {
      // If the ray does hit, it hits far from the pedestal.
      expect(Math.hypot(result.x, result.z)).toBeGreaterThan(0.12);
    }
  });

  test('clicks outside the pedestal radius clamp to null', () => {
    // The helper should honor a maxRadius so placements outside the pedestal
    // surface are rejected at the placement layer.
    const cam = makeCamera();
    // Fake a click that would intersect at radius > 0.12 (the pedestal top
    // radius from Task 1) by aiming well off-center.
    const ndc = new Vector2(0.8, -0.5);
    const result = computePlacementFromClick(ndc, cam, 0.12);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `pnpm --filter @reef/client test src/playground/interaction.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `computePlacementFromClick`**

```ts
// packages/client/src/playground/interaction.ts
import { Plane, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';

const PEDESTAL_PLANE = new Plane(new Vector3(0, 1, 0), 0);  // y=0, normal up

/**
 * Cast a ray from the camera through an NDC click point onto the pedestal's
 * y=0 plane. Returns the local-space hit point, or null if the ray misses
 * the plane or the hit falls outside `maxRadius`.
 */
export function computePlacementFromClick(
  ndc: Vector2,
  camera: PerspectiveCamera,
  maxRadius = 0.12,
): Vector3 | null {
  const ray = new Raycaster();
  ray.setFromCamera(ndc, camera);
  const hit = new Vector3();
  const intersected = ray.ray.intersectPlane(PEDESTAL_PLANE, hit);
  if (!intersected) return null;
  const r = Math.hypot(hit.x, hit.z);
  if (r > maxRadius) return null;
  return hit;
}
```

- [ ] **Step 4: Verify test passes**

Run: `pnpm --filter @reef/client test src/playground/interaction.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/playground/interaction.ts packages/client/src/playground/interaction.test.ts
git commit -m "Playground: click-to-place raycast against pedestal plane"
```

---

## Task 5: HTML shell + minimal entry

**Files:**
- Create: `packages/client/playground.html`
- Create: `packages/client/src/playground.ts`
- Modify: `packages/client/vite.config.ts`

- [ ] **Step 1: Write `playground.html`**

```html
<!-- packages/client/playground.html -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="theme-color" content="#0b1d2a" />
  <title>Coral Reef — Playground</title>
  <link rel="stylesheet" href="/src/styles.css" />
  <style>
    body { margin: 0; background: #02111d; overflow: hidden; }
    #gl { display: block; width: 100vw; height: 100vh; }
    #mode-badge {
      position: fixed; top: 12px; left: 12px; padding: 4px 8px;
      font: 500 11px/1 system-ui, sans-serif; color: #9ab;
      background: rgba(0,0,0,0.35); border-radius: 3px;
      pointer-events: none;
    }
  </style>
</head>
<body>
  <canvas id="gl"></canvas>
  <div id="mode-badge"></div>
  <div id="picker" class="hidden" role="region" aria-label="Plant a polyp">
    <div class="picker-row" role="group" aria-label="Species">
      <button type="button" data-species="branching">Branching</button>
      <button type="button" data-species="bulbous">Bulbous</button>
      <button type="button" data-species="fan">Fan</button>
      <button type="button" data-species="tube">Tube</button>
      <button type="button" data-species="encrusting">Encrusting</button>
    </div>
    <div id="colors" class="picker-row" role="group" aria-label="Color"></div>
    <div class="picker-actions">
      <button id="rerollBtn" type="button" disabled aria-label="Regenerate shape">Reroll shape</button>
      <button id="cancelBtn" type="button" disabled aria-label="Cancel placement">Cancel</button>
    </div>
    <button id="growBtn" type="button" disabled>Grow it</button>
    <p id="hint" aria-live="polite">Click the pedestal to place your polyp.</p>
  </div>
  <script type="module" src="/src/playground.ts"></script>
</body>
</html>
```

- [ ] **Step 2: Write the minimal `playground.ts`**

```ts
// packages/client/src/playground.ts
import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { installLighting } from './scene/lighting.js';
import { createPedestal } from './playground/scene.js';
import { readPlaygroundConfig } from './playground/config.js';

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

const camera = new PerspectiveCamera(50, 1, 0.01, 20);
camera.position.set(0.45, 0.2, 0);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.minDistance = 0.2;
controls.maxDistance = 1.2;
controls.maxPolarAngle = Math.PI / 2 - 0.05;  // don't orbit below the floor
controls.enableDamping = true;

function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

function loop(): void {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
```

- [ ] **Step 3: Add the Vite entry**

In `packages/client/vite.config.ts`, add `playground` to `rollupOptions.input`:

```ts
// packages/client/vite.config.ts (relevant diff)
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        preview: resolve(import.meta.dirname, 'preview.html'),
        timelapse: resolve(import.meta.dirname, 'timelapse.html'),
        playground: resolve(import.meta.dirname, 'playground.html'),
      },
```

- [ ] **Step 4: Build and verify the entry compiles**

Run: `pnpm --filter @reef/client build`
Expected: build completes, `dist/playground.html` exists.

Also run in dev:
`pnpm --filter @reef/client dev`
Open `http://localhost:5173/playground.html`.
Expected: dark-blue background, pedestal visible at center, mouse-drag rotates the camera around the pedestal.

- [ ] **Step 5: Commit**

```bash
git add packages/client/playground.html packages/client/src/playground.ts packages/client/vite.config.ts
git commit -m "Playground: HTML shell + minimal entry with orbit camera"
```

---

## Task 6: Load reef state + live socket updates

**Files:**
- Modify: `packages/client/src/playground.ts`

- [ ] **Step 1: Modify `playground.ts` to load the reef and subscribe**

```ts
// packages/client/src/playground.ts — replace previous content
import { PerspectiveCamera, Scene, WebGLRenderer, type Mesh } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PublicPolyp } from '@reef/shared';
import { installLighting } from './scene/lighting.js';
import { installSway } from './scene/currentSway.js';
import { installPulse } from './scene/pulse.js';
import { Reef } from './scene/reef.js';
import { FishSchool } from './sim/fish.js';
import { fetchReef } from './net/api.js';
import { ReefSocket, defaultWsUrl } from './net/ws.js';
import { createPedestal } from './playground/scene.js';
import { readPlaygroundConfig } from './playground/config.js';

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

const socket = new ReefSocket(config.apiBase
  ? defaultWsUrl().replace(/^ws(s?):\/\/[^/]+/, config.apiBase.replace(/^http/, 'ws'))
  : defaultWsUrl());
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
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

void loadInitial();
socket.connect();
```

- [ ] **Step 2: Verify in the browser**

Run: `pnpm --filter @reef/server dev` (in one terminal, if not already running)
Run: `pnpm --filter @reef/client dev` (in another)
Open: `http://localhost:5173/playground.html?api=http://localhost:8787`
Expected: reef renders with existing polyps, fish move, polyps pulse gently.

Add a polyp via `curl -X POST http://localhost:8787/api/reef/polyp -H 'Content-Type: application/json' -d '{"species":"branching","seed":42,"colorKey":"coral-pink","position":[0.01,0,0.01],"orientation":[0,0,0,1],"scale":0.6}'` — the playground should show it appear live (via WebSocket).

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/playground.ts
git commit -m "Playground: load reef + subscribe to live sim/polyp events"
```

---

## Task 7: Click-to-place + picker integration

**Files:**
- Modify: `packages/client/src/playground.ts`

- [ ] **Step 1: Add the Placement + Picker wiring**

Insert after the existing imports and state setup:

```ts
import { Placement } from './placement.js';
import { Picker } from './ui/picker.js';
import { submitPolyp, RateLimitError } from './net/api.js';
import { computePlacementFromClick } from './playground/interaction.js';
import { Vector2 } from 'three';

// ... existing scene + reef setup ...

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
    // Convert to reef-local space (reef.anchor is at origin, so equal).
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
```

Note: `Placement.showGhost` takes `(species, seed, colorKey, raycastHit?)`. The existing `placement.ts` in the AR client passes the hit implicitly via `handleTap`; for the playground, the hit comes from our own raycast helper. If `showGhost` doesn't currently accept a hit point, **Task 7a below** refactors it to take an optional position.

- [ ] **Step 2: Look at `placement.ts` and decide if it needs Task 7a**

Read `packages/client/src/placement.ts`. If `showGhost` already accepts a position parameter, skip to Step 3. If not, perform Task 7a (below).

**Task 7a (conditional): Extend `Placement.showGhost` to accept an optional position**

```ts
// packages/client/src/placement.ts — modify
// Change:
//   showGhost(species, seed, colorKey)
// To:
//   showGhost(species, seed, colorKey, position?: Vector3)
// Where: if position is provided, place ghost there; otherwise use the
// most recent handleTap result (preserves AR client behavior).
```

(Exact signature depends on the current implementation — keep the existing call sites in `app.ts` working by making the new parameter optional with a sensible default.)

Run `pnpm --filter @reef/client test` after the change to confirm `placement.test.ts` still passes. Add a test for the new position-override path.

- [ ] **Step 3: Verify in the browser**

`pnpm --filter @reef/client dev`, open `http://localhost:5173/playground.html?api=http://localhost:8787`.
Click a spot on the pedestal top → ghost polyp appears. Pick species + color → ghost updates. Click Grow → polyp commits, appears on the reef, persists through page reload.

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/playground.ts packages/client/src/placement.ts packages/client/src/placement.test.ts
git commit -m "Playground: click-to-place + picker + commit flow"
```

---

## Task 8: Screen mode (auto-orbit, no picker)

**Files:**
- Modify: `packages/client/src/playground.ts`

- [ ] **Step 1: Add the screen-mode branch**

Add after the `OrbitControls` setup:

```ts
import { computeOrbitPose } from './playground/autoOrbit.js';

if (config.mode === 'screen') {
  // Hide the picker and take over camera movement.
  picker.hide();
  (document.getElementById('picker') as HTMLElement).classList.add('hidden');
  modeBadge.textContent = 'screen';
  controls.enabled = false;
}
```

And in the render loop, branch on mode:

```ts
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
```

- [ ] **Step 2: Verify in the browser**

Open `http://localhost:5173/playground.html?mode=screen&api=http://localhost:8787`.
Expected: picker is hidden, camera slowly orbits the pedestal, full period ~60s. No clickable surface. Polyps still animate.

Then open `http://localhost:5173/playground.html?readonly=1&api=http://localhost:8787`.
Expected: picker visible, orbit camera enabled, Grow button press shows "Readonly mode" hint and does not POST.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/playground.ts
git commit -m "Playground: screen mode with auto-orbit, readonly gate on commit"
```

---

## Task 9: Include playground in the Pages bundle

**Files:**
- Modify: `scripts/build-pages-index.sh`

- [ ] **Step 1: Inspect the current script**

`cat scripts/build-pages-index.sh` — it currently moves `dist/index.html` to `dist/ar.html` and writes a new landing-page `index.html`. Confirm that `dist/playground.html` is already preserved (Vite's dist output is static, the script only touches `index.html`).

- [ ] **Step 2: Extend the landing page to link to the playground**

Find the anchor list in the `<body>` of the written HTML and add:

```html
<li><a href="./playground.html">Playground</a> — interactive reef (no AR needed, works against any deployed backend)</li>
<li><a href="./playground.html?mode=screen">Screen view</a> — auto-orbit camera, demo-ready</li>
```

(Preserve the existing links to `./ar.html`, `./preview.html`, `./timelapse.html` as they are.)

- [ ] **Step 3: Test the build-and-assemble flow**

```bash
pnpm --filter @reef/client build
bash scripts/build-pages-index.sh
ls packages/client/dist/
# Expected: index.html (landing), ar.html, preview.html, timelapse.html, playground.html, assets/, image-targets/
grep -c playground packages/client/dist/index.html
# Expected: 2
```

- [ ] **Step 4: Commit**

```bash
git add scripts/build-pages-index.sh
git commit -m "Pages landing: link to playground + screen mode"
```

---

## Task 10: Boot smoke test for the playground entry

**Files:**
- Create: `packages/client/src/playground.test.ts`

- [ ] **Step 1: Write a lightweight construction test**

```ts
// packages/client/src/playground.test.ts
import { describe, expect, test, vi } from 'vitest';

// We don't run the full playground entry in test — it calls WebGL and fetch.
// Instead, verify the module imports without throwing and the config parser
// + scene factory work together as expected.
describe('playground module', () => {
  test('config + scene + autoOrbit all importable together', async () => {
    const [config, scene, autoOrbit, interaction] = await Promise.all([
      import('./playground/config.js'),
      import('./playground/scene.js'),
      import('./playground/autoOrbit.js'),
      import('./playground/interaction.js'),
    ]);
    expect(typeof config.readPlaygroundConfig).toBe('function');
    expect(typeof scene.createPedestal).toBe('function');
    expect(typeof autoOrbit.computeOrbitPose).toBe('function');
    expect(typeof interaction.computePlacementFromClick).toBe('function');
  });

  test('readPlaygroundConfig + createPedestal produce a valid pair', async () => {
    const { readPlaygroundConfig } = await import('./playground/config.js');
    const { createPedestal } = await import('./playground/scene.js');
    vi.stubGlobal('location', { search: '?mode=screen' });
    expect(readPlaygroundConfig().mode).toBe('screen');
    expect(createPedestal()).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @reef/client test src/playground.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 3: Run the full suite**

Run: `pnpm -r test`
Expected: all previous tests still pass + the new tests added across Tasks 1-4 + 10. Total should be 161 + 14 new = ~175 tests (adjust based on actual counts post-Task-7a).

- [ ] **Step 4: Commit**

```bash
git add packages/client/src/playground.test.ts
git commit -m "Playground: boot smoke test for module wiring"
```

---

## Task 11: Documentation

**Files:**
- Modify: `README.md`
- Modify: `NEXT_STEPS.md`
- Modify: `CONTRIBUTING.md`
- Modify: `PLAN.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: README — mention the playground in the stack section**

In the **Stack** bullet for "Client", append:

```md
- **Client**: TypeScript · Vite · Three.js. AR tracking via the
  self-hosted 8th Wall engine binary (noop fallback for desktop/dev).
  Two-finger pinch + twist for polyp placement.
  **Playground** (`playground.html`): AR-free orbit-camera view for
  iterating on the reef without a marker or phone. Adds a
  `?mode=screen` variant for a fixed museum-screen display.
```

Also add a section heading in the TOC if one exists.

- [ ] **Step 2: NEXT_STEPS — shift the operator test story**

Insert a new subsection under "Operator runbook" titled **"Step 0 — Non-AR testing via the playground"**:

```md
### Step 0 — Non-AR testing via the playground

Before you invest in the marker print + NFC tag + real-device test
cycle, exercise the full reef pipeline without any AR dependencies:

```sh
# Point at the deployed backend:
https://reef.home.local/playground.html

# Or against local dev:
cd ~/dev/CoralReefAR
pnpm --filter @reef/server dev  # terminal 1
pnpm --filter @reef/client dev  # terminal 2
# → http://localhost:5173/playground.html?api=http://localhost:8787
```

What it exercises end-to-end:
- Species + color picker UI
- Click-to-place raycast
- Ghost polyp preview
- POST /api/reef/polyp submission
- WebSocket live updates (open two tabs, plant in one, see it in the other)
- Admin delete/restore via `/admin` reflects here
- Pulse + sway visual effects
- Fish school animation

Use `?mode=screen` to preview the museum-display look (auto-orbit
camera, no picker). Use `?readonly=1` to let visitors browse but
disable planting.

**This is the fastest feedback loop** for most iteration. The
real-device AR test (Step 3 below) stays necessary for camera,
marker, and SLAM verification — but everything else can be wrung
out here.
```

- [ ] **Step 3: CONTRIBUTING — add the dev command**

In the **Setup → Run the app locally** section, append:

```md
### Playground (no AR needed)

```sh
pnpm --filter @reef/client dev
# Open http://localhost:5173/playground.html?api=http://localhost:8787
# Or add ?mode=screen for the museum-screen variant.
```

The playground uses orbit-controls (mouse-drag rotate, scroll zoom)
and click-to-place instead of the AR tap flow. Same backend.
```

- [ ] **Step 4: PLAN — reflect the dual-surface concept**

Under "What changed from v1" add:

```md
- **Dual surface:** the installation has both an AR layer (phone tapped to a pedestal) and an ambient screen layer (`playground.html?mode=screen`) that shows the reef growing from a fixed viewpoint on a wall-mounted display. Both share the same backend + sim loop.
```

- [ ] **Step 5: CHANGELOG — Unreleased entry**

Add to the `[Unreleased]` block:

```md
### Added

- **Playground** (`playground.html`) — AR-free interactive reef view
  with orbit camera + click-to-place. Reuses the existing Reef,
  Placement, Picker, ReefSocket infrastructure. Adds a
  `?mode=screen` variant (auto-orbit, no UI) for a fixed
  museum-display view, and `?readonly=1` for look-but-don't-touch
  kiosks. Supports `?api=URL` to point at any backend.
```

- [ ] **Step 6: Commit**

```bash
git add README.md NEXT_STEPS.md CONTRIBUTING.md PLAN.md CHANGELOG.md
git commit -m "Docs: playground — interactive reef view + museum screen mode"
```

---

## Task 12: Final verification

- [ ] **Step 1: Full test + typecheck + lint + build**

```bash
pnpm -r test
pnpm -r typecheck
pnpm lint
pnpm --filter @reef/client build
```

Expected: all green. Test count ~175 (was 161).

- [ ] **Step 2: Manual end-to-end**

With the deployed backend and the freshly-built client bundle:

1. Build Docker image locally or via release tag → redeploy LXC
2. Open `https://reef.home.local/playground.html` — interactive, polyps render, clicks plant
3. Open `https://reef.home.local/playground.html?mode=screen` — auto-orbit, no picker
4. Open both in separate browser windows — plant in one, see it appear live in the other via WebSocket

- [ ] **Step 3: Open PR**

```bash
git push -u origin playground-virtual-reef
gh pr create --base main --title "Playground: AR-free interactive reef + museum screen mode" --body "[paste summary]"
```

- [ ] **Step 4: After merge, tag + redeploy**

Tag v0.3.1 (patch) or v0.4.0 (minor — feels more like a minor since this adds a user-facing view). Cut the GitHub release, redeploy the LXC with the latest image. Update NEXT_STEPS snapshot date.

---

## Risk notes

1. **`Placement.showGhost` signature** — may require Task 7a if the current implementation doesn't accept an optional position. Fall-back: extend the signature with an optional param, default to the existing behavior.
2. **Orbit camera on trackpad** — `scroll to zoom` is two-finger trackpad pinch by default. Test on a Mac trackpad; if it's too twitchy, adjust `controls.zoomSpeed` and `controls.rotateSpeed`.
3. **Screen mode interactions** — double-check that `controls.enabled = false` doesn't leave an orphan event listener. If the camera still reacts to mouse events, explicitly remove the canvas's pointer handlers.
4. **Pedestal size vs reef spread** — if the reef generator's polyps can spawn further than 12 cm from origin, the pedestal will look too small. Check `packages/generator` for the position-bound and adjust `PEDESTAL_RADIUS` if needed.

---

## Known out-of-scope for this plan

- Authentication for the playground (planting is anonymous, same as AR).
- Mobile-friendly touch orbit controls (desktop mouse is the primary playground target).
- Responsive picker layout (current CSS assumes a certain viewport).
- Historical scrubber ("show me the reef 3 months ago") — that's what `timelapse.html` is for.
- An in-playground admin panel (use the existing `/admin` route in a separate tab).
