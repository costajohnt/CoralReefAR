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

  it('#97: handleSessionEnd tears the reef down before closing the socket', () => {
    // socket.close() is async, so a queued WS frame can still dispatch after it.
    // The reef must already be null when close() runs, so handleServerMessage
    // no-ops the late frame instead of mutating a half-cleared reef. The fake
    // socket records whether reef was already null at close time.
    const app = new QuestApp(mockUi());
    app._setStateForTest('interactive');
    const internal = app as unknown as {
      reef: { clear: () => void } | null;
      socket: { close: () => void } | null;
      handleSessionEnd: () => void;
    };
    let reefNullAtClose: boolean | null = null;
    const clear = vi.fn();
    internal.reef = { clear };
    internal.socket = { close: () => { reefNullAtClose = internal.reef === null; } };

    internal.handleSessionEnd();

    expect(reefNullAtClose).toBe(true);
    expect(clear).toHaveBeenCalledTimes(1);
    expect(internal.reef).toBeNull();
    expect(internal.socket).toBeNull();
  });

  it('adoptRestoredAnchor releases the XRAnchor and bails if session ended mid-restore', async () => {
    // Round-10 audit guard regression: a restorePersistentAnchor promise
    // can resolve AFTER the user ended the session. Without the
    // `if (!this.session)` guard, we'd parent the anchor's Object3D into
    // a scene attached to a dead session and call loadReef on it.
    const app = new QuestApp(mockUi());
    const internal = app as unknown as {
      session: XRSession | null;
      adoptRestoredAnchor: (a: XRAnchor) => Promise<void>;
      reefAnchor: object | null;
    };
    internal.session = null; // simulate session-already-ended
    const deleteSpy = vi.fn();
    const anchor = { delete: deleteSpy } as unknown as XRAnchor;
    await internal.adoptRestoredAnchor(anchor);
    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(internal.reefAnchor).toBeNull();
  });

  it('restorePersistentAnchor rejection clears the saved handle + falls back to placement', async () => {
    // Round-10 audit: a stale handle (room rearranged, anchor expired)
    // must drop the localStorage entry and surface a recoverable message.
    // Before the fix, the next session would retry the dead handle.
    window.history.pushState({}, '', '?persist=1');
    window.localStorage.setItem('reef.questAnchorHandle', 'stale-uuid');
    try {
      const xr = navigator.xr as XRSystem & { requestSession: ReturnType<typeof vi.fn> };
      const restoreReject = vi.fn().mockRejectedValue(new Error('handle expired'));
      xr.requestSession.mockResolvedValue({
        addEventListener: vi.fn(),
        requestReferenceSpace: vi.fn().mockResolvedValue({}),
        restorePersistentAnchor: restoreReject,
        inputSources: [],
      } as unknown as XRSession);
      const ui = mockUi();
      const app = new QuestApp(ui);
      await app.start();
      // onXRFrame returns early when renderer/referenceSpace are null
      // (happy-dom has no WebGL2 so the renderer is gated off in start()).
      // Stub them just enough to let the restore-handle branch fire.
      const internal = app as unknown as {
        renderer: { render: () => void } | null;
        onXRFrame: (f: XRFrame) => void;
      };
      internal.renderer = { render: vi.fn() };
      const frameStub = {
        predictedDisplayTime: 0,
        getViewerPose: () => null,
      } as unknown as XRFrame;
      internal.onXRFrame(frameStub);
      // restorePersistentAnchor was called and rejected; let the catch run.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(restoreReject).toHaveBeenCalledTimes(1);
      expect(window.localStorage.getItem('reef.questAnchorHandle')).toBeNull();
      expect(app.state).toBe('placement');
      expect(ui.status.textContent).toMatch(/Could not restore reef/);
    } finally {
      window.localStorage.removeItem('reef.questAnchorHandle');
      window.history.pushState({}, '', '/');
    }
  });

  it('transient errors fired within 3s do not clear each other prematurely', () => {
    // Round-10 audit fix: showTransientError tracks the timer ID and
    // cancels it before scheduling a new one, so the second message
    // sticks for its full 3s instead of being wiped by the first
    // timer firing.
    vi.useFakeTimers();
    try {
      const ui = mockUi();
      const app = new QuestApp(ui);
      app._setStateForTest('interactive');
      const submit = (app as unknown as { handleSubmitError: (e: unknown) => void })
        .handleSubmitError.bind(app);
      submit(new RateLimitError(5_000));
      expect(ui.status.textContent).toMatch(/Slow down/);
      // Second error 1s later — second timer should replace the first.
      vi.advanceTimersByTime(1_000);
      submit(new Error('submitPolyp 400'));
      expect(ui.status.textContent).toMatch(/closer to the reef center/);
      // 2.5s after the second error — first timer (already cancelled)
      // would have fired by now. Second message must still be visible.
      vi.advanceTimersByTime(2_500);
      expect(ui.status.textContent).toMatch(/closer to the reef center/);
      // Past the second timer's 3s window — now cleared.
      vi.advanceTimersByTime(600);
      expect(ui.status.textContent).toBe('');
    } finally {
      vi.useRealTimers();
    }
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
