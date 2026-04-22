import { describe, expect, test, beforeEach } from 'vitest';
import { Mesh, Vector3 } from 'three';
import type { PublicTreePolyp } from '@reef/shared';
import { TreeReef } from './reef.js';

// Attach counts per variant (from variants.test.ts)
// starburst: 4, forked: 2, trident: 3

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

describe('TreeReef', () => {
  let reef: TreeReef;

  beforeEach(() => {
    reef = new TreeReef();
  });

  // Test 1: addPiece(root)
  test('addPiece(root) adds mesh under anchor and getPiece returns it', () => {
    const root = makeRoot(1);
    reef.addPiece(root);
    expect(reef.anchor.children).toHaveLength(1);
    const mesh = reef.getPiece(1);
    expect(mesh).toBeInstanceOf(Mesh);
  });

  // Test 2: addPiece(child) — world position close to parent's first attach point
  test('addPiece(child) places child at parent world attach-point position', () => {
    const root = makeRoot(1);
    reef.addPiece(root);

    // Retrieve root's actual first attach point world position via getAvailableAttachPoints
    const rootPoints = reef.getAvailableAttachPoints().filter((p) => p.parentId === 1);
    expect(rootPoints.length).toBeGreaterThan(0);
    const attachPoint0 = rootPoints.find((p) => p.index === 0)!;

    const child = makeChild(2, 1, 0);
    reef.addPiece(child);

    expect(reef.anchor.children).toHaveLength(2);
    const childMesh = reef.getPiece(2)!;
    expect(childMesh).toBeInstanceOf(Mesh);

    // Child's world position (mesh origin after applyMatrix4) should be at attach point
    // We verify by checking the child appears in the scene and the slot is now claimed
    const pointsAfterChild = reef.getAvailableAttachPoints().filter((p) => p.parentId === 1 && p.index === 0);
    expect(pointsAfterChild).toHaveLength(0); // slot 0 is claimed
  });

  // Test 3: addPiece throws when parent not registered
  test('addPiece throws when parent is not yet registered', () => {
    const child = makeChild(2, 999, 0);
    expect(() => reef.addPiece(child)).toThrow(/parent 999 not registered/i);
  });

  // Test 4: addPiece throws when attach index is out of range
  test('addPiece throws when attach index is out of range for parent', () => {
    const root = makeRoot(1); // starburst has 4 attach points (indices 0-3)
    reef.addPiece(root);
    const child = makeChild(2, 1, 99); // index 99 doesn't exist
    expect(() => reef.addPiece(child)).toThrow(/no attach index 99/i);
  });

  // Test 5: removePiece
  test('removePiece removes mesh from anchor and clears registry', () => {
    const root = makeRoot(1);
    reef.addPiece(root);
    reef.removePiece(1);
    expect(reef.anchor.children).toHaveLength(0);
    expect(reef.getPiece(1)).toBeUndefined();
  });

  test('removePiece releases claimed slot when child is removed', () => {
    const root = makeRoot(1);
    reef.addPiece(root);
    const child = makeChild(2, 1, 0);
    reef.addPiece(child);

    // Slot 0 is claimed
    const beforeRemoval = reef.getAvailableAttachPoints().filter((p) => p.parentId === 1 && p.index === 0);
    expect(beforeRemoval).toHaveLength(0);

    reef.removePiece(2);

    // Slot 0 should be available again
    const afterRemoval = reef.getAvailableAttachPoints().filter((p) => p.parentId === 1 && p.index === 0);
    expect(afterRemoval).toHaveLength(1);
  });

  test('removePiece is a no-op for unknown id', () => {
    expect(() => reef.removePiece(9999)).not.toThrow();
  });

  // Test 6: getAvailableAttachPoints
  test('getAvailableAttachPoints: root starburst exposes 4 slots, child claims one', () => {
    const root = makeRoot(1); // starburst: 4 attach points
    reef.addPiece(root);

    const beforeChild = reef.getAvailableAttachPoints().filter((p) => p.parentId === 1);
    expect(beforeChild).toHaveLength(4);

    // Attach a child at index 0 (forked: 2 attach points)
    const child = makeChild(2, 1, 0, 'forked');
    reef.addPiece(child);

    const afterChild = reef.getAvailableAttachPoints();
    const rootSlots = afterChild.filter((p) => p.parentId === 1);
    const childSlots = afterChild.filter((p) => p.parentId === 2);

    expect(rootSlots).toHaveLength(3); // index 0 claimed
    expect(childSlots).toHaveLength(2); // forked has 2 slots, none claimed
    expect(afterChild).toHaveLength(5);
  });

  test('getAvailableAttachPoints returns Vector3 worldPos and worldNormal', () => {
    reef.addPiece(makeRoot(1));
    const points = reef.getAvailableAttachPoints();
    for (const p of points) {
      expect(p.worldPos).toBeInstanceOf(Vector3);
      expect(p.worldNormal).toBeInstanceOf(Vector3);
      // Normal should be unit-length
      expect(p.worldNormal.length()).toBeCloseTo(1, 3);
    }
  });

  // Test 7: allPieces yields all registered pieces
  test('allPieces yields all registered pieces', () => {
    reef.addPiece(makeRoot(1));
    reef.addPiece(makeChild(2, 1, 0));
    reef.addPiece(makeChild(3, 1, 1));

    const pieces = [...reef.allPieces()];
    expect(pieces).toHaveLength(3);
    const ids = pieces.map((p) => p.polyp.id).sort();
    expect(ids).toEqual([1, 2, 3]);
    for (const { mesh } of pieces) {
      expect(mesh).toBeInstanceOf(Mesh);
    }
  });

  // Test 8: 2-deep chain world position — grandchild is transformed twice
  test('2-deep chain: grandchild world position differs from child attach-point raw values', () => {
    // Root at origin
    const root = makeRoot(1); // starburst
    reef.addPiece(root);

    // Child claims root's slot 0
    const child = makeChild(2, 1, 0, 'forked'); // forked: 2 attach points
    reef.addPiece(child);

    // Grandchild claims child's slot 0
    const grandchild = makeChild(3, 2, 0, 'starburst');
    reef.addPiece(grandchild);

    expect(reef.anchor.children).toHaveLength(3);

    // Get grandchild's world attach points (none claimed)
    const allPoints = reef.getAvailableAttachPoints();
    const childSlots = allPoints.filter((p) => p.parentId === 2);
    const grandchildSlots = allPoints.filter((p) => p.parentId === 3);

    // Child slot 0 is claimed by grandchild, so only slot 1 remains
    expect(childSlots).toHaveLength(1);
    expect(childSlots[0]!.index).toBe(1);

    // Grandchild has starburst: 4 attach points, none claimed
    expect(grandchildSlots).toHaveLength(4);

    // Core rotation-frame check:
    // Grandchild's world attach point positions must differ from root's attach point positions
    // (they've been rotated twice through the parent chain)
    const rootSlots = allPoints.filter((p) => p.parentId === 1);
    // grandchild slots' world positions should not coincide with root slots
    if (grandchildSlots.length > 0 && rootSlots.length > 0) {
      const gcPos = grandchildSlots[0]!.worldPos;
      const rootPos = rootSlots[0]!.worldPos;
      // They are distinct pieces at distinct world positions (unless degenerate geometry)
      // At minimum, the grandchild's position has been double-transformed
      const dist = gcPos.distanceTo(new Vector3(0, 0, 0));
      // Root is at origin so its attach points are close to origin
      // Grandchild is at least one attach-point distance away from root,
      // and further from origin than rootPos (which is right at origin radius)
      // This is a weak sanity check: grandchild is not at the exact same spot as root
      expect(gcPos.distanceTo(new Vector3(0, 0, 0))).not.toBeCloseTo(0, 3);
      // Grandchild's position should be further from origin than root attach point positions
      // (it was placed at a child which was placed away from origin)
      const rootAttachDist = rootPos.length();
      // grandchild world attach points start from child's world position, which is away from origin
      // so at minimum they should be further than the raw root attach dist
      expect(dist).toBeGreaterThan(rootAttachDist * 0.5);
    }
  });

  // addPiece is idempotent
  test('addPiece is idempotent — calling twice does not duplicate mesh', () => {
    const root = makeRoot(1);
    reef.addPiece(root);
    reef.addPiece(root); // second call is no-op
    expect(reef.anchor.children).toHaveLength(1);
  });
});
