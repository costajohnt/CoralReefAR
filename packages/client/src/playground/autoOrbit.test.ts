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
