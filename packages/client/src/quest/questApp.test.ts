import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Group, Object3D, Vector3 } from 'three';
import { QuestApp, type QuestAppState } from './questApp.js';

// Reach the private fields the #98 input-path tests need to drive
// handlePinchStart without a live XR session.
interface PinchTestable {
  reef: unknown;
  compose: unknown;
  palette: { object3d: { children: Object3D[] } };
  handlePinchStart(thumb: Vector3, index: Vector3, wristYaw: number): void;
}
const moveButtonWorldPos = (app: QuestApp): Vector3 => {
  const palette = (app as unknown as PinchTestable).palette;
  const moveBtn = palette.object3d.children.find(
    (c) => (c.userData as { action?: string }).action === 'move',
  );
  if (!moveBtn) throw new Error('move button not found on palette');
  return moveBtn.getWorldPosition(new Vector3());
};

function mockUi() {
  const button = document.createElement('button');
  const status = document.createElement('div');
  return { button, status };
}

describe('QuestApp state machine', () => {
  beforeEach(() => {
    (navigator as Navigator & { xr?: XRSystem }).xr = {
      requestSession: vi.fn(),
      isSessionSupported: vi.fn().mockResolvedValue(true),
    } as unknown as XRSystem;
  });

  it('starts in idle', () => {
    const app = new QuestApp(mockUi());
    expect(app.state).toBe('idle' satisfies QuestAppState);
  });

  it('transitions idle -> xr-starting -> placement when session resolves', async () => {
    const fakeSession = {
      addEventListener: vi.fn(),
      requestReferenceSpace: vi.fn().mockResolvedValue({}),
    };
    const xr = navigator.xr as XRSystem & { requestSession: ReturnType<typeof vi.fn> };
    xr.requestSession.mockResolvedValue(fakeSession as unknown as XRSession);

    const app = new QuestApp(mockUi());
    const promise = app.start();
    expect(app.state).toBe('xr-starting' satisfies QuestAppState);
    await promise;
    expect(app.state).toBe('placement' satisfies QuestAppState);
  });

  it('transitions to error when requestSession rejects', async () => {
    const xr = navigator.xr as XRSystem & { requestSession: ReturnType<typeof vi.fn> };
    xr.requestSession.mockRejectedValue(new Error('user-canceled'));
    const app = new QuestApp(mockUi());
    await app.start();
    expect(app.state).toBe('error' satisfies QuestAppState);
  });

  it('anchorPlaced moves placement -> loading', () => {
    const app = new QuestApp(mockUi());
    app._setStateForTest('placement');
    app.anchorPlaced();
    expect(app.state).toBe('loading' satisfies QuestAppState);
  });

  it('anchorPlaced is a no-op outside placement', () => {
    const app = new QuestApp(mockUi());
    app._setStateForTest('interactive');
    app.anchorPlaced();
    expect(app.state).toBe('interactive' satisfies QuestAppState);
  });

  it('reefReady moves loading -> interactive', () => {
    const app = new QuestApp(mockUi());
    app._setStateForTest('loading');
    app.reefReady();
    expect(app.state).toBe('interactive' satisfies QuestAppState);
  });

  it('trackingLost / trackingRestored toggle correctly from interactive', () => {
    const app = new QuestApp(mockUi());
    app._setStateForTest('interactive');
    app.trackingLost();
    expect(app.state).toBe('tracking-lost' satisfies QuestAppState);
    app.trackingRestored();
    expect(app.state).toBe('interactive' satisfies QuestAppState);
  });

  it('moveReef returns to placement from interactive', () => {
    const app = new QuestApp(mockUi());
    app._setStateForTest('interactive');
    app.moveReef();
    expect(app.state).toBe('placement' satisfies QuestAppState);
  });

  it('moveReef is a no-op from non-interactive states', () => {
    const app = new QuestApp(mockUi());
    app._setStateForTest('placement');
    app.moveReef();
    // Stays in placement — moveReef shouldn't kick the state machine here.
    expect(app.state).toBe('placement' satisfies QuestAppState);

    app._setStateForTest('loading');
    app.moveReef();
    expect(app.state).toBe('loading' satisfies QuestAppState);
  });

  it('moveReef from tracking-lost also returns to placement', () => {
    const app = new QuestApp(mockUi());
    app._setStateForTest('tracking-lost');
    app.moveReef();
    expect(app.state).toBe('placement' satisfies QuestAppState);
  });

  // #98: in tracking-lost a right-hand pinch must still reach the Move-reef
  // palette button (the only recovery action) — but must NOT place a polyp
  // against the stale anchor pose.
  it('a Move-reef palette poke is reachable from tracking-lost', () => {
    const app = new QuestApp(mockUi());
    const internal = app as unknown as PinchTestable;
    // tracking-lost holds the reef at its last good pose, so reef is non-null.
    internal.reef = {};
    app._setStateForTest('tracking-lost');

    // Aim the index fingertip exactly at the Move-reef button.
    const onMove = moveButtonWorldPos(app);
    internal.handlePinchStart(onMove.clone(), onMove, 0);

    // The poke fired onMoveReef -> moveReef -> placement.
    expect(app.state).toBe('placement' satisfies QuestAppState);
  });

  it('a free-space pinch in tracking-lost does not start a compose', () => {
    const app = new QuestApp(mockUi());
    const internal = app as unknown as PinchTestable;
    internal.reef = {};
    app._setStateForTest('tracking-lost');

    // Far from every palette button — no poke, and placement is blocked.
    const far = new Vector3(100, 100, 100);
    internal.handlePinchStart(far.clone(), far, 0);

    expect(internal.compose).toBeNull();
    expect(app.state).toBe('tracking-lost' satisfies QuestAppState);
  });

  it('entering tracking-lost discards an in-flight compose so it cannot commit against a stale pose', () => {
    const app = new QuestApp(mockUi());
    const internal = app as unknown as PinchTestable;
    app._setStateForTest('interactive');
    // Stage a compose mid-pinch (the right hand can still be tracked when only
    // the anchor is lost, so without the discard a pinch-end would commit it).
    internal.compose = { preview: new Group(), yaw: 0, initialYaw: 0 };

    app.trackingLost();

    expect(app.state).toBe('tracking-lost' satisfies QuestAppState);
    expect(internal.compose).toBeNull();
  });

  it('start() is idempotent — repeat calls do not re-enter xr-starting', async () => {
    const xr = navigator.xr as XRSystem & { requestSession: ReturnType<typeof vi.fn> };
    xr.requestSession.mockResolvedValue({
      addEventListener: vi.fn(),
      requestReferenceSpace: vi.fn().mockResolvedValue({}),
    } as unknown as XRSession);
    const app = new QuestApp(mockUi());
    await app.start();
    expect(app.state).toBe('placement' satisfies QuestAppState);
    await app.start();
    // Still in placement — not back to xr-starting.
    expect(app.state).toBe('placement' satisfies QuestAppState);
    expect(xr.requestSession).toHaveBeenCalledTimes(1);
  });

  it('status div text updates per state', async () => {
    const ui = mockUi();
    const xr = navigator.xr as XRSystem & { requestSession: ReturnType<typeof vi.fn> };
    xr.requestSession.mockResolvedValue({
      addEventListener: vi.fn(),
      requestReferenceSpace: vi.fn().mockResolvedValue({}),
    } as unknown as XRSession);
    const app = new QuestApp(ui);
    await app.start();
    expect(ui.status.textContent).toMatch(/Pinch/);
    app._setStateForTest('interactive');
    app.reefReady();
    // reefReady() clears the status div but only from `loading`; here we forced
    // interactive directly, so the message is unchanged. Verify via moveReef.
    app.moveReef();
    expect(ui.status.textContent).toMatch(/Pinch a new spot/);
  });
});
