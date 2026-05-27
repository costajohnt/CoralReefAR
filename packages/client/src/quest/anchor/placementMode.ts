/**
 * A snapshot of the pose captured at pinch time. We can't keep the raw
 * XRPose — its lifetime is bounded to the originating XRFrame per the
 * WebXR spec, and using its transform on a later frame is technically
 * undefined behaviour. Snapshotting the rigid transform up-front keeps
 * us spec-clean.
 */
export interface CapturedPose {
  transform: XRRigidTransform;
}

export type AnchorHandler = (pose: CapturedPose) => void;

/**
 * Drives the "pinch a spot to plant the reef" flow. Right hand only —
 * the left wrist hosts the palette UI in a later task, and binding the
 * placement gesture to one hand keeps the two from colliding.
 *
 * `handleSelectStart` is wired from the XRSession's `selectstart` event
 * inside questApp; it receives both the source (handedness check) and the
 * pose (used as the anchor's location). Once the anchor is captured,
 * subsequent pinches are ignored until `reset()` is called (used by the
 * "Move reef" follow-up flow).
 */
export class PlacementMode {
  private _anchorPose: CapturedPose | null = null;
  private handlers: AnchorHandler[] = [];

  get anchorPose(): CapturedPose | null {
    return this._anchorPose;
  }

  onAnchor(handler: AnchorHandler): void {
    this.handlers.push(handler);
  }

  handleSelectStart(source: XRInputSource, pose: XRPose): void {
    if (source.handedness !== 'right') return;
    if (this._anchorPose !== null) return;
    // Snapshot the pose's rigid transform into our own object so the
    // raw XRPose can be released; XRPose may be invalidated outside
    // its originating frame.
    const captured: CapturedPose = { transform: pose.transform };
    this._anchorPose = captured;
    for (const h of this.handlers) h(captured);
  }

  reset(): void {
    this._anchorPose = null;
  }
}
