import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ReefSocket, defaultWsUrl } from './ws.js';

// Minimal WebSocket mock. Tracks registered listeners so tests can fire open /
// message / close / error to drive ReefSocket through its state machine.
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
    // Real WebSockets fire close asynchronously; for test purposes synchronous
    // is fine and makes assertions deterministic.
    this.fire('close', {});
  }

  fire(type: string, ev: unknown): void {
    this.listeners.get(type)?.forEach((cb) => cb(ev));
  }

  static created: FakeWs[] = [];
  static reset(): void {
    FakeWs.created = [];
  }
}

describe('ReefSocket', () => {
  beforeEach(() => {
    FakeWs.reset();
    vi.stubGlobal('WebSocket', FakeWs);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('connect() opens a WebSocket at the configured url', () => {
    const s = new ReefSocket('ws://example.test/ws');
    s.connect();

    expect(FakeWs.created).toHaveLength(1);
    expect(FakeWs.created[0]!.url).toBe('ws://example.test/ws');
  });

  test('messages dispatch to every registered handler', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const s = new ReefSocket('ws://t');
    s.on(h1);
    s.on(h2);
    s.connect();

    FakeWs.created[0]!.fire('message', { data: JSON.stringify({ type: 'hello', polypCount: 3 }) });

    expect(h1).toHaveBeenCalledWith({ type: 'hello', polypCount: 3 });
    expect(h2).toHaveBeenCalledWith({ type: 'hello', polypCount: 3 });
  });

  test('close event schedules a reconnect with exponential backoff', () => {
    const s = new ReefSocket('ws://t');
    s.connect();
    // First drop: retries goes 0 → 1, delay = 1000 * 1.8^0 = 1000.
    FakeWs.created[0]!.fire('close', {});

    // Not yet — still within the backoff window.
    vi.advanceTimersByTime(999);
    expect(FakeWs.created).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(FakeWs.created).toHaveLength(2);

    // Second drop: delay = 1000 * 1.8^1 = 1800.
    FakeWs.created[1]!.fire('close', {});
    vi.advanceTimersByTime(1799);
    expect(FakeWs.created).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(FakeWs.created).toHaveLength(3);
  });

  test('backoff caps at 30s even after many failures', () => {
    const s = new ReefSocket('ws://t');
    s.connect();
    // Burn through retries without ever succeeding so the formula exceeds 30s.
    // 1000 * 1.8^8 ≈ 110,200 — well past the cap.
    for (let i = 0; i < 8; i++) {
      FakeWs.created[FakeWs.created.length - 1]!.fire('close', {});
      vi.advanceTimersByTime(30_000);
    }
    // 1 initial + 8 reconnects = 9 sockets. Crucially, each reconnect fired
    // within a 30s window — no run ever needed more than that.
    expect(FakeWs.created).toHaveLength(9);
  });

  test('an open event resets retries so the next drop starts from baseline', () => {
    const s = new ReefSocket('ws://t');
    s.connect();
    // Fail a few times to build up retries.
    FakeWs.created[0]!.fire('close', {});
    vi.advanceTimersByTime(1000);
    FakeWs.created[1]!.fire('close', {});
    vi.advanceTimersByTime(1800);
    // Now we're on socket index 2. Successfully open it.
    FakeWs.created[2]!.fire('open', {});
    // Drop again: next delay should be 1000ms (retries reset to 0), not 3240.
    FakeWs.created[2]!.fire('close', {});
    vi.advanceTimersByTime(999);
    expect(FakeWs.created).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(FakeWs.created).toHaveLength(4);
  });

  test('close() on the socket stops reconnects', () => {
    const s = new ReefSocket('ws://t');
    s.connect();
    s.close();
    // close() invokes ws.close() which fires 'close', which would normally
    // schedule a reconnect. The `closed` flag must short-circuit that.
    vi.advanceTimersByTime(60_000);
    expect(FakeWs.created).toHaveLength(1);
  });
});

describe('defaultWsUrl', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('picks wss for https and ws for http', () => {
    vi.stubGlobal('location', { protocol: 'https:', host: 'reef.example.com' });
    expect(defaultWsUrl()).toBe('wss://reef.example.com/ws');

    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost:5173' });
    expect(defaultWsUrl()).toBe('ws://localhost:5173/ws');
  });
});
