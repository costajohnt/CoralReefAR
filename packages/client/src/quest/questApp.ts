import {
  Scene,
  WebGLRenderer,
  PerspectiveCamera,
  Vector3,
  Quaternion,
  Euler,
  type Mesh,
  type Object3D,
} from 'three';
import type { ServerMessage, Species } from '@reef/shared';
import { generatePolyp } from '@reef/generator';
import { polypMesh } from '../scene/meshAdapter.js';
import { Reef } from '../scene/reef.js';
import { disposeTree } from '../scene/dispose.js';
import { installSway } from '../scene/currentSway.js';
import { installPulse } from '../scene/pulse.js';
import { fetchReef, submitPolyp, RateLimitError } from '../net/api.js';
import { ReefSocket, defaultWsUrl } from '../net/ws.js';
import { PlacementMode } from './anchor/placementMode.js';
import { ReefAnchor } from './anchor/reefAnchor.js';
import {
  persistFlagEnabled,
  loadAnchorHandle,
  saveAnchorHandle,
  clearAnchorHandle,
  type PersistentAnchorAPI,
  type PersistentAnchorSession,
} from './anchor/anchorPersistence.js';
import { WristPalette } from './ui/wristPalette.js';
import { InstructionOverlay } from './ui/instructionOverlay.js';
import { isPinching, pickPokedButton, pickHotspot } from './hand/handInteraction.js';
import { applyServerMessage } from './serverMessageHandler.js';
import { HotspotLayer } from './hotspotLayer.js';

interface ComposeContext {
  species: Species;
  colorKey: string;
  seed: number;
  /** Initial wrist yaw at pinch start; rotation deltas are relative to this. */
  initialYaw: number;
  preview: Object3D;
  yaw: number;
}

export type QuestAppState =
  | 'idle'
  | 'xr-starting'
  | 'placement'
  | 'loading'
  | 'interactive'
  | 'tracking-lost'
  | 'error';

export interface QuestAppUi {
  button: HTMLButtonElement;
  status: HTMLDivElement;
}

/**
 * QuestApp owns the WebXR session lifecycle and a coarse state machine,
 * and orchestrates everything that hangs off of it: the WebGL renderer,
 * the per-frame anchor pose, the live reef scene, the wrist palette, and
 * the WebSocket fan-in for multi-user updates.
 *
 * Quest deliberately does NOT implement the `Tracker` interface used by
 * the phone-AR path. WebXR owns the reference space, the render loop, and
 * the per-frame camera, which is a different abstraction than the
 * marker-based pose pipeline `Tracker` was designed for.
 */
export class QuestApp {
  private _state: QuestAppState = 'idle';
  private session: XRSession | null = null;
  private referenceSpace: XRReferenceSpace | null = null;

  private renderer: WebGLRenderer | null = null;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(70, 1, 0.01, 50);

  private readonly placement = new PlacementMode();
  private reefAnchor: ReefAnchor | null = null;
  private reef: Reef | null = null;
  private readonly hotspots = new HotspotLayer();
  private readonly palette = new WristPalette();
  private readonly overlay = new InstructionOverlay();
  private socket: ReefSocket | null = null;
  private selectedSpecies: Species = 'branching';
  private selectedColorKey = 'coral-pink';
  private pendingAnchorPose: { transform: XRRigidTransform } | null = null;
  private rightPinchWas = false;
  private compose: ComposeContext | null = null;
  /** Set on construction; gates whether to read / write persistent handles. */
  private readonly persist: boolean = persistFlagEnabled();
  /** Set if a saved handle should be restored on the next XRFrame. */
  private pendingRestoreHandle: string | null = null;
  /**
   * Shared clock used by sway / pulse effect installers. Updated each
   * frame from the WebXR predictedDisplayTime (or wall-clock fallback).
   * The effects read `clock.value` directly.
   */
  private readonly ambientClock = { value: 0 };
  /** Keys used to mark a mesh as already having an effect installed. */
  private static readonly SWAY_INSTALLED = Symbol.for('reef.quest.sway');
  private static readonly PULSE_INSTALLED = Symbol.for('reef.quest.pulse');
  /** Last known viewer position (head). Used for palette face-toward-head. */
  private lastHeadPosition: Vector3 | null = null;
  /** Last known viewer forward vector. Used to billboard the overlay. */
  private lastHeadForward: Vector3 | null = null;
  /** Tracked id for the 3s transient-error fade-out timer. */
  private transientErrorTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly ui: QuestAppUi) {
    this.palette.onShapeSelect((s) => { this.selectedSpecies = s; });
    this.palette.onColorSelect((c) => { this.selectedColorKey = c; });
    this.palette.onMoveReef(() => this.moveReef());
    // Register PlacementMode handlers ONCE here, not per-session, so they
    // don't accumulate across multiple Enter-MR cycles on the same app.
    this.placement.onAnchor((pose) => {
      this.pendingAnchorPose = pose;
      this.setState('loading');
    });
  }

  get state(): QuestAppState {
    return this._state;
  }

  async start(): Promise<void> {
    if (this._state !== 'idle') return;
    this.setState('xr-starting');
    let sessionToCleanup: XRSession | null = null;
    try {
      const session = await navigator.xr!.requestSession('immersive-ar', {
        requiredFeatures: ['hand-tracking', 'anchors'],
        optionalFeatures: ['local-floor'],
      });
      sessionToCleanup = session;
      // Register 'end' listener BEFORE any later step can throw — if
      // requestReferenceSpace or renderer setup fails, we still want the
      // session's own end signal to drive cleanup if the runtime sends
      // one. The cleanup catch below covers the case where it doesn't.
      session.addEventListener('end', () => this.handleSessionEnd());
      this.session = session;
      this.referenceSpace = await session.requestReferenceSpace('local-floor').catch(() =>
        session.requestReferenceSpace('local'),
      );

      // happy-dom (test env) has no WebGL2; only set up the renderer when
      // a real graphics context is available. This keeps state-machine
      // unit tests passing without elaborate WebGL mocks.
      if (typeof WebGL2RenderingContext !== 'undefined') {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl2', { xrCompatible: true });
        if (gl) {
          // Only attach the canvas to the DOM after WebGL2 succeeded —
          // otherwise we'd leak an invisible canvas on browsers without
          // WebGL2.
          document.body.appendChild(canvas);
          let renderer: WebGLRenderer | null = null;
          try {
            renderer = new WebGLRenderer({ canvas, context: gl });
            renderer.xr.enabled = true;
            await renderer.xr.setSession(session);
            this.renderer = renderer;
            this.scene.add(this.palette.object3d);
            this.scene.add(this.overlay.object3d);
            renderer.setAnimationLoop((_t, frame) => {
              if (frame) this.onXRFrame(frame);
            });
          } catch (rendErr) {
            // setSession (or dispose-during-creation) can reject. Clean up
            // the renderer + canvas before bubbling out to the outer catch,
            // which will handle the session and state transition.
            if (renderer) renderer.dispose();
            canvas.remove();
            throw rendErr;
          }
        }
      }

      session.addEventListener('selectstart', (ev) => {
        this.handleSelectStart(ev as XRInputSourceEvent);
      });

      // If persistence is enabled and we have a saved handle AND this
      // browser actually implements the restore API, queue the restore
      // for the next frame. Verifying the API is present here (not later
      // in onXRFrame) keeps us from setting a "Restoring..." status that
      // would otherwise stick when there's no way to actually restore.
      if (this.persist) {
        const restoreAPI = (session as XRSession & PersistentAnchorSession)
          .restorePersistentAnchor;
        const saved = loadAnchorHandle();
        if (restoreAPI && saved) this.pendingRestoreHandle = saved;
      }

      this.setState('placement');
      this.ui.status.textContent = this.pendingRestoreHandle
        ? 'Restoring the reef in its last location…'
        : 'Pinch a spot on your floor to plant the reef.';
    } catch (err) {
      this.setState('error');
      this.ui.status.textContent = `Failed to enter MR: ${(err as Error).message}`;
      // Don't leak a session that was opened but failed during setup.
      // session.end() is async and might itself reject; ignore that —
      // the user is already in the error state and there's nothing
      // useful to do with another error here.
      if (sessionToCleanup) {
        sessionToCleanup.end().catch(() => undefined);
      }
    }
  }

  /**
   * Take a restored XRAnchor (from restorePersistentAnchor) and turn it
   * into a live reef. Mirrors the success path of createAnchor.then but
   * without the persistence write — we're restoring, not creating.
   */
  private async adoptRestoredAnchor(anchor: XRAnchor): Promise<void> {
    // Guard against the session ending while restorePersistentAnchor was
    // in flight. If it did, we'd be building a zombie reef on a dead
    // session — releasing the anchor and bailing is the safe path.
    if (!this.session) {
      anchor.delete();
      return;
    }
    this.reefAnchor = new ReefAnchor(anchor);
    this.scene.add(this.reefAnchor.object3d);
    try {
      await this.loadReef();
    } catch (loadErr) {
      this.tearDownPartialReefSetup();
      this.setState('error');
      this.ui.status.textContent = `Could not load reef: ${(loadErr as Error).message}`;
      return;
    }
    // The session may have ended during loadReef too; re-check before
    // surfacing the interactive state.
    if (!this.session) {
      this.tearDownPartialReefSetup();
      return;
    }
    this.setState('interactive');
    this.ui.status.textContent = '';
  }

  /**
   * Roll back the side effects loadReef may have left behind when it
   * throws partway through (new Reef + parented hotspots + sometimes
   * a socket). Used by both anchor paths' error handlers. Does NOT
   * touch session / renderer — those are still alive in error state
   * so the user can recover via session end + Enter MR.
   */
  private tearDownPartialReefSetup(): void {
    this.socket?.close();
    this.socket = null;
    if (this.reef) this.reef.clear();
    this.reef = null;
    this.hotspots.clear();
    if (this.reefAnchor) {
      this.scene.remove(this.reefAnchor.object3d);
      this.reefAnchor.delete();
      this.reefAnchor = null;
    }
    this.pendingAnchorPose = null;
  }

  private handleSelectStart(ev: XRInputSourceEvent): void {
    if (this._state !== 'placement') return;
    if (!this.referenceSpace) return;
    const pose = ev.frame.getPose(ev.inputSource.targetRaySpace, this.referenceSpace);
    if (!pose) return;
    this.placement.handleSelectStart(ev.inputSource, pose);
  }

  private async loadReef(): Promise<void> {
    if (!this.reefAnchor) return;
    this.reef = new Reef();
    this.reefAnchor.object3d.add(this.reef.anchor);
    this.reefAnchor.object3d.add(this.hotspots.object3d);
    // fetchReef rejects on network / CORS / non-2xx; let it propagate so
    // the caller transitions the state machine to 'error' and shows the
    // user something instead of leaving them on a permanent "Loading…".
    const state = await fetchReef();
    for (const polyp of state.polyps) {
      this.reef.addPolyp(polyp);
      this.hotspots.addPolyp(polyp);
    }
    for (const delta of state.sim) this.reef.applySim(delta);
    this.installAmbientEffectsOnNewMeshes();

    const url = defaultWsUrl();
    this.socket = new ReefSocket(url);
    this.socket.on((msg: ServerMessage) => this.handleServerMessage(msg));
    this.socket.connect();
  }

  private handleServerMessage(msg: ServerMessage): void {
    if (!this.reef) return;
    applyServerMessage(this.reef, msg);
    if (msg.type === 'polyp_added') {
      this.hotspots.addPolyp(msg.polyp);
      this.installAmbientEffectsOnNewMeshes();
    } else if (msg.type === 'polyp_removed') {
      this.hotspots.removePolyp(msg.id);
    }
  }

  /**
   * Walk the live reef and install sway + pulse effects on any mesh that
   * doesn't have them yet. Idempotent — guards via per-mesh symbols. The
   * effects read from the shared ambientClock which we tick each frame.
   */
  private installAmbientEffectsOnNewMeshes(): void {
    if (!this.reef) return;
    for (const obj of this.reef.all()) {
      const m = obj as Mesh;
      if (!m.isMesh) continue;
      const flags = m.userData as Record<symbol, unknown>;
      if (!flags[QuestApp.SWAY_INSTALLED]) {
        installSway(m, this.ambientClock);
        flags[QuestApp.SWAY_INSTALLED] = true;
      }
      if (!flags[QuestApp.PULSE_INSTALLED]) {
        const polyp = (m.userData as { polyp?: { seed: number } }).polyp;
        if (polyp) {
          installPulse(m, this.ambientClock, polyp.seed);
          flags[QuestApp.PULSE_INSTALLED] = true;
        }
      }
    }
  }

  private onXRFrame(frame: XRFrame): void {
    if (!this.renderer || !this.referenceSpace) return;
    // Drive the sway / pulse shaders. predictedDisplayTime is the WebXR
    // canonical wall-clock; fall back to performance.now() if absent.
    this.ambientClock.value = ((frame as XRFrame & { predictedDisplayTime?: number })
      .predictedDisplayTime ?? performance.now()) / 1000;

    // Persistent-anchor restore path: this fires on the first XRFrame
    // after start() if persist=1 and a saved handle exists. Restoring is
    // an async API; on success we skip placement entirely and go
    // straight to loading. On failure we drop the saved handle and let
    // the user re-pinch.
    if (this.pendingRestoreHandle && !this.reefAnchor && this._state === 'placement') {
      const handle = this.pendingRestoreHandle;
      this.pendingRestoreHandle = null;
      const restore = (this.session as XRSession & PersistentAnchorSession | null)
        ?.restorePersistentAnchor;
      if (restore && this.session) {
        this.setState('loading');
        void restore.call(this.session, handle)
          .then(async (anchor) => this.adoptRestoredAnchor(anchor))
          .catch(() => {
            // Restore failed — handle is stale (room rearranged, anchor
            // expired). Drop it and fall back to manual placement.
            clearAnchorHandle();
            this.setState('placement');
            this.ui.status.textContent = 'Could not restore reef — pinch a new spot.';
          });
      }
    }

    // Promote pending pose into an XRAnchor on the first frame after
    // placement. Anchors can only be created inside an XRFrame.
    if (this.pendingAnchorPose && !this.reefAnchor) {
      const pose = this.pendingAnchorPose;
      this.pendingAnchorPose = null;
      const createAnchor = (frame as XRFrame & {
        createAnchor?: (pose: XRRigidTransform, space: XRSpace) => Promise<XRAnchor>;
      }).createAnchor;
      if (createAnchor) {
        void createAnchor.call(frame, pose.transform, this.referenceSpace)
          .then(async (anchor) => {
            // Session may have ended during createAnchor. Without this
            // check we'd build a zombie reef + open a WebSocket on a
            // dead session.
            if (!this.session) {
              anchor.delete();
              return;
            }
            this.reefAnchor = new ReefAnchor(anchor);
            this.scene.add(this.reefAnchor.object3d);
            // If persistence is enabled, ask the anchor for a UUID and
            // save it for the next session. Best-effort: a missing API
            // or failed request is silently ignored.
            if (this.persist) {
              const persistAPI = anchor as XRAnchor & PersistentAnchorAPI;
              if (persistAPI.requestPersistentHandle) {
                try {
                  const handle = await persistAPI.requestPersistentHandle();
                  saveAnchorHandle(handle);
                } catch {
                  // ignore — persistence is opt-in convenience
                }
              }
            }
            try {
              await this.loadReef();
            } catch (loadErr) {
              this.tearDownPartialReefSetup();
              this.setState('error');
              this.ui.status.textContent = `Could not load reef: ${(loadErr as Error).message}`;
              return;
            }
            // Re-check after the async loadReef.
            if (!this.session) {
              this.tearDownPartialReefSetup();
              return;
            }
            this.setState('interactive');
            this.ui.status.textContent = '';
          })
          .catch((err: unknown) => {
            this.setState('error');
            this.ui.status.textContent = `Anchor failed: ${(err as Error).message}`;
          });
      }
    }

    if (this.reefAnchor) {
      const tracked = this.reefAnchor.update(frame, this.referenceSpace);
      if (!tracked && this._state === 'interactive') this.setState('tracking-lost');
      else if (tracked && this._state === 'tracking-lost') this.setState('interactive');
    }

    this.captureHeadPose(frame);
    this.updatePalettePose(frame);
    this.updateOverlayPose();
    this.handleRightHandInteraction(frame);
    this.renderer.render(this.scene, this.camera);
  }

  private captureHeadPose(frame: XRFrame): void {
    if (!this.referenceSpace) return;
    const viewerPose = frame.getViewerPose(this.referenceSpace);
    if (!viewerPose) return;
    const t = viewerPose.transform;
    if (this.lastHeadPosition) {
      this.lastHeadPosition.set(t.position.x, t.position.y, t.position.z);
    } else {
      this.lastHeadPosition = new Vector3(t.position.x, t.position.y, t.position.z);
    }
    // Forward in WebXR's viewer space is local -Z. Rotate that by the viewer
    // orientation to get the world-space gaze direction.
    const q = t.orientation;
    const fwd = new Vector3(0, 0, -1).applyQuaternion(
      new Quaternion(q.x, q.y, q.z, q.w),
    );
    if (this.lastHeadForward) this.lastHeadForward.copy(fwd);
    else this.lastHeadForward = fwd;
  }

  private updateOverlayPose(): void {
    if (!this.overlay.visible || !this.lastHeadPosition || !this.lastHeadForward) return;
    this.overlay.updatePose(this.lastHeadPosition, this.lastHeadForward);
  }

  private updatePalettePose(frame: XRFrame): void {
    if (!this.session || !this.referenceSpace) return;
    for (const source of this.session.inputSources) {
      if (source.handedness !== 'left') continue;
      if (!source.hand) continue;
      const wristJoint = source.hand.get('wrist');
      if (!wristJoint) continue;
      const pose = frame.getJointPose?.(wristJoint, this.referenceSpace);
      if (!pose) continue;
      const p = pose.transform.position;
      // Offset 4 cm above the wrist so the palette floats over the back of
      // the user's hand rather than clipping into it. The face-toward target
      // is the user's head, so the palette is always readable.
      const wristPos = new Vector3(p.x, p.y + 0.04, p.z);
      const lookTarget = this.lastHeadPosition ?? new Vector3(p.x, p.y + 1, p.z);
      this.palette.updatePose(wristPos, lookTarget);
      return;
    }
  }

  private handleRightHandInteraction(frame: XRFrame): void {
    if (this._state !== 'interactive') return;
    if (!this.session || !this.referenceSpace) return;
    let sawTrackedRightHand = false;
    for (const source of this.session.inputSources) {
      if (source.handedness !== 'right' || !source.hand) continue;
      const thumb = source.hand.get('thumb-tip');
      const index = source.hand.get('index-finger-tip');
      const wrist = source.hand.get('wrist');
      if (!thumb || !index || !wrist) continue;
      const thumbPose = frame.getJointPose?.(thumb, this.referenceSpace);
      const indexPose = frame.getJointPose?.(index, this.referenceSpace);
      const wristPose = frame.getJointPose?.(wrist, this.referenceSpace);
      if (!thumbPose || !indexPose || !wristPose) continue;
      sawTrackedRightHand = true;
      const thumbP = thumbPose.transform.position;
      const indexP = indexPose.transform.position;
      const thumbVec = new Vector3(thumbP.x, thumbP.y, thumbP.z);
      const indexVec = new Vector3(indexP.x, indexP.y, indexP.z);
      const wristYaw = this.yawFromXrQuaternion(wristPose.transform.orientation);
      const pinching = isPinching(thumbVec, indexVec, this.rightPinchWas);
      const isPinchStart = pinching && !this.rightPinchWas;
      const isPinchEnd = !pinching && this.rightPinchWas;
      this.rightPinchWas = pinching;

      if (isPinchStart) {
        this.handlePinchStart(thumbVec, indexVec, wristYaw);
      } else if (pinching && this.compose) {
        // Mid-pinch: update preview rotation from wrist twist.
        const delta = this.shortestAngleDelta(wristYaw, this.compose.initialYaw);
        this.compose.yaw = delta;
        this.compose.preview.rotation.y = delta;
      } else if (isPinchEnd && this.compose) {
        this.commitCompose();
      }
      return;
    }
    // Right hand isn't tracked this frame. Cancel any in-progress
    // gesture state so the next reappearance doesn't fire a phantom
    // pinch-end commit.
    if (!sawTrackedRightHand) this.cancelGestureOnHandLoss();
  }

  /**
   * Reset right-hand gesture state when tracking drops mid-interaction.
   * Committing a polyp the user can no longer see is worse than making
   * them retry the placement; we discard the compose preview and clear
   * the "was pinching" flag so the next frame with an un-pinched hand
   * doesn't read as a pinch-end transition.
   *
   * Exposed (not private) so the unit test can drive it directly —
   * the full render-loop path requires a WebGL2 context that happy-dom
   * doesn't provide.
   */
  cancelGestureOnHandLoss(): void {
    if (this.compose) {
      this.disposeComposePreview(this.compose.preview);
      this.compose = null;
    }
    this.rightPinchWas = false;
  }

  private handlePinchStart(thumb: Vector3, index: Vector3, wristYaw: number): void {
    if (!this.reef) return;
    if (this.compose) return; // already composing — ignore extra starts
    // Direct-touch poke check: did the user's index fingertip land on a
    // palette button? Distance-based (not raycast) because poke is a
    // touch gesture, not a far-pointer interaction.
    const paletteButtons: Object3D[] = this.palette.object3d.children;
    const poked = pickPokedButton(index, paletteButtons);
    if (poked) {
      this.palette.poke(poked);
      return;
    }
    // Tip-node hotspot: ray from thumb toward index hits one of the
    // visible glowing tips? Start the compose anchored at the tip's
    // world transform instead of free-space.
    const rayDir = new Vector3().subVectors(index, thumb);
    const hotspotHit = pickHotspot(thumb, rayDir, this.hotspots.hotspots());
    if (hotspotHit) {
      const transform = this.hotspots.hotspotTransform(hotspotHit.hotspotId);
      if (transform) {
        this.beginComposeAt(transform.worldPosition, wristYaw);
        return;
      }
    }
    this.beginCompose(index, wristYaw);
  }

  private beginComposeAt(worldPosition: Vector3, initialYaw: number): void {
    // Hotspot path: world position comes from the hotspot's transform,
    // not the user's fingertip. The compose preview snaps to the tip.
    this.beginCompose(worldPosition, initialYaw);
  }

  /** Server's PolypInputSchema constrains position to ±1m around the
   * anchor (pedestal-local). Reject placement attempts that would 400. */
  private static readonly MAX_REEF_LOCAL_COORD = 1.0;

  private beginCompose(at: Vector3, initialYaw: number): void {
    if (!this.reefAnchor) return;
    // Pre-flight: if the requested position is outside the server's
    // ±1m bound, bail before spawning a preview the user will see
    // disappear on commit. Show the same "pinch closer" message we'd
    // show for an actual 400 response.
    const localProbe = this.reefAnchor.object3d.worldToLocal(at.clone());
    const M = QuestApp.MAX_REEF_LOCAL_COORD;
    if (
      Math.abs(localProbe.x) > M ||
      Math.abs(localProbe.y) > M ||
      Math.abs(localProbe.z) > M
    ) {
      this.showTransientError('Pinch closer to the reef center to plant a polyp.');
      return;
    }
    const seed = Math.floor(Math.random() * 0xffffffff);
    const { mesh } = generatePolyp({
      species: this.selectedSpecies,
      seed,
      colorKey: this.selectedColorKey,
    });
    const preview = polypMesh(mesh);
    preview.userData.isPreview = true;
    // Dim the preview so users can visually distinguish "ghost in flight"
    // from a placed polyp. polypMesh returns its own material per call,
    // so we can mutate without leaking to other polyps.
    const previewMat = (preview as Mesh).material as
      | { opacity?: number; emissiveIntensity?: number }
      | { opacity?: number; emissiveIntensity?: number }[];
    const setGhostLook = (mat: { opacity?: number; emissiveIntensity?: number }): void => {
      mat.opacity = 0.55;
      mat.emissiveIntensity = 0.5;
    };
    if (Array.isArray(previewMat)) previewMat.forEach(setGhostLook);
    else setGhostLook(previewMat);
    // Position the preview at the local-space equivalent of the pinch point;
    // attaching to the reef anchor means tracking-lost still keeps the preview
    // visually aligned with the reef.
    const local = this.reefAnchor.object3d.worldToLocal(at.clone());
    preview.position.copy(local);
    this.reefAnchor.object3d.add(preview);
    this.compose = {
      species: this.selectedSpecies,
      colorKey: this.selectedColorKey,
      seed,
      initialYaw,
      preview,
      yaw: 0,
    };
  }

  private commitCompose(): void {
    if (!this.compose || !this.reefAnchor) return;
    const c = this.compose;
    this.compose = null;
    // Snapshot the preview's local position before disposal — the live
    // polyp_added broadcast will spawn the real version at the same coords.
    const local = c.preview.position.clone();
    this.disposeComposePreview(c.preview);
    const q = new Quaternion().setFromEuler(new Euler(0, c.yaw, 0, 'YXZ'));
    submitPolyp({
      species: c.species,
      seed: c.seed,
      colorKey: c.colorKey,
      position: [local.x, local.y, local.z],
      orientation: [q.x, q.y, q.z, q.w],
      scale: 1,
      surface: 'quest',
    }).catch((err: unknown) => {
      this.handleSubmitError(err);
    });
  }

  private handleSubmitError(err: unknown): void {
    let msg: string;
    if (err instanceof RateLimitError) {
      msg = `Slow down — wait ${Math.ceil(err.retryAfterMs / 1000)}s.`;
    } else if (err instanceof Error && err.message.includes('400')) {
      // Server validation rejection — most often a position out of the ±1m
      // pedestal-local bounds. Educate the user.
      msg = 'Pinch closer to the reef center to plant a polyp.';
    } else {
      // Unknown error (500, network, etc.) — still surface visible
      // feedback rather than silently swallowing. Log for debugging.
      console.warn('submitPolyp failed', err);
      msg = 'Could not plant polyp — try again.';
    }
    this.showTransientError(msg);
  }

  /**
   * Show a 3-second transient error in both the 2D status div and the
   * in-XR overlay. Cancels any previous transient-error timer so
   * overlapping errors don't stack and clear each other prematurely.
   */
  private showTransientError(msg: string): void {
    this.ui.status.textContent = msg;
    this.overlay.setText(msg);
    this.overlay.show();
    if (this.transientErrorTimer !== null) {
      clearTimeout(this.transientErrorTimer);
    }
    this.transientErrorTimer = setTimeout(() => this.clearTransientError(), 3000);
  }

  private clearTransientError(): void {
    this.transientErrorTimer = null;
    this.ui.status.textContent = '';
    // Restore the overlay text to whatever the current state expects.
    this.syncOverlayToState();
  }

  private disposeComposePreview(preview: Object3D): void {
    if (preview.parent) preview.parent.remove(preview);
    disposeTree(preview);
  }

  private yawFromXrQuaternion(orientation: DOMPointReadOnly): number {
    const q = new Quaternion(orientation.x, orientation.y, orientation.z, orientation.w);
    const euler = new Euler().setFromQuaternion(q, 'YXZ');
    return euler.y;
  }

  /** Returns (current - initial) wrapped to (-π, π] so the polyp doesn't spin past full turns. */
  private shortestAngleDelta(current: number, initial: number): number {
    let d = current - initial;
    if (d > Math.PI) d -= 2 * Math.PI;
    else if (d < -Math.PI) d += 2 * Math.PI;
    return d;
  }

  // ---- Public API for tests + UI external triggers ----

  anchorPlaced(): void {
    if (this._state === 'placement') this.setState('loading');
  }

  reefReady(): void {
    if (this._state === 'loading') {
      this.setState('interactive');
      this.ui.status.textContent = '';
    }
  }

  trackingLost(): void {
    if (this._state === 'interactive') this.setState('tracking-lost');
  }

  trackingRestored(): void {
    if (this._state === 'tracking-lost') this.setState('interactive');
  }

  moveReef(): void {
    if (this._state !== 'interactive' && this._state !== 'tracking-lost') return;
    // Tear down any in-progress compose first; its preview is parented to the
    // about-to-be-removed reef anchor and would otherwise dangle.
    if (this.compose) {
      this.disposeComposePreview(this.compose.preview);
      this.compose = null;
      this.rightPinchWas = false;
    }
    // If we had a persisted handle for this location, it's no longer
    // valid — the user is explicitly re-locating the reef. Both the
    // localStorage entry AND the Quest's persistent-anchor record need
    // to go; XRAnchor.delete() handles the in-session anchor, not the
    // storage record, which lives at the session level.
    if (this.persist) {
      const oldHandle = loadAnchorHandle();
      clearAnchorHandle();
      if (oldHandle && this.session) {
        const deletePersistent = (this.session as XRSession & PersistentAnchorSession)
          .deletePersistentAnchor;
        deletePersistent?.call(this.session, oldHandle).catch(() => undefined);
      }
    }
    // Drop the WS so we don't double-subscribe on the next loadReef, remove
    // the reef group from the anchor, release the anchor itself.
    this.socket?.close();
    this.socket = null;
    if (this.reefAnchor) {
      if (this.reef) {
        this.reefAnchor.object3d.remove(this.reef.anchor);
        this.reef.clear();
      }
      this.reefAnchor.object3d.remove(this.hotspots.object3d);
      this.hotspots.clear();
      this.scene.remove(this.reefAnchor.object3d);
      this.reefAnchor.delete();
      this.reefAnchor = null;
    }
    this.reef = null;
    this.placement.reset();
    this.setState('placement');
    this.ui.status.textContent = 'Pinch a new spot to move the reef.';
  }

  _setStateForTest(s: QuestAppState): void {
    this._state = s;
  }

  // ---- Private internals ----

  private handleSessionEnd(): void {
    if (this.compose) {
      this.disposeComposePreview(this.compose.preview);
      this.compose = null;
    }
    this.rightPinchWas = false;
    this.lastHeadPosition = null;
    this.lastHeadForward = null;
    this.pendingRestoreHandle = null;
    if (this.transientErrorTimer !== null) {
      clearTimeout(this.transientErrorTimer);
      this.transientErrorTimer = null;
    }
    this.socket?.close();
    this.socket = null;
    if (this.reef) this.reef.clear();
    this.reef = null;
    this.hotspots.clear();
    // Detach the reef anchor's Object3D from the scene graph before
    // releasing the XRAnchor — otherwise the empty Object3D lingers in
    // this.scene as an invisible (but real) child, and across multiple
    // Enter-MR cycles N orphan reef-anchor subtrees accumulate.
    if (this.reefAnchor) {
      this.scene.remove(this.reefAnchor.object3d);
      this.reefAnchor.delete();
      this.reefAnchor = null;
    }
    this.session = null;
    this.referenceSpace = null;
    this.pendingAnchorPose = null;
    // Dispose the WebGLRenderer + remove its canvas from the DOM so
    // resources don't accumulate. WebGLRenderer.xr already unbinds the
    // session on its own 'end' listener, so we only handle GL state.
    if (this.renderer) {
      const canvas = this.renderer.domElement;
      this.renderer.dispose();
      canvas.remove();
      this.renderer = null;
    }
    this.setState('idle');
  }

  private setState(s: QuestAppState): void {
    this._state = s;
    this.syncOverlayToState();
  }

  private syncOverlayToState(): void {
    switch (this._state) {
      case 'placement':
        this.overlay.setText('Pinch the floor with your right hand to plant the reef.');
        this.overlay.show();
        break;
      case 'loading':
        this.overlay.setText('Loading the reef…');
        this.overlay.show();
        break;
      case 'tracking-lost':
        this.overlay.setText('Tracking lost. Look around to recover.');
        this.overlay.show();
        break;
      case 'error':
        this.overlay.setText('Something went wrong. Exit and try again.');
        this.overlay.show();
        break;
      case 'interactive':
      case 'idle':
      case 'xr-starting':
        this.overlay.setText('');
        this.overlay.hide();
        break;
      default:
        this.overlay.setText('');
        this.overlay.hide();
        break;
    }
  }
}
