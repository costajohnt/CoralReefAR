import {
  DoubleSide, Group, Mesh, MeshBasicMaterial, Object3D, RingGeometry, Vector3,
} from 'three';
import type { PublicPolyp, SimDelta } from '@reef/shared';
import { generatePolyp } from '@reef/generator';
import { polypMesh } from './meshAdapter.js';
import { applySimDecoration } from './simDecor.js';
import { disposeTree } from './dispose.js';

/**
 * Owns the scene graph for the reef. The anchor group is the coordinate
 * system provided by the tracker; everything lives under it so when the
 * anchor pose updates, the entire reef follows.
 */
export const MINE_RING_NAME = 'mine-ring';

/**
 * Flat glowing ring around a polyp's base marking it as planted from this
 * device. Sized from the polyp's horizontal footprint; a child of the polyp
 * node so it inherits pose/scale and is disposed with it.
 */
function mineRing(node: Object3D): Mesh {
  // Local (unscaled) geometry bounds: the node may still be at its 0.001
  // grow-in scale, and the ring inherits the node's scale anyway.
  const geom = (node as Mesh).geometry;
  let r = 0.02;
  if (geom) {
    if (!geom.boundingBox) geom.computeBoundingBox();
    const b = geom.boundingBox;
    if (b) r = Math.max(0.005, Math.abs(b.min.x), b.max.x, Math.abs(b.min.z), b.max.z) * 1.15;
  }
  const ring = new Mesh(
    new RingGeometry(r * 0.85, r, 48),
    new MeshBasicMaterial({
      color: 0x7fffd4, transparent: true, opacity: 0.75, side: DoubleSide, depthWrite: false,
    }),
  );
  ring.name = MINE_RING_NAME;
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.0005;
  return ring;
}

export class Reef {
  readonly anchor = new Group();
  private readonly polypsById = new Map<number, Object3D>();
  // Ids planted from this device. Kept independently of polypsById so a mark
  // that arrives before the polyp (WS/HTTP ordering) applies once it's added.
  private readonly mine = new Set<number>();

  markMine(id: number): void {
    this.mine.add(id);
    const node = this.polypsById.get(id);
    if (node && !node.getObjectByName(MINE_RING_NAME)) node.add(mineRing(node));
  }

  unmarkMine(id: number): void {
    this.mine.delete(id);
    const ring = this.polypsById.get(id)?.getObjectByName(MINE_RING_NAME);
    if (ring) {
      ring.removeFromParent();
      disposeTree(ring);
    }
  }

  /** Number of this device's polyps currently in the scene. */
  mineCount(): number {
    let n = 0;
    for (const id of this.mine) if (this.polypsById.has(id)) n++;
    return n;
  }

  clear(): void {
    for (const obj of this.polypsById.values()) {
      this.anchor.remove(obj);
      disposeTree(obj);
    }
    this.polypsById.clear();
  }

  /** The scene node for a polyp id, if it's in the reef. */
  node(id: number): Object3D | undefined {
    return this.polypsById.get(id);
  }

  hasPolyp(id: number): boolean {
    return this.polypsById.has(id);
  }

  addPolyp(p: PublicPolyp, animateGrowth = false): void {
    if (this.polypsById.has(p.id)) return;
    const { mesh } = generatePolyp({ species: p.species, seed: p.seed, colorKey: p.colorKey });
    const node = polypMesh(mesh);
    node.position.fromArray(p.position as unknown as number[]);
    node.quaternion.fromArray(p.orientation as unknown as number[]);
    node.scale.setScalar(animateGrowth ? 0.001 : p.scale);
    node.userData.polyp = p;
    node.userData.targetScale = p.scale;
    node.userData.createdClient = performance.now();
    this.anchor.add(node);
    this.polypsById.set(p.id, node);
    if (this.mine.has(p.id)) node.add(mineRing(node));
  }

  removePolyp(id: number): void {
    const obj = this.polypsById.get(id);
    if (!obj) return;
    this.anchor.remove(obj);
    disposeTree(obj);
    this.polypsById.delete(id);
  }

  applySim(delta: SimDelta): void {
    const obj = this.polypsById.get(delta.polypId);
    if (!obj) return;
    applySimDecoration(obj, delta);
  }

  animateGrowth(t: number): void {
    for (const obj of this.polypsById.values()) {
      const target = obj.userData.targetScale as number | undefined;
      if (!target) continue;
      const current = obj.scale.x;
      if (current >= target - 1e-4) continue;
      const k = 1 - Math.exp(-6 * (t - (obj.userData.createdClient as number)) / 2000);
      obj.scale.setScalar(target * Math.max(k, current / target));
    }
  }

  all(): Iterable<Object3D> {
    return this.polypsById.values();
  }

  nearest(point: Vector3, maxDist: number): { obj: Object3D; dist: number } | null {
    let best: { obj: Object3D; dist: number } | null = null;
    const p = new Vector3();
    for (const obj of this.polypsById.values()) {
      obj.getWorldPosition(p);
      const d = p.distanceTo(point);
      if (d < maxDist && (!best || d < best.dist)) best = { obj, dist: d };
    }
    return best;
  }

  densityNudge(localPoint: Vector3, minSpacing: number, maxIter = 6): Vector3 {
    const result = localPoint.clone();
    const pp = new Vector3();
    for (let iter = 0; iter < maxIter; iter++) {
      let push = new Vector3();
      let n = 0;
      for (const obj of this.polypsById.values()) {
        pp.copy(obj.position);
        const d = result.distanceTo(pp);
        if (d < minSpacing) {
          const away = result.clone().sub(pp);
          if (away.lengthSq() < 1e-8) away.set((Math.random() - 0.5), 0, (Math.random() - 0.5));
          push.add(away.normalize().multiplyScalar(minSpacing - d));
          n++;
        }
      }
      if (n === 0) break;
      result.add(push.multiplyScalar(1 / n));
    }
    return result;
  }

}
