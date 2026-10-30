import { describe, test, expect, vi } from 'vitest';
import type { AnchorEvent } from '@reef/shared';
import { isWebXRHitTestSupported, startWebXRTracker, WebXRHitTestProvider } from './webxrHitTest.js';

// Column-major pose: identity rotation, translated to (0.5, -1.2, -2).
const HIT_MATRIX = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.5, -1.2, -2, 1]);

/**
 * A fake XRSession driving the provider without a device: frames are stepped
 * by hand, `select` is dispatched by hand, and the hit-test source returns
 * whatever `hits` holds when the frame runs.
 */
function fakeXR(opts: { supported?: boolean | 'throws'; requestRejects?: boolean } = {}) {
  const listeners = new Map<string, Array<() => void>>();
  const frameCbs: XRFrameRequestCallback[] = [];
  const hitTestSource = { cancel: vi.fn() };
  const localSpace = { kind: 'local' };
  const state = { hits: [] as Float32Array[] };
  const session = {
    addEventListener: vi.fn((type: string, cb: () => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), cb]);
    }),
    requestReferenceSpace: vi.fn(async (type: string) => (type === 'local' ? localSpace : { kind: type })),
    requestHitTestSource: vi.fn(async () => hitTestSource),
    requestAnimationFrame: vi.fn((cb: XRFrameRequestCallback) => { frameCbs.push(cb); return frameCbs.length; }),
    cancelAnimationFrame: vi.fn(),
    end: vi.fn(async () => { for (const cb of listeners.get('end') ?? []) cb(); }),
  };
  const xr = {
    isSessionSupported: vi.fn(async () => {
      if (opts.supported === 'throws') throw new Error('SecurityError');
      return opts.supported ?? true;
    }),
    requestSession: vi.fn(async () => {
      if (opts.requestRejects) throw new Error('NotSupportedError: hit-test');
      return session;
    }),
  };
  const step = (t = 16): void => {
    const frame = {
      getHitTestResults: vi.fn(() => state.hits.map((m) => ({
        getPose: (space: unknown) => (space === localSpace ? { transform: { matrix: m } } : null),
      }))),
    };
    const pending = frameCbs.splice(0);
    for (const cb of pending) cb(t, frame as unknown as XRFrame);
  };
  const emit = (type: string): void => { for (const cb of listeners.get(type) ?? []) cb(); };
  return { xr: xr as unknown as XRSystem, rawXr: xr, session, hitTestSource, state, step, emit };
}

describe('isWebXRHitTestSupported', () => {
  test('false when navigator.xr is missing (iOS Safari)', async () => {
    expect(await isWebXRHitTestSupported(undefined)).toBe(false);
  });

  test('false when immersive-ar is unsupported or the probe throws', async () => {
    expect(await isWebXRHitTestSupported(fakeXR({ supported: false }).xr)).toBe(false);
    expect(await isWebXRHitTestSupported(fakeXR({ supported: 'throws' }).xr)).toBe(false);
  });

  test('true when immersive-ar is supported', async () => {
    const f = fakeXR();
    expect(await isWebXRHitTestSupported(f.xr)).toBe(true);
    expect(f.rawXr.isSessionSupported).toHaveBeenCalledWith('immersive-ar');
  });
});

describe('startWebXRTracker', () => {
  test('returns null without requesting a session when unsupported', async () => {
    const f = fakeXR({ supported: false });
    expect(await startWebXRTracker(f.xr, null)).toBeNull();
    expect(f.rawXr.requestSession).not.toHaveBeenCalled();
  });

  test('returns null when the session request rejects (no hit-test)', async () => {
    const f = fakeXR({ requestRejects: true });
    expect(await startWebXRTracker(f.xr, null)).toBeNull();
  });

  test('requires hit-test and asks for the DOM overlay', async () => {
    const f = fakeXR();
    const root = document.createElement('div');
    const p = await startWebXRTracker(f.xr, root);
    expect(p).toBeInstanceOf(WebXRHitTestProvider);
    expect(f.rawXr.requestSession).toHaveBeenCalledWith('immersive-ar', {
      requiredFeatures: ['hit-test'],
      optionalFeatures: ['dom-overlay'],
      domOverlay: { root },
    });
    expect(f.session.requestHitTestSource).toHaveBeenCalled();
  });
});

describe('WebXRHitTestProvider placement', () => {
  async function started() {
    const f = fakeXR();
    const p = (await startWebXRTracker(f.xr, null))!;
    const found: AnchorEvent[] = [];
    const lost: string[] = [];
    p.onAnchorFound((ev) => found.push(ev));
    p.onAnchorLost((id) => lost.push(id));
    await p.start();
    return { f, p, found, lost };
  }

  test('a tap places the anchor at the latest hit pose on the next frame', async () => {
    const { f, found } = await started();
    f.state.hits = [HIT_MATRIX];
    f.step();
    f.emit('select');
    expect(found).toHaveLength(0);
    f.step();
    expect(found).toHaveLength(1);
    expect(Array.from(found[0]!.pose.elements)).toEqual(Array.from(HIT_MATRIX));
    // Placement is one-shot: the hit-test source is released and later taps
    // belong to polyp placement, not anchor placement.
    expect(f.hitTestSource.cancel).toHaveBeenCalled();
    f.emit('select');
    f.step();
    expect(found).toHaveLength(1);
  });

  test('a tap with no surface under the reticle places nothing', async () => {
    const { f, found } = await started();
    f.step();
    f.emit('select');
    f.step();
    expect(found).toHaveLength(0);
    // A later tap once a surface is found still places.
    f.state.hits = [HIT_MATRIX];
    f.step();
    f.emit('select');
    f.step();
    expect(found).toHaveLength(1);
  });

  test('hasSurface reflects whether the last frame found a hit', async () => {
    const { f, p } = await started();
    f.step();
    expect(p.hasSurface).toBe(false);
    f.state.hits = [HIT_MATRIX];
    f.step();
    expect(p.hasSurface).toBe(true);
  });

  test('session end reports the anchor lost', async () => {
    const { f, p, lost } = await started();
    await p.destroy();
    expect(f.session.end).toHaveBeenCalled();
    expect(lost).toEqual(['floor']);
  });
});
