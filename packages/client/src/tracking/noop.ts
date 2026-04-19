import { Matrix4 } from 'three';
import type {
  AnchorFoundHandler, AnchorLostHandler, FrameHandler,
  TrackingInitOptions, TrackingProvider,
} from '@reef/shared';

/**
 * A tracking provider with no tracking. Anchors the reef a fixed distance in
 * front of the camera — used for desktop dev and as a final fallback.
 */
export class NoopProvider implements TrackingProvider {
  readonly name = 'noop' as const;
  private anchorCbs: AnchorFoundHandler[] = [];
  private frameCbs: FrameHandler[] = [];
  private raf = 0;
  private running = false;
  private readonly anchorPose = new Matrix4().makeTranslation(0, -0.3, -0.8);
  private readonly camPose = new Matrix4();

  async init(_: TrackingInitOptions): Promise<void> {}

  onAnchorFound(cb: AnchorFoundHandler): void { this.anchorCbs.push(cb); }
  onAnchorLost(_cb: AnchorLostHandler): void {}
  onFrame(cb: FrameHandler): void { this.frameCbs.push(cb); }

  async start(): Promise<void> {
    this.running = true;
    for (const cb of this.anchorCbs) cb({ id: 'pedestal', pose: this.anchorPose });
    const loop = (t: number): void => {
      if (!this.running) return;
      for (const cb of this.frameCbs) cb(this.camPose, t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  async stop(): Promise<void> {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  async destroy(): Promise<void> {
    await this.stop();
  }
}
