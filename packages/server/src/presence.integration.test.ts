import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { makeServer } from './index.js';

async function boot(presence: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'reef-presence-'));
  const srv = await makeServer({ dbPath: join(dir, 'reef.db'), logger: false, presence });
  await srv.app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = srv.app.server.address() as AddressInfo;
  return { ...srv, wsUrl: `ws://127.0.0.1:${port}/ws` };
}

async function client(url: string): Promise<{ ws: WebSocket; frames: Array<{ type: string; visitors?: unknown[] }> }> {
  const ws = new WebSocket(url);
  const frames: Array<{ type: string; visitors?: unknown[] }> = [];
  ws.on('message', (d) => frames.push(JSON.parse(d.toString())));
  await new Promise((r) => ws.once('open', r));
  return { ws, frames };
}

const settle = () => new Promise((r) => setTimeout(r, 50));
const totalChanges = (db: { db: { prepare(s: string): { get(): unknown } } }) =>
  (db.db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
const pose = JSON.stringify({ type: 'presence', p: [0.2, 1.5, -0.3], q: [0, 0, 0, 1] });

test('presence integration: on, two sockets see each other, leave on disconnect, DB untouched', async () => {
  const srv = await boot(true);
  try {
    assert.ok(srv.presence);
    const changes = totalChanges(srv.db);
    const a = await client(srv.wsUrl);
    const b = await client(srv.wsUrl);
    a.ws.send(pose);
    b.ws.send(pose);
    await settle();
    srv.presence.tick();
    await settle();
    assert.equal(a.frames.filter((f) => f.type === 'presence').at(-1)?.visitors?.length, 1);
    assert.equal(b.frames.filter((f) => f.type === 'presence').at(-1)?.visitors?.length, 1);

    b.ws.close();
    await settle();
    assert.equal(srv.presence.size(), 1);
    assert.equal(totalChanges(srv.db), changes, 'presence wrote nothing to SQLite');
    a.ws.close();
  } finally {
    await srv.app.close();
  }
});

test('presence integration: off (the default), frames are ignored and nothing is broadcast', async () => {
  const srv = await boot(false);
  try {
    assert.equal(srv.presence, null);
    const a = await client(srv.wsUrl);
    const b = await client(srv.wsUrl);
    a.ws.send(pose);
    b.ws.send(pose);
    await new Promise((r) => setTimeout(r, 400)); // two would-be presence intervals
    for (const c of [a, b]) {
      assert.deepEqual(c.frames.map((f) => f.type), ['hello']);
      assert.equal(c.ws.readyState, WebSocket.OPEN);
    }
    a.ws.close();
    b.ws.close();
  } finally {
    await srv.app.close();
  }
});
