import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { OWNER_HEADER, UNDO_WINDOW_MS, type ServerMessage } from '@reef/shared';
import { ReefDb } from '../db.js';
import { Hub } from '../hub.js';
import { registerReefRoutes } from './reef.js';
import { config } from '../config.js';

function buildApp(): { app: FastifyInstance; db: ReefDb; sent: ServerMessage[] } {
  const dir = mkdtempSync(join(tmpdir(), 'reef-undo-'));
  const db = new ReefDb(join(dir, 'reef.db'));
  const hub = new Hub();
  const sent: ServerMessage[] = [];
  hub.broadcast = (msg) => { sent.push(msg as ServerMessage); };
  const app = Fastify({ logger: false });
  registerReefRoutes(app, db, hub);
  return { app, db, sent };
}

const valid = {
  species: 'branching', seed: 42, colorKey: 'coral-pink',
  position: [0, 0, 0], orientation: [0, 0, 0, 1], scale: 1,
};

const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

async function plant(app: FastifyInstance, owner?: string): Promise<number> {
  const r = await app.inject({
    method: 'POST', url: '/api/reef/polyp', payload: valid,
    headers: owner ? { [OWNER_HEADER]: owner } : {},
  });
  assert.equal(r.statusCode, 201, r.body);
  return (r.json() as { id: number }).id;
}

function undo(app: FastifyInstance, id: number, owner?: string) {
  return app.inject({
    method: 'POST', url: `/api/reef/polyp/${id}/undo`,
    headers: owner ? { [OWNER_HEADER]: owner } : {},
  });
}

function ageRow(db: ReefDb, id: number, ms: number): void {
  db.db.prepare('UPDATE polyps SET created_at = created_at - ? WHERE id = ?').run(ms, id);
}

test('POST /api/reef/polyp stores only a hash of the owner token', async () => {
  const { app, db } = buildApp();
  const id = await plant(app, ALICE);
  const row = db.db.prepare('SELECT owner_hash FROM polyps WHERE id = ?').get(id) as { owner_hash: string };
  assert.match(row.owner_hash, /^[0-9a-f]{64}$/);
  assert.notEqual(row.owner_hash, ALICE);
  assert.ok(!JSON.stringify(db.listPublicPolyps()).includes(row.owner_hash), 'public rows must not carry the hash');
  await app.close();
});

test('POST /api/reef/polyp without an owner header still works (old clients)', async () => {
  const { app, db } = buildApp();
  const id = await plant(app);
  const row = db.db.prepare('SELECT owner_hash FROM polyps WHERE id = ?').get(id) as { owner_hash: string | null };
  assert.equal(row.owner_hash, null);
  await app.close();
});

test('POST /api/reef/polyp rejects a malformed owner header', async () => {
  const { app, db } = buildApp();
  const r = await app.inject({
    method: 'POST', url: '/api/reef/polyp', payload: valid,
    headers: { [OWNER_HEADER]: 'not-a-digest' },
  });
  assert.equal(r.statusCode, 400);
  assert.equal((r.json() as { error: string }).error, 'invalid_owner');
  assert.equal(db.listPublicPolyps().length, 0);
  await app.close();
});

test('GET /api/reef/mine lists only the caller\'s live polyps', async () => {
  const { app } = buildApp();
  const a1 = await plant(app, ALICE);
  await plant(app, BOB);
  await plant(app);
  const a2 = await plant(app, ALICE);
  const r = await app.inject({ method: 'GET', url: '/api/reef/mine', headers: { [OWNER_HEADER]: ALICE } });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { ids: [a1, a2] });
  await app.close();
});

test('GET /api/reef/mine requires a well-formed owner header', async () => {
  const { app } = buildApp();
  const missing = await app.inject({ method: 'GET', url: '/api/reef/mine' });
  assert.equal(missing.statusCode, 400);
  const bad = await app.inject({ method: 'GET', url: '/api/reef/mine', headers: { [OWNER_HEADER]: 'zz' } });
  assert.equal(bad.statusCode, 400);
  await app.close();
});

test('undo: owner can undo their latest polyp inside the window; broadcasts removal', async () => {
  const { app, db, sent } = buildApp();
  const id = await plant(app, ALICE);
  sent.length = 0;
  const r = await undo(app, id, ALICE);
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { ok: true });
  assert.equal(db.listPublicPolyps().length, 0);
  assert.deepEqual(sent, [{ type: 'polyp_removed', id }]);
  const mine = await app.inject({ method: 'GET', url: '/api/reef/mine', headers: { [OWNER_HEADER]: ALICE } });
  assert.deepEqual(mine.json(), { ids: [] });
  await app.close();
});

test('undo: a different owner token is refused', async () => {
  const { app, db, sent } = buildApp();
  const id = await plant(app, ALICE);
  sent.length = 0;
  const r = await undo(app, id, BOB);
  assert.equal(r.statusCode, 403);
  assert.equal((r.json() as { error: string }).error, 'not_owner');
  assert.equal(db.listPublicPolyps().length, 1);
  assert.equal(sent.length, 0);
  await app.close();
});

test('undo: a polyp planted without an owner can never be undone', async () => {
  const { app, db } = buildApp();
  const id = await plant(app);
  const r = await undo(app, id, ALICE);
  assert.equal(r.statusCode, 403);
  assert.equal(db.listPublicPolyps().length, 1);
  await app.close();
});

test('undo: missing or malformed owner header is a 400', async () => {
  const { app } = buildApp();
  const id = await plant(app, ALICE);
  assert.equal((await undo(app, id)).statusCode, 400);
  assert.equal((await undo(app, id, 'A'.repeat(64))).statusCode, 400);
  await app.close();
});

test('undo: non-numeric or unknown id', async () => {
  const { app } = buildApp();
  const bad = await app.inject({ method: 'POST', url: '/api/reef/polyp/abc/undo', headers: { [OWNER_HEADER]: ALICE } });
  assert.equal(bad.statusCode, 400);
  const missing = await undo(app, 999, ALICE);
  assert.equal(missing.statusCode, 404);
  await app.close();
});

test('undo: refused once the grace window has expired', async () => {
  const { app, db, sent } = buildApp();
  const id = await plant(app, ALICE);
  ageRow(db, id, UNDO_WINDOW_MS + 1);
  sent.length = 0;
  const r = await undo(app, id, ALICE);
  assert.equal(r.statusCode, 409);
  assert.equal((r.json() as { error: string }).error, 'undo_window_expired');
  assert.equal(db.listPublicPolyps().length, 1);
  assert.equal(sent.length, 0);
  await app.close();
});

test('undo: only the owner\'s most recent polyp, not an earlier one', async () => {
  const { app, db } = buildApp();
  const first = await plant(app, ALICE);
  await plant(app, ALICE);
  const r = await undo(app, first, ALICE);
  assert.equal(r.statusCode, 409);
  assert.equal((r.json() as { error: string }).error, 'not_latest');
  assert.equal(db.listPublicPolyps().length, 2);
  await app.close();
});

test('undo: someone else planting afterwards does not block the owner', async () => {
  const { app, db } = buildApp();
  const mine = await plant(app, ALICE);
  await plant(app, BOB);
  await plant(app);
  const r = await undo(app, mine, ALICE);
  assert.equal(r.statusCode, 200);
  assert.equal(db.listPublicPolyps().length, 2);
  await app.close();
});

test('undo: does not chain back to an older polyp after undoing the latest', async () => {
  const { app, db } = buildApp();
  const first = await plant(app, ALICE);
  const second = await plant(app, ALICE);
  assert.equal((await undo(app, second, ALICE)).statusCode, 200);
  const r = await undo(app, first, ALICE);
  assert.equal(r.statusCode, 409);
  assert.equal((r.json() as { error: string }).error, 'not_latest');
  assert.equal(db.listPublicPolyps().length, 1);
  await app.close();
});

test('undo: double undo is idempotent and broadcasts once', async () => {
  const { app, db, sent } = buildApp();
  const id = await plant(app, ALICE);
  sent.length = 0;
  const [a, b] = await Promise.all([undo(app, id, ALICE), undo(app, id, ALICE)]);
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  const again = await undo(app, id, ALICE);
  assert.equal(again.statusCode, 200);
  assert.deepEqual(again.json(), { ok: true });
  assert.equal(db.listPublicPolyps().length, 0);
  assert.deepEqual(sent, [{ type: 'polyp_removed', id }]);
  await app.close();
});

test('undo: a repeat undo after the window still reports success, not expiry', async () => {
  const { app, db } = buildApp();
  const id = await plant(app, ALICE);
  assert.equal((await undo(app, id, ALICE)).statusCode, 200);
  ageRow(db, id, UNDO_WINDOW_MS + 1);
  assert.equal((await undo(app, id, ALICE)).statusCode, 200);
  await app.close();
});

test('undo: snapshot and sim tick around an undo stay consistent', async () => {
  const { SnapshotWorker, SimWorker } = await import('../sim.js');
  const { app, db } = buildApp();
  const keep = await plant(app, BOB);
  const id = await plant(app, ALICE);
  const snap = new SnapshotWorker(db, 60_000);
  const before = JSON.parse(db.getSnapshot(snap.take())!.stateJson) as { polyps: Array<{ id: number }> };
  assert.deepEqual(before.polyps.map((p) => p.id), [keep, id]);
  assert.equal((await undo(app, id, ALICE)).statusCode, 200);
  const after = JSON.parse(db.getSnapshot(snap.take())!.stateJson) as { polyps: Array<{ id: number }> };
  assert.deepEqual(after.polyps.map((p) => p.id), [keep]);
  // The sim tick only reads live rows, so an undone polyp gets no deltas.
  ageRow(db, keep, 100 * 86_400_000);
  ageRow(db, id, 100 * 86_400_000);
  const sim = new SimWorker(db, new Hub(), 60_000, 0, () => 0);
  const updates = sim.tick();
  assert.ok(updates.length > 0);
  assert.ok(updates.every((u) => u.polypId === keep));
  await app.close();
});

test('undo: per-IP rate limit returns 429 with Retry-After once the bucket is empty', async () => {
  const saved = config.undoRateLimitPerMin;
  config.undoRateLimitPerMin = 2; // the limiter is built at route registration
  try {
    const { app, db } = buildApp();
    const id = await plant(app, ALICE);
    assert.equal((await undo(app, id, BOB)).statusCode, 403);
    assert.equal((await undo(app, id, BOB)).statusCode, 403);
    const limited = await undo(app, id, ALICE);
    assert.equal(limited.statusCode, 429);
    assert.equal((limited.json() as { error: string }).error, 'rate_limited');
    assert.ok(Number(limited.headers['retry-after']) >= 1);
    // Rejected before any DB work: the owner's polyp is still live.
    assert.equal(db.listPublicPolyps().length, 1);
    // Planting and reading are separate buckets and unaffected.
    assert.equal((await app.inject({ method: 'GET', url: '/api/reef' })).statusCode, 200);
    await app.close();
  } finally {
    config.undoRateLimitPerMin = saved;
  }
});

test('undo: UNDO_RATE_LIMIT_PER_MIN=0 disables the limiter', async () => {
  const saved = config.undoRateLimitPerMin;
  config.undoRateLimitPerMin = 0;
  try {
    const { app } = buildApp();
    const id = await plant(app, ALICE);
    for (let i = 0; i < 15; i++) assert.equal((await undo(app, id, BOB)).statusCode, 403);
    await app.close();
  } finally {
    config.undoRateLimitPerMin = saved;
  }
});
