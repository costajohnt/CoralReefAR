import { describe, expect, test } from 'vitest';
import {
  AUTO_ORBIT_PERIOD_SEC,
  AUTO_ORBIT_RADIUS,
  AUTO_ORBIT_HEIGHT,
  computeCinematicPose,
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

describe('computeCinematicPose', () => {
  const dist = (a: { x: number; z: number }) => Math.hypot(a.x, a.z);

  test('is deterministic for a given time', () => {
    const a = computeCinematicPose(123.4);
    const b = computeCinematicPose(123.4);
    expect(a.position.toArray()).toEqual(b.position.toArray());
  });

  test('drifts radius and height within bounds around the base orbit', () => {
    let minR = Infinity, maxR = 0, minY = Infinity, maxY = -Infinity;
    for (let t = 0; t < 600; t += 0.5) {
      const p = computeCinematicPose(t).position;
      minR = Math.min(minR, dist(p)); maxR = Math.max(maxR, dist(p));
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
    expect(maxR - minR).toBeGreaterThan(0.02); // it actually drifts
    expect(minR).toBeGreaterThan(AUTO_ORBIT_RADIUS * 0.8);
    expect(maxR).toBeLessThan(AUTO_ORBIT_RADIUS * 1.2);
    expect(minY).toBeGreaterThan(0.1);
    expect(maxY).toBeLessThan(0.32);
  });

  test('does not simply repeat every orbit period (idle variation)', () => {
    const a = computeCinematicPose(10).position;
    const b = computeCinematicPose(10 + AUTO_ORBIT_PERIOD_SEC * 2).position;
    expect(a.distanceTo(b)).toBeGreaterThan(0.005);
  });

  test('moves smoothly: no jumps between consecutive frames', () => {
    for (let t = 0; t < 300; t += 7.3) {
      const a = computeCinematicPose(t).position;
      const b = computeCinematicPose(t + 1 / 60).position;
      expect(a.distanceTo(b)).toBeLessThan(0.002);
    }
  });

  test('reduced motion: no drift and a slower orbit', () => {
    const r0 = dist(computeCinematicPose(0, { reducedMotion: true }).position);
    for (const t of [5, 50, 500]) {
      const p = computeCinematicPose(t, { reducedMotion: true }).position;
      expect(dist(p)).toBeCloseTo(r0, 6);
      expect(p.y).toBeCloseTo(AUTO_ORBIT_HEIGHT, 6);
    }
    const step = (o?: { reducedMotion: boolean }) =>
      computeCinematicPose(0, o).position.distanceTo(computeCinematicPose(1, o).position);
    expect(step({ reducedMotion: true })).toBeLessThan(step() * 0.75);
  });

  test('target stays near the reef (gentle bob only)', () => {
    for (let t = 0; t < 300; t += 11) {
      const { target } = computeCinematicPose(t);
      expect(Math.abs(target.x)).toBe(0);
      expect(Math.abs(target.z)).toBe(0);
      expect(target.y).toBeGreaterThanOrEqual(0);
      expect(target.y).toBeLessThan(0.05);
    }
  });
});
