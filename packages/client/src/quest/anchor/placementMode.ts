export type AnchorHandler = (pose: XRPose) => void;

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
  private _anchorPose: XRPose | null = null;
  private handlers: AnchorHandler[] = [];

  get anchorPose(): XRPose | null {
    return this._anchorPose;
  }

  onAnchor(handler: AnchorHandler): void {
    this.handlers.push(handler);
  }

  handleSelectStart(source: XRInputSource, pose: XRPose): void {
    if (source.handedness !== 'right') return;
    if (this._anchorPose !== null) return;
    this._anchorPose = pose;
    for (const h of this.handlers) h(pose);
  }

  reset(): void {
    this._anchorPose = null;
  }
}
