import { Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';

export interface AttachSlot {
  parentId: number;
  index: number;
  worldPos: Vector3;
  worldNormal: Vector3;
}

const INDICATOR_RADIUS = 0.007;
const HIT_PROXY_RADIUS = 0.018;
const INDICATOR_SEGMENTS = 12;

function makeIndicatorMesh(): Mesh {
  // Outer mesh is an invisible hit proxy ~2.5× the visual radius so the
  // raycast target is comfortable to click without enlarging the rendered
  // orb. The raycaster in tree.ts uses intersectObjects(..., false), so
  // the proxy must be a direct child of the group — the visual is nested
  // under it. Opacity 0 + depthWrite false keeps the proxy invisible.
  const proxyGeom = new SphereGeometry(HIT_PROXY_RADIUS, 8, 8);
  const proxyMat = new MeshStandardMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const proxy = new Mesh(proxyGeom, proxyMat);

  const visualGeom = new SphereGeometry(INDICATOR_RADIUS, INDICATOR_SEGMENTS, INDICATOR_SEGMENTS);
  // Cool-blue tint + low emissive so the orbs read as subtle "clickable
  // hints" rather than dominant bright-white spots. Kept below the bloom
  // threshold so they don't pick up halos from the post-processing pass.
  const visualMat = new MeshStandardMaterial({
    color: 0x9ecae8,
    emissive: 0x4a88b4,
    emissiveIntensity: 0.6,
    transparent: true,
    opacity: 0.85,
  });
  const visual = new Mesh(visualGeom, visualMat);
  proxy.add(visual);

  return proxy;
}

export class AttachIndicators {
  readonly group = new Group();
  private bySlot = new Map<string, Mesh>();

  refresh(available: AttachSlot[]): void {
    const wantedKeys = new Set(available.map((s) => `${s.parentId}/${s.index}`));

    // Remove indicators for slots no longer available.
    for (const [key, mesh] of this.bySlot) {
      if (!wantedKeys.has(key)) {
        this.group.remove(mesh);
        disposeIndicator(mesh);
        this.bySlot.delete(key);
      }
    }

    // Add indicators for new slots.
    for (const slot of available) {
      const key = `${slot.parentId}/${slot.index}`;
      if (this.bySlot.has(key)) continue;
      const mesh = makeIndicatorMesh();
      mesh.position.copy(slot.worldPos);
      mesh.userData = { parentId: slot.parentId, attachIndex: slot.index };
      this.group.add(mesh);
      this.bySlot.set(key, mesh);
    }
  }

  meshAt(parentId: number, index: number): Mesh | undefined {
    return this.bySlot.get(`${parentId}/${index}`);
  }

  *all(): Iterable<{ parentId: number; index: number; mesh: Mesh }> {
    for (const [key, mesh] of this.bySlot) {
      const [pid, idx] = key.split('/');
      yield { parentId: Number(pid), index: Number(idx), mesh };
    }
  }
}

function disposeIndicator(mesh: Mesh): void {
  mesh.geometry.dispose();
  (mesh.material as MeshStandardMaterial).dispose();
  for (const child of mesh.children) {
    if (child instanceof Mesh) {
      child.geometry.dispose();
      (child.material as MeshStandardMaterial).dispose();
    }
  }
}
