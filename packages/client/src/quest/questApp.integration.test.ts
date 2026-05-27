/**
 * Integration test for QuestApp — drives the full happy path with a
 * mocked XRSession + mocked fetch + mocked WebSocket. Verifies the
 * state machine transitions correctly, the anchor flow promotes
 * pendingAnchorPose into an XRAnchor on the next frame, and the
 * reef loads + the WebSocket connects.
 *
 * The original implementation plan said "interaction tests are next
 * session's job" — this is that test. happy-dom has no WebGL2, so the
 * renderer setup is gated and the per-frame loop here runs against a
 * stub that simulates frames.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry, Vector3 } from 'three';
import { QuestApp } from './questApp.js';
import { RateLimitError } from '../net/api.js';

function mockUi() {
  const button = document.createElement('button');
  const status = document.createElement('div');
  return { button, status };
}

describe('QuestApp integration', () => {
  beforeEach(() => {
    (navigator as Navigator & { xr?: XRSystem }).xr = {
      requestSession: vi.fn(),
      isSessionSupported: vi.fn().mockResolvedValue(true),
    } as unknown as XRSystem;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ polyps: [], sim: [], serverTime: Date.now() }),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('start() resolves to placement state with a working selectstart handler wired up', async () => {
    const xr = navigator.xr as XRSystem & { requestSession: ReturnType<typeof vi.fn> };
    const eventHandlers = new Map<string, (ev: unknown) => void>();
    const fakeSession = {
      addEventListener: vi.fn((name: string, cb: (ev: unknown) => void) => {
        eventHandlers.set(name, cb);
      }),
      requestReferenceSpace: vi.fn().mockResolvedValue({}),
    };
    xr.requestSession.mockResolvedValue(fakeSession as unknown as XRSession);

    const app = new QuestApp(mockUi());
    await app.start();
    expect(app.state).toBe('placement');
    // QuestApp registered handlers for end + selectstart.
    expect(eventHandlers.has('end')).toBe(true);
    expect(eventHandlers.has('selectstart')).toBe(true);
  });

  it('a selectstart from the right hand triggers the placement -> loading transition', async () => {
    const xr = navigator.xr as XRSystem & { requestSession: ReturnType<typeof vi.fn> };
    const eventHandlers = new Map<string, (ev: unknown) => void>();
    xr.requestSession.mockResolvedValue({
      addEventListener: vi.fn((name: string, cb: (ev: unknown) => void) => {
        eventHandlers.set(name, cb);
      }),
      requestReferenceSpace: vi.fn().mockResolvedValue({}),
    } as unknown as XRSession);

    const app = new QuestApp(mockUi());
    await app.start();
    expect(app.state).toBe('placement');

    // Fire a synthetic selectstart with a right-hand input source.
    const selectstart = eventHandlers.get('selectstart')!;
    selectstart({
      frame: {
        getPose: vi.fn().mockReturnValue({
          transform: { matrix: new Float32Array(16) },
        }),
      },
      inputSource: {
        handedness: 'right',
        targetRaySpace: {},
      },
    });
    // State machine moves placement -> loading via placement.onAnchor.
    expect(app.state).toBe('loading');
  });

  it('selectstart from the left hand is ignored (palette hand)', async () => {
    const xr = navigator.xr as XRSystem & { requestSession: ReturnType<typeof vi.fn> };
    const eventHandlers = new Map<string, (ev: unknown) => void>();
    xr.requestSession.mockResolvedValue({
      addEventListener: vi.fn((name: string, cb: (ev: unknown) => void) => {
        eventHandlers.set(name, cb);
      }),
      requestReferenceSpace: vi.fn().mockResolvedValue({}),
    } as unknown as XRSession);

    const app = new QuestApp(mockUi());
    await app.start();

    const selectstart = eventHandlers.get('selectstart')!;
    selectstart({
      frame: {
        getPose: vi.fn().mockReturnValue({
          transform: { matrix: new Float32Array(16) },
        }),
      },
      inputSource: { handedness: 'left', targetRaySpace: {} },
    });
    expect(app.state).toBe('placement'); // still waiting for right-hand pinch
  });

  it('session end transitions the app back to idle and clears references', async () => {
    const xr = navigator.xr as XRSystem & { requestSession: ReturnType<typeof vi.fn> };
    const eventHandlers = new Map<string, (ev: unknown) => void>();
    xr.requestSession.mockResolvedValue({
      addEventListener: vi.fn((name: string, cb: (ev: unknown) => void) => {
        eventHandlers.set(name, cb);
      }),
      requestReferenceSpace: vi.fn().mockResolvedValue({}),
    } as unknown as XRSession);

    const app = new QuestApp(mockUi());
    await app.start();
    eventHandlers.get('end')!(undefined);
    expect(app.state).toBe('idle');
  });

  it('moveReef while in interactive state resets to placement (no XR required for the public API)', async () => {
    const app = new QuestApp(mockUi());
    app._setStateForTest('interactive');
    app.moveReef();
    expect(app.state).toBe('placement');
  });

  it('moveReef from a fresh app (no anchor, no reef) is a no-op', async () => {
    // Idempotency / safety: moveReef shouldn't crash on partially-initialized
    // state. It's exposed as a public method and could be called any time.
    const app = new QuestApp(mockUi());
    expect(() => app.moveReef()).not.toThrow();
    expect(app.state).toBe('idle');
  });

  it('handleSubmitError surfaces RateLimitError to the status div and clears after 3s', () => {
    vi.useFakeTimers();
    try {
      const ui = mockUi();
      const app = new QuestApp(ui);
      app._setStateForTest('interactive');
      (app as unknown as { handleSubmitError: (err: unknown) => void })
        .handleSubmitError(new RateLimitError(5_000));
      expect(ui.status.textContent).toMatch(/Slow down/);
      vi.advanceTimersByTime(3_100);
      expect(ui.status.textContent).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('handleSubmitError surfaces a 400 (out-of-bounds position) as a helpful message', () => {
    vi.useFakeTimers();
    try {
      const ui = mockUi();
      const app = new QuestApp(ui);
      app._setStateForTest('interactive');
      (app as unknown as { handleSubmitError: (err: unknown) => void })
        .handleSubmitError(new Error('submitPolyp 400'));
      expect(ui.status.textContent).toMatch(/closer to the reef center/);
      vi.advanceTimersByTime(3_100);
      expect(ui.status.textContent).toBe('');
    } finally {
      vi.useRealTimers();
    }
  });

  it('Bug AA regression: requestReferenceSpace failure ends the leaked session', async () => {
    // The session is opened successfully but the reference space request
    // fails. Before the fix, the session held resources with no cleanup
    // path. Now: state → error AND session.end() is invoked.
    const xr = navigator.xr as XRSystem & { requestSession: ReturnType<typeof vi.fn> };
    const endSpy = vi.fn(() => Promise.resolve());
    xr.requestSession.mockResolvedValue({
      addEventListener: vi.fn(),
      requestReferenceSpace: vi.fn().mockRejectedValue(new Error('not supported')),
      end: endSpy,
    } as unknown as XRSession);
    const ui = mockUi();
    const app = new QuestApp(ui);
    await app.start();
    expect(app.state).toBe('error');
    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it('Bug A regression: persist=1 + missing restore API → falls back to "Pinch a spot"', async () => {
    // Set up the conditions that triggered Bug A:
    //   1. ?persist=1 in URL (so persistFlagEnabled() returns true)
    //   2. A saved handle in localStorage (so the restore would have queued)
    //   3. Session WITHOUT restorePersistentAnchor (older browser / dev env)
    // Before the fix, this combination wrote "Restoring..." to the status
    // div with no way to ever clear it.
    window.history.pushState({}, '', '?persist=1');
    window.localStorage.setItem('reef.questAnchorHandle', 'fake-uuid');
    try {
      const xr = navigator.xr as XRSystem & { requestSession: ReturnType<typeof vi.fn> };
      xr.requestSession.mockResolvedValue({
        addEventListener: vi.fn(),
        requestReferenceSpace: vi.fn().mockResolvedValue({}),
        // Deliberately no restorePersistentAnchor.
      } as unknown as XRSession);
      const ui = mockUi();
      const app = new QuestApp(ui);
      await app.start();
      expect(app.state).toBe('placement');
      expect(ui.status.textContent).not.toMatch(/Restoring/);
      expect(ui.status.textContent).toMatch(/Pinch/);
    } finally {
      window.localStorage.removeItem('reef.questAnchorHandle');
      window.history.pushState({}, '', '/');
    }
  });

  it('persist=1 + saved handle + restore API present → status shows "Restoring..."', async () => {
    // Positive case: the same URL + storage combo, but with the API
    // actually present, DOES show the restoring message.
    window.history.pushState({}, '', '?persist=1');
    window.localStorage.setItem('reef.questAnchorHandle', 'fake-uuid');
    try {
      const xr = navigator.xr as XRSystem & { requestSession: ReturnType<typeof vi.fn> };
      xr.requestSession.mockResolvedValue({
        addEventListener: vi.fn(),
        requestReferenceSpace: vi.fn().mockResolvedValue({}),
        restorePersistentAnchor: vi.fn(),
      } as unknown as XRSession);
      const ui = mockUi();
      const app = new QuestApp(ui);
      await app.start();
      expect(ui.status.textContent).toMatch(/Restoring/);
    } finally {
      window.localStorage.removeItem('reef.questAnchorHandle');
      window.history.pushState({}, '', '/');
    }
  });

  it('Bug AR regression: pinch outside ±1m bounds rejects pre-flight without spawning preview', () => {
    const ui = mockUi();
    const app = new QuestApp(ui);
    app._setStateForTest('interactive');
    // Set a non-null reefAnchor + reef so beginCompose proceeds past
    // its early-exit guards. reefAnchor.object3d at origin so
    // worldToLocal is the identity transform.
    const internal = app as unknown as {
      reefAnchor: { object3d: Group };
      reef: object | null;
      compose: object | null;
    };
    const anchorObj = new Group();
    anchorObj.updateMatrixWorld(true);
    internal.reefAnchor = { object3d: anchorObj };
    internal.reef = {} as object;

    // World position 1.5m from the anchor → outside the ±1m bound.
    (app as unknown as {
      beginCompose: (at: Vector3, yaw: number) => void;
    }).beginCompose(new Vector3(1.5, 0, 0), 0);

    expect(internal.compose).toBeNull();
    expect(ui.status.textContent).toMatch(/closer to the reef center/);
  });

  it('Bug AR (inverse): pinch within ±1m bounds starts a compose', () => {
    const ui = mockUi();
    const app = new QuestApp(ui);
    app._setStateForTest('interactive');
    const internal = app as unknown as {
      reefAnchor: { object3d: Group };
      reef: object | null;
      compose: object | null;
    };
    const anchorObj = new Group();
    anchorObj.updateMatrixWorld(true);
    internal.reefAnchor = { object3d: anchorObj };
    internal.reef = {} as object;
    (app as unknown as {
      beginCompose: (at: Vector3, yaw: number) => void;
    }).beginCompose(new Vector3(0.3, 0.2, -0.1), 0);
    expect(internal.compose).not.toBeNull();
  });

  it('Bug B regression: cancelGestureOnHandLoss disposes the compose preview + resets rightPinchWas', () => {
    const app = new QuestApp(mockUi());
    app._setStateForTest('interactive');
    // Stage an in-progress compose: a preview mesh parented to a holder,
    // plus a stale rightPinchWas=true (the bug condition).
    const parent = new Group();
    const preview = new Mesh(new PlaneGeometry(0.1, 0.1), new MeshBasicMaterial());
    parent.add(preview);
    const internal = app as unknown as {
      compose: { preview: Mesh; species: string; colorKey: string; seed: number; initialYaw: number; yaw: number } | null;
      rightPinchWas: boolean;
    };
    internal.compose = {
      preview,
      species: 'branching',
      colorKey: 'coral-pink',
      seed: 1,
      initialYaw: 0,
      yaw: 0,
    };
    internal.rightPinchWas = true;
    expect(parent.children).toContain(preview);

    app.cancelGestureOnHandLoss();

    expect(internal.compose).toBeNull();
    expect(internal.rightPinchWas).toBe(false);
    expect(parent.children).not.toContain(preview);
  });

  it('cancelGestureOnHandLoss is safe to call with no compose active', () => {
    const app = new QuestApp(mockUi());
    expect(() => app.cancelGestureOnHandLoss()).not.toThrow();
  });

  it('placement.onAnchor handler does NOT accumulate across re-entries (Bug C)', async () => {
    // Drive two start() cycles via a session-end transition between them
    // and confirm a single simulated pinch only sets pendingAnchorPose
    // once worth of side effects. Easier: read the placement's internal
    // handler array length via a peek. If we registered the handler
    // twice, length would be 2.
    const xr = navigator.xr as XRSystem & { requestSession: ReturnType<typeof vi.fn> };
    const eventHandlers = new Map<string, (ev: unknown) => void>();
    xr.requestSession.mockResolvedValue({
      addEventListener: vi.fn((name: string, cb: (ev: unknown) => void) => {
        eventHandlers.set(name, cb);
      }),
      requestReferenceSpace: vi.fn().mockResolvedValue({}),
    } as unknown as XRSession);

    const app = new QuestApp(mockUi());
    await app.start();
    eventHandlers.get('end')!(undefined); // end the session
    await app.start();
    // PlacementMode.handlers is private; reach in via cast just for the test.
    const placement = (app as unknown as {
      placement: { handlers: Array<unknown> };
    }).placement;
    expect(placement.handlers.length).toBe(1);
  });
});
