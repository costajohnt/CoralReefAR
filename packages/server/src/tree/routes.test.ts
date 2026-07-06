import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import Fastify from 'fastify';
import { ReefDb } from '../db.js';
import { Hub } from '../hub.js';
import { config } from '../config.js';
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
      payload: { variant: 'starburst', seed: 1, colorKey: 'neon-cyan', parentId: null, attachIndex: 0 },
    });
    const rootId = (JSON.parse(root.body) as { id: number }).id;

    const child = await app.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'forked', seed: 2, colorKey: 'neon-cyan', parentId: rootId, attachIndex: 1 },
    });
    assert.equal(child.statusCode, 200);
    assert.equal((JSON.parse(child.body) as { parentId: number }).parentId, rootId);
    await close();
  });

  test('returns 409 when the attach slot is already claimed', async () => {
    const { app, close } = await makeServer();
    const root = await app.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'starburst', seed: 1, colorKey: 'neon-cyan', parentId: null, attachIndex: 0 },
    });
    const rootId = (JSON.parse(root.body) as { id: number }).id;

    await app.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'forked', seed: 2, colorKey: 'neon-cyan', parentId: rootId, attachIndex: 0 },
    });
    const dup = await app.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'claw', seed: 3, colorKey: 'neon-cyan', parentId: rootId, attachIndex: 0 },
    });
    assert.equal(dup.statusCode, 409);
    assert.match(JSON.parse(dup.body).error as string, /claim/i);
    await close();
  });

  test('returns 404 when parent does not exist', async () => {
    const { app, close } = await makeServer();
    const res = await app.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'forked', seed: 1, colorKey: 'neon-cyan', parentId: 99999, attachIndex: 0 },
    });
    assert.equal(res.statusCode, 404);
    await close();
  });

  test('returns 400 on malformed input (unknown variant)', async () => {
    const { app, close } = await makeServer();
    const res = await app.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'branching', seed: 1, colorKey: 'neon-cyan', parentId: null, attachIndex: 0 },
    });
    assert.equal(res.statusCode, 400);
    await close();
  });

  test('returns 400 when colorKey is not in the palette (poison-key guard)', async () => {
    const { app, close } = await makeServer();
    const res = await app.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'starburst', seed: 1, colorKey: 'evil-key', parentId: null, attachIndex: 0 },
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
      payload: { variant: 'starburst', seed: 1, colorKey: 'neon-cyan', parentId: null, attachIndex: 0 },
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
      payload: { variant: 'starburst', seed: 1, colorKey: 'neon-cyan', parentId: null, attachIndex: 0 },
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
      payload: { variant: 'starburst', seed: 1, colorKey: 'neon-cyan', parentId: null, attachIndex: 0 },
    });
    const rootId = (JSON.parse(root.body) as { id: number }).id;
    await app.inject({
      method: 'POST', url: '/api/tree/polyp',
      payload: { variant: 'forked', seed: 2, colorKey: 'neon-cyan', parentId: rootId, attachIndex: 1 },
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
      payload: { variant: 'starburst', seed: 1, colorKey: 'neon-cyan', parentId: null, attachIndex: 0 },
    });
    const rootId = (JSON.parse(root.body) as { id: number }).id;
    messages.length = 0; // clear the polyp_added broadcast
    await app2.inject({ method: 'DELETE', url: `/api/tree/polyp/${rootId}` });
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0], { type: 'tree_polyp_removed', id: rootId });
    await app2.close();
  });
});

describe('tree write rate limit', () => {
  test('planting is unlimited when RATE_LIMIT_MAX is 0 (default)', async () => {
    const prevMax = config.rateLimitMax;
    config.rateLimitMax = 0;
    const { app, close } = await makeServer();
    try {
      const root = await app.inject({
        method: 'POST', url: '/api/tree/polyp',
        payload: { variant: 'starburst', seed: 1, colorKey: 'neon-cyan', parentId: null, attachIndex: 0 },
      });
      const rootId = (JSON.parse(root.body) as { id: number }).id;
      // Many children from the same device all succeed with the limit off.
      for (let i = 0; i < 3; i++) {
        const child = await app.inject({
          method: 'POST', url: '/api/tree/polyp',
          payload: { variant: 'forked', seed: i, colorKey: 'neon-cyan', parentId: rootId, attachIndex: i },
        });
        assert.equal(child.statusCode, 200);
      }
    } finally {
      await close();
      config.rateLimitMax = prevMax;
    }
  });

  test('returns 429 with Retry-After once a device exceeds RATE_LIMIT_MAX', async () => {
    const prevMax = config.rateLimitMax;
    config.rateLimitMax = 2;
    const { app, close } = await makeServer();
    try {
      // Root counts as the device's first piece.
      const root = await app.inject({
        method: 'POST', url: '/api/tree/polyp',
        payload: { variant: 'starburst', seed: 1, colorKey: 'neon-cyan', parentId: null, attachIndex: 0 },
      });
      assert.equal(root.statusCode, 200);
      const rootId = (JSON.parse(root.body) as { id: number }).id;
      // Second piece still under the limit.
      const second = await app.inject({
        method: 'POST', url: '/api/tree/polyp',
        payload: { variant: 'forked', seed: 2, colorKey: 'neon-cyan', parentId: rootId, attachIndex: 0 },
      });
      assert.equal(second.statusCode, 200);
      // Third trips the limit.
      const third = await app.inject({
        method: 'POST', url: '/api/tree/polyp',
        payload: { variant: 'claw', seed: 3, colorKey: 'neon-cyan', parentId: rootId, attachIndex: 1 },
      });
      assert.equal(third.statusCode, 429);
      const body = JSON.parse(third.body) as { error: string; retryAfterMs: number };
      assert.equal(body.error, 'rate_limited');
      assert.ok(body.retryAfterMs > 0);
      assert.ok(third.headers['retry-after'] !== undefined);
    } finally {
      await close();
      config.rateLimitMax = prevMax;
    }
  });
});

describe('tree mutation auth gate', () => {
  test('reset is open when no admin token is configured', async () => {
    const prev = config.adminToken;
    config.adminToken = '';
    const { app, close } = await makeServer();
    try {
      const res = await app.inject({ method: 'POST', url: '/api/tree/reset' });
      assert.equal(res.statusCode, 200);
    } finally {
      await close();
      config.adminToken = prev;
    }
  });

  test('reset requires the admin token once one is configured', async () => {
    const prev = config.adminToken;
    config.adminToken = 'tree-secret';
    const { app, close } = await makeServer();
    try {
      const unauth = await app.inject({ method: 'POST', url: '/api/tree/reset' });
      assert.equal(unauth.statusCode, 401);
      const wrong = await app.inject({
        method: 'POST', url: '/api/tree/reset',
        headers: { authorization: 'Bearer nope' },
      });
      assert.equal(wrong.statusCode, 401);
      const ok = await app.inject({
        method: 'POST', url: '/api/tree/reset',
        headers: { authorization: 'Bearer tree-secret' },
      });
      assert.equal(ok.statusCode, 200);
    } finally {
      await close();
      config.adminToken = prev;
    }
  });

  test('delete is gated, but planting stays open, once an admin token is set', async () => {
    const prev = config.adminToken;
    config.adminToken = 'tree-secret';
    const { app, close } = await makeServer();
    try {
      // Planting is NOT gated even with a token configured.
      const root = await app.inject({
        method: 'POST', url: '/api/tree/polyp',
        payload: { variant: 'starburst', seed: 1, colorKey: 'neon-cyan', parentId: null, attachIndex: 0 },
      });
      assert.equal(root.statusCode, 200);
      const rootId = (JSON.parse(root.body) as { id: number }).id;
      const child = await app.inject({
        method: 'POST', url: '/api/tree/polyp',
        payload: { variant: 'forked', seed: 2, colorKey: 'neon-cyan', parentId: rootId, attachIndex: 0 },
      });
      assert.equal(child.statusCode, 200);
      const childId = (JSON.parse(child.body) as { id: number }).id;

      // Deleting requires the token.
      const unauth = await app.inject({ method: 'DELETE', url: `/api/tree/polyp/${childId}` });
      assert.equal(unauth.statusCode, 401);
      const ok = await app.inject({
        method: 'DELETE', url: `/api/tree/polyp/${childId}`,
        headers: { authorization: 'Bearer tree-secret' },
      });
      assert.equal(ok.statusCode, 200);
    } finally {
      await close();
      config.adminToken = prev;
    }
  });
});
