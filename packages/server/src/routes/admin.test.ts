import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { ReefDb } from '../db.js';
import { Hub } from '../hub.js';
import { registerReefRoutes } from './reef.js';
import { registerAdminRoutes } from './admin.js';
import { config } from '../config.js';

function buildApp(): { app: FastifyInstance; db: ReefDb } {
  const dir = mkdtempSync(join(tmpdir(), 'reef-admin-'));
  const db = new ReefDb(join(dir, 'reef.db'));
  const hub = new Hub();
  const app = Fastify({ logger: false });
  registerReefRoutes(app, db, hub);
  registerAdminRoutes(app, db, hub);
  return { app, db };
}

const valid = {
  species: 'branching', seed: 42, colorKey: 'coral-pink',
  position: [0, 0, 0], orientation: [0, 0, 0, 1], scale: 1,
};

test('admin: DELETE without token returns 401', async () => {
  const { app } = buildApp();
  config.adminToken = 'token-abc';
  const r = await app.inject({ method: 'DELETE', url: '/api/admin/polyp/1' });
  assert.equal(r.statusCode, 401);
  await app.close();
});

test('admin: DELETE with wrong token returns 401', async () => {
  const { app } = buildApp();
  config.adminToken = 'token-abc';
  const r = await app.inject({
    method: 'DELETE', url: '/api/admin/polyp/1',
    headers: { authorization: 'Bearer nope' },
  });
  assert.equal(r.statusCode, 401);
  await app.close();
});

test('admin: DELETE with valid token soft-deletes polyp', async () => {
  const { app, db } = buildApp();
  config.adminToken = 'token-abc';
  await app.inject({ method: 'POST', url: '/api/reef/polyp', payload: valid });
  assert.equal(db.listPublicPolyps().length, 1);
  const r = await app.inject({
    method: 'DELETE', url: '/api/admin/polyp/1',
    headers: { authorization: 'Bearer token-abc' },
  });
  assert.equal(r.statusCode, 200);
  assert.equal(db.listPublicPolyps().length, 0);
  await app.close();
});

test('admin: DELETE rejects non-numeric id', async () => {
  const { app } = buildApp();
  config.adminToken = 'token-abc';
  const r = await app.inject({
    method: 'DELETE', url: '/api/admin/polyp/not-a-number',
    headers: { authorization: 'Bearer token-abc' },
  });
  assert.equal(r.statusCode, 400);
  await app.close();
});

test('admin: DELETE returns 404 for unknown id', async () => {
  const { app } = buildApp();
  config.adminToken = 'token-abc';
  const r = await app.inject({
    method: 'DELETE', url: '/api/admin/polyp/999',
    headers: { authorization: 'Bearer token-abc' },
  });
  assert.equal(r.statusCode, 404);
  await app.close();
});

test('admin: blank ADMIN_TOKEN disables admin entirely', async () => {
  const { app } = buildApp();
  config.adminToken = '';
  const r = await app.inject({
    method: 'DELETE', url: '/api/admin/polyp/1',
    headers: { authorization: 'Bearer anything' },
  });
  assert.equal(r.statusCode, 401);
  await app.close();
});

test('admin: POST restore without token returns 401', async () => {
  const { app } = buildApp();
  config.adminToken = 'token-abc';
  const r = await app.inject({ method: 'POST', url: '/api/admin/polyp/1/restore' });
  assert.equal(r.statusCode, 401);
  await app.close();
});

test('admin: POST restore with non-numeric id returns 400', async () => {
  const { app } = buildApp();
  config.adminToken = 'token-abc';
  const r = await app.inject({
    method: 'POST', url: '/api/admin/polyp/nope/restore',
    headers: { authorization: 'Bearer token-abc' },
  });
  assert.equal(r.statusCode, 400);
  await app.close();
});

test('admin: POST restore for unknown id returns 404', async () => {
  const { app } = buildApp();
  config.adminToken = 'token-abc';
  const r = await app.inject({
    method: 'POST', url: '/api/admin/polyp/999/restore',
    headers: { authorization: 'Bearer token-abc' },
  });
  assert.equal(r.statusCode, 404);
  await app.close();
});

test('admin: POST restore for a live (never-deleted) polyp returns 404', async () => {
  const { app } = buildApp();
  config.adminToken = 'token-abc';
  await app.inject({ method: 'POST', url: '/api/reef/polyp', payload: valid });
  const r = await app.inject({
    method: 'POST', url: '/api/admin/polyp/1/restore',
    headers: { authorization: 'Bearer token-abc' },
  });
  assert.equal(r.statusCode, 404);
  await app.close();
});

test('admin: POST restore un-deletes a soft-deleted polyp and returns it', async () => {
  const { app, db } = buildApp();
  config.adminToken = 'token-abc';
  await app.inject({ method: 'POST', url: '/api/reef/polyp', payload: valid });
  assert.equal(db.listPublicPolyps().length, 1);
  await app.inject({
    method: 'DELETE', url: '/api/admin/polyp/1',
    headers: { authorization: 'Bearer token-abc' },
  });
  assert.equal(db.listPublicPolyps().length, 0);

  const r = await app.inject({
    method: 'POST', url: '/api/admin/polyp/1/restore',
    headers: { authorization: 'Bearer token-abc' },
  });
  assert.equal(r.statusCode, 200);
  const body = r.json() as { id: number; species: string };
  assert.equal(body.id, 1);
  assert.equal(body.species, 'branching');
  assert.equal(db.listPublicPolyps().length, 1);
  await app.close();
});

test('admin: GET deleted without token returns 401', async () => {
  const { app } = buildApp();
  config.adminToken = 'token-abc';
  const r = await app.inject({ method: 'GET', url: '/api/admin/deleted' });
  assert.equal(r.statusCode, 401);
  await app.close();
});

test('admin: GET deleted with wrong token returns 401', async () => {
  const { app } = buildApp();
  config.adminToken = 'token-abc';
  const r = await app.inject({
    method: 'GET', url: '/api/admin/deleted',
    headers: { authorization: 'Bearer nope' },
  });
  assert.equal(r.statusCode, 401);
  await app.close();
});

test('admin: GET deleted returns empty list when nothing is soft-deleted', async () => {
  const { app } = buildApp();
  config.adminToken = 'token-abc';
  await app.inject({ method: 'POST', url: '/api/reef/polyp', payload: valid });
  const r = await app.inject({
    method: 'GET', url: '/api/admin/deleted',
    headers: { authorization: 'Bearer token-abc' },
  });
  assert.equal(r.statusCode, 200);
  const body = r.json() as { polyps: Array<{ id: number }> };
  assert.ok(Array.isArray(body.polyps));
  assert.equal(body.polyps.length, 0);
  await app.close();
});

test('admin: GET deleted returns soft-deleted polyps (and excludes live ones)', async () => {
  const { app } = buildApp();
  config.adminToken = 'token-abc';
  // Plant one, delete it; then plant a second, leave it live.
  await app.inject({ method: 'POST', url: '/api/reef/polyp', payload: valid });
  await app.inject({
    method: 'DELETE', url: '/api/admin/polyp/1',
    headers: { authorization: 'Bearer token-abc' },
  });
  await app.inject({
    method: 'POST', url: '/api/reef/polyp',
    headers: { 'user-agent': 'second-device' },
    payload: { ...valid, seed: 99 },
  });
  const r = await app.inject({
    method: 'GET', url: '/api/admin/deleted',
    headers: { authorization: 'Bearer token-abc' },
  });
  assert.equal(r.statusCode, 200);
  const body = r.json() as { polyps: Array<{ id: number; species: string }> };
  assert.equal(body.polyps.length, 1);
  assert.equal(body.polyps[0]?.id, 1);
  assert.equal(body.polyps[0]?.species, 'branching');
  await app.close();
});

test('admin: GET /admin returns HTML without auth', async () => {
  const { app } = buildApp();
  const r = await app.inject({ method: 'GET', url: '/admin' });
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'] as string, /text\/html/);
  assert.match(r.payload, /<title>Reef Admin<\/title>/);
  await app.close();
});
