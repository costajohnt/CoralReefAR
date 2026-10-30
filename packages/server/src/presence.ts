import { randomBytes } from 'node:crypto';
import { PRESENCE_INTERVAL_MS, PresenceClientMessageSchema, type PresenceVisitor } from '@reef/shared';

// Quest co-presence (#114): ephemeral head poses relayed between headsets.
// Memory only: no DB, so nothing reaches SQLite or Litestream. Ids are random
// per connection and poses are reef-local, so nothing identifies a visitor.

const WS_OPEN = 1;
/** A presence frame is ~80 bytes; anything much larger is not one. */
const MAX_FRAME_BYTES = 256;
/** Frames per second (any size or validity) before the socket is closed. 4x the legit rate. */
const FLOOD_MAX_PER_SEC = (1000 / PRESENCE_INTERVAL_MS) * 4;

export type PresenceSocket = {
  readyState: number;
  send(data: string): void;
  close?(code?: number, reason?: string): void;
};

interface Entry {
  id: string;
  pose: Pick<PresenceVisitor, 'p' | 'q'> | null;
  updatedAt: number;
  lastAccepted: number;
  windowStart: number;
  windowCount: number;
}

export interface PresenceOptions {
  /** Most visitors any one client is sent per frame (nearest-in-time first). */
  maxVisitors: number;
  /** A pose older than this is not broadcast. */
  ttlMs?: number;
  now?: () => number;
}

export class Presence {
  private readonly entries = new Map<PresenceSocket, Entry>();
  // Closed for flooding: frames already buffered behind the close must not re-join.
  private readonly banned = new WeakSet<PresenceSocket>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly opts: PresenceOptions) {
    this.ttlMs = opts.ttlMs ?? 2000;
    this.now = opts.now ?? Date.now;
  }

  /**
   * One inbound frame. A socket joins presence on its first frame, so clients
   * that never send one (every non-Quest surface) are never sent presence.
   */
  handleFrame(ws: PresenceSocket, raw: Buffer | string): void {
    if (this.banned.has(ws)) return;
    const now = this.now();
    let e = this.entries.get(ws);
    if (!e) {
      e = { id: randomBytes(4).toString('hex'), pose: null, updatedAt: 0, lastAccepted: -Infinity, windowStart: now, windowCount: 0 };
      this.entries.set(ws, e);
    }
    if (now - e.windowStart >= 1000) {
      e.windowStart = now;
      e.windowCount = 0;
    }
    if (++e.windowCount > FLOOD_MAX_PER_SEC) {
      this.remove(ws);
      this.banned.add(ws);
      try { ws.close?.(1008, 'presence rate limit'); } catch { /* already gone */ }
      return;
    }
    if (raw.length > MAX_FRAME_BYTES) return;
    // Throttle: one pose per interval, with 25% jitter tolerance. Excess frames
    // are dropped silently (they still count toward the flood limit above).
    if (now - e.lastAccepted < PRESENCE_INTERVAL_MS * 0.75) return;
    let parsed: unknown;
    try { parsed = JSON.parse(String(raw)); } catch { return; }
    const msg = PresenceClientMessageSchema.safeParse(parsed);
    if (!msg.success) return;
    e.pose = { p: msg.data.p, q: msg.data.q };
    e.updatedAt = now;
    e.lastAccepted = now;
  }

  remove(ws: PresenceSocket): void {
    this.entries.delete(ws);
  }

  size(): number {
    return this.entries.size;
  }

  /** Fan out: each joined client gets up to maxVisitors fresh poses, never its own. */
  tick(): void {
    const now = this.now();
    const fresh: Array<{ ws: PresenceSocket; visitor: PresenceVisitor; at: number }> = [];
    for (const [ws, e] of this.entries) {
      if (e.pose && now - e.updatedAt <= this.ttlMs) fresh.push({ ws, visitor: { id: e.id, ...e.pose }, at: e.updatedAt });
    }
    // Newest first; one extra so a recipient that is itself in the top N
    // still gets N others.
    fresh.sort((a, b) => b.at - a.at);
    fresh.length = Math.min(fresh.length, this.opts.maxVisitors + 1);
    if (fresh.length === 0) return;
    for (const ws of this.entries.keys()) {
      if (ws.readyState !== WS_OPEN) continue;
      const visitors: PresenceVisitor[] = [];
      for (const f of fresh) {
        if (f.ws !== ws && visitors.length < this.opts.maxVisitors) visitors.push(f.visitor);
      }
      if (visitors.length === 0) continue;
      try {
        ws.send(JSON.stringify({ type: 'presence', visitors }));
      } catch {
        this.entries.delete(ws);
      }
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), PRESENCE_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
