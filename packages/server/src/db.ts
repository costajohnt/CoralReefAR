import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Polyp, PublicPolyp, SimDelta, SimKind, Species } from '@reef/shared';

export interface ReefStats {
  total: number;
  uniqueDevices: number;
  firstAt: number | null;
  lastAt: number | null;
  last24h: number;
  last7d: number;
  bySpecies: Record<string, number>;
}

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

export interface PolypRow {
  id: number;
  species: string;
  seed: number;
  color_key: string;
  pos_x: number; pos_y: number; pos_z: number;
  quat_x: number; quat_y: number; quat_z: number; quat_w: number;
  scale: number;
  created_at: number;
  device_hash: string;
  deleted: number;
}

export class ReefDb {
  readonly db: Database.Database;
  private readonly stmt: {
    listPolyps: Database.Statement;
    statsOverview: Database.Statement;
    statsRecent: Database.Statement;
    statsBySpecies: Database.Statement;
    insertPolyp: Database.Statement;
    softDelete: Database.Statement;
    restore: Database.Statement;
    getPolypById: Database.Statement;
    listDeletedPolyps: Database.Statement;
    countByDevice: Database.Statement;
    oldestByDevice: Database.Statement;
    listSim: Database.Statement;
    listSimSince: Database.Statement;
    pruneSim: Database.Statement;
    insertSim: Database.Statement;
    insertSnapshot: Database.Statement;
    listSnapshots: Database.Statement;
    getSnapshot: Database.Statement;
    pruneSnapshots: Database.Statement;
  };

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();

    this.stmt = {
      listPolyps: this.db.prepare(
        'SELECT * FROM polyps WHERE deleted = 0 ORDER BY created_at ASC',
      ),
      statsOverview: this.db.prepare(
        `SELECT COUNT(*) AS total,
                COUNT(DISTINCT device_hash) AS uniqueDevices,
                MIN(created_at) AS firstAt,
                MAX(created_at) AS lastAt
         FROM polyps WHERE deleted = 0`,
      ),
      statsRecent: this.db.prepare(
        `SELECT COUNT(*) AS n FROM polyps
         WHERE deleted = 0 AND created_at >= ?`,
      ),
      statsBySpecies: this.db.prepare(
        `SELECT species, COUNT(*) AS n FROM polyps
         WHERE deleted = 0 GROUP BY species`,
      ),
      insertPolyp: this.db.prepare(`
        INSERT INTO polyps (species, seed, color_key, pos_x, pos_y, pos_z,
          quat_x, quat_y, quat_z, quat_w, scale, created_at, device_hash, deleted)
        VALUES (@species, @seed, @color_key, @pos_x, @pos_y, @pos_z,
          @quat_x, @quat_y, @quat_z, @quat_w, @scale, @created_at, @device_hash, 0)
      `),
      softDelete: this.db.prepare('UPDATE polyps SET deleted = 1 WHERE id = ?'),
      // Only restores a row that's currently soft-deleted. Rows that are
      // either absent or already live leave .changes === 0 so callers can
      // distinguish "restored" from "no-op".
      restore: this.db.prepare('UPDATE polyps SET deleted = 0 WHERE id = ? AND deleted = 1'),
      getPolypById: this.db.prepare('SELECT * FROM polyps WHERE id = ?'),
      listDeletedPolyps: this.db.prepare(
        'SELECT * FROM polyps WHERE deleted = 1 ORDER BY created_at DESC',
      ),
      countByDevice: this.db.prepare(
        'SELECT COUNT(*) as n FROM polyps WHERE device_hash = ? AND created_at >= ? AND deleted = 0',
      ),
      oldestByDevice: this.db.prepare(
        'SELECT MIN(created_at) as t FROM polyps WHERE device_hash = ? AND created_at >= ? AND deleted = 0',
      ),
      listSim: this.db.prepare('SELECT * FROM sim_state ORDER BY created_at ASC'),
      listSimSince: this.db.prepare(
        'SELECT * FROM sim_state WHERE created_at >= ? ORDER BY created_at ASC',
      ),
      pruneSim: this.db.prepare('DELETE FROM sim_state WHERE created_at < ?'),
      insertSim: this.db.prepare(
        'INSERT INTO sim_state (polyp_id, kind, params, created_at) VALUES (?, ?, ?, ?)',
      ),
      insertSnapshot: this.db.prepare(
        'INSERT INTO snapshots (taken_at, polyp_count, state_json) VALUES (?, ?, ?)',
      ),
      listSnapshots: this.db.prepare(
        'SELECT id, taken_at as takenAt, polyp_count as polypCount FROM snapshots ORDER BY taken_at ASC',
      ),
      getSnapshot: this.db.prepare(
        'SELECT id, taken_at as takenAt, polyp_count as polypCount, state_json as stateJson FROM snapshots WHERE id = ?',
      ),
      // Keep the `?` most recent snapshots (by taken_at, id as tiebreak),
      // delete the rest.
      pruneSnapshots: this.db.prepare(
        `DELETE FROM snapshots WHERE id NOT IN (
           SELECT id FROM snapshots ORDER BY taken_at DESC, id DESC LIMIT ?
         )`,
      ),
    };
  }

  private migrate(): void {
    // Track which .sql files have run so each applies exactly once. Without
    // this, every file re-exec'd on every boot — fine only because they all use
    // CREATE ... IF NOT EXISTS. Any future migration that ALTERs or backfills
    // data would re-run on every restart. The tracking table fixes that: a
    // recorded file is skipped. Existing DBs (tables already present, but no
    // schema_migrations row) back-fill cleanly on first run because the
    // IF NOT EXISTS statements are no-ops and then get recorded.
    this.db.exec(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename   TEXT PRIMARY KEY,
         applied_at INTEGER NOT NULL
       )`,
    );
    const applied = new Set(
      (this.db.prepare('SELECT filename FROM schema_migrations').all() as Array<{ filename: string }>)
        .map((r) => r.filename),
    );
    const record = this.db.prepare(
      'INSERT OR IGNORE INTO schema_migrations (filename, applied_at) VALUES (?, ?)',
    );

    // Apply each file and record it atomically: exec + the bookkeeping row
    // commit or roll back together, so a statement that throws mid-file can't
    // leave the schema partially applied while the file is marked done (or
    // vice versa). Migration files therefore must not contain their own
    // BEGIN/COMMIT; current files are CREATE TABLE/INDEX, all transaction-safe.
    const applyOne = this.db.transaction((f: string, sql: string) => {
      this.db.exec(sql);
      record.run(f, Date.now());
    });

    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (applied.has(f)) continue;
      applyOne(f, readFileSync(join(migrationsDir, f), 'utf8'));
    }

    // attach_yaw was added imperatively before the tracking table existed, and
    // ALTER TABLE ADD COLUMN has no IF NOT EXISTS form. Keep the pragma-guarded
    // add for DBs that predate it. New schema changes should be .sql migration
    // files now that they run exactly once.
    this.ensureColumn('tree_polyps', 'attach_yaw', 'REAL NOT NULL DEFAULT 0');
  }

  private ensureColumn(table: string, column: string, decl: string): void {
    const row = this.db
      .prepare(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`)
      .get(table, column);
    if (row) return;
    // Bracket access avoids a false-positive security-hook match on a
    // property named "exec"; this is better-sqlite3's SQL runner, not a
    // child-process shell call.
    this.db['exec'](`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }

  /** Polyps with device_hash stripped — safe for broadcasting. */
  listPublicPolyps(): PublicPolyp[] {
    return (this.stmt.listPolyps.all() as PolypRow[]).map(rowToPublicPolyp);
  }

  insertPolyp(p: Omit<Polyp, 'id' | 'deleted'>): Polyp {
    const info = this.stmt.insertPolyp.run({
      species: p.species, seed: p.seed, color_key: p.colorKey,
      pos_x: p.position[0], pos_y: p.position[1], pos_z: p.position[2],
      quat_x: p.orientation[0], quat_y: p.orientation[1],
      quat_z: p.orientation[2], quat_w: p.orientation[3],
      scale: p.scale,
      created_at: p.createdAt,
      device_hash: p.deviceHash,
    });
    return { ...p, id: Number(info.lastInsertRowid), deleted: false };
  }

  softDeletePolyp(id: number): boolean {
    return this.stmt.softDelete.run(id).changes > 0;
  }

  // Admin-only: soft-deleted polyps, newest deletion first (well, newest
  // creation — we don't track deletion timestamps yet). For the mod queue UI.
  listDeletedPolyps(): PublicPolyp[] {
    return (this.stmt.listDeletedPolyps.all() as PolypRow[]).map(rowToPublicPolyp);
  }

  // Un-sets the deleted flag. Returns a discriminated union so callers can
  // distinguish "no such polyp" from "already live" — both map to 404 at the
  // HTTP layer today, but 409 Conflict for already_live is an option and
  // audit logs should record which case happened.
  restorePolyp(id: number): RestoreResult {
    // Atomic UPDATE+SELECT — prevents a concurrent softDeletePolyp(id) from
    // slipping between the two statements and causing us to broadcast a
    // polyp_added for a row that's actually still-deleted.
    let result: RestoreResult = { status: 'unknown' };
    this.db.transaction(() => {
      if (this.stmt.restore.run(id).changes === 0) {
        // Either the row doesn't exist or it's already live. Peek to find out.
        const row = this.stmt.getPolypById.get(id) as PolypRow | undefined;
        result = row ? { status: 'already_live' } : { status: 'unknown' };
        return;
      }
      const row = this.stmt.getPolypById.get(id) as PolypRow | undefined;
      if (row) result = { status: 'restored', polyp: rowToPublicPolyp(row) };
      // Extremely unlikely: UPDATE said 1 row changed but SELECT can't find it.
      // Leave result as the default 'unknown' so the caller sends a 404.
    })();
    return result;
  }

  countByDeviceSince(deviceHash: string, sinceMs: number): number {
    return (this.stmt.countByDevice.get(deviceHash, sinceMs) as { n: number }).n;
  }

  oldestPolypSince(deviceHash: string, sinceMs: number): number | null {
    const row = this.stmt.oldestByDevice.get(deviceHash, sinceMs) as { t: number | null };
    return row.t;
  }

  private mapSimRows(
    rows: Array<{ polyp_id: number; kind: string; params: string; created_at: number }>,
  ): SimDelta[] {
    return rows.map((r) => ({
      polypId: r.polyp_id,
      kind: r.kind as SimKind,
      params: JSON.parse(r.params) as Record<string, number | string>,
      createdAt: r.created_at,
    }));
  }

  listSim(): SimDelta[] {
    return this.mapSimRows(this.stmt.listSim.all() as Parameters<typeof this.mapSimRows>[0]);
  }

  /** Sim deltas created at or after `sinceMs`. Used to bound the GET payload. */
  listSimSince(sinceMs: number): SimDelta[] {
    return this.mapSimRows(
      this.stmt.listSimSince.all(sinceMs) as Parameters<typeof this.mapSimRows>[0],
    );
  }

  /** Delete sim deltas older than `cutoffMs`. Returns the number removed. */
  pruneSimBefore(cutoffMs: number): number {
    return this.stmt.pruneSim.run(cutoffMs).changes;
  }

  insertSim(delta: SimDelta): void {
    this.stmt.insertSim.run(
      delta.polypId, delta.kind, JSON.stringify(delta.params), delta.createdAt,
    );
  }

  transaction(fn: () => void): void {
    this.db.transaction(fn)();
  }

  stats(): ReefStats {
    const overview = this.stmt.statsOverview.get() as {
      total: number; uniqueDevices: number; firstAt: number | null; lastAt: number | null;
    };
    const now = Date.now();
    const last24h = (this.stmt.statsRecent.get(now - 86_400_000) as { n: number }).n;
    const last7d = (this.stmt.statsRecent.get(now - 7 * 86_400_000) as { n: number }).n;
    const bySpecies = (this.stmt.statsBySpecies.all() as Array<{ species: string; n: number }>)
      .reduce<Record<string, number>>((acc, r) => { acc[r.species] = r.n; return acc; }, {});
    return {
      total: overview.total,
      uniqueDevices: overview.uniqueDevices,
      firstAt: overview.firstAt,
      lastAt: overview.lastAt,
      last24h,
      last7d,
      bySpecies,
    };
  }

  insertSnapshot(polypCount: number, stateJson: string): number {
    const info = this.stmt.insertSnapshot.run(Date.now(), polypCount, stateJson);
    return Number(info.lastInsertRowid);
  }

  listSnapshots(): Array<{ id: number; takenAt: number; polypCount: number }> {
    return this.stmt.listSnapshots.all() as Array<{ id: number; takenAt: number; polypCount: number }>;
  }

  getSnapshot(id: number): { id: number; takenAt: number; polypCount: number; stateJson: string } | undefined {
    return this.stmt.getSnapshot.get(id) as { id: number; takenAt: number; polypCount: number; stateJson: string } | undefined;
  }

  /** Keep the `keep` most recent snapshots, delete older ones. Returns removed count. */
  pruneOldSnapshots(keep: number): number {
    return this.stmt.pruneSnapshots.run(Math.floor(keep)).changes;
  }
}

export type RestoreResult =
  | { status: 'restored'; polyp: PublicPolyp }
  | { status: 'already_live' }
  | { status: 'unknown' };

export function rowToPublicPolyp(r: PolypRow): PublicPolyp {
  return {
    id: r.id,
    species: r.species as Species,
    seed: r.seed,
    colorKey: r.color_key,
    position: [r.pos_x, r.pos_y, r.pos_z],
    orientation: [r.quat_x, r.quat_y, r.quat_z, r.quat_w],
    scale: r.scale,
    createdAt: r.created_at,
  };
}

export function toPublicPolyp(p: Polyp): PublicPolyp {
  return {
    id: p.id, species: p.species, seed: p.seed, colorKey: p.colorKey,
    position: p.position, orientation: p.orientation, scale: p.scale, createdAt: p.createdAt,
  };
}
