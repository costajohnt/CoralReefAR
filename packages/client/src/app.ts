import { PerspectiveCamera, Scene, WebGLRenderer, type Mesh } from 'three';
import { computeGestureFrame, type PublicPolyp, type Mat4Like, type TouchPair } from '@reef/shared';
import { Reef } from './scene/reef.js';
import { installLighting } from './scene/lighting.js';
import { installSway } from './scene/currentSway.js';
import { installPulse } from './scene/pulse.js';
import { FishSchool } from './sim/fish.js';
import { Placement } from './placement.js';
import { Picker } from './ui/picker.js';
import { fetchReef, submitPolyp, RateLimitError } from './net/api.js';
import { ReefSocket, defaultWsUrl } from './net/ws.js';
import { readTrackerFromUrl, selectProvider } from './tracking/index.js';
import { EightWallProvider } from './tracking/eightwall.js';
import { applyAnchorPose } from './tracking/anchor.js';
import type { TrackingProvider } from '@reef/shared';

export interface AppOptions {
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement;
  pickerRoot: HTMLElement;
  statusEl: HTMLElement;
}

const SWAY_INSTALLED = Symbol('sway-installed');
const PULSE_INSTALLED = Symbol('pulse-installed');

export class App {
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly renderer: WebGLRenderer;
  private readonly reef = new Reef();
  private readonly placement: Placement;
  private readonly picker: Picker;
  private readonly fish = new FishSchool();
  private readonly swayClock = { value: 0 };
  // Selected in start() after we've given the 8th Wall engine script a chance
  // to load; picking here would always lose the race.
  private tracker!: TrackingProvider;
  private readonly socket = new ReefSocket(defaultWsUrl());
  private readonly statusEl: HTMLElement;
  private lastFrameT = 0;
  private currentSeed = Math.floor(Math.random() * 0xffffffff);
  private placementLockedUntil = 0;
  private running = false;
  // Previous frame of a two-finger gesture, or null when we aren't tracking one.
  private gesturePrev: TouchPair | null = null;

  constructor(readonly opts: AppOptions) {
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

    installLighting(this.scene);
    this.scene.add(this.reef.anchor);
    this.reef.anchor.add(this.fish.points);

    this.placement = new Placement(this.reef, this.camera, this.reef.anchor);
    this.picker = new Picker(opts.pickerRoot);

    this.wireInteractions();
    this.wireSocket();
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
      applyAnchorPose(this.reef.anchor, pose.elements);
      this.reef.anchor.visible = true;
      this.setStatus('Tap a spot to place your polyp.');
      this.picker.show();
    });
    this.tracker.onAnchorLost(() => {
      // Hide the reef entirely while the anchor is unknown so visitors don't
      // see the scene pinned to a stale pose. The picker hides too — they
      // can't place against a lost anchor.
      this.reef.anchor.visible = false;
      this.picker.hide();
      this.placement.reset();
      this.picker.setCommittable(false);
      // Drop any in-flight two-finger state; otherwise the next touchend
      // after the anchor returns would suppress a legitimate tap.
      this.gesturePrev = null;
      this.setStatus('Looking for the reef…');
    });
    this.tracker.onFrame((_pose: Mat4Like, _t: number) => { /* reserved */ });
    await this.tracker.start();

    void this.loadInitial();
    this.socket.connect();
    this.running = true;
    requestAnimationFrame((t) => this.loop(t));
  }

  stop(): void {
    this.running = false;
    this.socket.close();
    // tracker is only assigned in start(); guard so stop() pre-start is safe.
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

  private async loadInitial(): Promise<void> {
    try {
      const state = await fetchReef();
      for (const p of state.polyps) this.reef.addPolyp(p, false);
      for (const d of state.sim) this.reef.applySim(d);
      this.installSwayOnNewMeshes();
    } catch (e) {
      // Without this, a failed fetch looks identical to an empty reef — new
      // visitors think nobody has planted and may plant a duplicate, or an
      // operator never sees that they've misconfigured CORS/DNS.
      // Must surface via #status (visible on start) rather than #hint, which
      // lives inside the still-hidden picker until the anchor is found.
      console.error('Failed to load reef', e);
      this.setStatus('Could not load the reef. Check your connection and refresh.');
    }
  }

  private installSwayOnNewMeshes(): void {
    for (const obj of this.reef.all()) {
      const m = obj as Mesh;
      if (!m.isMesh) continue;
      const flags = m.userData as Record<PropertyKey, unknown>;
      if (!flags[SWAY_INSTALLED]) {
        installSway(m, this.swayClock);
        flags[SWAY_INSTALLED] = true;
      }
      if (!flags[PULSE_INSTALLED]) {
        const polyp = m.userData.polyp as PublicPolyp | undefined;
        if (polyp) {
          installPulse(m, this.swayClock, polyp.seed);
          flags[PULSE_INSTALLED] = true;
        }
      }
    }
  }

  private wireInteractions(): void {
    this.opts.canvas.addEventListener('click', (e) => this.handleTap(e.clientX, e.clientY));
    this.opts.canvas.addEventListener('touchend', (e) => {
      // Skip taps that were part of a two-finger gesture.
      if (e.touches.length > 0 || this.gesturePrev !== null) {
        this.gesturePrev = null;
        return;
      }
      const t = e.changedTouches[0];
      if (t) this.handleTap(t.clientX, t.clientY);
    }, { passive: true });

    this.wireGestures();

    this.picker.onChange(({ species, colorKey }) => {
      if (this.placement.getLast()) {
        this.placement.updateGhost(species, this.currentSeed, colorKey);
      }
    });

    this.picker.onCommit(() => void this.commit());
    this.picker.onReroll(() => this.reroll());
    this.picker.onCancel(() => this.cancelPlacement());
  }

  private wireGestures(): void {
    const canvas = this.opts.canvas;
    const toPair = (a: Touch, b: Touch): TouchPair => ({
      a: { x: a.clientX, y: a.clientY },
      b: { x: b.clientX, y: b.clientY },
    });
    canvas.addEventListener('touchstart', (e) => {
      if (e.touches.length === 2) {
        this.gesturePrev = toPair(e.touches[0]!, e.touches[1]!);
      }
    }, { passive: true });
    canvas.addEventListener('touchmove', (e) => {
      if (e.touches.length !== 2 || !this.gesturePrev) return;
      const curr = toPair(e.touches[0]!, e.touches[1]!);
      const frame = computeGestureFrame(this.gesturePrev, curr);
      this.placement.applyGesture(frame);
      this.gesturePrev = curr;
    }, { passive: true });
    canvas.addEventListener('touchcancel', () => { this.gesturePrev = null; }, { passive: true });
  }

  private reroll(): void {
    if (!this.placement.getLast()) return;
    this.currentSeed = Math.floor(Math.random() * 0xffffffff);
    const s = this.picker.get();
    this.placement.updateGhost(s.species, this.currentSeed, s.colorKey);
    this.picker.setHint('New shape. Tap Grow or reroll again.');
  }

  private cancelPlacement(): void {
    this.placement.reset();
    this.picker.setCommittable(false);
    this.picker.setHint('Tap a spot to try again.');
  }

  private handleTap(x: number, y: number): void {
    if (Date.now() < this.placementLockedUntil) return;
    const r = this.placement.handleTap(x, y, window.innerWidth, window.innerHeight);
    if (!r) {
      this.picker.setHint('Tap nearer the pedestal to place your polyp.');
      return;
    }
    this.currentSeed = Math.floor(Math.random() * 0xffffffff);
    const s = this.picker.get();
    this.placement.showGhost(s.species, this.currentSeed, s.colorKey);
    this.picker.setCommittable(true);
    this.picker.setHint('Happy with it? Tap Grow.');
  }

  private async commit(): Promise<void> {
    const r = this.placement.getLast();
    if (!r) return;
    const s = this.picker.get();
    this.picker.setSubmitting(true);
    try {
      const saved = await submitPolyp({
        species: s.species,
        seed: this.currentSeed,
        colorKey: s.colorKey,
        position: [r.position.x, r.position.y, r.position.z],
        orientation: [r.orientation.x, r.orientation.y, r.orientation.z, r.orientation.w],
        scale: r.scale,
      });
      this.placement.reset();
      this.reef.addPolyp(saved, true);
      this.installSwayOnNewMeshes();
      this.placementLockedUntil = Date.now() + 60 * 60 * 1000;
      this.picker.setSubmitting(false);
      this.picker.setCommittable(false);
      this.picker.setHint('Grown. Come back in an hour to plant another.');
    } catch (e) {
      this.picker.setSubmitting(false);
      if (e instanceof RateLimitError) {
        this.placement.reset();
        this.placementLockedUntil = Date.now() + e.retryAfterMs;
        const mins = Math.ceil(e.retryAfterMs / 60_000);
        this.picker.setCommittable(false);
        this.picker.setHint(`You already planted recently. Come back in ${mins} min.`);
      } else {
        this.picker.setCommittable(true);
        const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
        this.picker.setHint(offline
          ? 'You appear to be offline. Reconnect and tap Grow again.'
          : 'The reef didn\u2019t save your polyp. Tap Grow to retry.');
        console.error(e);
      }
    }
  }

  private wireSocket(): void {
    this.socket.on((msg) => {
      if (msg.type === 'hello') this.onHello(msg.polypCount);
      else if (msg.type === 'polyp_added') this.onRemoteAdded(msg.polyp);
      else if (msg.type === 'polyp_removed') this.reef.removePolyp(msg.id);
      else if (msg.type === 'sim_update') {
        for (const d of msg.updates) this.reef.applySim(d);
      }
    });
  }

  private onHello(count: number): void {
    if (count === 0) return;
    const word = count === 1 ? 'coral' : 'corals';
    this.picker.setHint(`${count} ${word} already here. Tap a spot to plant yours.`);
  }

  private onRemoteAdded(p: PublicPolyp): void {
    if (this.reef.hasPolyp(p.id)) return;
    this.reef.addPolyp(p, true);
    this.installSwayOnNewMeshes();
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
    const dt = Math.min(0.05, (t - this.lastFrameT) / 1000 || 0.016);
    this.lastFrameT = t;
    this.swayClock.value = t / 1000;
    this.fish.update(dt);
    this.reef.animateGrowth(t);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((tt) => this.loop(tt));
  }
}
