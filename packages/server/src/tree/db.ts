import Database from 'better-sqlite3';
import type { ReefDb } from '../db.js';
import type { PublicTreePolyp, TreeVariant } from '@reef/shared';

export interface InsertRootInput {
  variant: TreeVariant;
  seed: number;
  colorKey: string;
  deviceHash?: string;
}

export interface InsertChildInput extends InsertRootInput {
  parentId: number;
  attachIndex: number;
  /** Radians around the parent attach-point normal. 0 = canonical orientation. */
  attachYaw?: number;
}

export interface SoftDeleteResult {
  ok: boolean;
  reason?: string;
}

export class TreeDb {
  private readonly db: Database.Database;
  private readonly stmt: {
    insert: Database.Statement;
    findParent: Database.Statement;
    findAttachClaimed: Database.Statement;
    listLive: Database.Statement;
    findById: Database.Statement;
    countLiveChildren: Database.Statement;
    softDelete: Database.Statement;
    hasAny: Database.Statement;
    softDeleteAll: Database.Statement;
  };

  // ReefDb owns the underlying sqlite handle. Share it so migrations run once
  // and tree + landscape data live in the same file.
  constructor(reef: ReefDb) {
    this.db = reef.db;

    this.stmt = {
      insert: this.db.prepare(
        `INSERT INTO tree_polyps (variant, seed, color_key, parent_id, attach_index, attach_yaw, created_at, device_hash)
         VALUES (@variant, @seed, @colorKey, @parentId, @attachIndex, @attachYaw, @createdAt, @deviceHash)`,
      ),
      findParent: this.db.prepare(
        'SELECT id FROM tree_polyps WHERE id = ? AND deleted = 0',
      ),
      findAttachClaimed: this.db.prepare(
        'SELECT id FROM tree_polyps WHERE parent_id = ? AND attach_index = ? AND deleted = 0',
      ),
      listLive: this.db.prepare(
        'SELECT * FROM tree_polyps WHERE deleted = 0 ORDER BY created_at ASC',
      ),
      findById: this.db.prepare(
        'SELECT * FROM tree_polyps WHERE id = ? AND deleted = 0',
      ),
      countLiveChildren: this.db.prepare(
        'SELECT COUNT(*) AS n FROM tree_polyps WHERE parent_id = ? AND deleted = 0',
      ),
      softDelete: this.db.prepare(
        'UPDATE tree_polyps SET deleted = 1 WHERE id = ? AND deleted = 0',
      ),
      hasAny: this.db.prepare(
        'SELECT 1 FROM tree_polyps WHERE deleted = 0 LIMIT 1',
      ),
      softDeleteAll: this.db.prepare(
        'UPDATE tree_polyps SET deleted = 1 WHERE deleted = 0',
      ),
    };
  }

  /**
   * Soft-delete every live polyp. Used by the reset endpoint so visitors can
   * wipe the tree and start over. Soft-delete (rather than hard DELETE) keeps
   * history in the DB; the partial unique index on (parent_id, attach_index)
   * frees the slots so a fresh root can be inserted immediately after.
   */
  deleteAll(): void {
    this.stmt.softDeleteAll.run();
  }

  insertRoot(input: InsertRootInput): PublicTreePolyp {
    const createdAt = Date.now();
    const row = this.stmt.insert.run({
      variant: input.variant,
      seed: input.seed,
      colorKey: input.colorKey,
      parentId: null,
      attachIndex: 0,
      attachYaw: 0,
      createdAt,
      deviceHash: input.deviceHash ?? null,
    });
    return this.toPublic(this.stmt.findById.get(Number(row.lastInsertRowid)) as DbRow);
  }

  insertChild(input: InsertChildInput): PublicTreePolyp {
    const parent = this.stmt.findParent.get(input.parentId);
    if (!parent) throw new Error(`parent not found (id=${input.parentId})`);
    const claimed = this.stmt.findAttachClaimed.get(input.parentId, input.attachIndex);
    if (claimed) {
      throw new Error(`attach index ${input.attachIndex} already claimed on parent ${input.parentId}`);
    }
    const createdAt = Date.now();
    const row = this.stmt.insert.run({
      variant: input.variant,
      seed: input.seed,
      colorKey: input.colorKey,
      parentId: input.parentId,
      attachIndex: input.attachIndex,
      attachYaw: input.attachYaw ?? 0,
      createdAt,
      deviceHash: input.deviceHash ?? null,
    });
    return this.toPublic(this.stmt.findById.get(Number(row.lastInsertRowid)) as DbRow);
  }

  listLive(): PublicTreePolyp[] {
    const rows = this.stmt.listLive.all() as DbRow[];
    return rows.map((r) => this.toPublic(r));
  }

  getById(id: number): PublicTreePolyp | null {
    const row = this.stmt.findById.get(id) as DbRow | undefined;
    return row ? this.toPublic(row) : null;
  }

  softDelete(id: number): SoftDeleteResult {
    const row = this.stmt.findById.get(id);
    if (!row) return { ok: false, reason: 'not_found' };
    const children = this.stmt.countLiveChildren.get(id) as { n: number };
    if (children.n > 0) return { ok: false, reason: 'has children' };
    this.stmt.softDelete.run(id);
    return { ok: true };
  }

  hasAnyLive(): boolean {
    return !!this.stmt.hasAny.get();
  }

  private toPublic(row: DbRow): PublicTreePolyp {
    return {
      id: row.id,
      variant: row.variant as TreeVariant,
      seed: row.seed,
      colorKey: row.color_key,
      parentId: row.parent_id,
      attachIndex: row.attach_index,
      attachYaw: row.attach_yaw ?? 0,
      createdAt: row.created_at,
    };
  }
}

interface DbRow {
  id: number;
  variant: string;
  seed: number;
  color_key: string;
  parent_id: number | null;
  attach_index: number;
  attach_yaw: number | null;
  created_at: number;
  device_hash: string | null;
  deleted: number;
}
