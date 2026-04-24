import { Group, Object3D, Vector3 } from 'three';
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
export class Reef {
  readonly anchor = new Group();
  private readonly polypsById = new Map<number, Object3D>();

  clear(): void {
    for (const obj of this.polypsById.values()) {
      this.anchor.remove(obj);
      disposeTree(obj);
    }
    this.polypsById.clear();
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
