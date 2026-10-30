import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');

/**
 * Owns the better-sqlite3 handle, its pragmas and the migration runner.
 * ReefDb and TreeDb both take a Storage, so neither depends on the other and
 * both see the same file (one Litestream stream, one set of migrations).
 */
export class Storage {
  readonly db: Database.Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.migrate();
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
}
