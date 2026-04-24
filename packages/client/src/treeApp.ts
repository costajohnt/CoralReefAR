import { PerspectiveCamera, Raycaster, Scene, Vector2, WebGLRenderer } from 'three';
import type { Mat4Like, PublicTreePolyp } from '@reef/shared';
import { TreeReef } from './tree/reef.js';
import { AttachIndicators } from './tree/indicators.js';
import { TreePlacement } from './tree/placement.js';
import { installUnderwaterLighting } from './tree/scene.js';
import { fetchTree, TreeSocket, defaultTreeWsUrl } from './tree/api.js';
import { TreePicker, TREE_VARIANTS } from './ui/treePicker.js';
import { Shark } from './tree/shark.js';
import { Clownfish } from './tree/clownfish.js';
import { Jellyfish } from './tree/jellyfish.js';
import { SeaTurtle } from './tree/seaTurtle.js';
import { installSway } from './scene/currentSway.js';
import { installTreePulse } from './tree/pulse.js';
import { initialState, reduce, type TreeAction, type TreeState } from './tree/state.js';
import { createEffects } from './tree/effects.js';
import { applyAnchorPose } from './tracking/anchor.js';
import { readTrackerFromUrl, selectProvider } from './tracking/index.js';
import { EightWallProvider } from './tracking/eightwall.js';
import type { TrackingProvider } from '@reef/shared';
import type { Mesh } from 'three';

export interface TreeAppOptions {
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement;
  pickerRoot: HTMLElement;
  statusEl: HTMLElement;
}

const SCALE = 5;

const SWAY_INSTALLED = Symbol('sway-installed');
const PULSE_INSTALLED = Symbol('pulse-installed');

type CreatureType = 'shark' | 'clownfish' | 'jellyfish' | 'seaTurtle';
interface SwimmingCreature { update: (clockSec: number) => void; }
interface TrackedCreature {
  type: CreatureType;
  instance: SwimmingCreature;
  group: import('three').Group;
}

export class TreeApp {
  private readonly scene = new Scene();
  private readonly camera: PerspectiveCamera;
  private readonly renderer: WebGLRenderer;
  private readonly treeReef = new TreeReef();
  private readonly attachIndicators = new AttachIndicators();
  private readonly placement: TreePlacement;
  private readonly picker: TreePicker;
  private readonly swayClock = { value: 0 };
  private tracker!: TrackingProvider;
  private socket!: TreeSocket;
  private effects!: ReturnType<typeof createEffects>;
  private state: TreeState;
  private running = false;
  private readonly creatures: TrackedCreature[] = [];
  private readonly hintEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly apiBase: string;

  constructor(readonly opts: TreeAppOptions) {
    this.statusEl = opts.statusEl;

    const params = new URLSearchParams(globalThis.location?.search ?? '');
    this.apiBase = params.get('api') ?? '';

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

    // TreePlacement depends on treeReef; initialize here so ghostAnchor is
    // available before we add it to the scene graph below.
    this.placement = new TreePlacement(this.treeReef);

    installUnderwaterLighting(this.scene);
    this.scene.add(this.treeReef.anchor);
    this.treeReef.anchor.add(this.attachIndicators.group);
    this.treeReef.anchor.add(this.placement.ghostAnchor);
    this.treeReef.anchor.visible = false;

    this.picker = new TreePicker(opts.pickerRoot);
    this.hintEl = document.getElementById('hint') ?? opts.statusEl;
    this.state = initialState(this.picker.get());

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

    this.effects = createEffects({
      placement: this.placement,
      treeReef: this.treeReef,
      indicators: this.attachIndicators,
      picker: this.picker,
      hintEl: this.hintEl,
      apiBase: this.apiBase,
      dispatch: (action) => this.dispatch(action),
      addPiecesAndRefresh: (polyps) => this.addPiecesAndRefresh(polyps),
    });

    this.tracker.onAnchorFound(({ pose }) => {
      applyAnchorPose(this.treeReef.anchor, pose.elements, SCALE);
      this.treeReef.anchor.visible = true;
      this.setStatus('Tap a glowing dot to attach your branch.');
      this.picker.show();
    });

    this.tracker.onAnchorLost(() => {
      this.treeReef.anchor.visible = false;
      this.picker.hide();
      this.placement.reset();
      this.picker.setCommittable(false);
      this.setStatus('Looking for the marker…');
    });

    this.tracker.onFrame((_pose: Mat4Like, _t: number) => { /* reserved */ });

    this.wirePicker();
    this.wireTap();
    this.wireSocket();

    await this.tracker.start();

    void this.loadInitial();
    this.running = true;
    requestAnimationFrame((t) => this.loop(t));
  }

  stop(): void {
    this.running = false;
    if (this.socket) this.socket.close();
    if (this.tracker) void this.tracker.destroy();
  }

  wireToolbar(): void {
    const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement | null;
    const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement | null;
    const seaLifeBtn = document.getElementById('seaLifeBtn') as HTMLButtonElement | null;
    const seaLifePanel = document.getElementById('sea-life-panel') as HTMLElement | null;
    const seaLifeCloseBtn = document.getElementById('sea-life-close-btn') as HTMLButtonElement | null;

    if (clearBtn) clearBtn.addEventListener('click', () => this.dispatch({ type: 'CLEAR_CLICKED' }));
    if (undoBtn) undoBtn.addEventListener('click', () => this.dispatch({ type: 'UNDO_CLICKED' }));

    const setPanelOpen = (open: boolean): void => {
      if (!seaLifePanel || !seaLifeBtn) return;
      if (open) {
        seaLifePanel.classList.add('open');
        seaLifeBtn.setAttribute('aria-expanded', 'true');
        seaLifeBtn.setAttribute('aria-pressed', 'true');
      } else {
        seaLifePanel.classList.remove('open');
        seaLifeBtn.setAttribute('aria-expanded', 'false');
        seaLifeBtn.removeAttribute('aria-pressed');
      }
    };

    if (seaLifeBtn) seaLifeBtn.addEventListener('click', () => {
      const isOpen = seaLifePanel?.classList.contains('open') ?? false;
      setPanelOpen(!isOpen);
    });
    if (seaLifeCloseBtn) seaLifeCloseBtn.addEventListener('click', () => setPanelOpen(false));

    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') setPanelOpen(false);
    });
    document.addEventListener('click', (ev) => {
      if (!seaLifePanel?.classList.contains('open')) return;
      const target = ev.target as Node;
      if (!seaLifePanel.contains(target) && target !== seaLifeBtn && !seaLifeBtn?.contains(target)) {
        setPanelOpen(false);
      }
    });

    const refreshPanel = (): void => {
      const types: CreatureType[] = ['shark', 'clownfish', 'jellyfish', 'seaTurtle'];
      for (const type of types) {
        const n = this.countCreatures(type);
        const countEl = document.getElementById(`count-${type}`);
        if (countEl) countEl.textContent = String(n);
        const capType = type.charAt(0).toUpperCase() + type.slice(1);
        const removeBtn = document.getElementById(`remove${capType}Btn`) as HTMLButtonElement | null;
        if (removeBtn) removeBtn.disabled = n === 0;
      }
    };

    const wire = (addId: string, removeId: string, type: CreatureType, spawn: () => void): void => {
      const addBtn = document.getElementById(addId) as HTMLButtonElement | null;
      const removeBtn = document.getElementById(removeId) as HTMLButtonElement | null;
      if (addBtn) addBtn.addEventListener('click', () => { spawn(); refreshPanel(); });
      if (removeBtn) removeBtn.addEventListener('click', () => { this.removeCreature(type); refreshPanel(); });
    };

    wire('addSharkBtn', 'removeSharkBtn', 'shark', () => this.spawnShark());
    wire('addClownfishBtn', 'removeClownfishBtn', 'clownfish', () => this.spawnClownfish());
    wire('addJellyfishBtn', 'removeJellyfishBtn', 'jellyfish', () => this.spawnJellyfish());
    wire('addSeaTurtleBtn', 'removeSeaTurtleBtn', 'seaTurtle', () => this.spawnSeaTurtle());
  }

  private dispatch(action: TreeAction): void {
    const prev = this.state;
    this.state = reduce(this.state, action);
    if (this.state !== prev) {
      this.effects.apply(prev, this.state, action);
      this.refreshUndoBtn();
    }
  }

  private wirePicker(): void {
    this.picker.onChange((sel) => {
      const current = this.state.picker;
      if (sel.variant !== current.variant) {
        const seed = Math.floor(Math.random() * 0xffffffff);
        this.dispatch({ type: 'VARIANT_CHOSEN', variant: sel.variant, seed });
      }
      if (sel.colorKey !== current.colorKey) {
        this.dispatch({ type: 'COLOR_CHOSEN', colorKey: sel.colorKey });
      }
    });

    this.picker.onReroll(() => {
      if (this.state.kind !== 'placing') return;
      const options = TREE_VARIANTS.filter((v) => v !== this.state.picker.variant);
      const variant = options[Math.floor(Math.random() * options.length)]!;
      const seed = Math.floor(Math.random() * 0xffffffff);
      this.dispatch({ type: 'REROLL_CLICKED', variant, seed });
    });

    this.picker.onCancel(() => this.dispatch({ type: 'CANCEL_CLICKED' }));
    this.picker.onCommit(() => this.dispatch({ type: 'GROW_CLICKED' }));
  }

  private wireTap(): void {
    const canvas = this.opts.canvas;
    const raycaster = new Raycaster();

    const handleTap = (clientX: number, clientY: number): void => {
      const rect = canvas.getBoundingClientRect();
      const ndc = new Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -(((clientY - rect.top) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, this.camera);
      const intersects = raycaster.intersectObjects(this.attachIndicators.group.children, false);
      if (intersects.length === 0) {
        if (this.state.kind === 'idle') {
          this.hintEl.textContent = 'Tap a glowing dot to attach your branch.';
        }
        return;
      }
      const hit = intersects[0]!;
      const ud = hit.object.userData as { parentId?: number; attachIndex?: number };
      if (ud.parentId === undefined || ud.attachIndex === undefined) return;
      const seed = Math.floor(Math.random() * 0xffffffff);
      this.dispatch({
        type: 'ATTACH_CLICKED',
        parentId: ud.parentId,
        attachIndex: ud.attachIndex,
        seed,
      });
    };

    canvas.addEventListener('click', (e) => handleTap(e.clientX, e.clientY));
    canvas.addEventListener('touchend', (e) => {
      if (e.touches.length > 0) return;
      const t = e.changedTouches[0];
      if (t) handleTap(t.clientX, t.clientY);
    }, { passive: true });
  }

  private wireSocket(): void {
    const buildUrl = (): string => {
      if (this.apiBase) {
        return this.apiBase.replace(/^http/, 'ws') + '/ws/tree';
      }
      return defaultTreeWsUrl();
    };
    this.socket = new TreeSocket(buildUrl());
    this.socket.on((msg) => {
      if (msg.type === 'tree_hello') {
        // Initial state fetched via HTTP.
      } else if (msg.type === 'tree_polyp_added') {
        this.treeReef.addPiece(msg.polyp);
        this.installEffectsOnNewPieces();
        this.attachIndicators.refresh(this.treeReef.getAvailableAttachPoints());
        if (
          this.state.kind !== 'undoing' &&
          'lastCommittedId' in this.state &&
          this.state.lastCommittedId !== null &&
          msg.polyp.parentId === this.state.lastCommittedId
        ) {
          this.dispatch({ type: 'LAST_COMMITTED_INVALIDATED' });
        }
      } else if (msg.type === 'tree_polyp_removed') {
        this.treeReef.removePiece(msg.id);
        this.attachIndicators.refresh(this.treeReef.getAvailableAttachPoints());
        this.dispatch({ type: 'TREE_POLYP_REMOVED_EXTERNAL', id: msg.id });
      } else if (msg.type === 'tree_reset') {
        this.treeReef.clear();
        this.attachIndicators.refresh([]);
        this.dispatch({ type: 'TREE_RESET_EXTERNAL' });
      }
    });
    this.socket.connect();
  }

  private async loadInitial(): Promise<void> {
    try {
      const { polyps } = await fetchTree(this.apiBase);
      this.addPiecesAndRefresh(polyps);
    } catch (e) {
      console.error('[treeAr] Failed to load tree', e);
      this.hintEl.textContent = 'Failed to load tree. Check the server.';
    }
  }

  private addPiecesAndRefresh(polyps: PublicTreePolyp[]): void {
    const sorted = [...polyps].sort((a, b) => a.createdAt - b.createdAt);
    for (const polyp of sorted) this.treeReef.addPiece(polyp);
    this.installEffectsOnNewPieces();
    this.attachIndicators.refresh(this.treeReef.getAvailableAttachPoints());
  }

  private installEffectsOnNewPieces(): void {
    for (const { polyp, mesh } of this.treeReef.allPieces()) {
      const flags = mesh.userData as Record<PropertyKey, unknown>;
      if (!flags[SWAY_INSTALLED]) {
        installSway(mesh as Mesh, this.swayClock);
        flags[SWAY_INSTALLED] = true;
      }
      if (!flags[PULSE_INSTALLED]) {
        installTreePulse(mesh as Mesh, this.swayClock, polyp.seed);
        flags[PULSE_INSTALLED] = true;
      }
    }
  }

  private refreshUndoBtn(): void {
    const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement | null;
    if (!undoBtn) return;
    undoBtn.disabled = !(this.state.kind === 'idle' && this.state.lastCommittedId !== null);
  }

  private spawnShark(): void {
    const s = new Shark({
      orbitRadius: 0.25 + Math.random() * 0.15,
      orbitHeight: 0.05 + Math.random() * 0.2,
      orbitPeriodSec: 14 + Math.random() * 10,
      phaseRad: Math.random() * Math.PI * 2,
      direction: Math.random() < 0.5 ? 1 : -1,
    });
    this.treeReef.anchor.add(s.group);
    this.creatures.push({ type: 'shark', instance: s, group: s.group });
  }

  private spawnClownfish(): void {
    const c = new Clownfish({
      orbitRadius: 0.15 + Math.random() * 0.15,
      orbitHeight: 0.04 + Math.random() * 0.2,
      orbitPeriodSec: 5 + Math.random() * 6,
      phaseRad: Math.random() * Math.PI * 2,
      direction: Math.random() < 0.5 ? 1 : -1,
    });
    this.treeReef.anchor.add(c.group);
    this.creatures.push({ type: 'clownfish', instance: c, group: c.group });
  }

  private spawnJellyfish(): void {
    const j = new Jellyfish({
      orbitRadius: 0.18 + Math.random() * 0.14,
      orbitHeight: 0.1 + Math.random() * 0.2,
      orbitPeriodSec: 20 + Math.random() * 12,
      phaseRad: Math.random() * Math.PI * 2,
      direction: Math.random() < 0.5 ? 1 : -1,
    });
    this.treeReef.anchor.add(j.group);
    this.creatures.push({ type: 'jellyfish', instance: j, group: j.group });
  }

  private spawnSeaTurtle(): void {
    const t = new SeaTurtle({
      orbitRadius: 0.28 + Math.random() * 0.12,
      orbitHeight: 0.04 + Math.random() * 0.12,
      orbitPeriodSec: 28 + Math.random() * 12,
      phaseRad: Math.random() * Math.PI * 2,
      direction: Math.random() < 0.5 ? 1 : -1,
    });
    this.treeReef.anchor.add(t.group);
    this.creatures.push({ type: 'seaTurtle', instance: t, group: t.group });
  }

  private removeCreature(type: CreatureType): boolean {
    const idx = [...this.creatures].map((c, i) => ({ c, i })).reverse()
      .find(({ c }) => c.type === type)?.i ?? -1;
    if (idx === -1) return false;
    const [removed] = this.creatures.splice(idx, 1);
    if (!removed) return false;
    this.treeReef.anchor.remove(removed.group);
    removed.group.traverse((obj) => {
      const mesh = obj as import('three').Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) {
          for (const m of mesh.material) (m as import('three').Material).dispose();
        } else {
          (mesh.material as import('three').Material | undefined)?.dispose();
        }
      }
    });
    return true;
  }

  private countCreatures(type: CreatureType): number {
    return this.creatures.filter((c) => c.type === type).length;
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
    const tSec = t / 1000;
    this.swayClock.value = tSec;
    for (const c of this.creatures) c.instance.update(tSec);
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame((tt) => this.loop(tt));
  }
}
