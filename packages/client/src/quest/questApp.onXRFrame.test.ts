/**
 * Per-frame orchestration test for QuestApp.onXRFrame (#109 item 1).
 *
 * The other QuestApp suites drive anchor promotion, the pinch state machine
 * and tracking-lost as isolated units (handlePinchStart, beginCompose,
 * cancelGestureOnHandLoss, ...). None of them run the real frame callback
 * with a viewer pose, so the frame-level wiring (pending pose promoted once,
 * anchor pose applied to the reef, head pose captured, hand input walked
 * through the pinch state machine, render last) has no test. This suite
 * feeds a stub XRFrame that returns a non-null viewer pose, hand-joint poses
 * and a translated anchor pose, and asserts on the observable state after
 * each frame.
 *
 * happy-dom has no WebGL2, so start() never builds a renderer; the tests
 * install a stub renderer the same way questApp.integration.test.ts does,
 * plus the one thing WebGLRenderer.render does that these paths depend on:
 * scene.updateMatrixWorld(), so the anchor's world matrix reaches
 * worldToLocal in beginCompose.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Object3D, Vector3 } from 'three';
import { QuestApp } from './questApp.js';

const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
/** Anchor sits at world (1, 0, -1) so reef-local coords differ from world coords. */
const ANCHOR_OFFSET = { x: 1, y: 0, z: -1 };
const ANCHOR_MATRIX = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, ANCHOR_OFFSET.x, ANCHOR_OFFSET.y, ANCHOR_OFFSET.z, 1]);

type Xyz = { x: number; y: number; z: number };
type JointName = 'thumb-tip' | 'index-finger-tip' | 'wrist';

/** Yaw-only rotation about +Y as a WebXR DOMPointReadOnly-shaped quaternion. */
function yawQuat(yaw: number): { x: number; y: number; z: number; w: number } {
  return { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
}

/**
 * Mutable right-hand rig. Each joint name maps to its own object, so
 * `frame.getJointPose(joint)` can look the pose up by identity. Tests move
 * the fingers between frames to walk the pinch state machine.
 */
function makeRightHand() {
  const joints: Record<JointName, { name: JointName }> = {
    'thumb-tip': { name: 'thumb-tip' },
    'index-finger-tip': { name: 'index-finger-tip' },
    wrist: { name: 'wrist' },
  };
  const rig = {
    thumb: { x: 0.3, y: 0.5, z: -0.3 } as Xyz,
    index: { x: 0.31, y: 0.5, z: -0.3 } as Xyz, // 1 cm apart: pinching
    wristYaw: 0,
    /** false = joints exist but have no pose this frame (hand not tracked). */
    tracked: true,
    source: {
      handedness: 'right',
      hand: { get: (name: JointName) => joints[name] },
    },
    poseFor(joint: { name: JointName }) {
      if (!rig.tracked) return null;
      if (joint.name === 'wrist') {
        return { transform: { position: { x: 0.3, y: 0.4, z: -0.3 }, orientation: yawQuat(rig.wristYaw) } };
      }
      const p = joint.name === 'thumb-tip' ? rig.thumb : rig.index;
      return { transform: { position: p, orientation: yawQuat(0) } };
    },
    setGap(meters: number) {
      rig.index = { x: rig.thumb.x + meters, y: rig.thumb.y, z: rig.thumb.z };
    },
  };
  return rig;
}

function makeFrame(opts: {
  hand: ReturnType<typeof makeRightHand>;
  anchorTracked?: () => boolean;
  createAnchor?: ReturnType<typeof vi.fn>;
  predictedDisplayTime?: number;
}) {
  return {
    predictedDisplayTime: opts.predictedDisplayTime ?? 16,
    getViewerPose: vi.fn(() => ({
      transform: {
        position: { x: 0, y: 1.6, z: 0 },
        orientation: { x: 0, y: 0, z: 0, w: 1 },
      },
    })),
    createAnchor: opts.createAnchor,
    // Anchor-space pose: ReefAnchor.update() reads transform.matrix.
    getPose: vi.fn(() => ((opts.anchorTracked?.() ?? true) ? { transform: { matrix: ANCHOR_MATRIX } } : null)),
    getJointPose: vi.fn((joint: { name: JointName }) => opts.hand.poseFor(joint)),
  } as unknown as XRFrame;
}

interface Internal {
  renderer: { render: ReturnType<typeof vi.fn> } | null;
  reefAnchor: { object3d: Object3D } | null;
  pendingAnchorPose: unknown;
  compose: { preview: Object3D; yaw: number; initialYaw: number } | null;
  rightPinchWas: boolean;
  lastHeadPosition: Vector3 | null;
  ambientClock: { value: number };
  scene: Object3D;
  onXRFrame: (f: XRFrame) => void;
}

function mockUi() {
  return { button: document.createElement('button'), status: document.createElement('div') };
}

/** Boot the app into `placement`, fire a right-hand selectstart, install a stub renderer. */
async function bootToPendingAnchor(hand: ReturnType<typeof makeRightHand>) {
  const eventHandlers = new Map<string, (ev: unknown) => void>();
  const session = {
    addEventListener: vi.fn((name: string, cb: (ev: unknown) => void) => { eventHandlers.set(name, cb); }),
    requestReferenceSpace: vi.fn().mockResolvedValue({ kind: 'local-floor' }),
    inputSources: [hand.source],
  };
  (navigator as Navigator & { xr?: XRSystem }).xr = {
    requestSession: vi.fn().mockResolvedValue(session),
    isSessionSupported: vi.fn().mockResolvedValue(true),
  } as unknown as XRSystem;

  const ui = mockUi();
  const app = new QuestApp(ui);
  await app.start();
  expect(app.state).toBe('placement');

  const placementTransform = { matrix: IDENTITY };
  eventHandlers.get('selectstart')!({
    frame: { getPose: () => ({ transform: placementTransform }) },
    inputSource: { handedness: 'right', targetRaySpace: {} },
  });
  expect(app.state).toBe('loading');

  const internal = app as unknown as Internal;
  internal.renderer = { render: vi.fn(() => internal.scene.updateMatrixWorld()) };
  return { app, ui, internal, session, placementTransform };
}

/** Full happy path: pending pose -> XRAnchor -> reef loaded -> interactive. */
async function bootToInteractive(hand: ReturnType<typeof makeRightHand>) {
  const booted = await bootToPendingAnchor(hand);
  const anchor = { anchorSpace: { kind: 'anchor' }, delete: vi.fn() };
  const createAnchor = vi.fn().mockResolvedValue(anchor);
  hand.setGap(0.1); // open hand during the promotion frame
  booted.internal.onXRFrame(makeFrame({ hand, createAnchor }));
  await vi.waitFor(() => expect(booted.app.state).toBe('interactive'));
  // The anchor object3d joined the scene after the promotion frame rendered;
  // one settling frame applies its pose and refreshes matrixWorld.
  booted.internal.onXRFrame(makeFrame({ hand }));
  expect(booted.internal.reefAnchor!.object3d.matrixWorld.elements.slice(12, 15))
    .toEqual([ANCHOR_OFFSET.x, ANCHOR_OFFSET.y, ANCHOR_OFFSET.z]);
  return booted;
}

function postCalls(): Array<{ url: string; body: Record<string, unknown> }> {
  return (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    .map(([url, init]) => ({
      url: String(url),
      body: JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>,
    }));
}

describe('QuestApp.onXRFrame orchestration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => ({
      ok: true,
      status: init?.method === 'POST' ? 201 : 200,
      json: async () => (init?.method === 'POST'
        ? { id: 1, species: 'branching', seed: 1, colorKey: 'coral-pink', position: [0, 0, 0], orientation: [0, 0, 0, 1], scale: 1, createdAt: 0 }
        : { polyps: [], sim: [], serverTime: Date.now() }),
    })));
    // loadReef opens a ReefSocket; keep it off the network.
    vi.stubGlobal('WebSocket', class {
      addEventListener(): void {}
      close(): void {}
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('first frame after placement promotes the pending pose into an XRAnchor, loads the reef and renders', async () => {
    const hand = makeRightHand();
    hand.setGap(0.1);
    const { app, internal, session, placementTransform } = await bootToPendingAnchor(hand);
    const anchor = { anchorSpace: { kind: 'anchor' }, delete: vi.fn() };
    const createAnchor = vi.fn().mockResolvedValue(anchor);
    const frame = makeFrame({ hand, createAnchor, predictedDisplayTime: 2500 });

    internal.onXRFrame(frame);

    // Synchronous part of the frame: the pending pose is consumed exactly once
    // and handed to createAnchor inside the frame, with the session's space.
    expect(createAnchor).toHaveBeenCalledTimes(1);
    const refSpace = await session.requestReferenceSpace.mock.results[0]!.value;
    expect(createAnchor).toHaveBeenCalledWith(placementTransform, refSpace);
    expect(internal.pendingAnchorPose).toBeNull();
    // Viewer pose was consumed for the head pose, the clock ticked, and the
    // frame ended in a render.
    expect(internal.lastHeadPosition!.toArray()).toEqual([0, 1.6, 0]);
    expect(internal.ambientClock.value).toBe(2.5);
    expect(internal.renderer!.render).toHaveBeenCalledTimes(1);

    // Async tail: anchor adopted, reef fetched, state advanced.
    await vi.waitFor(() => expect(app.state).toBe('interactive'));
    expect(internal.reefAnchor).not.toBeNull();
    expect(internal.scene.children).toContain(internal.reefAnchor!.object3d);
    expect(fetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/reef$/));

    // Second frame: nothing left to promote, anchor pose is applied instead.
    internal.onXRFrame(frame);
    expect(createAnchor).toHaveBeenCalledTimes(1);
    expect((frame as unknown as { getPose: ReturnType<typeof vi.fn> }).getPose)
      .toHaveBeenCalledWith(anchor.anchorSpace, refSpace);
    expect(app.state).toBe('interactive');
    expect(internal.renderer!.render).toHaveBeenCalledTimes(2);
  });

  it('createAnchor rejection on the promotion frame lands in error with the reason', async () => {
    const hand = makeRightHand();
    hand.setGap(0.1);
    const { app, ui, internal } = await bootToPendingAnchor(hand);
    const createAnchor = vi.fn().mockRejectedValue(new Error('anchors unsupported'));

    internal.onXRFrame(makeFrame({ hand, createAnchor }));

    await vi.waitFor(() => expect(app.state).toBe('error'));
    expect(ui.status.textContent).toBe('Anchor failed: anchors unsupported');
    expect(internal.reefAnchor).toBeNull();
  });

  it('pinch-start / mid-pinch twist / pinch-end across frames composes and submits a polyp', async () => {
    const hand = makeRightHand();
    const { internal } = await bootToInteractive(hand);
    const frame = makeFrame({ hand });

    // Frame 1: fingers 1 cm apart -> pinch-start -> compose begins, preview
    // parented under the anchor so it tracks the reef.
    hand.setGap(0.01);
    const pinchPoint = { ...hand.index }; // free-space compose anchors at the index tip
    internal.onXRFrame(frame);
    expect(internal.compose).not.toBeNull();
    expect(internal.rightPinchWas).toBe(true);
    const preview = internal.compose!.preview;
    expect(preview.parent).toBe(internal.reefAnchor!.object3d);
    expect(internal.compose!.initialYaw).toBeCloseTo(0);

    // Frame 2: still pinched, wrist twisted 0.5 rad -> preview follows.
    hand.wristYaw = 0.5;
    internal.onXRFrame(frame);
    expect(internal.compose).not.toBeNull();
    expect(internal.compose!.yaw).toBeCloseTo(0.5);
    expect(preview.rotation.y).toBeCloseTo(0.5);
    expect(postCalls()).toHaveLength(0);

    // Frame 3: 3 cm gap sits between the start (2.5 cm) and release (4 cm)
    // thresholds -> hysteresis keeps the pinch alive, no commit yet.
    hand.setGap(0.03);
    internal.onXRFrame(frame);
    expect(internal.compose).not.toBeNull();
    expect(postCalls()).toHaveLength(0);

    // Frame 4: fingers open past the release threshold -> pinch-end commits.
    hand.setGap(0.1);
    internal.onXRFrame(frame);
    expect(internal.compose).toBeNull();
    expect(internal.rightPinchWas).toBe(false);
    expect(preview.parent).toBeNull();
    const posts = postCalls();
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toMatch(/\/api\/reef\/polyp$/);
    expect(posts[0]!.body).toMatchObject({ species: 'branching', colorKey: 'coral-pink', surface: 'quest', scale: 1 });
    // Position is the pinch point in reef-local space: world index tip minus
    // the anchor's world offset (ReefAnchor.update -> matrixWorld -> worldToLocal).
    const [px, py, pz] = posts[0]!.body.position as number[];
    expect(px).toBeCloseTo(pinchPoint.x - ANCHOR_OFFSET.x);
    expect(py).toBeCloseTo(pinchPoint.y - ANCHOR_OFFSET.y);
    expect(pz).toBeCloseTo(pinchPoint.z - ANCHOR_OFFSET.z);
    // Orientation is the twisted yaw as a quaternion about +Y.
    const [qx, qy, qz, qw] = posts[0]!.body.orientation as number[];
    expect(qx).toBeCloseTo(0);
    expect(qz).toBeCloseTo(0);
    expect(qy).toBeCloseTo(Math.sin(0.25));
    expect(qw).toBeCloseTo(Math.cos(0.25));

    // Frame 5: hand still open -> no phantom second commit.
    internal.onXRFrame(frame);
    expect(postCalls()).toHaveLength(1);
  });

  it('losing the right hand mid-pinch discards the compose and does not commit when it reappears open', async () => {
    const hand = makeRightHand();
    const { internal } = await bootToInteractive(hand);
    const frame = makeFrame({ hand });

    hand.setGap(0.01);
    internal.onXRFrame(frame);
    const preview = internal.compose!.preview;

    hand.tracked = false;
    internal.onXRFrame(frame);
    expect(internal.compose).toBeNull();
    expect(internal.rightPinchWas).toBe(false);
    expect(preview.parent).toBeNull();

    hand.tracked = true;
    hand.setGap(0.1);
    internal.onXRFrame(frame);
    expect(postCalls()).toHaveLength(0);
    expect(internal.compose).toBeNull();

    // Reappearing already pinched reads as a fresh pinch-start (rightPinchWas
    // was reset on loss), so a new compose opens instead of a commit or a no-op.
    hand.setGap(0.01);
    internal.onXRFrame(frame);
    expect(internal.compose).not.toBeNull();
    expect(postCalls()).toHaveLength(0);
  });

  it('anchor pose dropping out drives tracking-lost (discarding the compose) and recovers when it returns', async () => {
    const hand = makeRightHand();
    const { app, internal } = await bootToInteractive(hand);
    let anchorTracked = true;
    const frame = makeFrame({ hand, anchorTracked: () => anchorTracked });

    hand.setGap(0.01);
    internal.onXRFrame(frame);
    expect(internal.compose).not.toBeNull();

    anchorTracked = false;
    internal.onXRFrame(frame);
    expect(app.state).toBe('tracking-lost');
    expect(internal.compose).toBeNull();

    // Hand opens while the anchor is still lost: no commit against a stale pose.
    hand.setGap(0.1);
    internal.onXRFrame(frame);
    expect(postCalls()).toHaveLength(0);

    anchorTracked = true;
    internal.onXRFrame(frame);
    expect(app.state).toBe('interactive');
  });
});
