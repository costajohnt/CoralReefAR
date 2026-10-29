import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { OWNER_HEADER } from '@reef/shared';
import { fetchReef, submitPolyp, RateLimitError, fetchMyPolypIds, undoPolyp, UndoError } from './api.js';
import { OWNER_STORAGE_KEY, __resetOwnerForTests } from './owner.js';

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers: { 'content-type': 'application/json' } },
  )));
}

const validInput = {
  species: 'branching' as const,
  seed: 1,
  colorKey: 'coral-pink',
  position: [0, 0, 0] as [number, number, number],
  orientation: [0, 0, 0, 1] as [number, number, number, number],
  scale: 1,
};

describe('fetchReef', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  test('resolves with the parsed reef state on 200', async () => {
    mockFetch(200, { polyps: [], sim: [], serverTime: 42 });
    const state = await fetchReef();
    expect(state).toEqual({ polyps: [], sim: [], serverTime: 42 });
  });

  test('throws on non-2xx with status in the message', async () => {
    mockFetch(500, {});
    await expect(fetchReef()).rejects.toThrowError(/fetchReef 500/);
  });
});

describe('submitPolyp', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  test('resolves with the saved polyp on 201', async () => {
    mockFetch(201, { id: 7, ...validInput, createdAt: 123 });
    const saved = await submitPolyp(validInput);
    expect(saved.id).toBe(7);
    expect(saved.species).toBe('branching');
  });

  test('throws RateLimitError with retryAfterMs on 429', async () => {
    mockFetch(429, { error: 'rate_limited', retryAfterMs: 1234 });
    const err = await submitPolyp(validInput).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(1234);
  });

  test('RateLimitError falls back to 1h when body is missing retryAfterMs', async () => {
    mockFetch(429, { error: 'rate_limited' });
    const err = await submitPolyp(validInput).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(3_600_000);
  });

  test('RateLimitError falls back to 1h when body is malformed JSON', async () => {
    mockFetch(429, 'not json');
    const err = await submitPolyp(validInput).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfterMs).toBe(3_600_000);
  });

  test('throws a generic Error on other non-2xx', async () => {
    mockFetch(400, { error: 'invalid_input' });
    const err = await submitPolyp(validInput).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(RateLimitError);
    expect((err as Error).message).toContain('400');
  });
});

describe('owner token transport (#112)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __resetOwnerForTests();
    window.localStorage.clear();
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  function headerOf(call: unknown[]): string | undefined {
    const init = call[1] as RequestInit | undefined;
    return (init?.headers as Record<string, string> | undefined)?.[OWNER_HEADER];
  }

  test('submitPolyp sends the owner token header', async () => {
    mockFetch(201, { id: 7, ...validInput, createdAt: 123 });
    await submitPolyp(validInput);
    const call = vi.mocked(fetch).mock.calls[0]!;
    expect(headerOf(call)).toMatch(/^[0-9a-f]{64}$/);
    expect(headerOf(call)).not.toBe(window.localStorage.getItem(OWNER_STORAGE_KEY));
  });

  test('submitPolyp still posts without a token when hashing is unavailable', async () => {
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('insecure'));
    mockFetch(201, { id: 7, ...validInput, createdAt: 123 });
    await submitPolyp(validInput);
    expect(headerOf(vi.mocked(fetch).mock.calls[0]!)).toBeUndefined();
  });

  test('fetchMyPolypIds GETs /api/reef/mine with the token', async () => {
    mockFetch(200, { ids: [3, 9] });
    expect(await fetchMyPolypIds()).toEqual([3, 9]);
    const call = vi.mocked(fetch).mock.calls[0]!;
    expect(String(call[0])).toMatch(/\/api\/reef\/mine$/);
    expect(headerOf(call)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('fetchMyPolypIds returns [] without a token and does not call the server', async () => {
    vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('insecure'));
    mockFetch(200, { ids: [1] });
    expect(await fetchMyPolypIds()).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  test('undoPolyp POSTs to the undo route with the token', async () => {
    mockFetch(200, { ok: true });
    await undoPolyp(12);
    const call = vi.mocked(fetch).mock.calls[0]!;
    expect(String(call[0])).toMatch(/\/api\/reef\/polyp\/12\/undo$/);
    expect((call[1] as RequestInit).method).toBe('POST');
    expect(headerOf(call)).toMatch(/^[0-9a-f]{64}$/);
  });

  test('undoPolyp surfaces the server error code', async () => {
    mockFetch(409, { error: 'undo_window_expired' });
    const err = await undoPolyp(12).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UndoError);
    expect((err as UndoError).code).toBe('undo_window_expired');
  });

  test('undoPolyp falls back to an http_<status> code on an unparseable body', async () => {
    mockFetch(502, 'bad gateway');
    const err = await undoPolyp(12).catch((e: unknown) => e);
    expect((err as UndoError).code).toBe('http_502');
  });
});
