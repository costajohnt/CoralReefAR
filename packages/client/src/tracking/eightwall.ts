import { Matrix4, Quaternion, Vector3 } from 'three';
import type {
  AnchorFoundHandler, AnchorLostHandler, FrameHandler,
  TrackingInitOptions, TrackingProvider,
} from '@reef/shared';

/**
 * 8th Wall XR engine wrapper. The engine exposes a global `XR8` once the
 * self-hosted binary script (see `index.html`) has loaded. This wrapper
 * treats it as opaque and translates between its callback shapes and our
 * TrackingProvider contract. NoopProvider is the fallback when XR8 isn't
 * loaded (e.g. desktop/dev).
 */
interface XR8Global {
  XrController: {
    configure: (opts: unknown) => void;
    pipelineModule: () => unknown;
  };
  GlTextureRenderer: { pipelineModule: () => unknown };
  Threejs: { pipelineModule: () => unknown };
  XrConfig: { device: () => unknown };
  addCameraPipelineModules: (mods: unknown[]) => void;
  addCameraPipelineModule: (mod: unknown) => void;
  run: (opts: { canvas: HTMLCanvasElement }) => void;
  stop: () => void;
}

declare global {
  interface Window { XR8?: XR8Global }
}

export class EightWallProvider implements TrackingProvider {
  readonly name = 'eightwall' as const;
  private anchorFound: AnchorFoundHandler[] = [];
  private anchorLost: AnchorLostHandler[] = [];
  private frameCbs: FrameHandler[] = [];
  private canvas?: HTMLCanvasElement;
  private anchorPose = new Matrix4();

  static isAvailable(): boolean {
    return typeof window !== 'undefined' && !!window.XR8;
  }

  // The engine <script> tag is `async`, so XR8 may not have attached to window
  // by the time the user taps Start. Poll briefly before giving up to Noop.
  static async waitUntilReady(timeoutMs = 8000, intervalMs = 50): Promise<boolean> {
    if (typeof window === 'undefined') return false;
    if (EightWallProvider.isAvailable()) return true;
    const deadline = Date.now() + timeoutMs;
    return new Promise<boolean>((resolve) => {
      const tick = (): void => {
        if (EightWallProvider.isAvailable()) return resolve(true);
        if (Date.now() >= deadline) return resolve(false);
        setTimeout(tick, intervalMs);
      };
      tick();
    });
  }

  async init(opts: TrackingInitOptions): Promise<void> {
    if (!EightWallProvider.isAvailable()) {
      throw new Error('8th Wall engine not loaded (xr.js script missing or blocked?)');
    }
    this.canvas = (opts.canvasElement as HTMLCanvasElement | undefined) ?? document.createElement('canvas');

    // Fetch the compiled image-target. The self-hosted engine wants the full
    // JSON blob via imageTargetData — the retired hosted platform's
    // cloud-named-target API (imageTargets: ['pedestal']) doesn't exist in
    // the self-hosted binary. Path is relative so it works at both / (server
    // deploy) and /CoralReefAR/ (Pages deploy).
    const targetUrl = new URL('image-targets/pedestal.json', document.baseURI).toString();
    const targetRes = await fetch(targetUrl);
    if (!targetRes.ok) {
      throw new Error(`failed to load pedestal image-target (${targetRes.status} at ${targetUrl})`);
    }
    const pedestalTarget = await targetRes.json() as unknown;

    const XR8 = window.XR8!;
    XR8.XrController.configure({ imageTargetData: [pedestalTarget] });
    XR8.addCameraPipelineModules([
      XR8.GlTextureRenderer.pipelineModule(),
      XR8.Threejs.pipelineModule(),
      XR8.XrController.pipelineModule(),
      {
        name: 'reef-bridge',
        listeners: [
          {
            event: 'reality.imagefound',
            process: (e: { detail: { name: string; position: {x:number;y:number;z:number}; rotation: {x:number;y:number;z:number;w:number} } }) => {
              const pos = new Vector3(e.detail.position.x, e.detail.position.y, e.detail.position.z);
              const rot = new Quaternion(e.detail.rotation.x, e.detail.rotation.y, e.detail.rotation.z, e.detail.rotation.w);
              const scl = new Vector3(1, 1, 1);
              const m = new Matrix4().compose(pos, rot, scl);
              this.anchorPose = m;
              for (const cb of this.anchorFound) cb({ id: e.detail.name, pose: m });
            },
          },
          {
            event: 'reality.imagelost',
            process: (e: { detail: { name: string } }) => {
              for (const cb of this.anchorLost) cb(e.detail.name);
            },
          },
        ],
        onUpdate: (_: { processCpuResult: { reality?: { worldMatrix?: number[] } } }) => {
          const now = performance.now();
          for (const cb of this.frameCbs) cb(this.anchorPose, now);
        },
      },
    ]);
  }

  onAnchorFound(cb: AnchorFoundHandler): void { this.anchorFound.push(cb); }
  onAnchorLost(cb: AnchorLostHandler): void { this.anchorLost.push(cb); }
  onFrame(cb: FrameHandler): void { this.frameCbs.push(cb); }

  async start(): Promise<void> {
    if (!this.canvas) throw new Error('not initialized');
    window.XR8!.run({ canvas: this.canvas });
  }

  async stop(): Promise<void> {
    window.XR8?.stop();
  }

  async destroy(): Promise<void> {
    await this.stop();
    this.anchorFound = [];
    this.anchorLost = [];
    this.frameCbs = [];
  }
}
