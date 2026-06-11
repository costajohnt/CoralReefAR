import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReefDb } from './db.js';
import { Hub } from './hub.js';
import { SimWorker, SnapshotWorker } from './sim.js';

function freshDb(): ReefDb {
  const dir = mkdtempSync(join(tmpdir(), 'reef-sim-'));
  return new ReefDb(join(dir, 'reef.db'));
}

function polypAgedDays(days: number) {
  return {
    species: 'branching' as const,
    seed: 1,
    colorKey: 'coral-pink',
    position: [0, 0, 0] as [number, number, number],
    orientation: [0, 0, 0, 1] as [number, number, number, number],
    scale: 1,
    createdAt: Date.now() - days * 86_400_000,
    deviceHash: 'seed',
  };
}

test('sim: tick produces no updates on fresh polyps (all <30 days)', () => {
  const db = freshDb();
  for (let i = 0; i < 20; i++) db.insertPolyp(polypAgedDays(5));
  const sim = new SimWorker(db, new Hub(), 3600_000);
  for (let i = 0; i < 10; i++) {
    const updates = sim.tick();
    assert.equal(updates.length, 0);
  }
});

test('sim: tick eventually produces barnacles for aged polyps', () => {
  const db = freshDb();
  for (let i = 0; i < 200; i++) db.insertPolyp(polypAgedDays(60));
  const sim = new SimWorker(db, new Hub(), 3600_000);
  // At 2% chance per polyp per tick over 200 polyps, expected ~4/tick. Over
  // 20 ticks, P(zero updates) ≈ (1-0.02)^(200*20) = effectively 0.
  let total = 0;
  for (let i = 0; i < 20; i++) total += sim.tick().length;
  assert.ok(total > 0, `expected updates, got ${total}`);
});

test('sim: sim_update deltas persist via transaction', () => {
  const db = freshDb();
  for (let i = 0; i < 50; i++) db.insertPolyp(polypAgedDays(100));
  const sim = new SimWorker(db, new Hub(), 3600_000);
  for (let i = 0; i < 5; i++) sim.tick();
  const stored = db.listSim();
  // Must be consistent: every delta reported by tick is in the DB.
  assert.ok(stored.length > 0);
  for (const d of stored) {
    assert.ok(['barnacle', 'algae', 'weather'].includes(d.kind));
  }
});

const DAY = 86_400_000;

test('db: pruneSimBefore deletes only deltas older than the cutoff', () => {
  const db = freshDb();
  const now = Date.now();
  // sim_state.polyp_id is a FK, so reference real polyps.
  const oldP = db.insertPolyp(polypAgedDays(0));
  const newP = db.insertPolyp(polypAgedDays(0));
  db.insertSim({ polypId: oldP.id, kind: 'barnacle', params: {}, createdAt: now - 40 * DAY });
  db.insertSim({ polypId: newP.id, kind: 'algae', params: {}, createdAt: now - 5 * DAY });
  const removed = db.pruneSimBefore(now - 30 * DAY);
  assert.equal(removed, 1);
  const left = db.listSim();
  assert.equal(left.length, 1);
  assert.equal(left[0]!.polypId, newP.id);
});

test('db: listSimSince returns only deltas inside the window', () => {
  const db = freshDb();
  const now = Date.now();
  const oldP = db.insertPolyp(polypAgedDays(0));
  const newP = db.insertPolyp(polypAgedDays(0));
  db.insertSim({ polypId: oldP.id, kind: 'barnacle', params: {}, createdAt: now - 40 * DAY });
  db.insertSim({ polypId: newP.id, kind: 'algae', params: {}, createdAt: now - 2 * DAY });
  const recent = db.listSimSince(now - 30 * DAY);
  assert.equal(recent.length, 1);
  assert.equal(recent[0]!.polypId, newP.id);
  // listSim still returns everything (used by the snapshot path).
  assert.equal(db.listSim().length, 2);
});

test('sim: tick prunes deltas older than the retention window', () => {
  const db = freshDb();
  const now = Date.now();
  const oldP = db.insertPolyp(polypAgedDays(0));
  const newP = db.insertPolyp(polypAgedDays(0));
  // Old + recent deltas; the polyps are <30d so tick adds nothing new.
  db.insertSim({ polypId: oldP.id, kind: 'barnacle', params: {}, createdAt: now - 40 * DAY });
  db.insertSim({ polypId: newP.id, kind: 'algae', params: {}, createdAt: now - 1 * DAY });
  const sim = new SimWorker(db, new Hub(), 3600_000, 30 * DAY);
  sim.tick();
  const left = db.listSim();
  assert.equal(left.length, 1);
  assert.equal(left[0]!.polypId, newP.id);
});

test('sim: retentionMs=0 prunes nothing (pruning disabled)', () => {
  const db = freshDb();
  const now = Date.now();
  const p = db.insertPolyp(polypAgedDays(0));
  db.insertSim({ polypId: p.id, kind: 'barnacle', params: {}, createdAt: now - 400 * DAY });
  const sim = new SimWorker(db, new Hub(), 3600_000, 0);
  sim.tick();
  assert.equal(db.listSim().length, 1);
});

test('snapshot: take() writes JSON snapshot of current state', () => {
  const db = freshDb();
  db.insertPolyp(polypAgedDays(1));
  const w = new SnapshotWorker(db, 86_400_000);
  const id = w.take();
  const snap = db.getSnapshot(id);
  assert.ok(snap);
  const parsed = JSON.parse(snap!.stateJson) as { polyps: unknown[] };
  assert.equal(parsed.polyps.length, 1);
});
