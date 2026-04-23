import { Group, Mesh, MeshStandardMaterial, SphereGeometry, Vector3 } from 'three';

export interface AttachSlot {
  parentId: number;
  index: number;
  worldPos: Vector3;
  worldNormal: Vector3;
}

const INDICATOR_RADIUS = 0.007;
const INDICATOR_SEGMENTS = 12;

function makeIndicatorMesh(): Mesh {
  const geom = new SphereGeometry(INDICATOR_RADIUS, INDICATOR_SEGMENTS, INDICATOR_SEGMENTS);
  // Cool-blue tint + low emissive so the orbs read as subtle "clickable
  // hints" rather than dominant bright-white spots. Kept below the bloom
  // threshold so they don't pick up halos from the post-processing pass.
  const mat = new MeshStandardMaterial({
    color: 0x7aa4c4,
    emissive: 0x2f5a7a,
    emissiveIntensity: 0.25,
    transparent: true,
    opacity: 0.55,
  });
  return new Mesh(geom, mat);
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
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose();
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
