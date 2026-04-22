import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Box3, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { PublicTreePolyp } from '@reef/shared';
import { TreeReef } from './reef.js';
import { TreePlacement } from './placement.js';

function makeRoot(id = 1): PublicTreePolyp {
  return {
    id,
    variant: 'starburst',
    seed: 42,
    colorKey: 'neon-cyan',
    parentId: null,
    attachIndex: 0,
    createdAt: Date.now(),
  };
}

function makeChild(
  id: number,
  parentId: number,
  attachIndex = 0,
  variant: PublicTreePolyp['variant'] = 'forked',
): PublicTreePolyp {
  return {
    id,
    variant,
    seed: id * 7,
    colorKey: 'neon-magenta',
    parentId,
    attachIndex,
    createdAt: Date.now() + id,
  };
}

describe('TreePlacement', () => {
  let reef: TreeReef;
  let placement: TreePlacement;

  beforeEach(() => {
    reef = new TreeReef();
    placement = new TreePlacement(reef);
  });

  // Test 1: valid parent + index returns a Mesh and adds it to ghostAnchor
  test('showGhost with valid parent + index returns a Mesh and adds it to ghostAnchor', () => {
    reef.addPiece(makeRoot(1)); // starburst: 4 attach points

    const ghost = placement.showGhost('forked', 99, 'neon-cyan', 1, 0);

    expect(ghost).toBeInstanceOf(Mesh);
    expect(placement.ghostAnchor.children).toHaveLength(1);
    expect(placement.ghostAnchor.children[0]).toBe(ghost);
  });

  // Test 2: unknown parentId returns null
  test('showGhost with unknown parentId returns null and leaves ghostAnchor empty', () => {
    const ghost = placement.showGhost('forked', 1, 'neon-cyan', 9999, 0);

    expect(ghost).toBeNull();
    expect(placement.ghostAnchor.children).toHaveLength(0);
  });

  // Test 3: out-of-range attachIndex returns null
  test('showGhost with out-of-range attachIndex returns null', () => {
    reef.addPiece(makeRoot(1)); // starburst has 4 attach points (0–3)

    const ghost = placement.showGhost('forked', 1, 'neon-cyan', 1, 99);

    expect(ghost).toBeNull();
    expect(placement.ghostAnchor.children).toHaveLength(0);
  });

  // Test 4: collision rejection via mocked allWorldBoxes
  test('showGhost returns null when the proposed AABB overlaps existing pieces', () => {
    reef.addPiece(makeRoot(1));

    // Mock allWorldBoxes to return a box that definitely covers world-space origin region,
    // which is where the ghost for attach index 0 of the root starburst would be placed.
    // By returning a very large box, we guarantee intersection with any proposed placement.
    const hugeBox = new Box3(new Vector3(-100, -100, -100), new Vector3(100, 100, 100));
    vi.spyOn(reef, 'allWorldBoxes').mockImplementation(function* () {
      yield hugeBox;
    });

    const ghost = placement.showGhost('forked', 1, 'neon-cyan', 1, 0);

    expect(ghost).toBeNull();
    expect(placement.ghostAnchor.children).toHaveLength(0);
  });

  // Test 5: ghost material is semi-transparent
  test('showGhost sets the ghost material to transparent with reduced opacity', () => {
    reef.addPiece(makeRoot(1));

    const ghost = placement.showGhost('forked', 1, 'neon-cyan', 1, 0);

    expect(ghost).not.toBeNull();
    const mat = ghost!.material as MeshStandardMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBeCloseTo(0.45, 5);
    expect(mat.emissiveIntensity).toBeCloseTo(0.6, 5);
  });

  // Test 6: reset removes ghost from ghostAnchor and clears pending
  test('reset removes the ghost from ghostAnchor and clears pending', () => {
    reef.addPiece(makeRoot(1));

    const ghost = placement.showGhost('forked', 1, 'neon-cyan', 1, 0);
    expect(ghost).not.toBeNull();
    expect(placement.ghostAnchor.children).toHaveLength(1);
    expect(placement.getPending()).not.toBeNull();

    placement.reset();

    expect(placement.ghostAnchor.children).toHaveLength(0);
    expect(placement.getPending()).toBeNull();
  });

  // Test 7: getPending returns the correct pending intent
  test('getPending returns the current pending intent', () => {
    reef.addPiece(makeRoot(1));

    expect(placement.getPending()).toBeNull();

    placement.showGhost('trident', 77, 'neon-magenta', 1, 2);

    const pending = placement.getPending();
    expect(pending).not.toBeNull();
    expect(pending!.variant).toBe('trident');
    expect(pending!.seed).toBe(77);
    expect(pending!.colorKey).toBe('neon-magenta');
    expect(pending!.parentId).toBe(1);
    expect(pending!.attachIndex).toBe(2);
  });

  // Bonus: calling showGhost twice replaces the first ghost (reset is called internally)
  test('calling showGhost twice replaces the first ghost — ghostAnchor never accumulates', () => {
    reef.addPiece(makeRoot(1)); // starburst: 4 slots (0–3)

    const first = placement.showGhost('forked', 1, 'neon-cyan', 1, 0);
    expect(placement.ghostAnchor.children).toHaveLength(1);

    const second = placement.showGhost('forked', 2, 'neon-magenta', 1, 1);
    expect(placement.ghostAnchor.children).toHaveLength(1);
    expect(placement.ghostAnchor.children[0]).toBe(second);
    expect(placement.ghostAnchor.children[0]).not.toBe(first);
  });

  // Extra: ghostAnchor is a Group (verifying the public property type)
  test('ghostAnchor is a Group', () => {
    expect(placement.ghostAnchor).toBeInstanceOf(Group);
  });
});
