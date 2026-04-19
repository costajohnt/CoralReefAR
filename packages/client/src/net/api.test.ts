import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchReef, submitPolyp, RateLimitError } from './api.js';

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
