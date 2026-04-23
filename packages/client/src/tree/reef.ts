import { Box3, Group, Matrix4, Mesh, Quaternion, Vector3 } from 'three';
import type { AttachPoint, PublicTreePolyp } from '@reef/shared';
import { generateTreeVariantMesh } from './variants.js';

interface RegisteredPiece {
  polyp: PublicTreePolyp;
  mesh: Mesh;
  localAttachPoints: AttachPoint[];
  worldAttachPoints: AttachPoint[];
  worldBox: Box3;
}

/**
 * Tree-aware registry of rendered pieces.
 *
 * Placement depends on parent pieces: root pieces are placed at the origin;
 * child pieces are placed at the parent's world attach-point, oriented so
 * the child's local +Y aligns with the parent attach-point normal.
 *
 * Insertion order requirement: parents must be added before children.
 * The caller (Task 23) is responsible for ordering (e.g., sort by createdAt ASC).
 */
export class TreeReef {
  readonly anchor: Group = new Group();
  private byId = new Map<number, RegisteredPiece>();
  /** Tracks which (parentId/attachIndex) slots have been claimed by a child piece. */
  private claimedSlots = new Set<string>();

  addPiece(polyp: PublicTreePolyp): void {
    if (this.byId.has(polyp.id)) return;

    const generated = generateTreeVariantMesh({
      variant: polyp.variant,
      seed: polyp.seed,
      colorKey: polyp.colorKey,
    });

    // Compute world transform matrix for this piece.
    const matrix = new Matrix4();

    if (polyp.parentId === null) {
      // Root: identity transform — local +Y is world +Y.
      matrix.identity();
    } else {
      const parent = this.byId.get(polyp.parentId);
      if (!parent) {
        throw new Error(
          `TreeReef.addPiece: parent ${polyp.parentId} not registered yet — insert parents before children`,
        );
      }
      const attach = parent.worldAttachPoints[polyp.attachIndex];
      if (!attach) {
        throw new Error(
          `TreeReef.addPiece: parent ${polyp.parentId} has no attach index ${polyp.attachIndex}`,
        );
      }

      // Rotate so this piece's local +Y aligns with the parent's world attach-point normal.
      const localUp = new Vector3(0, 1, 0);
      const targetNormal = new Vector3(
        attach.normal.x,
        attach.normal.y,
        attach.normal.z,
      ).normalize();
      const quat = new Quaternion().setFromUnitVectors(localUp, targetNormal);

      const position = new Vector3(attach.position.x, attach.position.y, attach.position.z);
      matrix.compose(position, quat, new Vector3(1, 1, 1));
    }

    // Apply world transform directly to the mesh's vertex data.
    // After this call, the mesh is already in world space (under anchor).
    generated.mesh.applyMatrix4(matrix);
    this.anchor.add(generated.mesh);

    // Transform local attach points into world space using the same matrix.
    const rotationMatrix = new Matrix4().extractRotation(matrix);
    const worldAttachPoints: AttachPoint[] = generated.attachPointsLocal.map((ap) => {
      const wPos = new Vector3(ap.position.x, ap.position.y, ap.position.z).applyMatrix4(matrix);
      const wNorm = new Vector3(ap.normal.x, ap.normal.y, ap.normal.z)
        .applyMatrix4(rotationMatrix)
        .normalize();
      return {
        position: { x: wPos.x, y: wPos.y, z: wPos.z },
        normal: { x: wNorm.x, y: wNorm.y, z: wNorm.z },
      };
    });

    // Transform local bounding box into world space.
    const worldBox = generated.boundingBox.clone().applyMatrix4(matrix);

    this.byId.set(polyp.id, {
      polyp,
      mesh: generated.mesh,
      localAttachPoints: generated.attachPointsLocal,
      worldAttachPoints,
      worldBox,
    });

    // Mark the parent's slot as claimed.
    if (polyp.parentId !== null) {
      this.claimedSlots.add(`${polyp.parentId}/${polyp.attachIndex}`);
    }
  }

  removePiece(id: number): void {
    const entry = this.byId.get(id);
    if (!entry) return;

    this.anchor.remove(entry.mesh);
    disposeMeshTree(entry.mesh);

    this.byId.delete(id);

    if (entry.polyp.parentId !== null) {
      this.claimedSlots.delete(`${entry.polyp.parentId}/${entry.polyp.attachIndex}`);
    }
  }

  /** Removes every registered piece. Used by the reset flow. */
  clear(): void {
    for (const entry of this.byId.values()) {
      this.anchor.remove(entry.mesh);
      disposeMeshTree(entry.mesh);
    }
    this.byId.clear();
    this.claimedSlots.clear();
  }

  getPiece(id: number): Mesh | undefined {
    return this.byId.get(id)?.mesh;
  }

  /** Returns the world attach points and world bounding box for a registered piece, or undefined if not found. */
  getPieceEntry(id: number): { worldAttachPoints: AttachPoint[]; worldBox: Box3 } | undefined {
    const entry = this.byId.get(id);
    if (!entry) return undefined;
    return { worldAttachPoints: entry.worldAttachPoints, worldBox: entry.worldBox };
  }

  *allPieces(): Iterable<{ polyp: PublicTreePolyp; mesh: Mesh }> {
    for (const entry of this.byId.values()) {
      yield { polyp: entry.polyp, mesh: entry.mesh };
    }
  }

  /** Used by collision checks and placement logic. */
  *allWorldBoxes(): Iterable<Box3> {
    for (const entry of this.byId.values()) {
      yield entry.worldBox;
    }
  }

  /**
   * Returns all unclaimed attach points across all registered pieces, in world space.
   *
   * An attach point is claimed when a child piece references (parentId, attachIndex).
   * Walk all pieces; for each, skip any slot already in claimedSlots.
   */
  getAvailableAttachPoints(): Array<{
    parentId: number;
    index: number;
    worldPos: Vector3;
    worldNormal: Vector3;
  }> {
    const out: Array<{
      parentId: number;
      index: number;
      worldPos: Vector3;
      worldNormal: Vector3;
    }> = [];

    for (const entry of this.byId.values()) {
      for (let i = 0; i < entry.worldAttachPoints.length; i++) {
        const slotKey = `${entry.polyp.id}/${i}`;
        if (this.claimedSlots.has(slotKey)) continue;

        const ap = entry.worldAttachPoints[i]!;
        out.push({
          parentId: entry.polyp.id,
          index: i,
          worldPos: new Vector3(ap.position.x, ap.position.y, ap.position.z),
          worldNormal: new Vector3(ap.normal.x, ap.normal.y, ap.normal.z),
        });
      }
    }

    return out;
  }
}

/** Disposes a mesh plus every Mesh descendant (e.g. the joint sphere child
 *  added by generateTreeVariantMesh). Avoids geometry/material leaks. */
function disposeMeshTree(root: Mesh): void {
  root.traverse((obj) => {
    if ((obj as Mesh).isMesh) {
      const m = obj as Mesh;
      m.geometry.dispose();
      if (Array.isArray(m.material)) {
        for (const mat of m.material) mat.dispose();
      } else {
        (m.material as { dispose: () => void }).dispose();
      }
    }
  });
}
