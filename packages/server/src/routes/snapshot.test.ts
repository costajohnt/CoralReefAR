import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { ReefDb } from '../db.js';
import { registerSnapshotRoutes } from './snapshot.js';

function buildApp(): { app: FastifyInstance; db: ReefDb } {
  const dir = mkdtempSync(join(tmpdir(), 'reef-snap-'));
  const db = new ReefDb(join(dir, 'reef.db'));
  const app = Fastify({ logger: false });
  registerSnapshotRoutes(app, db);
  return { app, db };
}

test('snapshot: GET /api/snapshots returns empty list when none recorded', async () => {
  const { app } = buildApp();
  try {
    const r = await app.inject({ method: 'GET', url: '/api/snapshots' });
    assert.equal(r.statusCode, 200);
    const body = r.json();
    assert.ok(Array.isArray(body));
    assert.equal(body.length, 0);
  } finally {
    await app.close();
  }
});

test('snapshot: GET /api/snapshots lists recorded snapshots in order', async () => {
  const { app, db } = buildApp();
  try {
    const a = db.insertSnapshot(3, JSON.stringify({ polyps: [1, 2, 3], sim: [] }));
    const b = db.insertSnapshot(5, JSON.stringify({ polyps: [1, 2, 3, 4, 5], sim: [] }));
    const r = await app.inject({ method: 'GET', url: '/api/snapshots' });
    assert.equal(r.statusCode, 200);
    const body = r.json() as Array<{ id: number; polypCount: number }>;
    assert.equal(body.length, 2);
    const ids = body.map((s) => s.id);
    assert.ok(ids.includes(a));
    assert.ok(ids.includes(b));
    const last = body.find((s) => s.id === b);
    assert.equal(last?.polypCount, 5);
  } finally {
    await app.close();
  }
});

test('snapshot: GET /api/snapshots/:id returns the full state JSON', async () => {
  const { app, db } = buildApp();
  try {
    const state = { polyps: [{ id: 7, species: 'fan' }], sim: [{ polypId: 7, kind: 'algae' }] };
    const id = db.insertSnapshot(1, JSON.stringify(state));
    const r = await app.inject({ method: 'GET', url: `/api/snapshots/${id}` });
    assert.equal(r.statusCode, 200);
    const body = r.json() as { id: number; polypCount: number; stateJson: string };
    assert.equal(body.id, id);
    assert.equal(body.polypCount, 1);
    assert.deepEqual(JSON.parse(body.stateJson), state);
  } finally {
    await app.close();
  }
});

test('snapshot: GET /api/snapshots/:id returns 404 for unknown id', async () => {
  const { app } = buildApp();
  try {
    const r = await app.inject({ method: 'GET', url: '/api/snapshots/999' });
    assert.equal(r.statusCode, 404);
    assert.equal(r.json().error, 'not_found');
  } finally {
    await app.close();
  }
});

test('snapshot: GET /api/snapshots/:id returns 400 for non-numeric id', async () => {
  const { app } = buildApp();
  try {
    const r = await app.inject({ method: 'GET', url: '/api/snapshots/not-a-number' });
    assert.equal(r.statusCode, 400);
    assert.equal(r.json().error, 'invalid_id');
  } finally {
    await app.close();
  }
});
