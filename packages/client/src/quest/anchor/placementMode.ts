/**
 * A snapshot of the pose captured at pinch time. We can't keep the raw
 * XRPose, whose lifetime is bounded to its originating XRFrame per the
 * WebXR spec; using its transform on a later frame is undefined behaviour.
 * The `transform` here is reconstructed from primitive position and
 * orientation values, so it stays valid across frames.
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
    // Snapshot the pose's rigid transform by reconstructing a fresh
    // XRRigidTransform from its primitive position / orientation values.
    // Holding pose.transform directly (a same-identity reference) would
    // still be at the runtime's mercy for cross-frame validity. Building
    // a new transform from primitive numbers makes the snapshot
    // genuinely frame-independent. The constructor is unavailable in the
    // test environment (happy-dom); fall through to the raw transform
    // there since tests don't drive createAnchor.
    const t = pose.transform;
    let captured: CapturedPose;
    if (
      typeof XRRigidTransform !== 'undefined' &&
      t.position !== undefined &&
      t.orientation !== undefined
    ) {
      captured = {
        transform: new XRRigidTransform(
          { x: t.position.x, y: t.position.y, z: t.position.z, w: 1 },
          { x: t.orientation.x, y: t.orientation.y, z: t.orientation.z, w: t.orientation.w },
        ),
      };
    } else {
      captured = { transform: t };
    }
    this._anchorPose = captured;
    for (const h of this.handlers) h(captured);
  }

  reset(): void {
    this._anchorPose = null;
  }
}
