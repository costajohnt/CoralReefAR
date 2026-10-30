import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Storage } from './storage.js';
import { ReefDb } from './db.js';
import { TreeDb } from './tree/db.js';

test('storage: ReefDb and TreeDb built from one Storage share its handle and migrations', () => {
  const storage = new Storage(':memory:');
  const reef = new ReefDb(storage);
  const tree = new TreeDb(storage);
  assert.equal(reef.db, storage.db);
  tree.insertRoot({ variant: 'forked', seed: 1, colorKey: 'neon-cyan' });
  // A tree write is visible through the shared handle, so both live in one file.
  const n = (storage.db.prepare('SELECT COUNT(*) AS n FROM tree_polyps').get() as { n: number }).n;
  assert.equal(n, 1);
  assert.equal(reef.countLivePolyps(), 0);
});

test('storage: ReefDb(path) still opens its own Storage', () => {
  const reef = new ReefDb(':memory:');
  assert.ok(reef.storage instanceof Storage);
  assert.equal(reef.storage.db, reef.db);
});

// --- 006_rooms (#113 phase 2) -------------------------------------------------

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** A file as the pre-rooms server left it: 001-005 applied and recorded, with data. */
function preRoomsFile(): string {
  const path = join(mkdtempSync(join(tmpdir(), 'reef-pre006-')), 'reef.db');
  const raw = new Database(path);
  raw.pragma('journal_mode = WAL');
  raw.pragma('foreign_keys = ON');
  raw.exec('CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (const f of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql') && f < '006').sort()) {
    raw.exec(readFileSync(join(migrationsDir, f), 'utf8'));
    raw.prepare('INSERT INTO schema_migrations VALUES (?, 0)').run(f);
  }
  raw.exec('ALTER TABLE tree_polyps ADD COLUMN attach_yaw REAL NOT NULL DEFAULT 0');
  raw.exec(`
    INSERT INTO polyps (species, seed, color_key, pos_x, pos_y, pos_z, quat_x, quat_y, quat_z, quat_w,
                        scale, created_at, device_hash, owner_hash, deleted)
      VALUES ('branching', 1, 'coral-pink', 0, 0, 0, 0, 0, 0, 1, 1, 1000, 'dev', 'own', 0),
             ('branching', 2, 'coral-pink', 0, 0, 0, 0, 0, 0, 1, 1, 2000, 'dev', NULL, 1);
    INSERT INTO sim_state (polyp_id, kind, params, created_at) VALUES (1, 'algae', '{}', 1500);
    INSERT INTO snapshots (taken_at, polyp_count, state_json) VALUES (3000, 1, '{"polyps":[]}');
    INSERT INTO tree_polyps (variant, seed, color_key, parent_id, attach_index, created_at)
      VALUES ('forked', 1, 'neon-cyan', NULL, 0, 1000), ('claw', 2, 'neon-cyan', 1, 2, 1100);
    INSERT INTO ecosystem_state (id, state_json, updated_at) VALUES (1, '{"bleaching":0.4}', 4000);
  `);
  raw.close();
  return path;
}

function roomIds(s: Storage, table: string): number[] {
  return (s.db.prepare(`SELECT room_id FROM ${table} ORDER BY id`).all() as Array<{ room_id: number }>)
    .map((r) => r.room_id);
}

test('006: fresh db has the main room, room_id columns defaulting to 1, and an empty ecosystem v2', () => {
  const storage = new Storage(':memory:');
  assert.deepEqual(storage.db.prepare('SELECT id, slug, archived_at FROM rooms').all(), [
    { id: 1, slug: 'main', archived_at: null },
  ]);
  const reef = new ReefDb(storage);
  const tree = new TreeDb(storage);
  const p = reef.insertPolyp({
    species: 'branching', seed: 1, colorKey: 'coral-pink', position: [0, 0, 0],
    orientation: [0, 0, 0, 1], scale: 1, createdAt: Date.now(), deviceHash: 'dev',
  });
  reef.insertSim({ polypId: p.id, kind: 'algae', params: {}, createdAt: Date.now() });
  reef.insertSnapshot(1, '{}');
  tree.insertRoot({ variant: 'forked', seed: 1, colorKey: 'neon-cyan' });
  for (const t of ['polyps', 'sim_state', 'snapshots', 'tree_polyps']) assert.deepEqual(roomIds(storage, t), [1], t);
  assert.equal(reef.getEcosystem(), null);
  assert.deepEqual(Object.values(storage.orphanRoomRows()), [0, 0, 0, 0, 0]);
});

test('006: an existing db keeps every row, all in main, with the ecosystem row carried over', () => {
  const path = preRoomsFile();
  const storage = new Storage(path);
  const reef = new ReefDb(storage);
  const tree = new TreeDb(storage);

  assert.ok((storage.db.prepare("SELECT 1 FROM schema_migrations WHERE filename = '006_rooms.sql'").get()));
  assert.deepEqual(roomIds(storage, 'polyps'), [1, 1]);
  assert.deepEqual(roomIds(storage, 'sim_state'), [1]);
  assert.deepEqual(roomIds(storage, 'snapshots'), [1]);
  assert.deepEqual(roomIds(storage, 'tree_polyps'), [1, 1]);
  // Same data through the repositories as before the migration.
  assert.equal(reef.listPublicPolyps().length, 1);
  assert.deepEqual(reef.listOwnedIds('own'), [1]);
  assert.equal(reef.listSnapshots().length, 1);
  assert.equal(tree.listLive().length, 2);
  assert.deepEqual(reef.getEcosystem(), { bleaching: 0.4 });
  assert.deepEqual(Object.values(storage.orphanRoomRows()), [0, 0, 0, 0, 0]);
  const indexes = (storage.db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all() as Array<{ name: string }>)
    .map((r) => r.name);
  for (const i of ['idx_polyps_room_live', 'idx_polyps_room_device', 'idx_polyps_room_owner',
    'idx_sim_room_created', 'idx_snapshots_room', 'idx_tree_room_live', 'idx_polyps_device']) {
    assert.ok(indexes.includes(i), i);
  }
  storage.db.close();

  // Re-opening applies nothing twice.
  const again = new Storage(path);
  assert.equal((again.db.prepare('SELECT COUNT(*) AS n FROM rooms').get() as { n: number }).n, 1);
  assert.equal((again.db.prepare('SELECT COUNT(*) AS n FROM ecosystem_state_v2').get() as { n: number }).n, 1);
});

test('006: the migrated file still serves the pre-rooms code paths (rollback)', () => {
  const storage = new Storage(preRoomsFile());
  new ReefDb(storage).saveEcosystem({
    version: 1, computedAt: 9000, polypCount: 1, plantedLast7d: 0, daysSinceLastPlant: 1,
    bleaching: 0.1, fishCount: 3, phase: 'thriving',
  });
  const db = storage.db;
  // Statements the pre-rooms ReefDb prepares at boot: the old ecosystem table
  // is kept (stale) and explicit-column inserts still work without room_id.
  assert.deepEqual(db.prepare('SELECT state_json AS s FROM ecosystem_state WHERE id = 1').get(), { s: '{"bleaching":0.4}' });
  db.prepare(`INSERT INTO polyps (species, seed, color_key, pos_x, pos_y, pos_z, quat_x, quat_y, quat_z, quat_w,
      scale, created_at, device_hash, owner_hash, deleted) VALUES ('branching', 3, 'c', 0, 0, 0, 0, 0, 0, 1, 1, 5000, 'd', NULL, 0)`).run();
  db.prepare('INSERT INTO snapshots (taken_at, polyp_count, state_json) VALUES (?, ?, ?)').run(6000, 2, '{}');
  assert.deepEqual(roomIds(storage, 'polyps'), [1, 1, 1]);
});

test('006: orphanRoomRows reports rows pointing at a missing room', () => {
  const storage = new Storage(':memory:');
  storage.db.prepare(`INSERT INTO tree_polyps (variant, seed, color_key, parent_id, attach_index, created_at, room_id)
    VALUES ('forked', 1, 'c', NULL, 0, 1, 99)`).run();
  assert.equal(storage.orphanRoomRows().tree_polyps, 1);
  assert.equal(storage.orphanRoomRows().polyps, 0);
});

test('006: roll-forward after a rollback adopts the newer legacy ecosystem row', () => {
  const path = preRoomsFile();
  const eco = (computedAt: number, bleaching: number) => ({
    version: 1 as const, computedAt, polypCount: 1, plantedLast7d: 0, daysSinceLastPlant: 1,
    bleaching, fishCount: 3, phase: 'thriving' as const,
  });
  const s1 = new Storage(path);
  new ReefDb(s1).saveEcosystem(eco(9000, 0.1));
  // The rolled-back (pre-rooms) server ticks into the legacy table only.
  s1.db.prepare('UPDATE ecosystem_state SET state_json = ?, updated_at = ? WHERE id = 1')
    .run(JSON.stringify(eco(20000, 0.3)), 20000);
  s1.db.close();

  const s2 = new Storage(path);
  assert.equal(new ReefDb(s2).getEcosystem()!.computedAt, 20000);
  // Once v2 is newer again, the stale legacy row never wins.
  new ReefDb(s2).saveEcosystem(eco(30000, 0.2));
  s2.db.close();
  const s3 = new Storage(path);
  assert.equal(new ReefDb(s3).getEcosystem()!.computedAt, 30000);
  // Runbook "reset to healthy" deletes the v2 row; a restart must not revive the legacy one.
  s3.db.prepare('DELETE FROM ecosystem_state_v2 WHERE room_id = 1').run();
  s3.db.close();
  assert.equal(new ReefDb(new Storage(path)).getEcosystem(), null);
});

test('storage: the orphan check runs only on a boot that applied a migration', (t) => {
  const path = join(mkdtempSync(join(tmpdir(), 'reef-orphan-')), 'reef.db');
  const s1 = new Storage(path);
  s1.db.prepare(`INSERT INTO snapshots (taken_at, polyp_count, state_json, room_id) VALUES (1, 0, '{}', 42)`).run();
  s1.db.close();
  const errors = t.mock.method(console, 'error', () => {});

  new Storage(path).db.close();
  assert.equal(errors.mock.callCount(), 0, 'no migration applied, no scan');

  // Un-record an idempotent (IF NOT EXISTS) file so the next boot applies one.
  const raw = new Database(path);
  raw.prepare("DELETE FROM schema_migrations WHERE filename = '005_ecosystem_state.sql'").run();
  raw.close();
  new Storage(path).db.close();
  assert.equal(errors.mock.callCount(), 1);
  assert.match(String(errors.mock.calls[0]!.arguments[0]), /missing room/);
});
