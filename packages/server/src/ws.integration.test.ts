import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { z } from 'zod';
import WebSocket from 'ws';
import {
  ServerMessageSchema,
  TreeServerMessageSchema,
  PublicPolypSchema,
  PublicTreePolypSchema,
} from '@reef/shared';
import type { ReefDb } from './db.js';
import type { TreeDb } from './tree/db.js';
import { makeServer } from './index.js';
import { config } from './config.js';

// Drive the *real* server (makeServer) rather than a hand-rolled /ws route, so
// the production hello payload + every registered route is what's under test.
// makeServer builds the app but does not listen; we bind to an ephemeral port.
async function buildApp(): Promise<{
  db: ReefDb;
  treeDb: TreeDb;
  url: string;
  wsUrl: string;
  treeWsUrl: string;
  close: () => Promise<void>;
}> {
  const dir = mkdtempSync(join(tmpdir(), 'reef-ws-integ-'));
  const { app, db, treeDb } = await makeServer({ dbPath: join(dir, 'reef.db'), logger: false });

  // Bind to 127.0.0.1:0 so the OS picks a free port and tests can run in parallel.
  await app.listen({ host: '127.0.0.1', port: 0 });
  const addr = app.server.address() as AddressInfo;
  const base = `127.0.0.1:${addr.port}`;

  return {
    db,
    treeDb,
    url: `http://${base}`,
    wsUrl: `ws://${base}/ws`,
    treeWsUrl: `ws://${base}/ws/tree`,
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

test('integration: WS upgrade delivers a schema-valid hello', async () => {
  const { wsUrl, close } = await buildApp();
  const probe = new WsProbe(wsUrl);
  try {
    await probe.open();
    const hello = await probe.next<Hello>((m: any) => m.type === 'hello');
    // Contract check: the live hello frame must satisfy the same schema the
    // client validates inbound frames with (dispatchMessage). This is the real
    // production hello payload now that buildApp goes through makeServer.
    const parsed = ServerMessageSchema.parse(hello);
    assert.equal(parsed.type, 'hello');
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

// ---------------------------------------------------------------------------
// /ws/tree round-trip — the tree socket had no integration coverage at all.
// ---------------------------------------------------------------------------

interface TreeHello { type: 'tree_hello'; polypCount: number; serverTime: number }
interface TreePolypAdded { type: 'tree_polyp_added'; polyp: { id: number; parentId: number | null } }

test('integration: /ws/tree delivers a schema-valid tree_hello, and planting broadcasts tree_polyp_added', async () => {
  const { treeWsUrl, url, close } = await buildApp();
  const probe = new WsProbe(treeWsUrl);
  try {
    await probe.open();
    const hello = await probe.next<TreeHello>((m: any) => m.type === 'tree_hello');
    const parsedHello = TreeServerMessageSchema.parse(hello);
    assert.equal(parsedHello.type, 'tree_hello');
    // makeServer seeds one Starburst root at boot.
    assert.equal(hello.polypCount, 1);

    // Find the seeded root to attach to.
    const treeRes = await fetch(`${url}/api/tree`);
    assert.equal(treeRes.status, 200);
    const tree = await treeRes.json() as { polyps: Array<{ id: number }> };
    const rootId = tree.polyps[0]!.id;

    const plantPromise = fetch(`${url}/api/tree/polyp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        variant: 'forked', seed: 4242, colorKey: 'neon-cyan',
        parentId: rootId, attachIndex: 0, attachYaw: 0,
      }),
    });

    const [added, plantRes] = await Promise.all([
      probe.next<TreePolypAdded>((m: any) => m.type === 'tree_polyp_added' && m.polyp.parentId === rootId),
      plantPromise,
    ]);
    assert.equal(plantRes.status, 200);
    // Contract check: the broadcast frame satisfies the client's tree schema.
    const parsedAdded = TreeServerMessageSchema.parse(added);
    assert.equal(parsedAdded.type, 'tree_polyp_added');
    assert.equal(added.polyp.parentId, rootId);
  } finally {
    await probe.close();
    await close();
  }
});

// ---------------------------------------------------------------------------
// HTTP contract — the client blind-casts r.json() in net/api.ts + tree/api.ts.
// These parse the live route responses with the shared schemas so a drift
// between server output and the client's assumed shape fails here.
// ---------------------------------------------------------------------------

const ReefStateContract = z.object({
  polyps: z.array(PublicPolypSchema),
  serverTime: z.number(),
});
const TreeStateContract = z.object({
  polyps: z.array(PublicTreePolypSchema),
  serverTime: z.number(),
});

test('contract: GET /api/reef and POST /api/reef/polyp responses match the shared schema', async () => {
  const { url, close } = await buildApp();
  try {
    const empty = ReefStateContract.parse(await (await fetch(`${url}/api/reef`)).json());
    assert.equal(empty.polyps.length, 0);

    const postRes = await fetch(`${url}/api/reef/polyp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        species: 'branching', seed: 7, colorKey: 'coral-pink',
        position: [0, 0, 0], orientation: [0, 0, 0, 1], scale: 1,
      }),
    });
    assert.equal(postRes.status, 201);
    // The POST response is a single public polyp; same shape the WS frame carries.
    const created = PublicPolypSchema.parse(await postRes.json());

    const after = ReefStateContract.parse(await (await fetch(`${url}/api/reef`)).json());
    assert.equal(after.polyps.length, 1);
    assert.equal(after.polyps[0]!.id, created.id);
  } finally {
    await close();
  }
});

test('contract: GET /api/tree response matches the shared schema', async () => {
  const { url, close } = await buildApp();
  try {
    const state = TreeStateContract.parse(await (await fetch(`${url}/api/tree`)).json());
    // The seeded Starburst root: a parentless polyp.
    assert.equal(state.polyps.length, 1);
    assert.equal(state.polyps[0]!.parentId, null);
  } finally {
    await close();
  }
});
