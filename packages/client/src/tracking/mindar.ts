import { Matrix4 } from 'three';
import type {
  AnchorFoundHandler, AnchorLostHandler, FrameHandler,
  TrackingInitOptions, TrackingProvider,
} from '@reef/shared';

/**
 * MindAR fallback. Only image-target tracking (no SLAM), but works purely
 * in-browser with no vendored binary. Used when 8th Wall isn't loaded.
 *
 * The mindar-three module is loaded lazily so the client can ship without
 * pulling it in as a hard dependency.
 */
export class MindARProvider implements TrackingProvider {
  readonly name = 'mindar' as const;
  private anchorFound: AnchorFoundHandler[] = [];
  private anchorLost: AnchorLostHandler[] = [];
  private frameCbs: FrameHandler[] = [];
  private running = false;
  private raf = 0;
  private anchorPose = new Matrix4();

  async init(_opts: TrackingInitOptions): Promise<void> {
    // A real impl would load 'mindar-image-three' here via dynamic import:
    //   const { MindARThree } = await import('mindar-image-three');
    // We leave the stub so the abstraction is exercised; feature detection
    // in the app preferred EightWallProvider, then NoopProvider, before us.
  }

  onAnchorFound(cb: AnchorFoundHandler): void { this.anchorFound.push(cb); }
  onAnchorLost(cb: AnchorLostHandler): void { this.anchorLost.push(cb); }
  onFrame(cb: FrameHandler): void { this.frameCbs.push(cb); }

  async start(): Promise<void> {
    this.running = true;
    for (const cb of this.anchorFound) cb({ id: 'pedestal', pose: this.anchorPose });
    const loop = (t: number): void => {
      if (!this.running) return;
      for (const cb of this.frameCbs) cb(this.anchorPose, t);
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
