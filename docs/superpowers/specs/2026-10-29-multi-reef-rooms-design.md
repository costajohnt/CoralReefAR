# Multi-Reef Rooms: Design

**Status:** proposed, awaiting decisions (no implementation yet)
**Date:** 2026-10-29
**Issue:** #113
**Decision owner:** John Costa

## Summary

Today a deployment has exactly one landscape reef and one tree. Parallel
demos, installations and playtests all write into the same state. This doc
proposes **rooms**: independent reefs that share one server, one SQLite file
and one deploy, selected by a short slug. The existing reef becomes the
default room, `main`, and every current URL keeps working against it.

The data-model change is the part John needs to decide on, so this doc lists
the open product questions with options and a recommendation for each
(section 12), then a phased plan that doesn't change behaviour until those
answers are in.

## 1. Goals and non-goals

**Goals**
- Several independent reefs (landscape and tree) on one deployment.
- Zero change for existing users: no-room URLs, API paths and WS paths map to
  `main` permanently.
- Each room has its own snapshots, timelapse, ecosystem, gallery, GLB export,
  WebSocket broadcasts and "my polyps".
- Room creation can't be used to fill the disk or squat names.
- Fix the TreeDb/ReefDb coupling flagged in the audit (TreeDb reads
  `reef.db`, ReefDb's raw handle) as part of the same change.

**Non-goals (v1)**
- Accounts, room ownership by visitors, private/password rooms.
- Per-room theming (palette, pedestal size, species sets).
- Separate database files per room.
- Moving polyps between rooms.

## 2. Current state (what has to change)

Everything below is implicitly global today:

| Area | Today | Where |
|---|---|---|
| Landscape polyps | `polyps` table, no scope column | `migrations/001_init.sql` |
| Sim decorations | `sim_state` (FK to polyp) | `001_init.sql` |
| Snapshots | `snapshots` table, one daily worker | `001_init.sql`, `sim.ts` |
| Tree | `tree_polyps`; partial unique index on `(parent_id, attach_index)` | `003_tree_polyps.sql` |
| Owner provenance | `polyps.owner_hash` + `idx_polyps_owner` | `004_polyp_owner.sql` |
| Ecosystem | single row, `id INTEGER PRIMARY KEY CHECK (id = 1)` | `005_ecosystem_state.sql` |
| HTTP | `/api/reef*`, `/api/tree*`, `/api/snapshots*`, `/api/stats`, `/api/admin/*`, `/metrics` | `routes/*.ts`, `tree/routes.ts` |
| WebSocket | `/ws` and `/ws/tree`, one `Hub` each | `index.ts` |
| Write limit | per device hash, counted over live rows | `routes/reef.ts`, `tree/routes.ts` |
| Clients | `index`, `playground` (+ gallery), `quest`, `preview`, `timelapse`, `tree`, `treeAr` | `packages/client/*.html` |
| Storage | one SQLite file at `DB_PATH`, replicated by Litestream | `fly.toml`, `infra/litestream.yml` |

## 3. Schema

### 3.1 `rooms` table (new)

```sql
CREATE TABLE IF NOT EXISTS rooms (
  id           INTEGER PRIMARY KEY,
  slug         TEXT    NOT NULL UNIQUE,      -- ^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$
  title        TEXT,                         -- optional display name
  created_at   INTEGER NOT NULL,
  archived_at  INTEGER,                      -- NULL = live; set = read-only
  write_limit  INTEGER,                      -- per-room override of RATE_LIMIT_MAX (NULL = global)
  created_by   TEXT                          -- 'admin' or a hashed creator id (see section 10)
);
INSERT OR IGNORE INTO rooms (id, slug, title, created_at) VALUES (1, 'main', NULL, 0);
```

An integer `id` is stored on every row (4-8 bytes, cheap joins). The slug
appears only in URLs and the `rooms` table, so renaming a room is a one-row
update.

### 3.2 `room_id` on existing tables

`polyps`, `tree_polyps`, `snapshots` and `sim_state` each gain
`room_id INTEGER NOT NULL DEFAULT 1`. The default backfills every existing
row into `main` in the same statement.

**Foreign key: verified constraint.** The server runs with
`PRAGMA foreign_keys = ON`, and SQLite refuses
`ALTER TABLE ... ADD COLUMN room_id INTEGER NOT NULL DEFAULT 1 REFERENCES rooms(id)`
("Cannot add a REFERENCES column with non-NULL default value"; checked on
SQLite 3.53.4, the version better-sqlite3 bundles here). Options:

| Option | Cost | Integrity |
|---|---|---|
| A. Plain `ADD COLUMN` without `REFERENCES`; the app validates `room_id` (rooms are only created by trusted code, and rows only via room-scoped repositories) | One statement per table, instant, no copy | App-level |
| B. 12-step table rebuild (create new table with the FK, copy, drop, rename, recreate indexes) | Copies every row; long transaction on a big reef; must preserve AUTOINCREMENT sequences and partial indexes | DB-level |

**Recommendation: A.** Rows are only ever written through room-scoped code
paths, rooms are never hard-deleted in v1 (section 9), and a rebuild of
`polyps` inside a startup migration risks a slow first boot on the live
volume. Add a startup integrity check (`SELECT COUNT(*) FROM polyps WHERE
room_id NOT IN (SELECT id FROM rooms)`) that logs loudly.

**Indexes** (replace or extend the existing ones so every hot query leads
with `room_id`):

```sql
CREATE INDEX IF NOT EXISTS idx_polyps_room_live    ON polyps (room_id, created_at) WHERE deleted = 0;
CREATE INDEX IF NOT EXISTS idx_polyps_room_device  ON polyps (room_id, device_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_polyps_room_owner   ON polyps (room_id, owner_hash, id) WHERE owner_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sim_room_created    ON sim_state (room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_snapshots_room      ON snapshots (room_id, taken_at);
CREATE INDEX IF NOT EXISTS idx_tree_room_live      ON tree_polyps (room_id, created_at) WHERE deleted = 0;
```

The tree's partial unique index on `(parent_id, attach_index) WHERE deleted = 0`
is already room-safe: a parent belongs to exactly one room, so its slots
can't collide across rooms. Inserts must check that the parent's `room_id`
matches the request's room (otherwise a crafted request could attach to
another room's tree).

`sim_state.room_id` is denormalised (it could be derived from `polyp_id`) so
that `GET /api/reef`'s bounded sim query and the retention prune stay single
index scans per room.

### 3.3 `ecosystem_state`

Its primary key is `id = 1` with a `CHECK`, so it can't simply gain a column.
Create `ecosystem_state_v2 (room_id INTEGER PRIMARY KEY, state_json TEXT NOT
NULL, updated_at INTEGER NOT NULL)` and copy the single row in as
`room_id = 1`. **Don't drop the old table in the same release.** Today's
`ReefDb` constructor prepares `SELECT ... FROM ecosystem_state`, so a code
rollback against a file where that table is gone would fail at boot. Leave
`ecosystem_state` in place (unused), and drop it in a later migration once
rollback past phase 2 is no longer needed. The sim tick steps each active
room's row (section 8).

### 3.4 Owner hashing ("my polyps", undo)

The owner token stays **per browser, not per room**. `owner_hash` is
server-side only (never returned), so per-room salting would add no privacy
and would break "my polyps" for someone who plants in two rooms.
`/api/rooms/:slug/reef/mine` and undo filter by `room_id`. Undo's "most
recent polyp" rule becomes "most recent in this room", so planting in room A
doesn't revoke the undo window in room B.

`/api/stats.contributors` becomes per room (`COUNT(DISTINCT owner_hash)
WHERE room_id = ?`). A deployment-wide total stays available to admins.

## 4. URLs and routing

Options:

| Option | Example | Pros | Cons |
|---|---|---|---|
| A. Query param everywhere | `/api/reef?room=demo`, `/playground.html?room=demo` | Smallest diff; matches the issue sketch | Easy to drop a param in one call and silently hit `main`; caches and logs key on the full URL |
| B. Path prefix for the API, query param for pages | `/api/rooms/demo/reef`, `/playground.html?room=demo` | Room is part of the resource, so it can't be lost; static HTML pages need no server routing | Two styles to learn |
| C. Path prefix for pages too | `/r/demo/playground` | Pretty share links | Needs SPA-style fallbacks for every entry page in Fastify static and the Vite dev server |
| D. Subdomain | `demo.reef.example` | Clean isolation | Wildcard DNS and TLS, CORS allowlist per room; overkill |

**Recommendation: B.** The API is `/api/rooms/:slug/...` for every
room-scoped route. The existing `/api/reef`, `/api/tree`, `/api/snapshots`,
`/api/stats` and the admin routes stay as permanent aliases for `main`,
implemented by the same handlers with `slug = 'main'`. Pages read `?room=`
(default `main`) and pass it through. A single `roomSlug()` helper in the
client builds every API and WS URL, so nothing hand-rolls paths.

Slug rules: lowercase `[a-z0-9-]`, 3 to 32 characters, no leading or trailing
hyphen, plus a reserved list (`main`, `admin`, `api`, `ws`, `static`,
`assets`, `new`) that can't be created. An unknown slug returns 404
`room_not_found`, and the client shows "This reef doesn't exist" instead of
silently falling back to `main`.

Cross-surface links carry the room. The gallery QR (`?plant=`), the GLB
filename, the timelapse filename, preview links and the Quest entry page all
include it.

## 5. WebSocket channel per room

Paths: `/ws?room=<slug>` and `/ws/tree?room=<slug>`, with no param meaning
`main`. (WS URLs carry no path parameters in the existing client helper, so a
query param keeps `defaultWsUrl()` simple. The server validates the slug at
upgrade and closes with code 4404 if the room doesn't exist.)

The server keeps a `Map<roomId, Hub>` per kind (reef and tree), created
lazily on the first connection and dropped when its last client leaves.
`hub.broadcast` calls become `hubs.for(roomId).broadcast(...)`, so a
`polyp_added` in `demo` never reaches `main`. The `hello` frame gains `room`
(the slug) so a client can assert it joined the room it asked for. That's an
optional field, so older clients' zod parsing ignores it.

Connection limits: `WS_MAX_CLIENTS` stays a **deployment-wide** cap (it
protects file descriptors and memory, which are shared). A new
`WS_MAX_CLIENTS_PER_ROOM` (default: the global cap / 4) stops one busy room
from starving the others. The heartbeat and reaping loop iterates all hubs.

## 6. Rate limits per room

| Limit | Today | Proposed scope |
|---|---|---|
| Per-device plant limit (`RATE_LIMIT_MAX`, `QUEST_RATE_LIMIT_MAX`) | per device, global | **Global per device by default**, with an optional per-room `rooms.write_limit` override |
| Per-IP read limit (`READ_RATE_LIMIT_PER_MIN`) | per IP | per IP, global (reads are cheap and room-agnostic) |
| Per-IP undo limit (`UNDO_RATE_LIMIT_PER_MIN`) | per IP | per IP, global |
| Read cache (`READ_CACHE_TTL_MS`) | one cache | one cache entry **per room** (a `Map` of `ttlCache`s keyed by room id, evicted with the hub) |

Why a global plant budget: per-room budgets let one device multiply its
write rate by hopping rooms, which defeats the limiter. Installations that
need a looser or tighter limit (a classroom room, a gallery kiosk) get an
admin-set `write_limit` on their room instead.

Counting stays "live rows for this device in the window". With a global
budget, the count query drops the room filter (it uses `idx_polyps_device`,
which stays). With a room override, it counts only that room's rows.

## 7. Migrating the existing reef to `main`

One migration file, `006_rooms.sql`, applied exactly once by the existing
`schema_migrations` runner. It contains no `BEGIN`/`COMMIT`, because the
runner wraps each file in a transaction:

1. `CREATE TABLE rooms` and insert `(1, 'main')`.
2. `ALTER TABLE polyps|tree_polyps|snapshots|sim_state ADD COLUMN room_id INTEGER NOT NULL DEFAULT 1`
   (metadata-only in SQLite; no row copy, so it's instant even on a large file).
3. Create the room-leading indexes from 3.2. The old single-column indexes can
   be dropped in a later migration once nothing queries without `room_id`.
4. Create `ecosystem_state_v2` keyed by `room_id` and copy the one row in.
   The old table is left in place (see 3.3 and Rollback below).

Behaviour after step 1 to 4 is identical: every row is in `main`, and every
legacy URL resolves to `main`. Old snapshot JSON blobs stay valid because
snapshots gain a column, not a format change.

**Rollback:** today's code names its insert columns explicitly and reads rows
with `SELECT *` (an extra column is harmless), so a code rollback keeps working
against the migrated file. Rows written in non-`main` rooms would then show up
in the single reef, so roll back only before any room other than `main` has
data. The old `ecosystem_state` table is still there (3.3), so a rolled-back
server boots and resumes from that row. The row is stale but valid, and the
24 h catch-up cap (runbook, "Reef ecosystem") bounds the jump.
Options for the old table:
(a) leave it stale (recommended; harmless), or
(b) keep mirroring `main`'s state into it until the drop migration
(double-write; not worth it).

## 8. Sim tick, ecosystem and snapshots per room

- **Sim decorations:** one pass per tick over all live polyps, as today, with
  `room_id` carried into each delta. Cost is linear in total polyps, not rooms
  (measured in #190: about 5 ms per tick at 5,000 polyps).
- **Ecosystem:** step each room that is live (not archived) and has at least
  one polyp. One aggregate query per room, so it's O(rooms + polyps). Each
  room gets its own bleaching and fish state, and broadcasts go only to that
  room's hub.
- **Snapshots:** the daily worker snapshots each room **whose state changed
  since its last snapshot** (`MAX(created_at)` or deletions newer than the
  last `taken_at`). Idle rooms don't pile up identical blobs.
  `SNAPSHOT_RETENTION_COUNT` applies per room.
- **Retention prune** for `sim_state` stays global (by `created_at`).

## 9. Room lifecycle

| Option | Behaviour |
|---|---|
| A. Rooms live forever | Simple; storage grows with abandoned rooms |
| B. Admin can archive: read-only, still viewable, excluded from sim and snapshots | Reversible; keeps history for timelapse and the devlog |
| C. Auto-archive after N days without planting | Low-maintenance for playtest rooms; surprising for installations |
| D. Hard delete | Frees space; irreversible; needs a cascade over four tables |

**Recommendation: B for v1**, with D as an admin-only, typed-confirmation
action later. Never auto-archive `main`. Option C can follow as an opt-in
per room (`auto_archive_days`) if playtest rooms pile up.

## 10. Abuse: room creation spam

Threats: creating thousands of rooms (disk, snapshot cost), squatting or
offensive slugs, using a room as an unmoderated space, and enumerating rooms.

| Option | Creation | Spam resistance | Friction |
|---|---|---|---|
| A. Admin-only (`ADMIN_TOKEN`), via `/admin` and `POST /api/admin/rooms` | Operator | Total | John creates each room (seconds) |
| B. Open creation, rate-limited (1 per IP per day, 3 per owner token per week), slug blocklist, auto-archive idle rooms | Anyone | Medium: VPN plus new token per room defeats it | None |
| C. Invite codes: admin mints single-use codes, anyone with a code creates a room | Code holders | High | Low |

**Recommendation: A for v1.** The stated use cases (parallel demos,
installations, playtests) are all operator-driven, and A has no new attack
surface. C is the natural next step if John wants visitors to make rooms.

Regardless of the creation option:
- **Rooms are unlisted.** There's no public `GET /api/rooms` list; only admin
  sees the index. A slug is a weak secret (good enough for a playtest, not for
  privacy), and the doc and UI say so.
- **Per-room caps:** `ROOM_MAX_POLYPS` (default 5,000) rejects plants beyond
  it with a clear 409, bounding storage and tick cost per room.
- **Global cap:** `MAX_ROOMS` (default 50) on creation.
- **Moderation:** the existing admin delete and restore gain a room filter.
  Archiving a room is the "turn it off" switch.

## 11. Litestream and storage impact

- **No config change.** Rooms live in the same SQLite file that
  `infra/litestream.yml` already replicates (`path: ${DB_PATH}`), so every
  room is backed up continuously like today.
- **Migration traffic:** the `006` migration is metadata-only `ADD COLUMN`
  plus index builds. Index creation writes WAL pages proportional to table
  size, which Litestream ships once; that's a one-off.
- **Restore granularity:** restore is still the whole file (all rooms at a
  point in time). Restoring one room means restoring to a scratch path and
  copying that room's rows across with SQL. The runbook gets a short recipe
  for this. Per-room files would allow per-room restore but need dynamic
  Litestream config and many WAL streams; that's rejected for this scale.
- **Growth:** dominated by snapshots (full-state JSON per room per day). With
  "only snapshot changed rooms" and per-room retention, worst case is
  `active rooms × SNAPSHOT_RETENTION_COUNT × blob size`. `ROOM_MAX_POLYPS`
  bounds the blob size.

## 12. Open product questions (decisions for John)

Each has a recommended default. Implementation can start from the defaults
and change any of them before phase 3 (section 15) without rework.

| # | Question | Options | Recommendation |
|---|---|---|---|
| Q1 | Who can create rooms? | Admin only / open with limits / invite codes (section 10) | **Admin only** for v1; invite codes later if wanted |
| Q2 | URL shape | `?room=` everywhere / API path prefix plus page `?room=` / `/r/:slug` pages / subdomains (section 4) | **`/api/rooms/:slug/...` plus page `?room=`**, legacy paths alias `main` forever |
| Q3 | Are rooms discoverable? | Public room list / unlisted (slug as weak secret) / password rooms | **Unlisted**; admin-only index; no password rooms in v1 |
| Q4 | Plant rate limit scope | Per device per room / per device global / global plus per-room override (section 6) | **Global per device, with per-room override** |
| Q5 | Does "my polyps" span rooms? | One owner token everywhere / per-room tokens | **One token**, results filtered by room (3.4) |
| Q6 | Room lifetime | Forever / admin archive / auto-archive idle / hard delete (section 9) | **Admin archive (read-only)**; hard delete later, admin-only |
| Q7 | Do rooms cover tree mode too? | Landscape only / landscape and tree | **Both**: same `room_id` column, and the storage refactor touches both anyway |
| Q8 | Default room slug | `main` / `default` / `lobby` | **`main`**; reserved; never archivable |
| Q9 | Per-room ecosystem and snapshots? | Shared / per room | **Per room**, skipping archived and idle rooms (section 8) |
| Q10 | Per-room size cap | None / `ROOM_MAX_POLYPS` | **5,000 per room** (bounds tick cost, snapshot size and abuse) |
| Q11 | Per-room customisation (palette, pedestal, title) | Now / later | **Title only now**; theming later |

## 13. Per-surface changes

| Surface | Change |
|---|---|
| AR app (`index.html`) | Reads `?room=`; all API and WS calls go through `roomSlug()`; the status line shows the room title when not `main` |
| Playground / gallery | `?room=`; the gallery counter uses per-room stats; the QR `?plant=` link includes `?room=<slug>` (it's same-origin, so it passes the #189 check) |
| Quest | `?room=` passed through `quest.html`; the persistent anchor key becomes per room so two rooms don't share an anchor |
| Timelapse | `/api/rooms/:slug/snapshots`; filename `reef-timelapse-<slug>-YYYY-MM-DD` (`main` keeps today's name) |
| GLB export | Exports the loaded room (it's client-side, so this is automatic); filename `coral-reef-<slug>-YYYY-MM-DD.glb` |
| Tree / Tree AR | `/api/rooms/:slug/tree...` and `/ws/tree?room=`; reset becomes per room (still admin-gated when a token is set) |
| Preview | Room-aware link |
| Admin page | Room picker; create, archive and rename rooms; delete and restore filtered by room |
| `/metrics` | Keep `reef_polyps_total` and `reef_ws_clients` as deployment totals. Add `reef_rooms_total` and `reef_rooms_active`. **No per-room labels by default** (cardinality); opt in with `METRICS_PER_ROOM=1` for small deployments |

## 14. Storage layer cleanup (the audit's TreeDb/ReefDb coupling)

Today `TreeDb` takes a `ReefDb` and reads its raw `db` handle, and migrations
live inside `ReefDb`. Rooms add a third concern (room lookup), so this is the
moment to fix it:

- A `Storage` module owns the `better-sqlite3` handle, pragmas and the
  migration runner.
- `RoomRepo` resolves slug to `{ id, archivedAt, writeLimit }`, cached in
  memory and invalidated on admin edits.
- `ReefDb` and `TreeDb` take `Storage` (not each other) and expose
  **room-scoped** methods (`forRoom(roomId)` returning a small object whose
  prepared statements all bind `room_id`). That makes it hard to write a query
  that forgets the room, which is the main correctness risk of this change.
- Route handlers resolve the room once (Fastify `preHandler` on the
  `/api/rooms/:slug` prefix and the legacy aliases), attach it to the request,
  and use `req.room` everywhere.

## 15. Phased plan

Each phase is its own PR and ships green with no user-visible change until
phase 3.

1. **Storage refactor** (section 14) with no schema change. Pure refactor,
   with existing tests as the safety net.
2. **Schema** (`006_rooms.sql`): rooms table, `room_id` columns, indexes,
   ecosystem v2. All code paths still use room 1. Add tests for the migration
   on a pre-006 file, the integrity check, and the ecosystem row carried over.
3. **Server room scoping:** `/api/rooms/:slug/*`, legacy aliases, per-room
   hubs, caches, sim, ecosystem and snapshots, limits and caps, admin room
   CRUD. Route tests for isolation (a write in room A is invisible in B over
   HTTP and WS), unknown slug, archived room read-only, alias equivalence, and
   cross-room tree attach rejected.
4. **Clients:** `roomSlug()` helper and `?room=` on every surface, plus room
   filenames and QR links. Client tests for URL building; a live check with
   two rooms open side by side.
5. **Ops:** runbook (room admin, single-room restore recipe), metrics,
   CHANGELOG.

## 16. Risks

- **A query that forgets `room_id`** leaks or mixes rooms. Mitigated by
  room-scoped repositories (section 14) and isolation tests per route.
- **Index builds on a large live file** at first boot of phase 2. A quick
  measurement for this doc (better-sqlite3 / SQLite 3.53.4, in-memory,
  200,000 rows on a MacBook Air): `ADD COLUMN ... DEFAULT 1` took 0.28 ms
  (metadata only), and the partial `(room_id, created_at)` index took 43.5 ms.
  Phase 2 re-measures against a file-backed copy of the production DB.
- **Slug as a secret** gives a false sense of privacy. The doc and admin UI
  say "unlisted, not private".
- **WS fan-out:** many small hubs is fine, but the per-room cap needs tuning
  for a single popular installation room. `WS_MAX_CLIENTS_PER_ROOM` is
  configurable.
