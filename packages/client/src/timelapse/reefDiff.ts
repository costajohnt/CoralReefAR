import type { Group, Object3D } from 'three';
import type { PublicPolyp } from '@reef/shared';
import type { SnapshotBody } from './player.js';

export interface SnapshotSceneDeps {
  makeNode(p: PublicPolyp): Object3D;
  disposeNode(o: Object3D): void;
}

export interface SnapshotScene {
  /** Make the group show exactly this snapshot's polyps. */
  apply(body: SnapshotBody): { added: number; removed: number };
  clear(): void;
}

/**
 * Applies snapshots as a diff keyed by polyp id. Consecutive daily snapshots
 * share almost every polyp, so stepping forward only generates the new ones
 * instead of rebuilding the whole reef. That keeps playback and video
 * recording from stalling on mesh generation, and the scene only ever holds
 * the current snapshot's meshes.
 */
export function createSnapshotScene(group: Group, deps: SnapshotSceneDeps): SnapshotScene {
  const nodes = new Map<number, Object3D>();

  const drop = (id: number, node: Object3D): void => {
    group.remove(node);
    deps.disposeNode(node);
    nodes.delete(id);
  };

  return {
    apply(body) {
      const want = new Set(body.polyps.map((p) => p.id));
      let removed = 0;
      for (const [id, node] of nodes) {
        if (!want.has(id)) { drop(id, node); removed++; }
      }
      let added = 0;
      for (const p of body.polyps) {
        // Relies on polyp rows being immutable (id → same species/seed/colour/pose).
        if (nodes.has(p.id)) continue;
        const node = deps.makeNode(p);
        group.add(node);
        nodes.set(p.id, node);
        added++;
      }
      return { added, removed };
    },
    clear() {
      // Deleting the current entry during Map iteration is safe.
      for (const [id, node] of nodes) drop(id, node);
    },
  };
}
