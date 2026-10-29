import { describe, test, expect } from 'vitest';
import { Group, Object3D } from 'three';
import type { PublicPolyp } from '@reef/shared';
import { createSnapshotScene } from './reefDiff.js';

const p = (id: number): PublicPolyp => ({
  id, species: 'branching', seed: id, colorKey: 'coral-pink',
  position: [0, 0, 0], orientation: [0, 0, 0, 1], scale: 1, createdAt: 0,
});

function setup() {
  const group = new Group();
  const made: number[] = [];
  const disposed: number[] = [];
  const scene = createSnapshotScene(group, {
    makeNode: (polyp) => { made.push(polyp.id); const o = new Object3D(); o.userData.id = polyp.id; return o; },
    disposeNode: (o) => { disposed.push(o.userData.id as number); },
  });
  return { group, scene, made, disposed };
}

describe('createSnapshotScene', () => {
  test('first snapshot builds every polyp', () => {
    const { group, scene, made } = setup();
    expect(scene.apply({ polyps: [p(1), p(2)] })).toEqual({ added: 2, removed: 0 });
    expect(made).toEqual([1, 2]);
    expect(group.children).toHaveLength(2);
  });

  test('a later snapshot only generates new polyps and drops missing ones', () => {
    const { group, scene, made, disposed } = setup();
    scene.apply({ polyps: [p(1), p(2), p(3)] });
    made.length = 0;
    expect(scene.apply({ polyps: [p(1), p(3), p(4)] })).toEqual({ added: 1, removed: 1 });
    expect(made).toEqual([4]);
    expect(disposed).toEqual([2]);
    expect(group.children.map((c) => c.userData.id).sort()).toEqual([1, 3, 4]);
  });

  test('scrubbing backwards removes polyps that did not exist yet', () => {
    const { group, scene } = setup();
    scene.apply({ polyps: [p(1), p(2), p(3)] });
    scene.apply({ polyps: [p(1)] });
    expect(group.children).toHaveLength(1);
  });

  test('clear() disposes everything', () => {
    const { group, scene, disposed } = setup();
    scene.apply({ polyps: [p(1), p(2)] });
    scene.clear();
    expect(group.children).toHaveLength(0);
    expect(disposed.sort()).toEqual([1, 2]);
  });

  test('re-applying the same snapshot is a no-op', () => {
    const { scene } = setup();
    scene.apply({ polyps: [p(1)] });
    expect(scene.apply({ polyps: [p(1)] })).toEqual({ added: 0, removed: 0 });
  });
});
