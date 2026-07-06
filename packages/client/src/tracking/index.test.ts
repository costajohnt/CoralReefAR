import { describe, test, expect, beforeEach, vi } from 'vitest';

// EightWallProvider.isAvailable() probes globals; stub the import so the
// `auto` branch selection is deterministic in tests.
vi.mock('./eightwall.js', () => ({
  EightWallProvider: class {
    static isAvailable = vi.fn(() => false);
    readonly name = 'eightwall' as const;
    async init(): Promise<void> {}
    onAnchorFound(): void {}
    onAnchorLost(): void {}
    onFrame(): void {}
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    async destroy(): Promise<void> {}
  },
}));

import { EightWallProvider } from './eightwall.js';
import { readTrackerFromUrl, selectProvider } from './index.js';

describe('readTrackerFromUrl', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  test('returns the explicit param when set to a known value', () => {
    vi.stubGlobal('location', { search: '?tracker=noop' });
    expect(readTrackerFromUrl()).toBe('noop');
    vi.stubGlobal('location', { search: '?tracker=eightwall' });
    expect(readTrackerFromUrl()).toBe('eightwall');
  });

  test('returns "auto" when the param is missing', () => {
    vi.stubGlobal('location', { search: '' });
    expect(readTrackerFromUrl()).toBe('auto');
  });

  test('returns "auto" when the param has an unknown value', () => {
    vi.stubGlobal('location', { search: '?tracker=rubbish' });
    expect(readTrackerFromUrl()).toBe('auto');
  });
});

describe('selectProvider', () => {
  beforeEach(() => {
    (EightWallProvider.isAvailable as unknown as ReturnType<typeof vi.fn>).mockReset();
  });

  test('honors explicit noop regardless of 8th Wall availability', () => {
    (EightWallProvider.isAvailable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const p = selectProvider('noop');
    // NoopProvider is the real class (not mocked), so its name is a real assertion.
    expect(p.name).toBe('noop');
  });

  test('honors explicit eightwall even when 8th Wall is not available', () => {
    (EightWallProvider.isAvailable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    // Assert on class identity, not the mock's fabricated `name`: this proves
    // selectProvider constructed an EightWallProvider, not just that something
    // labelled 'eightwall' came back.
    expect(selectProvider('eightwall')).toBeInstanceOf(EightWallProvider);
  });

  test('auto prefers EightWall when available', () => {
    (EightWallProvider.isAvailable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    expect(selectProvider('auto')).toBeInstanceOf(EightWallProvider);
  });

  test('auto falls back to noop when EightWall is unavailable', () => {
    (EightWallProvider.isAvailable as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const p = selectProvider('auto');
    expect(p).not.toBeInstanceOf(EightWallProvider);
    expect(p.name).toBe('noop');
  });
});
