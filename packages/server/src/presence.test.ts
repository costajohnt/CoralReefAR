import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PRESENCE_INTERVAL_MS } from '@reef/shared';
import { Presence, type PresenceSocket } from './presence.js';

class FakeSocket implements PresenceSocket {
  readyState = 1;
  sent: Array<{ type: string; visitors: Array<{ id: string; p: number[] }> }> = [];
  closed: number | null = null;
  send(data: string): void { this.sent.push(JSON.parse(data)); }
  close(code?: number): void { this.closed = code ?? 0; this.readyState = 3; }
  last() { return this.sent.at(-1); }
}

function setup(maxVisitors = 16) {
  const clock = { t: 10_000 };
  const presence = new Presence({ maxVisitors, ttlMs: 2000, now: () => clock.t });
  const pose = (x: number) => JSON.stringify({ type: 'presence', p: [x, 1.6, 0], q: [0, 0, 0, 1] });
  return { clock, presence, pose };
}

test('presence: fan-out sends each client the others, never itself', () => {
  const { presence, pose } = setup();
  const a = new FakeSocket(), b = new FakeSocket(), c = new FakeSocket();
  presence.handleFrame(a, pose(1));
  presence.handleFrame(b, pose(2));
  presence.handleFrame(c, pose(3));
  presence.tick();
  assert.deepEqual(a.last()!.visitors.map((v) => v.p[0]).sort(), [2, 3]);
  assert.deepEqual(b.last()!.visitors.map((v) => v.p[0]).sort(), [1, 3]);
  // Ids are anonymous, stable per connection, and distinct.
  const ids = new Set([...a.last()!.visitors, ...b.last()!.visitors].map((v) => v.id));
  assert.equal(ids.size, 3);
});

test('presence: sockets that never sent a frame are never sent presence', () => {
  const { presence, pose } = setup();
  const a = new FakeSocket(), b = new FakeSocket();
  presence.handleFrame(a, pose(1));
  presence.handleFrame(b, pose(2));
  const lurker = new FakeSocket();
  presence.tick();
  assert.equal(lurker.sent.length, 0);
});

test('presence: frames faster than the 5 Hz interval are dropped', () => {
  const { clock, presence, pose } = setup();
  const a = new FakeSocket(), b = new FakeSocket();
  presence.handleFrame(b, pose(9));
  presence.handleFrame(a, pose(1));
  clock.t += 50;
  presence.handleFrame(a, pose(2)); // too soon: dropped
  presence.tick();
  assert.equal(b.last()!.visitors[0]!.p[0], 1);
  clock.t += PRESENCE_INTERVAL_MS;
  presence.handleFrame(a, pose(3));
  presence.tick();
  assert.equal(b.last()!.visitors[0]!.p[0], 3);
});

test('presence: a flooding connection is closed and dropped', () => {
  const { presence, pose } = setup();
  const a = new FakeSocket();
  for (let i = 0; i < 25; i++) presence.handleFrame(a, pose(i));
  assert.equal(a.closed, 1008);
  assert.equal(presence.size(), 0);
});

test('presence: invalid or oversized frames are ignored', () => {
  const { presence } = setup();
  const a = new FakeSocket(), b = new FakeSocket();
  presence.handleFrame(a, '{"type":"presence","p":[1e9,0,0],"q":[0,0,0,1]}');
  presence.handleFrame(a, 'not json');
  presence.handleFrame(a, JSON.stringify({ type: 'presence', p: [0, 0, 0], q: [0, 0, 0, 1], pad: 'x'.repeat(300) }));
  presence.handleFrame(b, '{"type":"presence","p":[0,1,0],"q":[0,0,0,1]}');
  presence.tick();
  assert.equal(b.sent.length, 0, 'a has no valid pose, so b has nobody to see');
});

test('presence: visitors broadcast to one client are capped, newest first', () => {
  const { clock, presence, pose } = setup(2);
  const socks = Array.from({ length: 5 }, () => new FakeSocket());
  socks.forEach((s, i) => { clock.t += 1; presence.handleFrame(s, pose(i)); });
  presence.tick();
  assert.deepEqual(socks[0]!.last()!.visitors.map((v) => v.p[0]), [4, 3]);
  // The newest sender itself still gets two others.
  assert.deepEqual(socks[4]!.last()!.visitors.map((v) => v.p[0]), [3, 2]);
});

test('presence: stale poses stop being broadcast; disconnect removes the visitor', () => {
  const { clock, presence, pose } = setup();
  const a = new FakeSocket(), b = new FakeSocket(), c = new FakeSocket();
  presence.handleFrame(a, pose(1));
  presence.handleFrame(b, pose(2));
  presence.handleFrame(c, pose(3));
  presence.remove(c);
  presence.tick();
  assert.deepEqual(a.last()!.visitors.map((v) => v.p[0]), [2]);
  clock.t += 2500; // past the TTL with no new frames
  const before = a.sent.length;
  presence.tick();
  assert.equal(a.sent.length, before);
});
