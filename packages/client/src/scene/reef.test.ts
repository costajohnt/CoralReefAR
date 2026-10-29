import { describe, test, expect } from 'vitest';
import type { PublicPolyp } from '@reef/shared';
import { Reef, MINE_RING_NAME } from './reef.js';

function polyp(id: number): PublicPolyp {
  return {
    id, species: 'branching', seed: id, colorKey: 'coral-pink',
    position: [0, 0, 0], orientation: [0, 0, 0, 1], scale: 1, createdAt: 0,
  };
}

function ringOf(reef: Reef, id: number) {
  const node = [...reef.all()].find((o) => (o.userData.polyp as PublicPolyp).id === id)!;
  return node.getObjectByName(MINE_RING_NAME);
}

describe('Reef "mine" highlight', () => {
  test('markMine on an existing polyp adds a ring; unmarkMine removes it', () => {
    const reef = new Reef();
    reef.addPolyp(polyp(1));
    reef.markMine(1);
    expect(ringOf(reef, 1)).toBeDefined();
    expect(reef.mineCount()).toBe(1);
    reef.unmarkMine(1);
    expect(ringOf(reef, 1)).toBeUndefined();
    expect(reef.mineCount()).toBe(0);
  });

  test('markMine before the polyp arrives applies the ring on add', () => {
    const reef = new Reef();
    reef.markMine(2);
    expect(reef.mineCount()).toBe(0);
    reef.addPolyp(polyp(2));
    expect(ringOf(reef, 2)).toBeDefined();
    expect(reef.mineCount()).toBe(1);
  });

  test('markMine is idempotent (one ring)', () => {
    const reef = new Reef();
    reef.addPolyp(polyp(3));
    reef.markMine(3);
    reef.markMine(3);
    const node = [...reef.all()][0]!;
    expect(node.children.filter((c) => c.name === MINE_RING_NAME)).toHaveLength(1);
  });

  test('other polyps are not highlighted; removing a mine polyp drops it from the count', () => {
    const reef = new Reef();
    reef.addPolyp(polyp(4));
    reef.addPolyp(polyp(5));
    reef.markMine(5);
    expect(ringOf(reef, 4)).toBeUndefined();
    reef.removePolyp(5);
    expect(reef.mineCount()).toBe(0);
  });
});
