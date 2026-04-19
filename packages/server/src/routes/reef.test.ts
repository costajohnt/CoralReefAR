import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { ReefDb } from '../db.js';
import { Hub } from '../hub.js';
import { registerReefRoutes } from './reef.js';

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

test('POST /api/reef/polyp returns 429 with retryAfterMs on rate limit', async () => {
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
});
