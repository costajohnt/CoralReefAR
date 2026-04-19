import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Hub } from './hub.js';

interface FakeWebSocket {
  readyState: number;
  send(data: string): void;
  on(event: 'close' | 'pong', cb: () => void): void;
  ping(): void;
  terminate(): void;
  close(): void;
  sent: string[];
  pings: number;
  terminated: boolean;
  // Callers drive these to simulate a pong response or graceful close.
  replyPong(): void;
  closeCb?: () => void;
  pongCb?: () => void;
}

function fakeSocket(readyState = 1): FakeWebSocket {
  const sock: FakeWebSocket = {
    readyState,
    sent: [],
    pings: 0,
    terminated: false,
    send(data) { this.sent.push(data); },
    on(event, cb) {
      if (event === 'close') this.closeCb = cb;
      else if (event === 'pong') this.pongCb = cb;
    },
    ping() { this.pings++; },
    terminate() { this.terminated = true; this.readyState = 3; this.closeCb?.(); },
    close() { this.readyState = 3; this.closeCb?.(); },
    replyPong() { this.pongCb?.(); },
  };
  return sock;
}

test('hub: broadcast reaches all open clients', () => {
  const hub = new Hub();
  const a = fakeSocket();
  const b = fakeSocket();
  hub.add(a);
  hub.add(b);

  hub.broadcast({ type: 'polyp_removed', id: 42 });

  assert.equal(a.sent.length, 1);
  assert.equal(b.sent.length, 1);
  const parsed = JSON.parse(a.sent[0]!);
  assert.equal(parsed.type, 'polyp_removed');
  assert.equal(parsed.id, 42);
});

test('hub: broadcast skips clients that are not OPEN', () => {
  const hub = new Hub();
  const open = fakeSocket(1);
  const connecting = fakeSocket(0);
  const closing = fakeSocket(2);
  hub.add(open);
  hub.add(connecting);
  hub.add(closing);

  hub.broadcast({ type: 'polyp_removed', id: 1 });

  assert.equal(open.sent.length, 1);
  assert.equal(connecting.sent.length, 0);
  assert.equal(closing.sent.length, 0);
});

test('hub: close callback removes client from set', () => {
  const hub = new Hub();
  const a = fakeSocket();
  hub.add(a);
  assert.equal(hub.size(), 1);

  a.close();
  assert.equal(hub.size(), 0);
});

test('hub: size reports current client count', () => {
  const hub = new Hub();
  assert.equal(hub.size(), 0);
  const a = fakeSocket();
  const b = fakeSocket();
  hub.add(a);
  hub.add(b);
  assert.equal(hub.size(), 2);
  a.close();
  assert.equal(hub.size(), 1);
});

test('hub: a send failure on one client does not abort broadcast to others and evicts the bad client', () => {
  const hub = new Hub();
  const throwing = fakeSocket();
  throwing.send = () => { throw new Error('boom'); };
  const healthy = fakeSocket();
  hub.add(throwing);
  hub.add(healthy);
  assert.equal(hub.size(), 2);

  hub.broadcast({ type: 'polyp_removed', id: 1 });

  assert.equal(healthy.sent.length, 1, 'healthy client still receives');
  assert.equal(hub.size(), 1, 'throwing client was evicted');
});

test('hub: heartbeat pings live clients and terminates silent ones', () => {
  const hub = new Hub();
  const responsive = fakeSocket();
  const silent = fakeSocket();
  hub.add(responsive);
  hub.add(silent);

  // First tick: both get pinged, both flipped to "awaiting pong".
  hub.heartbeatTick();
  assert.equal(responsive.pings, 1);
  assert.equal(silent.pings, 1);
  assert.equal(responsive.terminated, false);
  assert.equal(silent.terminated, false);

  // Responsive replies with a pong; silent stays silent.
  responsive.replyPong();

  // Second tick: responsive gets pinged again, silent gets terminated.
  hub.heartbeatTick();
  assert.equal(responsive.pings, 2);
  assert.equal(silent.pings, 1, 'silent not pinged further after termination');
  assert.equal(silent.terminated, true);
  assert.equal(hub.size(), 1);
});
