import { Box3, Group, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import type { TreeVariant } from '@reef/shared';
import type { TreeReef } from './reef.js';
import { generateTreeVariantMesh } from './variants.js';
import { wouldCollide } from './collision.js';

export interface PendingTreePiece {
  variant: TreeVariant;
  seed: number;
  colorKey: string;
  parentId: number;
  attachIndex: number;
}

export class TreePlacement {
  readonly ghostAnchor = new Group();
  private ghost: Mesh | null = null;
  private pending: PendingTreePiece | null = null;
  /** World-space attach-point normal of the current ghost. Null when no ghost
   *  is pending. Used as the rotation axis in rotateGhost so drag-yaw matches
   *  the axis TreeReef.addPiece uses when applying `polyp.attachYaw`. */
  private attachNormal: Vector3 | null = null;

  constructor(private readonly reef: TreeReef) {}

  /**
   * Compute where a child piece would be placed at (parentId, attachIndex).
   * If the resulting world AABB collides with any existing piece, return null
   * (placement blocked). Otherwise: spawn a semi-opaque ghost mesh, wire it
   * into ghostAnchor, record the pending intent, and return the ghost.
   *
   * `initialYaw` seeds the ghost's rotation around the attach-point normal
   * (e.g. when re-entering `placing` on COMMIT_REJECTED with a previously
   * accumulated yaw). Pass 0 on a fresh attach.
   */
  showGhost(
    variant: TreeVariant,
    seed: number,
    colorKey: string,
    parentId: number,
    attachIndex: number,
    initialYaw = 0,
  ): Mesh | null {
    this.reset();

    const parent = this.reef.getPieceEntry(parentId);
    if (!parent) return null;
    const attach = parent.worldAttachPoints[attachIndex];
    if (!attach) return null;

    const generated = generateTreeVariantMesh({ variant, seed, colorKey });

    const attachNormal = new Vector3(attach.normal.x, attach.normal.y, attach.normal.z).normalize();
    const alignQuat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), attachNormal);
    const yawQuat = new Quaternion().setFromAxisAngle(attachNormal, initialYaw);
    const quat = yawQuat.multiply(alignQuat);
    const position = new Vector3(attach.position.x, attach.position.y, attach.position.z);

    // Live transform (not baked into vertices) so rotateGhost can pivot around
    // the attach-point normal via rotateOnWorldAxis without accumulating
    // rounding errors in the vertex data.
    generated.mesh.position.copy(position);
    generated.mesh.quaternion.copy(quat);
    generated.mesh.updateMatrixWorld(true);
    const worldBox = new Box3().setFromObject(generated.mesh);

    // Reject if colliding with any existing piece other than the parent itself.
    // The new piece attaches to the parent, so their bounding boxes will naturally
    // overlap — exclude the parent's world box from the collision set.
    const parentBox = parent.worldBox;
    const otherBoxes = (function* (all: Iterable<Box3>) {
      for (const b of all) {
        if (b !== parentBox) yield b;
      }
    })(this.reef.allWorldBoxes());

    if (wouldCollide(worldBox, otherBoxes)) {
      disposeMeshDeep(generated.mesh);
      return null;
    }

    // Make it visually a ghost: lower opacity, enable transparent.
    const mat = generated.mesh.material as unknown as {
      transparent: boolean;
      opacity: number;
      emissiveIntensity: number;
    };
    mat.transparent = true;
    mat.opacity = 0.45;
    mat.emissiveIntensity = 0.6;

    this.ghost = generated.mesh;
    this.pending = { variant, seed, colorKey, parentId, attachIndex };
    this.attachNormal = attachNormal;
    this.ghostAnchor.add(generated.mesh);
    return generated.mesh;
  }

  reset(): void {
    if (this.ghost) {
      this.ghostAnchor.remove(this.ghost);
      disposeMeshDeep(this.ghost);
      this.ghost = null;
    }
    this.pending = null;
    this.attachNormal = null;
  }

  getPending(): PendingTreePiece | null {
    return this.pending;
  }

  /**
   * Spin the current ghost around the parent attach-point normal, through
   * the attach position. Matches the axis TreeReef.addPiece uses for
   * `polyp.attachYaw`, so the visual preview matches what the committed
   * piece will render. No-op when no ghost is pending.
   */
  rotateGhost(deltaRad: number): void {
    if (!this.ghost || !this.attachNormal) return;
    this.ghost.rotateOnWorldAxis(this.attachNormal, deltaRad);
  }
}

/**
 * Disposes a mesh + any Mesh children (e.g. the joint sphere added by
 * generateTreeVariantMesh). Without this, rerolling a ghost leaks the child
 * geometry/material each time.
 */
function disposeMeshDeep(mesh: Mesh): void {
  mesh.traverse((obj) => {
    if ((obj as Mesh).isMesh) {
      const m = obj as Mesh;
      m.geometry.dispose();
      const mat = m.material as { dispose: () => void } | { dispose: () => void }[];
      if (Array.isArray(mat)) {
        for (const x of mat) x.dispose();
      } else {
        mat.dispose();
      }
    }
  });
}
