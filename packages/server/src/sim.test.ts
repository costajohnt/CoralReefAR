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

test('sim: with rng below every threshold, each eligible polyp grows exactly its applicable decorations', () => {
  // Inject a deterministic RNG that always rolls below all three thresholds
  // (0.02 / 0.01 / 0.005), so the tick outcome is exact instead of "passes
  // with very high probability". 75-day polyps clear the >30 and >60 gates but
  // not >90 → barnacle + algae each, no weather. (75 stays clear of the 60-day
  // boundary, which `>` would make timing-sensitive.)
  const db = freshDb();
  for (let i = 0; i < 100; i++) db.insertPolyp(polypAgedDays(75));
  const sim = new SimWorker(db, new Hub(), 3600_000, 0, () => 0);
  const updates = sim.tick();

  const counts = { barnacle: 0, algae: 0, weather: 0 };
  for (const u of updates) counts[u.kind] += 1;
  assert.equal(counts.barnacle, 100);
  assert.equal(counts.algae, 100);
  assert.equal(counts.weather, 0);
});

test('sim: 90+ day polyps with a sub-threshold rng grow all three decoration kinds', () => {
  const db = freshDb();
  for (let i = 0; i < 10; i++) db.insertPolyp(polypAgedDays(120));
  const sim = new SimWorker(db, new Hub(), 3600_000, 0, () => 0);
  const counts = { barnacle: 0, algae: 0, weather: 0 };
  for (const u of sim.tick()) counts[u.kind] += 1;
  assert.equal(counts.barnacle, 10);
  assert.equal(counts.algae, 10);
  assert.equal(counts.weather, 10);
});

test('sim: with rng above every threshold, no decorations grow', () => {
  // 0.5 is >= all three thresholds, so nothing fires regardless of age.
  const db = freshDb();
  for (let i = 0; i < 200; i++) db.insertPolyp(polypAgedDays(120));
  const sim = new SimWorker(db, new Hub(), 3600_000, 0, () => 0.5);
  let total = 0;
  for (let i = 0; i < 20; i++) total += sim.tick().length;
  assert.equal(total, 0);
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

test('db: pruneOldSnapshots keeps the N most recent', () => {
  const db = freshDb();
  db.insertPolyp(polypAgedDays(1));
  const ids: number[] = [];
  for (let i = 0; i < 5; i++) ids.push(db.insertSnapshot(1, JSON.stringify({ n: i })));
  const removed = db.pruneOldSnapshots(2);
  assert.equal(removed, 3);
  const left = db.listSnapshots().map((s) => s.id).sort((a, b) => a - b);
  // The two highest ids (most recent) survive.
  assert.deepEqual(left, ids.slice(-2));
});

test('snapshot: take() prunes to retentionCount across repeated runs', () => {
  const db = freshDb();
  db.insertPolyp(polypAgedDays(1));
  const w = new SnapshotWorker(db, 86_400_000, 3);
  for (let i = 0; i < 6; i++) w.take();
  assert.equal(db.listSnapshots().length, 3);
});

test('snapshot: retentionCount=0 keeps every snapshot', () => {
  const db = freshDb();
  db.insertPolyp(polypAgedDays(1));
  const w = new SnapshotWorker(db, 86_400_000, 0);
  for (let i = 0; i < 4; i++) w.take();
  assert.equal(db.listSnapshots().length, 4);
});

// --- Ecosystem (#117) --------------------------------------------------------

test('db: ecosystem state is absent until saved, then round-trips', () => {
  const db = freshDb();
  assert.equal(db.getEcosystem(), null);
  const s = {
    version: 1 as const, computedAt: 5, polypCount: 2, plantedLast7d: 1, daysSinceLastPlant: 0,
    bleaching: 0.25, fishCount: 12, phase: 'stressed' as const,
  };
  db.saveEcosystem(s);
  assert.deepEqual(db.getEcosystem(), s);
  db.saveEcosystem({ ...s, bleaching: 0.1 });
  assert.equal(db.getEcosystem()!.bleaching, 0.1);
  assert.equal((db.db.prepare('SELECT COUNT(*) AS n FROM ecosystem_state_v2').get() as { n: number }).n, 1);
});

test('db: ecosystemInputs counts live polyps only', () => {
  const db = freshDb();
  const now = Date.now();
  db.insertPolyp(polypAgedDays(20));
  const recent = db.insertPolyp(polypAgedDays(2));
  const gone = db.insertPolyp(polypAgedDays(1));
  db.softDeletePolyp(gone.id);
  const i = db.ecosystemInputs(now);
  assert.equal(i.polypCount, 2);
  assert.equal(i.plantedLast7d, 1);
  assert.equal(i.lastPlantedAt, recent.createdAt);
  assert.equal(i.now, now);
  assert.deepEqual(freshDb().ecosystemInputs(now), { now, polypCount: 0, lastPlantedAt: null, plantedLast7d: 0 });
});

test('sim: every tick persists the ecosystem and broadcasts it with sim_update, even with no deltas', () => {
  const db = freshDb();
  for (let i = 0; i < 5; i++) db.insertPolyp(polypAgedDays(1));
  const hub = new Hub();
  const sent: unknown[] = [];
  hub.broadcast = (m) => { sent.push(m); };
  let now = Date.now();
  const sim = new SimWorker(db, hub, 3600_000, 0, () => 0.99, () => now);
  assert.deepEqual(sim.tick(), []);
  const eco = db.getEcosystem()!;
  assert.equal(eco.polypCount, 5);
  assert.equal(eco.computedAt, now);
  assert.equal(eco.phase, 'thriving');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0], { type: 'sim_update', updates: [], ecosystem: eco });
  now += 3600_000;
  sim.tick();
  assert.equal(db.getEcosystem()!.computedAt, now);
});

test('sim: the ecosystem advances from the persisted state across restarts', () => {
  const db = freshDb();
  db.insertPolyp(polypAgedDays(30)); // long-stagnant reef
  let now = Date.now();
  const clock = () => now;
  new SimWorker(db, new Hub(), 3600_000, 0, () => 0.99, clock).tick();
  assert.equal(db.getEcosystem()!.bleaching, 0); // first state starts healthy
  now += 3600_000;
  // A new worker (process restart) continues from the saved row.
  new SimWorker(db, new Hub(), 3600_000, 0, () => 0.99, clock).tick();
  assert.ok(db.getEcosystem()!.bleaching > 0);
});

test('sim: the ecosystem never touches polyp rows', () => {
  const db = freshDb();
  for (let i = 0; i < 3; i++) db.insertPolyp(polypAgedDays(40));
  const before = JSON.stringify(db.db.prepare('SELECT * FROM polyps ORDER BY id').all());
  let now = Date.now();
  const sim = new SimWorker(db, new Hub(), 3600_000, 0, () => 0.99, () => now);
  for (let h = 0; h < 200; h++) { sim.tick(); now += 3600_000; }
  assert.ok(db.getEcosystem()!.bleaching > 0);
  assert.equal(JSON.stringify(db.db.prepare('SELECT * FROM polyps ORDER BY id').all()), before);
});

test('snapshot: take() records the ecosystem alongside polyps and sim', () => {
  const db = freshDb();
  db.insertPolyp(polypAgedDays(1));
  new SimWorker(db, new Hub(), 3600_000, 0, () => 0.99).tick();
  const id = new SnapshotWorker(db, 86_400_000).take();
  const state = JSON.parse(db.getSnapshot(id)!.stateJson) as { polyps: unknown[]; ecosystem: { polypCount: number } };
  assert.equal(state.polyps.length, 1);
  assert.equal(state.ecosystem.polypCount, 1);
});

test('sim/snapshot: a throwing tick is reported, not thrown (audit M1)', () => {
  const broken = new Proxy({} as ReefDb, { get: () => () => { throw new Error('SQLITE_FULL'); } });
  const errors: unknown[] = [];
  const sim = new SimWorker(broken, new Hub(), 3600_000);
  sim.onError = (err) => errors.push(err);
  assert.doesNotThrow(() => sim.safeTick());
  const snap = new SnapshotWorker(broken, 3600_000);
  snap.onError = (err) => errors.push(err);
  assert.doesNotThrow(() => snap.safeTake());
  assert.equal(errors.length, 2);
});

test('sim/snapshot: start() is idempotent (audit L2)', () => {
  const db = freshDb();
  const sim = new SimWorker(db, new Hub(), 3600_000);
  sim.start();
  const first = (sim as unknown as { timer: unknown }).timer;
  sim.start();
  assert.equal((sim as unknown as { timer: unknown }).timer, first);
  sim.stop();
  const snap = new SnapshotWorker(db, 3600_000);
  snap.start();
  const t = (snap as unknown as { timer: unknown }).timer;
  snap.start();
  assert.equal((snap as unknown as { timer: unknown }).timer, t);
  snap.stop();
});
