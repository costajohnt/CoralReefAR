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

  test('returns true when a proposal deeply overlaps an existing box', () => {
    const proposed = box(0, 0, 0, 1, 1, 1);
    // Overlap is >15% per side, well past the shrink tolerance.
    const others = [box(2, 0, 0, 3, 1, 1), box(0.3, 0.3, 0.3, 1.3, 1.3, 1.3)];
    expect(wouldCollide(proposed, others)).toBe(true);
  });

  test('boxes touching at a shared face do NOT collide (shrink tolerance)', () => {
    // Shrink factor intentionally permits coral-nodule grazing on the
    // AABB surface. Two unit boxes sharing x=1 have shrunk extents
    // [0.075, 0.925] and [1.075, 1.925] — clear of each other.
    const proposed = box(0, 0, 0, 1, 1, 1);
    const others = [box(1, 0, 0, 2, 1, 1)];
    expect(wouldCollide(proposed, others)).toBe(false);
  });

  test('boxes that overlap past the shrink tolerance still collide', () => {
    // Centers 0.8 apart on X, shrunk half-extent 0.425: shrunk boxes
    // cover [0.075, 0.925] and [0.875, 1.725] — overlap 0.05 on X.
    const proposed = box(0, 0, 0, 1, 1, 1);
    const others = [box(0.8, 0, 0, 1.8, 1, 1)];
    expect(wouldCollide(proposed, others)).toBe(true);
  });

  test('no existing boxes → no collision', () => {
    const proposed = box(0, 0, 0, 1, 1, 1);
    expect(wouldCollide(proposed, [])).toBe(false);
  });
});
