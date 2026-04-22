-- packages/server/migrations/003_tree_polyps.sql

CREATE TABLE IF NOT EXISTS tree_polyps (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  variant       TEXT NOT NULL,            -- forked / trident / starburst / claw / wishbone
  seed          INTEGER NOT NULL,
  color_key     TEXT NOT NULL,
  parent_id     INTEGER,                  -- NULL for root
  attach_index  INTEGER NOT NULL,         -- which tip of parent this piece claims (0..3)
  created_at    INTEGER NOT NULL,
  device_hash   TEXT,
  deleted       INTEGER NOT NULL DEFAULT 0,

  FOREIGN KEY (parent_id) REFERENCES tree_polyps(id),

  -- A given parent's attach slot is consumed by at most one live child.
  -- Partial unique index so soft-deleted rows don't block re-use.
  CHECK (attach_index BETWEEN 0 AND 3)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tree_polyps_parent_attach_live
  ON tree_polyps (parent_id, attach_index) WHERE deleted = 0;

CREATE INDEX IF NOT EXISTS idx_tree_polyps_live
  ON tree_polyps (deleted, created_at) WHERE deleted = 0;

CREATE INDEX IF NOT EXISTS idx_tree_polyps_parent
  ON tree_polyps (parent_id) WHERE deleted = 0;
