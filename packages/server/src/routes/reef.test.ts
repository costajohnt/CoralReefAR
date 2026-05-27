import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { ReefDb } from '../db.js';
import { Hub } from '../hub.js';
import { registerReefRoutes } from './reef.js';
import { config } from '../config.js';

function buildApp(): { app: FastifyInstance; db: ReefDb; hub: Hub } {
  const dir = mkdtempSync(join(tmpdir(), 'reef-rt-'));
  const db = new ReefDb(join(dir, 'reef.db'));
  const hub = new Hub();
  const app = Fastify({ logger: false, trustProxy: true });
  registerReefRoutes(app, db, hub);
  return { app, db, hub };
}

const valid = {
  species: 'branching',
  seed: 42,
  colorKey: 'coral-pink',
  position: [0, 0, 0],
  orientation: [0, 0, 0, 1],
  scale: 1,
};

test('GET /api/reef returns empty initial state with no deviceHash', async () => {
  const { app } = buildApp();
  const r = await app.inject({ method: 'GET', url: '/api/reef' });
  assert.equal(r.statusCode, 200);
  const j = r.json() as { polyps: unknown[]; sim: unknown[]; serverTime: number };
  assert.equal(j.polyps.length, 0);
  assert.ok(typeof j.serverTime === 'number');
  await app.close();
});

test('POST /api/reef/polyp accepts valid input and strips deviceHash', async () => {
  const { app } = buildApp();
  const r = await app.inject({
    method: 'POST', url: '/api/reef/polyp', payload: valid,
  });
  assert.equal(r.statusCode, 201);
  const body = r.json() as Record<string, unknown>;
  assert.ok(!('deviceHash' in body));
  assert.equal(body.id, 1);
  await app.close();
});

test('POST /api/reef/polyp strips the surface field before persistence', async () => {
  // surface is transport-only metadata for rate-limit bucket selection.
  // Defense in depth: verify the response body never carries it AND the
  // listPublicPolyps row from the DB doesn't either.
  const { app, db } = buildApp();
  const r = await app.inject({
    method: 'POST', url: '/api/reef/polyp',
    payload: { ...valid, surface: 'quest' },
  });
  assert.equal(r.statusCode, 201);
  const body = r.json() as Record<string, unknown>;
  assert.ok(!('surface' in body), 'response should not echo surface');
  const persisted = db.listPublicPolyps()[0]!;
  assert.ok(!('surface' in (persisted as Record<string, unknown>)), 'DB row should not contain surface');
  await app.close();
});

test('POST /api/reef/polyp rejects invalid colorKey', async () => {
  const { app } = buildApp();
  const r = await app.inject({
    method: 'POST', url: '/api/reef/polyp',
    payload: { ...valid, colorKey: 'bogus' },
  });
  assert.equal(r.statusCode, 400);
  await app.close();
});

test('POST /api/reef/polyp rejects non-unit quaternion', async () => {
  const { app } = buildApp();
  const r = await app.inject({
    method: 'POST', url: '/api/reef/polyp',
    payload: { ...valid, orientation: [0, 0, 0, 0.5] },
  });
  assert.equal(r.statusCode, 400);
  await app.close();
});

test('POST /api/reef/polyp rejects out-of-bounds position', async () => {
  const { app } = buildApp();
  const r = await app.inject({
    method: 'POST', url: '/api/reef/polyp',
    payload: { ...valid, position: [10, 0, 0] },
  });
  assert.equal(r.statusCode, 400);
  await app.close();
});

test('POST /api/reef/polyp returns 429 with retryAfterMs when RATE_LIMIT_MAX enabled', async () => {
  // Rate limits are disabled by default; this test turns the write-side
  // limit on to exercise the 429 path, then restores.
  const savedMax = config.rateLimitMax;
  config.rateLimitMax = 1;
  try {
    const { app } = buildApp();
    await app.inject({ method: 'POST', url: '/api/reef/polyp', payload: valid });
    const r = await app.inject({ method: 'POST', url: '/api/reef/polyp', payload: valid });
    assert.equal(r.statusCode, 429);
    const body = r.json() as { error: string; retryAfterMs: number };
    assert.equal(body.error, 'rate_limited');
    assert.ok(body.retryAfterMs > 0);
    assert.ok(body.retryAfterMs <= 3_600_000);
    assert.ok(r.headers['retry-after']);
    await app.close();
  } finally {
    config.rateLimitMax = savedMax;
  }
});

test('POST /api/reef/polyp accepts unlimited requests when rate limit is off (default)', async () => {
  // Use a CONSTANT user-agent so every request lands in the same
  // deviceHash bucket. The earlier version of this test rotated the UA
  // per iteration, producing distinct buckets — the test passed
  // tautologically even with rateLimitMax=1. Keeping the UA constant
  // actually exercises the "limit-off" code path.
  const savedMax = config.rateLimitMax;
  config.rateLimitMax = 0;
  try {
    const { app } = buildApp();
    for (let i = 0; i < 5; i++) {
      const r = await app.inject({
        method: 'POST', url: '/api/reef/polyp',
        headers: { 'user-agent': 'constant-ua-for-rate-limit-test' },
        payload: { ...valid, seed: 100 + i },
      });
      assert.equal(r.statusCode, 201, `request ${i} should succeed, got ${r.statusCode}`);
    }
    await app.close();
  } finally {
    config.rateLimitMax = savedMax;
  }
});

test('quest surface uses questRateLimitMax bucket, not rateLimitMax', async () => {
  // Web bucket = 1 (tight), quest bucket = 3. Plant 3 quest-tagged polyps from
  // the same device — all succeed. The 4th hits the quest bucket ceiling.
  const savedMax = config.rateLimitMax;
  const savedQuestMax = config.questRateLimitMax;
  config.rateLimitMax = 1;
  config.questRateLimitMax = 3;
  try {
    const { app } = buildApp();
    for (let i = 0; i < 3; i++) {
      const r = await app.inject({
        method: 'POST', url: '/api/reef/polyp',
        payload: { ...valid, seed: 200 + i, surface: 'quest' },
      });
      assert.equal(r.statusCode, 201, `quest #${i} should succeed: ${r.body}`);
    }
    const overflow = await app.inject({
      method: 'POST', url: '/api/reef/polyp',
      payload: { ...valid, seed: 299, surface: 'quest' },
    });
    assert.equal(overflow.statusCode, 429);
    await app.close();
  } finally {
    config.rateLimitMax = savedMax;
    config.questRateLimitMax = savedQuestMax;
  }
});

test('web surface (or absent surface) uses the strict rateLimitMax bucket', async () => {
  // Even with quest bucket loose, a web/absent submission hits the tight web
  // bucket. This guards against accidentally always-loose behavior.
  const savedMax = config.rateLimitMax;
  const savedQuestMax = config.questRateLimitMax;
  config.rateLimitMax = 1;
  config.questRateLimitMax = 10;
  try {
    const { app } = buildApp();
    const first = await app.inject({
      method: 'POST', url: '/api/reef/polyp',
      payload: { ...valid, seed: 301, surface: 'web' },
    });
    assert.equal(first.statusCode, 201);
    const second = await app.inject({
      method: 'POST', url: '/api/reef/polyp',
      payload: { ...valid, seed: 302, surface: 'web' },
    });
    assert.equal(second.statusCode, 429);
    await app.close();
  } finally {
    config.rateLimitMax = savedMax;
    config.questRateLimitMax = savedQuestMax;
  }
});
