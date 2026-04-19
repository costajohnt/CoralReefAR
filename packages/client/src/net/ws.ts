import { dispatchMessage, type MessageHandler, type ServerMessage } from '@reef/shared';

/**
 * Reconnecting WebSocket with exponential backoff. Capped at 30s between
 * tries. Fires every server message to each registered handler.
 */
export class ReefSocket {
  private ws?: WebSocket;
  private handlers: MessageHandler[] = [];
  private retries = 0;
  private closed = false;

  constructor(readonly url: string) {}

  on(h: MessageHandler): void { this.handlers.push(h); }

  connect(): void {
    if (this.closed) return;
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('open', () => { this.retries = 0; });
    this.ws.addEventListener('message', (ev) => {
      // Pure dispatcher lives in @reef/shared so its semantics (separate
      // parse vs. handler catches) are unit-tested without jsdom.
      dispatchMessage(ev.data as string, this.handlers, {
        onParseError: (err) => console.warn('ws: malformed frame', err),
        onHandlerError: (err, msg: ServerMessage) => {
          console.error('ws: handler threw on', (msg as { type?: string }).type, err);
        },
      });
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

export function defaultWsUrl(): string {
  const l = window.location;
  const proto = l.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${l.host}/ws`;
}
