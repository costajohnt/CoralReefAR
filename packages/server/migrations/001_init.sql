CREATE TABLE IF NOT EXISTS polyps (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  species      TEXT NOT NULL,
  seed         INTEGER NOT NULL,
  color_key    TEXT NOT NULL,
  pos_x        REAL NOT NULL,
  pos_y        REAL NOT NULL,
  pos_z        REAL NOT NULL,
  quat_x       REAL NOT NULL,
  quat_y       REAL NOT NULL,
  quat_z       REAL NOT NULL,
  quat_w       REAL NOT NULL,
  scale        REAL NOT NULL DEFAULT 1.0,
  created_at   INTEGER NOT NULL,
  device_hash  TEXT NOT NULL,
  deleted      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sim_state (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  polyp_id     INTEGER NOT NULL,
  kind         TEXT NOT NULL,
  params       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  FOREIGN KEY (polyp_id) REFERENCES polyps(id)
);

CREATE TABLE IF NOT EXISTS snapshots (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  taken_at     INTEGER NOT NULL,
  polyp_count  INTEGER NOT NULL,
  state_json   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_polyps_created ON polyps(created_at);
CREATE INDEX IF NOT EXISTS idx_polyps_device  ON polyps(device_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_sim_polyp      ON sim_state(polyp_id);
