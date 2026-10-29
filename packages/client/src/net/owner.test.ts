import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { getOwnerToken, OWNER_STORAGE_KEY, __resetOwnerForTests } from './owner.js';

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('getOwnerToken', () => {
  beforeEach(() => {
    __resetOwnerForTests();
    window.localStorage.clear();
  });
  afterEach(() => { vi.restoreAllMocks(); });

  test('creates a random ID once, persists it, and returns its SHA-256 (never the raw ID)', async () => {
    const token = await getOwnerToken();
    const raw = window.localStorage.getItem(OWNER_STORAGE_KEY);
    expect(raw).toMatch(/^[0-9a-f]{64}$/);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toBe(raw);
    expect(token).toBe(await sha256Hex(raw!));
  });

  test('is stable across reloads (same stored ID → same token)', async () => {
    const first = await getOwnerToken();
    __resetOwnerForTests();
    expect(await getOwnerToken()).toBe(first);
  });

  test('replaces a corrupted stored value', async () => {
    window.localStorage.setItem(OWNER_STORAGE_KEY, 'garbage');
    const token = await getOwnerToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(window.localStorage.getItem(OWNER_STORAGE_KEY)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('private mode: localStorage throwing falls back to a per-session ID', async () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    const a = await getOwnerToken();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    // Same page session keeps the same in-memory ID.
    __resetOwnerForTests({ keepMemoryId: true });
    expect(await getOwnerToken()).toBe(a);
  });

  test('returns null when WebCrypto digest is unavailable (insecure context)', async () => {
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('no subtle'));
    expect(await getOwnerToken()).toBeNull();
  });
});
