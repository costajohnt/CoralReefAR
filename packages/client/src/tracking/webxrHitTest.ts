import { Matrix4 } from 'three';
import type {
  AnchorFoundHandler, AnchorLostHandler, FrameHandler,
  TrackingInitOptions, TrackingProvider,
} from '@reef/shared';

/**
 * Markerless phone AR (#116): a WebXR `immersive-ar` session with hit-test.
 * A reticle-less flow: the hit-test source follows the centre of the view,
 * and the first screen tap that lands while a surface is found places the
 * reef there. Opt-in via `?tracker=webxr`; iOS Safari has no `navigator.xr`
 * and falls back to the marker path.
 *
 * ponytail: the anchor is the hit pose at tap time, not an XRAnchor, so it
 * does not get drift correction. Upgrade path: `hit.createAnchor()` and
 * re-apply the anchor-space pose each frame, as quest/anchor/reefAnchor.ts does.
 */
export async function isWebXRHitTestSupported(xr: XRSystem | undefined): Promise<boolean> {
  if (!xr) return false;
  return xr.isSessionSupported('immersive-ar').catch(() => false);
}

/**
 * Request the session and return an initialised provider, or null when the
 * device cannot run it (no WebXR, no immersive-ar, or hit-test refused). Must
 * run close to the user's tap: requestSession needs transient activation.
 */
export async function startWebXRTracker(
  xr: XRSystem | undefined,
  overlayRoot: Element | null,
): Promise<WebXRHitTestProvider | null> {
  if (!xr || !(await isWebXRHitTestSupported(xr))) return null;
  const provider = new WebXRHitTestProvider(xr, overlayRoot);
  try {
    await provider.init();
    return provider;
  } catch (e) {
    console.warn('WebXR hit-test session unavailable; using the marker path', e);
    await provider.destroy();
    return null;
  }
}

export class WebXRHitTestProvider implements TrackingProvider {
  readonly name = 'webxr' as const;
  private _session: XRSession | null = null;
  private localSpace: XRReferenceSpace | null = null;
  private hitTestSource: XRHitTestSource | null = null;
  private latestHit: Matrix4 | null = null;
  private placeRequested = false;
  private placed = false;
  private anchorFound: AnchorFoundHandler[] = [];
  private anchorLost: AnchorLostHandler[] = [];
  private frameCbs: FrameHandler[] = [];

  constructor(private readonly xr: XRSystem, private readonly overlayRoot: Element | null) {}

  get session(): XRSession | null { return this._session; }
  /** True when the last frame's hit test found a surface to place on. */
  get hasSurface(): boolean { return this.latestHit !== null; }

  async init(_opts?: TrackingInitOptions): Promise<void> {
    const session = await this.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      ...(this.overlayRoot ? { domOverlay: { root: this.overlayRoot } } : {}),
    });
    this._session = session;
    session.addEventListener('end', () => this.handleEnd());
    // A screen tap arrives as a transient input source's `select`.
    session.addEventListener('select', () => {
      if (!this.placed) this.placeRequested = true;
    });
    this.localSpace = await session.requestReferenceSpace('local');
    const viewer = await session.requestReferenceSpace('viewer');
    this.hitTestSource = (await session.requestHitTestSource?.({ space: viewer })) ?? null;
    if (!this.hitTestSource) throw new Error('hit-test source unavailable');
  }

  onAnchorFound(cb: AnchorFoundHandler): void { this.anchorFound.push(cb); }
  onAnchorLost(cb: AnchorLostHandler): void { this.anchorLost.push(cb); }
  onFrame(cb: FrameHandler): void { this.frameCbs.push(cb); }

  async start(): Promise<void> {
    const session = this._session;
    if (!session) throw new Error('not initialized');
    const loop: XRFrameRequestCallback = (t, frame) => {
      if (this._session !== session) return;
      this.onXRFrame(frame);
      for (const cb of this.frameCbs) cb(this.latestHit ?? new Matrix4(), t);
      session.requestAnimationFrame(loop);
    };
    session.requestAnimationFrame(loop);
  }

  private onXRFrame(frame: XRFrame): void {
    if (this.placed || !this.hitTestSource || !this.localSpace) return;
    const pose = frame.getHitTestResults(this.hitTestSource)[0]?.getPose(this.localSpace);
    this.latestHit = pose ? new Matrix4().fromArray(pose.transform.matrix) : null;
    if (!this.placeRequested) return;
    // Placement runs a frame after the tap so the same tap's DOM touchend
    // reaches the app before the reef becomes tappable.
    this.placeRequested = false;
    if (!this.latestHit) return;
    this.placed = true;
    this.hitTestSource.cancel();
    this.hitTestSource = null;
    for (const cb of this.anchorFound) cb({ id: 'floor', pose: this.latestHit });
  }

  private handleEnd(): void {
    if (!this._session) return;
    this._session = null;
    this.hitTestSource = null;
    for (const cb of this.anchorLost) cb('floor');
  }

  async stop(): Promise<void> {
    await this._session?.end().catch(() => undefined);
  }

  async destroy(): Promise<void> {
    this.hitTestSource?.cancel();
    await this.stop();
    this.anchorFound = [];
    this.anchorLost = [];
    this.frameCbs = [];
  }
}
