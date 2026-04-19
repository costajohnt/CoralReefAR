import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { ReefDb } from '../db.js';
import { registerStatsRoutes } from './stats.js';

function buildApp(): { app: FastifyInstance; db: ReefDb } {
  const dir = mkdtempSync(join(tmpdir(), 'reef-stats-'));
  const db = new ReefDb(join(dir, 'reef.db'));
  const app = Fastify({ logger: false });
  registerStatsRoutes(app, db);
  return { app, db };
}

const base = () => ({
  species: 'branching' as const,
  seed: 1,
  colorKey: 'coral-pink',
  position: [0, 0, 0] as [number, number, number],
  orientation: [0, 0, 0, 1] as [number, number, number, number],
  scale: 1,
  createdAt: Date.now(),
  deviceHash: 'd1',
});

test('stats: empty reef returns zero counts', async () => {
  const { app } = buildApp();
  const r = await app.inject({ method: 'GET', url: '/api/stats' });
  assert.equal(r.statusCode, 200);
  const j = r.json() as { total: number; uniqueDevices: number; last24h: number; bySpecies: Record<string, number> };
  assert.equal(j.total, 0);
  assert.equal(j.uniqueDevices, 0);
  assert.equal(j.last24h, 0);
  assert.deepEqual(j.bySpecies, {});
  await app.close();
});

test('stats: counts unique devices and species breakdown', async () => {
  const { app, db } = buildApp();
  const now = Date.now();
  db.insertPolyp({ ...base(), species: 'branching', createdAt: now - 1000, deviceHash: 'd1' });
  db.insertPolyp({ ...base(), species: 'bulbous', createdAt: now - 2000, deviceHash: 'd2' });
  db.insertPolyp({ ...base(), species: 'bulbous', createdAt: now - 3 * 86_400_000, deviceHash: 'd2' });
  db.insertPolyp({ ...base(), species: 'fan', createdAt: now - 10 * 86_400_000, deviceHash: 'd3' });

  const r = await app.inject({ method: 'GET', url: '/api/stats' });
  const j = r.json() as {
    total: number; uniqueDevices: number; last24h: number; last7d: number;
    bySpecies: Record<string, number>;
  };
  assert.equal(j.total, 4);
  assert.equal(j.uniqueDevices, 3);
  assert.equal(j.last24h, 2);
  assert.equal(j.last7d, 3);
  assert.equal(j.bySpecies.branching, 1);
  assert.equal(j.bySpecies.bulbous, 2);
  assert.equal(j.bySpecies.fan, 1);
  await app.close();
});
