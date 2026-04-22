import { strict as assert } from 'node:assert';
import { after, test } from 'node:test';
import { makeServer } from './index.js';

// Boot smoke test: register every plugin + route against a real Fastify
// instance, in the real load order, with an in-memory DB. Catches
// plugin-version-mismatch bugs (e.g. a cors plugin major that requires a
// newer Fastify than we ship) that route-level tests miss because they
// build minimal Fastify instances per-suite.

test('smoke: full app boots with the real plugin load order', async () => {
  const { app } = await makeServer({
    dbPath: ':memory:',
    adminToken: '',
    corsOrigins: ['*'],
    clientDistDir: undefined,
    logger: false,
  });
  after(async () => { await app.close(); });

  const healthz = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(healthz.statusCode, 200);
  const body = JSON.parse(healthz.body) as { ok: boolean; time: number };
  assert.equal(body.ok, true);
  assert.equal(typeof body.time, 'number');
});

test('smoke: DB migrations ran (API/reef serves an empty-state payload)', async () => {
  const { app } = await makeServer({
    dbPath: ':memory:',
    adminToken: '',
    corsOrigins: ['*'],
    clientDistDir: undefined,
    logger: false,
  });
  after(async () => { await app.close(); });

  const res = await app.inject({ method: 'GET', url: '/api/reef' });
  assert.equal(res.statusCode, 200);
  const state = JSON.parse(res.body) as { polyps: unknown[]; sim: unknown[] };
  assert.deepEqual(state.polyps, []);
  assert.deepEqual(state.sim, []);
});

test('smoke: explicit CORS_ORIGINS list binds without throwing', async () => {
  // Second CORS path — the `origin: string[]` branch, distinct from `origin: true`
  // that the wildcard test uses. Covers both sides of the config.ts split.
  const { app } = await makeServer({
    dbPath: ':memory:',
    adminToken: '',
    corsOrigins: ['https://a.example', 'https://b.example'],
    clientDistDir: undefined,
    logger: false,
  });
  after(async () => { await app.close(); });

  const res = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 200);
});

test('smoke: /api/tree returns a seeded state (not empty) on fresh boot', async () => {
  const { app } = await makeServer({
    dbPath: ':memory:', adminToken: '', corsOrigins: ['*'],
    clientDistDir: undefined, logger: false,
  });
  after(async () => { await app.close(); });

  const res = await app.inject({ method: 'GET', url: '/api/tree' });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body) as { polyps: unknown[] };
  // seedRootIfEmpty ran at boot — expect exactly one root.
  assert.equal(body.polyps.length, 1);
});
