import { Object3D, Matrix4 } from 'three';

/**
 * Wraps an `XRAnchor` and exposes a Three.js Object3D whose world matrix
 * tracks the anchor's pose each frame. Attach the reef's root mesh to this
 * object3d; do not mutate its position/rotation directly — they are
 * overwritten every frame from the anchor's reported pose.
 */
export class ReefAnchor {
  readonly object3d: Object3D = new Object3D();
  private readonly tmpMatrix = new Matrix4();

  constructor(private readonly anchor: XRAnchor) {
    this.object3d.matrixAutoUpdate = false;
  }

  /**
   * Call once per frame inside the WebXR rAF callback with the current
   * XRFrame and reference space. Returns true if the anchor is still
   * tracked. If tracking is lost, the previous matrix is left in place
   * so the reef visually holds at its last good pose.
   */
  update(frame: XRFrame, referenceSpace: XRReferenceSpace): boolean {
    const pose = frame.getPose(this.anchor.anchorSpace, referenceSpace);
    if (!pose) return false;
    this.tmpMatrix.fromArray(pose.transform.matrix);
    this.object3d.matrix.copy(this.tmpMatrix);
    this.object3d.matrixWorldNeedsUpdate = true;
    return true;
  }

  delete(): void {
    this.anchor.delete();
  }
}
