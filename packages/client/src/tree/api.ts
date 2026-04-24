import type { PublicTreePolyp, TreePolypInput, TreeServerMessage } from '@reef/shared';

export async function fetchTree(apiBase = ''): Promise<{ polyps: PublicTreePolyp[]; serverTime: number }> {
  const r = await fetch(`${apiBase}/api/tree`);
  if (!r.ok) throw new Error(`fetchTree ${r.status}`);
  return r.json() as Promise<{ polyps: PublicTreePolyp[]; serverTime: number }>;
}

export async function submitTreePolyp(input: TreePolypInput, apiBase = ''): Promise<PublicTreePolyp> {
  const r = await fetch(`${apiBase}/api/tree/polyp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`submitTreePolyp ${r.status}${detail ? ` ${detail}` : ''}`);
  }
  return r.json() as Promise<PublicTreePolyp>;
}

export async function resetTree(apiBase = ''): Promise<{ polyps: PublicTreePolyp[] }> {
  const r = await fetch(`${apiBase}/api/tree/reset`, { method: 'POST' });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`resetTree ${r.status}${detail ? ` ${detail}` : ''}`);
  }
  return r.json() as Promise<{ polyps: PublicTreePolyp[] }>;
}

export async function deleteTreePolyp(id: number, apiBase = ''): Promise<void> {
  const r = await fetch(`${apiBase}/api/tree/polyp/${id}`, { method: 'DELETE' });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`deleteTreePolyp ${r.status}${detail ? ` ${detail}` : ''}`);
  }
}

/**
 * Reconnecting WebSocket with exponential backoff. Capped at 30s between
 * tries. Fires every server message to each registered handler.
 */
export class TreeSocket {
  private ws?: WebSocket;
  private listeners: Array<(msg: TreeServerMessage) => void> = [];
  private retries = 0;
  private closed = false;

  constructor(readonly url: string) {}

  on(cb: (msg: TreeServerMessage) => void): void {
    this.listeners.push(cb);
  }

  connect(): void {
    if (this.closed) return;
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('open', () => { this.retries = 0; });
    this.ws.addEventListener('message', (ev) => {
      let msg: TreeServerMessage;
      try {
        msg = JSON.parse(ev.data as string) as TreeServerMessage;
      } catch (err) {
        console.warn('ws/tree: malformed frame', err);
        return;
      }
      for (const cb of this.listeners) {
        try {
          cb(msg);
        } catch (err) {
          console.error('ws/tree: handler threw on', (msg as { type?: string }).type, err);
        }
      }
    });
    this.ws.addEventListener('close', () => this.scheduleReconnect());
    this.ws.addEventListener('error', () => this.ws?.close());
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    const delay = Math.min(30_000, 1000 * Math.pow(1.8, this.retries++));
    setTimeout(() => this.connect(), delay);
  }

  close(): void {
    this.closed = true;
    this.ws?.close();
  }
}

export function defaultTreeWsUrl(): string {
  const l = window.location;
  const proto = l.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${l.host}/ws/tree`;
}
