import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fetchTree, submitTreePolyp, TreeSocket, defaultTreeWsUrl } from './api.js';

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(
    typeof body === 'string' ? body : JSON.stringify(body),
    { status, headers: { 'content-type': 'application/json' } },
  )));
}

const validInput = {
  variant: 'forked' as const,
  seed: 42,
  colorKey: 'reef-blue',
  parentId: null,
  attachIndex: 0,
};

describe('fetchTree', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  test('calls GET /api/tree and returns parsed JSON', async () => {
    const payload = { polyps: [], serverTime: 1000 };
    mockFetch(200, payload);

    const result = await fetchTree();

    expect(result).toEqual(payload);
    const fetchMock = vi.mocked(globalThis.fetch as typeof fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toBe('/api/tree');
  });

  test('respects the apiBase parameter', async () => {
    mockFetch(200, { polyps: [], serverTime: 0 });
    await fetchTree('https://api.example.com');
    const fetchMock = vi.mocked(globalThis.fetch as typeof fetch);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example.com/api/tree');
  });

  test('throws on non-OK response with status in message', async () => {
    mockFetch(500, {});
    await expect(fetchTree()).rejects.toThrowError(/fetchTree 500/);
  });

  test('throws on 404 with status in message', async () => {
    mockFetch(404, {});
    await expect(fetchTree()).rejects.toThrowError(/fetchTree 404/);
  });
});

describe('submitTreePolyp', () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  test('calls POST /api/tree/polyp with JSON body', async () => {
    const saved = { id: 1, ...validInput, createdAt: 999 };
    mockFetch(201, saved);

    const result = await submitTreePolyp(validInput);

    const fetchMock = vi.mocked(globalThis.fetch as typeof fetch);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('/api/tree/polyp');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(validInput);
    expect(result.id).toBe(1);
  });

  test('respects the apiBase parameter', async () => {
    mockFetch(201, { id: 2, ...validInput, createdAt: 1 });
    await submitTreePolyp(validInput, 'https://api.example.com');
    const fetchMock = vi.mocked(globalThis.fetch as typeof fetch);
    expect(fetchMock.mock.calls[0]![0]).toBe('https://api.example.com/api/tree/polyp');
  });

  test('throws on non-OK response with status in message', async () => {
    mockFetch(400, 'bad request');
    const err = await submitTreePolyp(validInput).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/submitTreePolyp 400/);
  });

  test('throws on 500 with status in message', async () => {
    mockFetch(500, 'server error');
    const err = await submitTreePolyp(validInput).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('500');
  });
});

// ---------------------------------------------------------------------------
// TreeSocket
// ---------------------------------------------------------------------------

class FakeWs {
  readonly listeners = new Map<string, Set<(ev: unknown) => void>>();
  readonly url: string;
  readonly closeSpy = vi.fn();

  constructor(url: string) {
    this.url = url;
    FakeWs.created.push(this);
  }

  addEventListener(type: string, cb: (ev: unknown) => void): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(cb);
  }

  close(): void {
    this.closeSpy();
    // Fire 'close' synchronously so reconnect logic is testable.
    this.fire('close', {});
  }

  fire(type: string, ev: unknown): void {
    this.listeners.get(type)?.forEach((cb) => cb(ev));
  }

  static created: FakeWs[] = [];
  static reset(): void { FakeWs.created = []; }
}

describe('TreeSocket', () => {
  beforeEach(() => {
    FakeWs.reset();
    vi.stubGlobal('WebSocket', FakeWs);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('connect() opens a WebSocket to the given URL', () => {
    const s = new TreeSocket('ws://example.test/ws/tree');
    s.connect();

    expect(FakeWs.created).toHaveLength(1);
    expect(FakeWs.created[0]!.url).toBe('ws://example.test/ws/tree');
  });

  test('on() registers a listener that receives parsed messages', () => {
    const cb = vi.fn();
    const s = new TreeSocket('ws://t');
    s.on(cb);
    s.connect();

    const msg = { type: 'tree_hello', polypCount: 5, serverTime: 100 };
    FakeWs.created[0]!.fire('message', { data: JSON.stringify(msg) });

    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(msg);
  });

  test('messages dispatch to every registered listener', () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const s = new TreeSocket('ws://t');
    s.on(cb1);
    s.on(cb2);
    s.connect();

    const msg = { type: 'tree_polyp_added', polyp: { id: 1, variant: 'forked', seed: 0, colorKey: 'x', parentId: null, attachIndex: 0, createdAt: 0 } };
    FakeWs.created[0]!.fire('message', { data: JSON.stringify(msg) });

    expect(cb1).toHaveBeenCalledWith(msg);
    expect(cb2).toHaveBeenCalledWith(msg);
  });

  test('close() closes the underlying WebSocket', () => {
    const s = new TreeSocket('ws://t');
    s.connect();
    s.close();

    expect(FakeWs.created[0]!.closeSpy).toHaveBeenCalledOnce();
  });

  test('close() stops reconnects', () => {
    const s = new TreeSocket('ws://t');
    s.connect();
    s.close();
    vi.advanceTimersByTime(60_000);
    expect(FakeWs.created).toHaveLength(1);
  });

  test('tolerates malformed JSON messages silently', () => {
    const cb = vi.fn();
    const s = new TreeSocket('ws://t');
    s.on(cb);
    s.connect();

    // Fire garbage — should not throw and should not call the listener.
    expect(() => {
      FakeWs.created[0]!.fire('message', { data: 'not valid JSON {{{{' });
    }).not.toThrow();

    expect(cb).not.toHaveBeenCalled();
  });

  test('reconnects with exponential backoff on close', () => {
    const s = new TreeSocket('ws://t');
    s.connect();

    // First drop: delay = 1000 * 1.8^0 = 1000ms.
    FakeWs.created[0]!.fire('close', {});

    vi.advanceTimersByTime(999);
    expect(FakeWs.created).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(FakeWs.created).toHaveLength(2);
  });

  test('open event resets retries so the next drop starts from baseline', () => {
    const s = new TreeSocket('ws://t');
    s.connect();

    // Fail twice to build up retries.
    FakeWs.created[0]!.fire('close', {});
    vi.advanceTimersByTime(1000);
    FakeWs.created[1]!.fire('close', {});
    vi.advanceTimersByTime(1800);

    // Socket 2: open it successfully then drop.
    FakeWs.created[2]!.fire('open', {});
    FakeWs.created[2]!.fire('close', {});

    // Next delay should be 1000ms (retries reset), not 3240ms.
    vi.advanceTimersByTime(999);
    expect(FakeWs.created).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(FakeWs.created).toHaveLength(4);
  });
});

describe('defaultTreeWsUrl', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  test('picks wss for https and ws for http, path is /ws/tree', () => {
    vi.stubGlobal('location', { protocol: 'https:', host: 'reef.example.com' });
    expect(defaultTreeWsUrl()).toBe('wss://reef.example.com/ws/tree');

    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:5173' });
    expect(defaultTreeWsUrl()).toBe('ws://localhost:5173/ws/tree');
  });
});
