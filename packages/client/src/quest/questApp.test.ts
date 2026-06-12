import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QuestApp, type QuestAppState } from './questApp.js';

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
