import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import Fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import WebSocket from 'ws';
import { ReefDb } from './db.js';
import { Hub } from './hub.js';
import { registerReefRoutes } from './routes/reef.js';
import { registerAdminRoutes } from './routes/admin.js';
import { config } from './config.js';

async function buildApp(): Promise<{
  app: FastifyInstance;
  db: ReefDb;
  url: string;
  wsUrl: string;
  close: () => Promise<void>;
}> {
  const dir = mkdtempSync(join(tmpdir(), 'reef-ws-integ-'));
  const db = new ReefDb(join(dir, 'reef.db'));
  const hub = new Hub();
  const app = Fastify({ logger: false });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  registerReefRoutes(app, db, hub);
  registerAdminRoutes(app, db, hub);

  app.get('/ws', { websocket: true }, (sock) => {
    const ws = sock as unknown as {
      readyState: number;
      send: (data: string) => void;
      on: (event: 'close', cb: () => void) => void;
    };
    hub.add(ws);
    ws.send(JSON.stringify({
      type: 'hello',
      polypCount: db.listPublicPolyps().length,
      serverTime: Date.now(),
    }));
  });

  // Bind to 127.0.0.1:0 so the OS picks a free port and tests can run in parallel.
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address() as AddressInfo;
  const url = `http://127.0.0.1:${addr.port}`;
  const wsUrl = `ws://127.0.0.1:${addr.port}/ws`;

  return {
    app,
    db,
    url,
    wsUrl,
    close: async () => { await app.close(); },
  };
}

// Buffer every incoming WS frame from the moment the client is constructed
// so callers can `await` messages without racing the open handshake.
class WsProbe {
  readonly ws: WebSocket;
  private readonly queue: unknown[] = [];
  private readonly waiters: Array<(msg: unknown) => boolean> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString());
        // Try each waiter in order; the first that accepts consumes the message.
        for (let i = 0; i < this.waiters.length; i++) {
          if (this.waiters[i]!(parsed)) {
            this.waiters.splice(i, 1);
            return;
          }
        }
        this.queue.push(parsed);
      } catch {
        // non-JSON frames are ignored
      }
    });
  }

  open(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.once('open', () => resolve());
      this.ws.once('error', reject);
    });
  }

  // Wait for a message that satisfies `predicate`, replaying anything buffered first.
  next<T>(predicate: (msg: unknown) => boolean, timeoutMs = 2000): Promise<T> {
    return new Promise((resolve, reject) => {
      for (let i = 0; i < this.queue.length; i++) {
        if (predicate(this.queue[i])) {
          const [msg] = this.queue.splice(i, 1);
          resolve(msg as T);
          return;
        }
      }
      const timer = setTimeout(() => {
        const idx = this.waiters.indexOf(match);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`WsProbe.next timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const match = (msg: unknown): boolean => {
        if (!predicate(msg)) return false;
        clearTimeout(timer);
        resolve(msg as T);
        return true;
      };
      this.waiters.push(match);
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.ws.readyState === WebSocket.CLOSED) { resolve(); return; }
      this.ws.once('close', () => resolve());
      this.ws.close();
    });
  }
}

interface Hello { type: 'hello'; polypCount: number; serverTime: number }
interface PolypAdded { type: 'polyp_added'; polyp: { id: number; species: string } }
interface PolypRemoved { type: 'polyp_removed'; id: number }

test('integration: WS upgrade delivers hello', async () => {
  const { wsUrl, close } = await buildApp();
  const probe = new WsProbe(wsUrl);
  try {
    await probe.open();
    const hello = await probe.next<Hello>((m: any) => m.type === 'hello');
    assert.equal(hello.type, 'hello');
    assert.equal(hello.polypCount, 0);
    assert.ok(typeof hello.serverTime === 'number');
  } finally {
    await probe.close();
    await close();
  }
});

test('integration: POST /api/reef/polyp broadcasts polyp_added to every WS client', async () => {
  const { wsUrl, url, close } = await buildApp();
  const a = new WsProbe(wsUrl);
  const b = new WsProbe(wsUrl);
  try {
    await Promise.all([a.open(), b.open()]);
    await Promise.all([
      a.next<Hello>((m: any) => m.type === 'hello'),
      b.next<Hello>((m: any) => m.type === 'hello'),
    ]);

    const postPromise = fetch(`${url}/api/reef/polyp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        species: 'branching', seed: 1337, colorKey: 'coral-pink',
        position: [0.01, 0, 0.01], orientation: [0, 0, 0, 1], scale: 1,
      }),
    });

    const [addedA, addedB, postRes] = await Promise.all([
      a.next<PolypAdded>((m: any) => m.type === 'polyp_added'),
      b.next<PolypAdded>((m: any) => m.type === 'polyp_added'),
      postPromise,
    ]);

    assert.equal(postRes.status, 201);
    assert.equal(addedA.polyp.species, 'branching');
    assert.equal(addedB.polyp.id, addedA.polyp.id);
  } finally {
    await Promise.all([a.close(), b.close()]);
    await close();
  }
});

test('integration: DELETE /api/admin/polyp/:id broadcasts polyp_removed', async () => {
  const savedAdminToken = config.adminToken;
  config.adminToken = 'integ-token';
  const { wsUrl, url, close } = await buildApp();
  const probe = new WsProbe(wsUrl);
  try {
    await probe.open();
    await probe.next<Hello>((m: any) => m.type === 'hello');

    const post = await fetch(`${url}/api/reef/polyp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'integ-a' },
      body: JSON.stringify({
        species: 'fan', seed: 1, colorKey: 'teal',
        position: [0, 0, 0], orientation: [0, 0, 0, 1], scale: 1,
      }),
    });
    assert.equal(post.status, 201);
    const { id } = await post.json() as { id: number };
    await probe.next<PolypAdded>((m: any) => m.type === 'polyp_added');

    const delPromise = fetch(`${url}/api/admin/polyp/${id}`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer integ-token' },
    });
    const [removed, delRes] = await Promise.all([
      probe.next<PolypRemoved>((m: any) => m.type === 'polyp_removed'),
      delPromise,
    ]);
    assert.equal(delRes.status, 200);
    assert.equal(removed.id, id);
  } finally {
    await probe.close();
    config.adminToken = savedAdminToken;
    await close();
  }
});

test('integration: POST /api/admin/polyp/:id/restore broadcasts polyp_added', async () => {
  const savedAdminToken = config.adminToken;
  config.adminToken = 'integ-token';
  const { wsUrl, url, close } = await buildApp();
  const probe = new WsProbe(wsUrl);
  try {
    await probe.open();
    await probe.next<Hello>((m: any) => m.type === 'hello');

    const post = await fetch(`${url}/api/reef/polyp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'integ-restore' },
      body: JSON.stringify({
        species: 'branching', seed: 99, colorKey: 'coral-pink',
        position: [0, 0, 0], orientation: [0, 0, 0, 1], scale: 1,
      }),
    });
    assert.equal(post.status, 201);
    const { id } = await post.json() as { id: number };
    await probe.next<PolypAdded>((m: any) => m.type === 'polyp_added');

    const del = await fetch(`${url}/api/admin/polyp/${id}`, {
      method: 'DELETE',
      headers: { authorization: 'Bearer integ-token' },
    });
    assert.equal(del.status, 200);
    await probe.next<PolypRemoved>((m: any) => m.type === 'polyp_removed');

    const restorePromise = fetch(`${url}/api/admin/polyp/${id}/restore`, {
      method: 'POST',
      headers: { authorization: 'Bearer integ-token' },
    });
    const [added, restoreRes] = await Promise.all([
      probe.next<PolypAdded>((m: any) => m.type === 'polyp_added'),
      restorePromise,
    ]);
    assert.equal(restoreRes.status, 200);
    assert.equal(added.polyp.id, id);
    assert.equal(added.polyp.species, 'branching');
  } finally {
    await probe.close();
    config.adminToken = savedAdminToken;
    await close();
  }
});

test('integration: Hub evicts clients whose sockets closed', async () => {
  const { wsUrl, url, close } = await buildApp();
  const a = new WsProbe(wsUrl);
  const b = new WsProbe(wsUrl);
  try {
    await Promise.all([a.open(), b.open()]);
    await Promise.all([
      a.next<Hello>((m: any) => m.type === 'hello'),
      b.next<Hello>((m: any) => m.type === 'hello'),
    ]);

    await b.close();

    const postRes = await fetch(`${url}/api/reef/polyp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'integ-b' },
      body: JSON.stringify({
        species: 'tube', seed: 9, colorKey: 'plum',
        position: [0, 0, 0], orientation: [0, 0, 0, 1], scale: 1,
      }),
    });
    assert.equal(postRes.status, 201);
    const added = await a.next<PolypAdded>((m: any) => m.type === 'polyp_added');
    assert.equal(added.polyp.species, 'tube');
  } finally {
    await a.close();
    await close();
  }
});
