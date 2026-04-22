import { describe, test, expect } from 'vitest';
import {
  Group, PerspectiveCamera, Vector3,
} from 'three';
import { Placement } from './placement.js';
import type { Reef } from './scene/reef.js';

// Minimal Reef stand-in — Placement only calls .all() (to enumerate mesh
// candidates for raycasting) and .densityNudge (to adjust a local-anchor
// position). An empty reef forces the ray to intersect the pedestal plane,
// which keeps the test away from Three's geometry machinery.
function makeFakeReef(): Reef {
  return {
    all: () => [] as const,
    densityNudge: (p: Vector3) => p.clone(),
  } as unknown as Reef;
}

// Build a Placement with handleTap-derived lastResult on the pedestal plane.
function setupPlacementWithLastResult(): Placement {
  const anchor = new Group();
  const camera = new PerspectiveCamera(60, 1, 0.01, 30);
  // Position camera above and looking down so a screen-center ray hits the
  // XZ pedestal plane (y=0) in front.
  camera.position.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);
  const placement = new Placement(makeFakeReef(), camera, anchor);
  const result = placement.handleTap(50, 50, 100, 100);
  if (!result) throw new Error('setup failed: handleTap returned null');
  return placement;
}

describe('Placement.applyGesture', () => {
  test('no-op when no lastResult (tap never succeeded)', () => {
    const anchor = new Group();
    const camera = new PerspectiveCamera(60, 1, 0.01, 30);
    const placement = new Placement(makeFakeReef(), camera, anchor);
    // Should not throw even with no lastResult seeded.
    placement.applyGesture({ rotateRadians: 1, scaleFactor: 2 });
    expect(placement.getLast()).toBeNull();
  });

  test('scale 1.5x twice -> 2.25x', () => {
    const placement = setupPlacementWithLastResult();
    expect(placement.getLast()?.scale).toBe(1);
    placement.applyGesture({ rotateRadians: 0, scaleFactor: 1.5 });
    expect(placement.getLast()?.scale).toBeCloseTo(1.5, 5);
    placement.applyGesture({ rotateRadians: 0, scaleFactor: 1.5 });
    expect(placement.getLast()?.scale).toBeCloseTo(2.25, 5);
  });

  test('scale clamps to [0.3, 3]', () => {
    const placement = setupPlacementWithLastResult();
    for (let i = 0; i < 10; i++) {
      placement.applyGesture({ rotateRadians: 0, scaleFactor: 2 });
    }
    expect(placement.getLast()?.scale).toBe(3);

    for (let i = 0; i < 10; i++) {
      placement.applyGesture({ rotateRadians: 0, scaleFactor: 0.5 });
    }
    expect(placement.getLast()?.scale).toBe(0.3);
  });

  test('rotation composes — 4 quarter-turns return to start', () => {
    const placement = setupPlacementWithLastResult();
    const startAngle = 0;
    const startQuat = placement.getLast()!.orientation.clone();
    for (let i = 0; i < 4; i++) {
      placement.applyGesture({ rotateRadians: Math.PI / 2, scaleFactor: 1 });
    }
    const endQuat = placement.getLast()!.orientation;
    // Quaternion equivalence: dot product ±1 means same rotation (or q and -q).
    const dot = startQuat.x * endQuat.x + startQuat.y * endQuat.y + startQuat.z * endQuat.z + startQuat.w * endQuat.w;
    expect(Math.abs(Math.abs(dot) - 1)).toBeLessThan(1e-6);
    expect(startAngle).toBe(0);
  });

  test('orientation stays unit length after many compositions (normalize keeps drift at ulp)', () => {
    const placement = setupPlacementWithLastResult();
    for (let i = 0; i < 600; i++) {
      placement.applyGesture({ rotateRadians: 0.01, scaleFactor: 1 });
    }
    const q = placement.getLast()!.orientation;
    const len = Math.hypot(q.x, q.y, q.z, q.w);
    expect(Math.abs(len - 1)).toBeLessThan(1e-10);
  });
});

describe('Placement.reset', () => {
  test('clears lastResult and ghost', () => {
    const placement = setupPlacementWithLastResult();
    expect(placement.getLast()).not.toBeNull();
    placement.reset();
    expect(placement.getLast()).toBeNull();
  });
});

describe('Placement.showGhost positionOverride', () => {
  test('showGhost with positionOverride seeds lastResult without needing handleTap first', () => {
    const anchor = new Group();
    const camera = new PerspectiveCamera(60, 1, 0.01, 30);
    const placement = new Placement(makeFakeReef(), camera, anchor);

    // Precondition: no lastResult until handleTap (or override) runs.
    expect(placement.getLast()).toBeNull();

    const override = new Vector3(0.03, 0, 0.02);
    placement.showGhost('branching', 1234, 'coral-pink', override);

    const r = placement.getLast();
    expect(r).not.toBeNull();
    expect(r!.position.x).toBeCloseTo(0.03, 6);
    expect(r!.position.z).toBeCloseTo(0.02, 6);
    expect(r!.normal.y).toBeCloseTo(1, 6);
    expect(r!.scale).toBe(1);
  });
});
