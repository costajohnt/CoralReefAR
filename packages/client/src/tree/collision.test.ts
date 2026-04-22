import { describe, expect, test } from 'vitest';
import { Box3, Vector3 } from 'three';
import { wouldCollide } from './collision.js';

function box(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): Box3 {
  return new Box3(new Vector3(minX, minY, minZ), new Vector3(maxX, maxY, maxZ));
}

describe('wouldCollide', () => {
  test('returns false when no existing boxes overlap the proposal', () => {
    const proposed = box(0, 0, 0, 1, 1, 1);
    const others = [box(2, 0, 0, 3, 1, 1), box(-3, 0, 0, -2, 1, 1)];
    expect(wouldCollide(proposed, others)).toBe(false);
  });

  test('returns true when the proposal overlaps any existing box', () => {
    const proposed = box(0, 0, 0, 1, 1, 1);
    const others = [box(2, 0, 0, 3, 1, 1), box(0.5, 0.5, 0.5, 1.5, 1.5, 1.5)];
    expect(wouldCollide(proposed, others)).toBe(true);
  });

  test('touching boxes at a shared face count as intersecting (Three.js behavior)', () => {
    const proposed = box(0, 0, 0, 1, 1, 1);
    const others = [box(1, 0, 0, 2, 1, 1)];  // shares the x=1 face
    expect(wouldCollide(proposed, others)).toBe(true);
  });

  test('no existing boxes → no collision', () => {
    const proposed = box(0, 0, 0, 1, 1, 1);
    expect(wouldCollide(proposed, [])).toBe(false);
  });
});
