import { Group, type Object3D } from 'three';
import type { PresenceVisitor } from '@reef/shared';
import { Clownfish } from '../../tree/clownfish.js';
import { disposeTree } from '../../scene/dispose.js';
import { PresenceBuffer } from './presenceBuffer.js';

/** The tree-mode clownfish is ~3 cm; at head height a visitor needs to read from across a room. */
export const VISITOR_FISH_SCALE = 4;

/**
 * Other visitors drawn as clownfish at their (reef-local) head pose. Parent
 * `object3d` under the reef anchor so poses land in this headset's room.
 * Each fish faces where its visitor is looking (fish nose is -Z, like the gaze).
 */
export class VisitorFish {
  readonly object3d = new Group();
  private readonly buffer = new PresenceBuffer();
  private readonly fish = new Map<string, Object3D>();

  ingest(visitors: readonly PresenceVisitor[], now: number): void {
    this.buffer.push(visitors, now);
  }

  update(now: number): void {
    for (const id of this.buffer.cull(now)) this.removeFish(id);
    this.buffer.sample(now, (id, p, q) => {
      let f = this.fish.get(id);
      if (!f) {
        f = new Clownfish().group;
        f.scale.setScalar(VISITOR_FISH_SCALE);
        this.fish.set(id, f);
        this.object3d.add(f);
      }
      f.position.copy(p);
      f.quaternion.copy(q);
    });
  }

  count(): number {
    return this.fish.size;
  }

  clear(): void {
    for (const id of this.fish.keys()) this.removeFish(id);
    this.buffer.clear();
  }

  private removeFish(id: string): void {
    const f = this.fish.get(id);
    if (!f) return;
    this.object3d.remove(f);
    disposeTree(f);
    this.fish.delete(id);
  }
}
