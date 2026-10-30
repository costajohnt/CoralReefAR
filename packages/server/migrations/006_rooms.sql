-- packages/server/migrations/006_rooms.sql
--
-- Multi-reef rooms (#113), phase 2: schema only. Every existing row lands in
-- room 1 ('main') and all code paths still use room 1, so behaviour is
-- unchanged. Design: docs/superpowers/specs/2026-10-29-multi-reef-rooms-design.md
-- sections 3 and 7. No BEGIN/COMMIT: the runner wraps each file in one.

CREATE TABLE IF NOT EXISTS rooms (
  id           INTEGER PRIMARY KEY,
  slug         TEXT    NOT NULL UNIQUE,
  title        TEXT,
  created_at   INTEGER NOT NULL,
  archived_at  INTEGER,
  write_limit  INTEGER,
  created_by   TEXT
);
INSERT OR IGNORE INTO rooms (id, slug, title, created_at) VALUES (1, 'main', NULL, 0);

-- No REFERENCES rooms(id): with foreign_keys ON, SQLite refuses to add a
-- REFERENCES column with a non-NULL default. Integrity is app-level, checked
-- at startup by Storage.orphanRoomRows(). The DEFAULT backfills every
-- existing row into 'main' without copying the table.
ALTER TABLE polyps      ADD COLUMN room_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tree_polyps ADD COLUMN room_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE snapshots   ADD COLUMN room_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sim_state   ADD COLUMN room_id INTEGER NOT NULL DEFAULT 1;

-- Room-leading indexes. The old single-scope indexes stay until nothing
-- queries without room_id (a later migration drops them).
CREATE INDEX IF NOT EXISTS idx_polyps_room_live   ON polyps (room_id, created_at) WHERE deleted = 0;
CREATE INDEX IF NOT EXISTS idx_polyps_room_device ON polyps (room_id, device_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_polyps_room_owner  ON polyps (room_id, owner_hash, id) WHERE owner_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sim_room_created   ON sim_state (room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_room     ON snapshots (room_id, taken_at);
CREATE INDEX IF NOT EXISTS idx_tree_room_live     ON tree_polyps (room_id, created_at) WHERE deleted = 0;

-- Per-room ecosystem state. ecosystem_state can't gain a room column (its
-- key is CHECK (id = 1)), so copy its one row into v2 as room 1. The old
-- table is deliberately kept: pre-rooms code prepares a SELECT on it at
-- startup, so dropping it here would stop a rolled-back server from booting.
-- It goes stale from here on and is dropped in a later migration.
CREATE TABLE IF NOT EXISTS ecosystem_state_v2 (
  room_id     INTEGER PRIMARY KEY,
  state_json  TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL
);
INSERT OR IGNORE INTO ecosystem_state_v2 (room_id, state_json, updated_at)
  SELECT 1, state_json, updated_at FROM ecosystem_state WHERE id = 1;
