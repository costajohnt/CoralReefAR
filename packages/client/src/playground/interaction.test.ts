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
    const ndc = new Vector2(0, 0);
    const result = computePlacementFromClick(ndc, cam);
    expect(result).not.toBeNull();
    expect(result!.y).toBeCloseTo(0, 4);
    expect(Math.hypot(result!.x, result!.z)).toBeLessThan(0.5);
  });

  test('click at top edge of screen (ndc y=1) misses the pedestal plane, returns null', () => {
    const cam = makeCamera();
    const ndc = new Vector2(0, 0.95);
    const result = computePlacementFromClick(ndc, cam);
    if (result !== null) {
      expect(Math.hypot(result.x, result.z)).toBeGreaterThan(0.12);
    }
  });

  test('clicks outside the pedestal radius clamp to null', () => {
    const cam = makeCamera();
    const ndc = new Vector2(0.8, -0.5);
    const result = computePlacementFromClick(ndc, cam, 0.12);
    expect(result).toBeNull();
  });
});
