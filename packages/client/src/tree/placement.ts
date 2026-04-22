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

  constructor(private readonly reef: TreeReef) {}

  /**
   * Compute where a child piece would be placed at (parentId, attachIndex).
   * If the resulting world AABB collides with any existing piece, return null
   * (placement blocked). Otherwise: spawn a semi-opaque ghost mesh, wire it
   * into ghostAnchor, record the pending intent, and return the ghost.
   */
  showGhost(
    variant: TreeVariant,
    seed: number,
    colorKey: string,
    parentId: number,
    attachIndex: number,
  ): Mesh | null {
    this.reset();

    const parent = this.reef.getPieceEntry(parentId);
    if (!parent) return null;
    const attach = parent.worldAttachPoints[attachIndex];
    if (!attach) return null;

    const generated = generateTreeVariantMesh({ variant, seed, colorKey });

    // Same composition logic as TreeReef.addPiece — mirror it.
    const quat = new Quaternion().setFromUnitVectors(
      new Vector3(0, 1, 0),
      new Vector3(attach.normal.x, attach.normal.y, attach.normal.z).normalize(),
    );
    const position = new Vector3(attach.position.x, attach.position.y, attach.position.z);
    const matrix = new Matrix4().compose(position, quat, new Vector3(1, 1, 1));

    generated.mesh.applyMatrix4(matrix);
    const worldBox = generated.boundingBox.clone().applyMatrix4(matrix);

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
      generated.mesh.geometry.dispose();
      (generated.mesh.material as { dispose: () => void }).dispose();
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
    this.ghostAnchor.add(generated.mesh);
    return generated.mesh;
  }

  reset(): void {
    if (this.ghost) {
      this.ghostAnchor.remove(this.ghost);
      this.ghost.geometry.dispose();
      (this.ghost.material as { dispose: () => void }).dispose();
      this.ghost = null;
    }
    this.pending = null;
  }

  getPending(): PendingTreePiece | null {
    return this.pending;
  }
}
