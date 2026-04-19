/**
 * Tracking provider abstraction.
 *
 * An implementation owns the camera feed, SLAM loop, and anchor math. The app
 * only sees pose matrices, so a future provider (WebXR image-tracking, a
 * different engine) can slot in without changing the rest of the codebase.
 *
 * Types here are structural and DOM-free so `@reef/shared` stays importable
 * from the server. Clients passing real HTMLVideoElement / HTMLCanvasElement
 * satisfy VideoLike / CanvasLike via subtyping.
 */

export interface Mat4Like {
  readonly elements: ArrayLike<number>;
}

export interface AnchorEvent {
  id: string;
  pose: Mat4Like;
}

export interface VideoLike {
  readonly videoWidth: number;
  readonly videoHeight: number;
}

export interface CanvasLike {
  width: number;
  height: number;
}

export interface TrackingInitOptions {
  markerImage: string;
  videoElement: VideoLike;
  canvasElement?: CanvasLike;
}

export type AnchorFoundHandler = (ev: AnchorEvent) => void;
export type AnchorLostHandler = (id: string) => void;
export type FrameHandler = (cameraPose: Mat4Like, t: number) => void;

export interface TrackingProvider {
  readonly name: 'eightwall' | 'noop';
  init(opts: TrackingInitOptions): Promise<void>;
  onAnchorFound(cb: AnchorFoundHandler): void;
  onAnchorLost(cb: AnchorLostHandler): void;
  onFrame(cb: FrameHandler): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  destroy(): Promise<void>;
}
