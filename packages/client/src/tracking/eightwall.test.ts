import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { EightWallProvider } from './eightwall.js';

// XR8 is a runtime-only global set by the 8th Wall engine script. Tests
// stub/clear it on window directly.
type TestWindow = Window & { XR8?: unknown };

describe('EightWallProvider.waitUntilReady', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete (window as TestWindow).XR8;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as TestWindow).XR8;
  });

  test('resolves true immediately when XR8 is already present', async () => {
    (window as unknown as { XR8?: unknown }).XR8 = {};
    await expect(EightWallProvider.waitUntilReady(1000)).resolves.toBe(true);
  });

  test('resolves true once XR8 arrives before the deadline', async () => {
    const promise = EightWallProvider.waitUntilReady(1000, 50);
    // Let a few polls run while XR8 is still absent.
    await vi.advanceTimersByTimeAsync(200);
    (window as unknown as { XR8?: unknown }).XR8 = {};
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBe(true);
  });

  test('resolves false if XR8 never arrives by the deadline', async () => {
    const promise = EightWallProvider.waitUntilReady(500, 50);
    await vi.advanceTimersByTimeAsync(600);
    await expect(promise).resolves.toBe(false);
  });
});
