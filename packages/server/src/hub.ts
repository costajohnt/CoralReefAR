import type { ServerMessage } from '@reef/shared';

// ws library readyState values — see https://developer.mozilla.org/docs/Web/API/WebSocket/readyState
const WS_OPEN = 1;

// Heartbeat cadence: each tick pings every client and flips them to
// pending-pong; any client still pending-pong on the next tick is
// terminated. A responsive client therefore has one full interval to
// reply. Keeps Cloudflare Tunnel / reverse proxies from silently
// garbage-collecting idle connections without the app noticing.
const HEARTBEAT_INTERVAL_MS = 30_000;

type WebSocket = {
  readyState: number;
  send(data: string): void;
  on(event: 'close' | 'pong', cb: () => void): void;
  ping?(): void;
  terminate?(): void;
};

interface LivenessState {
  alive: boolean;
}

export class Hub {
  private clients = new Map<WebSocket, LivenessState>();
  private heartbeat: NodeJS.Timeout | undefined;

  add(ws: WebSocket): void {
    const state: LivenessState = { alive: true };
    // The pong listener must be wired before join so we never miss the
    // first keepalive response. 'close' wired here for the same reason.
    ws.on('pong', () => { state.alive = true; });
    ws.on('close', () => {
      this.clients.delete(ws);
    });
    this.clients.set(ws, state);
  }

  broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const ws of this.clients.keys()) {
      if (ws.readyState !== WS_OPEN) continue;
      // A single client's send failure (network hiccup, socket already torn
      // down between the readyState check and the send) must not abort the
      // whole broadcast. Drop the bad client on the floor and move on.
      try {
        ws.send(data);
      } catch {
        this.clients.delete(ws);
      }
    }
  }

  size(): number {
    return this.clients.size;
  }

  startHeartbeat(intervalMs: number = HEARTBEAT_INTERVAL_MS): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => this.heartbeatTick(), intervalMs);
    this.heartbeat.unref?.();
  }

  stopHeartbeat(): void {
    if (!this.heartbeat) return;
    clearInterval(this.heartbeat);
    this.heartbeat = undefined;
  }

  // Exposed for tests. Each tick: terminate anyone who didn't reply to the
  // previous ping, then send a fresh ping to survivors and flip them to
  // `alive: false` until the matching pong flips them back.
  heartbeatTick(): void {
    for (const [ws, state] of this.clients) {
      if (!state.alive) {
        try { ws.terminate?.(); } catch { /* ignore */ }
        this.clients.delete(ws);
        continue;
      }
      state.alive = false;
      try { ws.ping?.(); } catch { this.clients.delete(ws); }
    }
  }
}
