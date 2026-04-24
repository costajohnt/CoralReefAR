import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import Fastify from 'fastify';
import { ReefDb } from '../db.js';
import { Hub } from '../hub.js';
import { TreeDb } from './db.js';
import { registerTreeRoutes } from './routes.js';

async function makeServer(): Promise<{ app: Awaited<ReturnType<typeof Fastify>>; close: () => Promise<void> }> {
  const reef = new ReefDb(':memory:');
  const tree = new TreeDb(reef);
  const hub = new Hub();
  const app = Fastify({ logger: false });
  registerTreeRoutes(app, tree, hub);
  await app.ready();
  return { app, close: async (): Promise<void> => { await app.close(); } };
}

describe('GET /api/tree', () => {
  test('returns an empty tree on a fresh db', async () => {
    const { app, close } = await makeServer();
    const res = await app.inject({ method: 'GET', url: '/api/tree' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { polyps: unknown[] };
    assert.deepEqual(body.polyps, []);
    await close();
  });
});

describe('POST /api/tree/polyp', () => {
  test('inserts a root piece when parentId is null', async () => {
    const { app, close } = await makeServer();
    const res = await app.inject({
      method: 'POST',
      url: '/api/tree/polyp',
      payload: { variant: 'starburst', seed: 1, colorKey: 'neon-cyan', parentId: null, attachIndex: 0 },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body) as { id: number; parentId: number | null };
    assert.ok(body.id > 0);
    assert.equal(body.parentId, null);
    await close();
  });

  test('inserts a child when parentId points to a live polyp', async () => {
    const { app, close } = await makeServer();
    const root = await app.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'starburst', seed: 1, colorKey: 'x', parentId: null, attachIndex: 0 },
    });
    const rootId = (JSON.parse(root.body) as { id: number }).id;

    const child = await app.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'forked', seed: 2, colorKey: 'x', parentId: rootId, attachIndex: 1 },
    });
    assert.equal(child.statusCode, 200);
    assert.equal((JSON.parse(child.body) as { parentId: number }).parentId, rootId);
    await close();
  });

  test('returns 409 when the attach slot is already claimed', async () => {
    const { app, close } = await makeServer();
    const root = await app.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'starburst', seed: 1, colorKey: 'x', parentId: null, attachIndex: 0 },
    });
    const rootId = (JSON.parse(root.body) as { id: number }).id;

    await app.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'forked', seed: 2, colorKey: 'x', parentId: rootId, attachIndex: 0 },
    });
    const dup = await app.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'claw', seed: 3, colorKey: 'x', parentId: rootId, attachIndex: 0 },
    });
    assert.equal(dup.statusCode, 409);
    assert.match(JSON.parse(dup.body).error as string, /claim/i);
    await close();
  });

  test('returns 404 when parent does not exist', async () => {
    const { app, close } = await makeServer();
    const res = await app.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'forked', seed: 1, colorKey: 'x', parentId: 99999, attachIndex: 0 },
    });
    assert.equal(res.statusCode, 404);
    await close();
  });

  test('returns 400 on malformed input (unknown variant)', async () => {
    const { app, close } = await makeServer();
    const res = await app.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'branching', seed: 1, colorKey: 'x', parentId: null, attachIndex: 0 },
    });
    assert.equal(res.statusCode, 400);
    await close();
  });

  test('broadcasts tree_polyp_added via the hub on success', async () => {
    const { app, close } = await makeServer();
    let received: unknown = null;
    const fakeWs = {
      readyState: 1,
      send(data: string) { received = JSON.parse(data); },
      on() { /* noop */ },
    };
    const hub = new Hub();
    hub.add(fakeWs);
    const reef = new ReefDb(':memory:');
    const tree = new TreeDb(reef);
    const app2 = Fastify({ logger: false });
    registerTreeRoutes(app2, tree, hub);
    await app2.ready();
    await app2.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'starburst', seed: 1, colorKey: 'x', parentId: null, attachIndex: 0 },
    });
    assert.equal((received as { type: string } | null)?.type, 'tree_polyp_added');
    await app2.close();
    await close();
  });
});

describe('DELETE /api/tree/polyp/:id', () => {
  test('soft-deletes a leaf polyp and returns ok:true', async () => {
    const { app, close } = await makeServer();
    const root = await app.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'starburst', seed: 1, colorKey: 'x', parentId: null, attachIndex: 0 },
    });
    const rootId = (JSON.parse(root.body) as { id: number }).id;
    const res = await app.inject({ method: 'DELETE', url: `/api/tree/polyp/${rootId}` });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { ok: true });

    const list = await app.inject({ method: 'GET', url: '/api/tree' });
    const body = JSON.parse(list.body) as { polyps: unknown[] };
    assert.equal(body.polyps.length, 0);
    await close();
  });

  test('returns 404 when polyp does not exist', async () => {
    const { app, close } = await makeServer();
    const res = await app.inject({ method: 'DELETE', url: '/api/tree/polyp/99999' });
    assert.equal(res.statusCode, 404);
    assert.match((JSON.parse(res.body) as { error: string }).error, /not found/i);
    await close();
  });

  test('returns 409 when polyp has children', async () => {
    const { app, close } = await makeServer();
    const root = await app.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'starburst', seed: 1, colorKey: 'x', parentId: null, attachIndex: 0 },
    });
    const rootId = (JSON.parse(root.body) as { id: number }).id;
    await app.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'forked', seed: 2, colorKey: 'x', parentId: rootId, attachIndex: 1 },
    });
    const res = await app.inject({ method: 'DELETE', url: `/api/tree/polyp/${rootId}` });
    assert.equal(res.statusCode, 409);
    await close();
  });

  test('returns 400 when id is not numeric', async () => {
    const { app, close } = await makeServer();
    const res = await app.inject({ method: 'DELETE', url: '/api/tree/polyp/abc' });
    assert.equal(res.statusCode, 400);
    await close();
  });

  test('broadcasts tree_polyp_removed via the hub on success', async () => {
    const messages: unknown[] = [];
    const fakeWs = {
      readyState: 1,
      send(data: string) { messages.push(JSON.parse(data)); },
      on() { /* noop */ },
    };
    const hub = new Hub();
    hub.add(fakeWs);
    const reef = new ReefDb(':memory:');
    const tree = new TreeDb(reef);
    const app2 = Fastify({ logger: false });
    registerTreeRoutes(app2, tree, hub);
    await app2.ready();
    const root = await app2.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'starburst', seed: 1, colorKey: 'x', parentId: null, attachIndex: 0 },
    });
    const rootId = (JSON.parse(root.body) as { id: number }).id;
    messages.length = 0; // clear the polyp_added broadcast
    await app2.inject({ method: 'DELETE', url: `/api/tree/polyp/${rootId}` });
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0], { type: 'tree_polyp_removed', id: rootId });
    await app2.close();
  });
});
