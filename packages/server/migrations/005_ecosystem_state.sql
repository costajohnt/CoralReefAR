-- packages/server/migrations/005_ecosystem_state.sql
--
-- Reef-wide ecosystem state (#117): one row, rewritten by each sim tick.
-- Kept apart from polyps so polyp rows stay immutable (the timelapse diff and
-- snapshots rely on that). Lives in the same SQLite file, so Litestream
-- replicates it with everything else.

CREATE TABLE IF NOT EXISTS ecosystem_state (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  state_json  TEXT    NOT NULL,
  updated_at  INTEGER NOT NULL
);
