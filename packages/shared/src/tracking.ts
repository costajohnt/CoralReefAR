/// <reference lib="dom" />
/**
 * Tracking provider abstraction.
 *
 * An implementation owns the camera feed, SLAM loop, and anchor math. The app
 * only sees pose matrices. If 8th Wall ever disappears, swap in MindAR without
 * changing the rest of the codebase.
 */

export interface Mat4Like {
  readonly elements: ArrayLike<number>;
}

export interface AnchorEvent {
  id: string;
  pose: Mat4Like;
}

export interface TrackingInitOptions {
  markerImage: Blob | string;
  videoElement: HTMLVideoElement;
  canvasElement?: HTMLCanvasElement;
}

export type AnchorFoundHandler = (ev: AnchorEvent) => void;
export type AnchorLostHandler = (id: string) => void;
export type FrameHandler = (cameraPose: Mat4Like, t: number) => void;

export interface TrackingProvider {
  readonly name: 'eightwall' | 'mindar' | 'noop';
  init(opts: TrackingInitOptions): Promise<void>;
  onAnchorFound(cb: AnchorFoundHandler): void;
  onAnchorLost(cb: AnchorLostHandler): void;
  onFrame(cb: FrameHandler): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
}
