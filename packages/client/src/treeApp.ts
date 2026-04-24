import { PerspectiveCamera, Scene, WebGLRenderer } from 'three';
import type { Mat4Like } from '@reef/shared';
import { TreeReef } from './tree/reef.js';
import { installUnderwaterLighting } from './tree/scene.js';
import { applyAnchorPose } from './tracking/anchor.js';
import { readTrackerFromUrl, selectProvider } from './tracking/index.js';
import { EightWallProvider } from './tracking/eightwall.js';
import type { TrackingProvider } from '@reef/shared';

export interface TreeAppOptions {
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement;
  pickerRoot: HTMLElement;
  statusEl: HTMLElement;
}

const SCALE = 5;

export class TreeApp {
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly renderer: WebGLRenderer;
  readonly treeReef = new TreeReef();
  private tracker!: TrackingProvider;
  private running = false;
  private readonly statusEl: HTMLElement;

  constructor(readonly opts: TreeAppOptions) {
    this.statusEl = opts.statusEl;

    this.renderer = new WebGLRenderer({
      canvas: opts.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setClearColor(0x000000, 0);

    this.camera = new PerspectiveCamera(60, 1, 0.01, 30);
    this.camera.position.set(0, 0, 0);

    installUnderwaterLighting(this.scene);
    this.scene.add(this.treeReef.anchor);
    this.treeReef.anchor.visible = false;

    this.onResize();
    window.addEventListener('resize', () => this.onResize());
  }

  async start(): Promise<void> {
    this.setStatus('Starting camera…');
    await this.startCamera();

    const preferred = readTrackerFromUrl();
    if (preferred === 'auto' || preferred === 'eightwall') {
      await EightWallProvider.waitUntilReady();
    }
    this.tracker = selectProvider(preferred);
    await this.tracker.init({
      markerImage: '',
      videoElement: this.opts.video,
      canvasElement: this.opts.canvas,
    });

    this.tracker.onAnchorFound(({ pose }) => {
      applyAnchorPose(this.treeReef.anchor, pose.elements, SCALE);
      this.treeReef.anchor.visible = true;
      this.setStatus('Tap a glowing dot to attach your branch.');
    });

    this.tracker.onAnchorLost(() => {
      this.treeReef.anchor.visible = false;
      this.setStatus('Looking for the marker…');
    });

    this.tracker.onFrame((_pose: Mat4Like, _t: number) => { /* reserved */ });

    await this.tracker.start();

    this.running = true;
    requestAnimationFrame((t) => this.loop(t));
  }

  stop(): void {
    this.running = false;
    if (this.tracker) void this.tracker.destroy();
  }

  private async startCamera(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
    this.opts.video.srcObject = stream;
    await this.opts.video.play().catch(() => {});
  }

  private onResize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.remove('hidden');
  }

  private loop(t: number): void {
    if (!this.running) return;
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((tt) => this.loop(tt));
  }
}
