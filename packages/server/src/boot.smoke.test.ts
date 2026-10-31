import { strict as assert } from 'node:assert';
import { after, test } from 'node:test';
import { makeServer } from './index.js';
import { config } from './config.js';

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

  // Global CSP blocks inline scripts (no 'unsafe-inline' on script-src). The
  // directive-bounded check ([^;]* stops at the next directive) is order-
  // independent — it won't false-pass on style-src's unsafe-inline.
  const csp = healthz.headers['content-security-policy'] as string;
  assert.match(csp, /script-src 'self'/);
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), 'script-src must not allow unsafe-inline');
  // style-src intentionally keeps 'unsafe-inline' for now.
  assert.match(csp, /style-src 'self' 'unsafe-inline'/);
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

// Single-container deploys (fly.toml, docker-compose, the LXC image) serve the
// built client through this server, so the global CSP applies to index.html.
// The 8th Wall engine is a cross-origin <script>; if the CSP does not allow its
// origin the browser drops it and AR silently falls back to the Noop provider.
// Serve the real index.html from a CLIENT_DIST_DIR and check every external
// script origin it references is permitted by script-src and connect-src.
test('smoke: CSP on a served client bundle allows every external script origin', async () => {
  const { mkdtempSync, copyFileSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const indexHtml = resolve(process.cwd(), '../client/index.html');
  const dist = mkdtempSync(join(tmpdir(), 'reef-dist-'));
  copyFileSync(indexHtml, join(dist, 'index.html'));
  const { app } = await makeServer({
    dbPath: ':memory:',
    adminToken: '',
    corsOrigins: ['*'],
    clientDistDir: dist,
    logger: false,
  });
  after(async () => { await app.close(); rmSync(dist, { recursive: true, force: true }); });

  const res = await app.inject({ method: 'GET', url: '/' });
  assert.equal(res.statusCode, 200);
  const origins = [...readFileSync(indexHtml, 'utf8').matchAll(/<script[^>]*\ssrc="(https?:\/\/[^/"]+)/g)]
    .map((m) => m[1]!);
  assert.ok(origins.length > 0, 'index.html should load the AR engine from a CDN');
  const csp = res.headers['content-security-policy'] as string;
  for (const origin of origins) {
    assert.ok(new RegExp(`script-src[^;]* ${origin}(\\s|;|$)`).test(csp), `script-src must allow ${origin}: ${csp}`);
    assert.ok(new RegExp(`connect-src[^;]* ${origin}(\\s|;|$)`).test(csp), `connect-src must allow ${origin}: ${csp}`);
  }
  // The engine compiles wasm and runs its SLAM chunks in blob: workers.
  assert.match(csp, /script-src[^;]*'wasm-unsafe-eval'/);
  assert.match(csp, /worker-src[^;]*blob:/);
});

// Snapshot and tree reads used to sit outside the per-route limiters; the
// limiter is now one app-level hook on every GET under /api/.
test('smoke: READ_RATE_LIMIT_PER_MIN covers snapshots and tree reads too (audit M3)', async () => {
  const saved = config.readRateLimitPerMin;
  config.readRateLimitPerMin = 3;
  try {
    const { app } = await makeServer({ dbPath: ':memory:', adminToken: '', corsOrigins: ['*'], clientDistDir: undefined, logger: false });
    after(async () => { await app.close(); });
    const codes: number[] = [];
    for (const url of ['/api/snapshots', '/api/tree', '/api/snapshots/1', '/api/snapshots']) {
      codes.push((await app.inject({ method: 'GET', url })).statusCode);
    }
    assert.deepEqual(codes, [200, 200, 404, 429]);
    // Writes and non-API reads are not on this bucket.
    assert.equal((await app.inject({ method: 'GET', url: '/healthz' })).statusCode, 200);
  } finally {
    config.readRateLimitPerMin = saved;
  }
});
