import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ReefDb } from './db.js';

function freshDb(): ReefDb {
  const dir = mkdtempSync(join(tmpdir(), 'reef-test-'));
  return new ReefDb(join(dir, 'reef.db'));
}

const basePolyp = () => ({
  species: 'branching' as const,
  seed: 1,
  colorKey: 'coral-pink',
  position: [0, 0, 0] as [number, number, number],
  orientation: [0, 0, 0, 1] as [number, number, number, number],
  scale: 1,
  createdAt: Date.now(),
  deviceHash: 'test-device',
});

test('DB: insert + list roundtrips', () => {
  const db = freshDb();
  const inserted = db.insertPolyp(basePolyp());
  assert.equal(inserted.id, 1);
  assert.equal(inserted.deleted, false);
  const all = db.listPublicPolyps();
  assert.equal(all.length, 1);
  assert.equal(all[0]!.id, 1);
  // Public polyp must not expose deviceHash.
  assert.ok(!('deviceHash' in all[0]!));
});

test('DB: listPublicPolyps excludes soft-deleted rows', () => {
  const db = freshDb();
  const p = db.insertPolyp(basePolyp());
  db.softDeletePolyp(p.id);
  assert.equal(db.listPublicPolyps().length, 0);
});

test('DB: softDeletePolyp returns false for unknown id', () => {
  const db = freshDb();
  assert.equal(db.softDeletePolyp(999), false);
});

test('DB: restorePolyp returns { status: "unknown" } for id that was never inserted', () => {
  const db = freshDb();
  const result = db.restorePolyp(999);
  assert.equal(result.status, 'unknown');
});

test('DB: restorePolyp returns { status: "already_live" } for a row that was never deleted', () => {
  const db = freshDb();
  const p = db.insertPolyp(basePolyp());
  const result = db.restorePolyp(p.id);
  assert.equal(result.status, 'already_live');
});

test('DB: restorePolyp returns { status: "restored", polyp } after a soft-delete', () => {
  const db = freshDb();
  const p = db.insertPolyp(basePolyp());
  db.softDeletePolyp(p.id);
  const result = db.restorePolyp(p.id);
  assert.equal(result.status, 'restored');
  if (result.status === 'restored') {
    assert.equal(result.polyp.id, p.id);
    assert.equal(result.polyp.species, 'branching');
    assert.ok(!('deviceHash' in result.polyp));
  }
  assert.equal(db.listPublicPolyps().length, 1);
});

test('DB: countByDeviceSince counts within window', () => {
  const db = freshDb();
  const now = Date.now();
  db.insertPolyp({ ...basePolyp(), createdAt: now - 10_000 });
  db.insertPolyp({ ...basePolyp(), createdAt: now - 2_000_000 });
  assert.equal(db.countByDeviceSince('test-device', now - 60_000), 1);
  assert.equal(db.countByDeviceSince('test-device', now - 3_000_000), 2);
  assert.equal(db.countByDeviceSince('other', now - 60_000), 0);
});

test('DB: oldestPolypSince returns oldest timestamp in window', () => {
  const db = freshDb();
  const now = Date.now();
  db.insertPolyp({ ...basePolyp(), createdAt: now - 10_000 });
  db.insertPolyp({ ...basePolyp(), createdAt: now - 30_000 });
  db.insertPolyp({ ...basePolyp(), createdAt: now - 5_000 });
  assert.equal(db.oldestPolypSince('test-device', now - 60_000), now - 30_000);
  assert.equal(db.oldestPolypSince('test-device', now - 20_000), now - 10_000);
  assert.equal(db.oldestPolypSince('test-device', now - 1_000), null);
});

test('DB: transaction wraps inserts atomically', () => {
  const db = freshDb();
  const p = db.insertPolyp(basePolyp());
  db.transaction(() => {
    db.insertSim({ polypId: p.id, kind: 'barnacle', params: { u: 0.1 }, createdAt: Date.now() });
    db.insertSim({ polypId: p.id, kind: 'algae', params: { u: 0.2 }, createdAt: Date.now() });
  });
  assert.equal(db.listSim().length, 2);
});

test('DB: snapshot stores and retrieves state', () => {
  const db = freshDb();
  db.insertPolyp(basePolyp());
  const id = db.insertSnapshot(1, '{"x":1}');
  const snap = db.getSnapshot(id);
  assert.ok(snap);
  assert.equal(snap!.polypCount, 1);
  assert.equal(snap!.stateJson, '{"x":1}');
  assert.equal(db.listSnapshots().length, 1);
});
