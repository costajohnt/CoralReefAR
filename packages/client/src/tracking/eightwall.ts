import { Matrix4, Quaternion, Vector3 } from 'three';
import type {
  AnchorFoundHandler, AnchorLostHandler, FrameHandler,
  TrackingInitOptions, TrackingProvider,
} from '@reef/shared';

/**
 * 8th Wall XR engine wrapper. The engine exposes a global `XR8` once the
 * vendor script is loaded. This wrapper treats it as opaque and translates
 * between its callback shapes and our TrackingProvider contract.
 *
 * Until the binary is vendored into `vendor/8thwall/`, this provider throws
 * on init. The NoopProvider or MindARProvider will be used in the meantime.
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

  async init(opts: TrackingInitOptions): Promise<void> {
    if (!EightWallProvider.isAvailable()) {
      throw new Error('8th Wall engine not loaded (vendor/8thwall/ missing?)');
    }
    this.canvas = opts.canvasElement ?? document.createElement('canvas');

    const XR8 = window.XR8!;
    XR8.XrController.configure({ imageTargets: ['pedestal'] });
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
