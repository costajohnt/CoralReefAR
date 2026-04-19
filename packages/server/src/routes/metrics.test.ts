import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { ReefDb } from '../db.js';
import { Hub } from '../hub.js';
import { registerMetricsRoutes } from './metrics.js';

function buildApp(): { app: FastifyInstance; db: ReefDb; hub: Hub } {
  const dir = mkdtempSync(join(tmpdir(), 'reef-metrics-'));
  const db = new ReefDb(join(dir, 'reef.db'));
  const hub = new Hub();
  const app = Fastify({ logger: false });
  registerMetricsRoutes(app, db, hub);
  return { app, db, hub };
}

test('metrics: returns text/plain with Prometheus version marker', async () => {
  const { app } = buildApp();
  try {
    const r = await app.inject({ method: 'GET', url: '/metrics' });
    assert.equal(r.statusCode, 200);
    const ct = r.headers['content-type'] as string;
    assert.match(ct, /text\/plain/);
    assert.match(ct, /version=0\.0\.4/);
  } finally {
    await app.close();
  }
});

test('metrics: exposes reef_polyps_total as a gauge', async () => {
  const { app, db } = buildApp();
  try {
    db.insertPolyp({
      species: 'branching', seed: 1, colorKey: 'coral-pink',
      position: [0, 0, 0], orientation: [0, 0, 0, 1], scale: 1,
      createdAt: Date.now(), deviceHash: 'x',
    });
    db.insertPolyp({
      species: 'fan', seed: 2, colorKey: 'teal',
      position: [0, 0, 0], orientation: [0, 0, 0, 1], scale: 1,
      createdAt: Date.now(), deviceHash: 'y',
    });
    const r = await app.inject({ method: 'GET', url: '/metrics' });
    assert.equal(r.statusCode, 200);
    const body = r.payload;
    assert.match(body, /^# HELP reef_polyps_total /m);
    assert.match(body, /^# TYPE reef_polyps_total gauge$/m);
    assert.match(body, /^reef_polyps_total 2$/m);
  } finally {
    await app.close();
  }
});

test('metrics: exposes reef_ws_clients as a gauge reflecting hub size', async () => {
  const { app, hub } = buildApp();
  try {
    // Simulate three connected clients via hub.add
    const makeSock = () => ({
      readyState: 1,
      send() { /* noop */ },
      on() { /* noop */ },
    });
    hub.add(makeSock());
    hub.add(makeSock());
    hub.add(makeSock());
    const r = await app.inject({ method: 'GET', url: '/metrics' });
    const body = r.payload;
    assert.match(body, /^# TYPE reef_ws_clients gauge$/m);
    assert.match(body, /^reef_ws_clients 3$/m);
  } finally {
    await app.close();
  }
});
