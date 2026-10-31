# Operations runbook

Short operational notes for running the CoralReefAR server in production. The
canonical deployment config is `fly.toml`; this file explains the *why* and the
day-2 tuning.

## Production environment

Every protection ships **off by default in code** so local and hands-on testing
isn't throttled. Production turns them on via `fly.toml`'s `[env]` block (or the
container environment for a self-hosted deploy):

| Env var | Prod value | Effect |
|---|---|---|
| `RATE_LIMIT_WINDOW_MS` | `3600000` (1h) | Sliding window for the per-device write limit. |
| `RATE_LIMIT_MAX` | `1` | Polyps per visitor (owner token; UA|IP for tokenless clients) per window. Also bounds tree writes (UA|IP). `0` = off. |
| `RATE_LIMIT_IP_MAX` | `50` | Backstop: polyps per UA|IP per window across all owner tokens, so one device cannot mint tokens to dodge `RATE_LIMIT_MAX`. `0` = off. |
| `QUEST_RATE_LIMIT_MAX` | `0` | Looser bucket for `surface: "quest"` plants from a Quest Browser UA. `0` = same as `RATE_LIMIT_MAX`. |
| `READ_RATE_LIMIT_PER_MIN` | `300` | Per-IP token bucket on every `GET /api/*` (reef, stats, snapshots, tree); a whole venue behind one NAT shares it. `0` = off. |
| `TRUST_PROXY_HOPS` | `1` | Reverse-proxy hops whose `X-Forwarded-For` entry sets `req.ip`, which every rate limit keys on. Only private/loopback peers are trusted. `0` (code default) = socket address, header ignored. After a deploy, confirm the logged `remoteAddress` is the visitor's IP, not Fly's proxy. |
| `UNDO_RATE_LIMIT_PER_MIN` | `10` (default) | Per-IP token bucket on the owner undo route (`POST /api/reef/polyp/:id/undo`). `0` = off. |
| `READ_CACHE_TTL_MS` | `1000` | Coalesce read scans within this window. `0` = off. |
| `WS_MAX_CLIENTS` | `1000` (default) | Max concurrent WebSocket connections per hub (reef + tree counted separately). `0` = unlimited. |
| `PRESENCE_ENABLED` | unset (off) | `1` turns on Quest co-presence (#114): headsets opened with `quest.html?presence=1` send their head pose over `/ws` (5 Hz, reef-local, anonymous per-connection id) and see each other as clownfish. Memory only, never written to SQLite. Off until validated on headsets. |
| `PRESENCE_MAX_VISITORS` | `16` | Most other visitors one client is sent per presence frame (newest first). |
| `SIM_RETENTION_MS` | `2592000000` (30d, default) | Prune sim decorations older than this. `0` = keep all. |
| `SNAPSHOT_RETENTION_COUNT` | `90` (default) | Keep the N most recent daily snapshots. `0` = keep all. |
| `ADMIN_TOKEN` | secret | Gates the reef admin routes and (when set) the destructive tree reset/delete. |
| `OWNER_HASH_SECRET` | secret (optional) | HMAC key for the stored "my polyps" owner hash. Unset = salted SHA-256 (the client token is already a hash of a 256-bit random ID). Changing it later orphans existing ownership (highlights stop; nothing breaks). |
| `METRICS_TOKEN` | secret (optional) | When set, `GET /metrics` requires `Authorization: Bearer <token>`. |
| `CORS_ORIGINS` | the deployed origin | Comma-separated allowlist. **Required in production**: with `NODE_ENV=production` the server refuses to start if this is `*` or unset (fail-closed). `*` stays the convenient default in dev/test. |

Set the secrets out of band: `fly secrets set ADMIN_TOKEN=... METRICS_TOKEN=... CORS_ORIGINS=...`.

## Watching the rate limiter

`reef_rate_limited_total` (a counter at `GET /metrics`) increments once per
request rejected by either the write limit or the read limit, across the reef
and tree routes.

- **Healthy:** near-flat, occasional bumps. A handful per day is normal — a
  visitor double-tapping, a refresh storm, a scraper.
- **Climbing steadily:** the limits may be too tight for real usage. With
  `RATE_LIMIT_MAX=1/hour` a genuinely engaged visitor who wants to plant a
  second polyp is blocked; if you see sustained growth alongside organic
  traffic, widen the window or raise the max.
- **Spiking:** likely abuse (a bot hammering writes) or a misbehaving client.
  Check `reef_ws_clients` and the access logs; the cap (`WS_MAX_CLIENTS`) and
  the limits are doing their job.

After a few days of real traffic, compare `reef_rate_limited_total` growth
against `reef_polyps_total` growth and adjust `RATE_LIMIT_MAX` /
`RATE_LIMIT_WINDOW_MS` to taste. The 1-per-hour default is a hand-tuned starting
point, not a measured one.

## Known limitations (accepted for the installation context)

- The device key is `sha256(user-agent, ip, rotating-salt)`. A motivated
  attacker with a VPN and a second device bypasses the per-device write limit.
  Acceptable for a gallery/installation; for public-internet scale, add a
  CAPTCHA or proof-of-work in front of writes.
- The per-window salt is reconstructible (HMAC of a per-process secret), and
  the limiter counts a device under both the current and previous window's
  hash, so crossing a window boundary no longer resets the count.

## Reef ecosystem (sim tick)

Each sim tick (`SIM_INTERVAL_MS`, hourly by default) steps the reef-wide
ecosystem state (fish count, bleaching, phase) and stores it in
`ecosystem_state_v2`, one row per room (only `room_id = 1`, the `main` room,
until rooms are routed, #113). The older single-row `ecosystem_state` table is
left in place so a server rolled back past `006_rooms.sql` still boots; a
later migration drops it. A rolled-back server ticks into that old table only,
so on roll-forward the boot copies it into room 1's v2 row when it's newer,
and the reef resumes where the rolled-back server left it rather than
catching up from the pre-rollback state. Tunables are constants in
`packages/server/src/ecosystem.ts`. Polyps are never modified by it.

- **Downtime is capped at 24 hours of catch-up** (`MAX_CATCHUP_HOURS`). After
  a longer outage the first tick applies at most 24 h of bleaching change, and
  any decline beyond that is dropped by design. The reef shouldn't come back
  from a maintenance window looking abandoned, and later ticks continue
  normally from there.
- `computedAt` never moves backwards, so a host clock stepping back and then
  forward doesn't add time twice.
- **Reset to healthy:** `DELETE FROM ecosystem_state_v2 WHERE room_id = 1;`. The next tick starts
  from an unbleached state (it doesn't jump to the current stagnation level),
  and `GET /api/reef` serves a computed healthy state until then.

## Migration 006 (rooms) first boot

The first boot of a build that includes `006_rooms.sql` (#113) applies it
once, inside one transaction, before the server listens:

- The `ADD COLUMN room_id` statements only change table metadata; no rows are
  copied.
- The six new `room_id` indexes are built from scratch, which reads every row
  of `polyps`, `sim_state`, `snapshots` and `tree_polyps`. On a synthetic
  file-backed DB with 200,000 polyps and 200,000 sim rows the whole migration
  took about 1.9 s on a MacBook Air. That's well inside the `/healthz` check's
  10 s `grace_period` in `fly.toml`; a reef big enough to approach it would
  need that grace period raised before deploying.
- The index pages land in the WAL, so Litestream ships one burst roughly the
  size of the new indexes right after boot. It's a one-off; replication lag
  returns to about a second once it's uploaded.
- That boot also runs the room integrity check and logs
  `[storage] rows reference a missing room` if anything is off. It should
  never fire. Later boots skip the check unless another migration applies.

## Backups (Litestream)

All production state is one SQLite file (`/data/reef.db`) on one Fly volume.
The daily snapshot worker writes *into that same file*, so it is not a backup.
Off-machine backups come from [Litestream](https://litestream.io), bundled in
the image (`infra/Dockerfile.server`), which streams every committed write to
an S3-compatible bucket (Tigris on Fly) about once a second.

**It is off until the bucket secrets exist.** `infra/docker-entrypoint.sh`
turns it on only when all of `BUCKET_NAME`, `AWS_ENDPOINT_URL_S3`,
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` are set (exactly what
`fly storage create` sets). Otherwise the server starts as it always has and
logs one line:

```
[entrypoint] backups disabled: no Litestream replica configured (BUCKET_NAME unset)
```

Config: `infra/litestream.yml`, entirely from the environment; no credentials
live in the repo; the replica lives under `reef.db/` in the bucket. Optional
knobs:

| Env var | Default | Effect |
|---|---|---|
| `AWS_REGION` | `auto` | Right for Tigris; set it for other S3 providers. |
| `LITESTREAM_RESTORE_TIMEOUT` | `300` | Seconds the boot-time restore may take before giving up. |

Snapshots are taken daily and kept for 7 days, so point-in-time restore covers
the last week.

### Turning it on (Fly)

```sh
# 1. Create a private Tigris bucket and attach its credentials to the app as
#    secrets (BUCKET_NAME, AWS_ENDPOINT_URL_S3, AWS_ACCESS_KEY_ID,
#    AWS_SECRET_ACCESS_KEY, AWS_REGION).
fly storage create -a coralreefar -n coralreefar-backups

# 2. Check they landed (names and digests only; values are never shown).
fly secrets list -a coralreefar

# 3. Restart onto the new secrets if `fly storage create` didn't already.
fly deploy --image ghcr.io/costajohnt/coralreefar:latest -a coralreefar
```

The image must include this change (any `ghcr.io/costajohnt/coralreefar:latest`
built after it merged).

**The existing production DB binds on first enable.** The first boot with the
secrets finds `/data/reef.db` present but not yet bound to any replica, lists
the brand-new bucket, sees it's empty, writes the binding and starts
replicating. Expect this once:

```
[entrypoint] local DB not yet bound and s3://coralreefar-backups/reef.db is empty; binding it (first enable)
[entrypoint] backups enabled: replicating /data/reef.db to s3://coralreefar-backups/reef.db
```

If instead the log says `replication HELD ... already holds data`, the bucket
wasn't empty (an old bucket reused, or the wrong `BUCKET_NAME`); see
"Replication held".

### Replica binding

Litestream 0.5 treats whatever local DB it replicates as the next state of the
history already in the bucket (see "Retention and lineage"), so replicating
the wrong DB silently replaces the backup. The entrypoint therefore replicates
a DB only once it's **bound** to the configured replica, recorded in
`/data/reef.db.replica-bound` as `s3://<bucket>/reef.db endpoint=<endpoint>`.
A DB becomes bound only when it has **no** binding yet and:

- it was just restored from that replica (non-empty restore), or
- the replica was just listed (`litestream ltx -json -level all`, exit 0,
  output `[]`) and is empty: a fresh volume on a new bucket, or an existing
  DB on first enable.

A binding is never switched automatically. Endpoints are compared in a
canonical form (scheme defaults to `https`, scheme and host lowercased,
trailing slashes dropped), so `fly.storage.tigris.dev`,
`https://fly.storage.tigris.dev` and `HTTPS://Fly.Storage.Tigris.dev/` are the
same replica; a different bucket or host is not.

On each boot:

| State | Result |
|---|---|
| `replication-hold` marker present | Server runs, no replication (see below). |
| DB present but zero bytes (bound or not) | Held. |
| DB present, bound to this replica | Replicates. No listing needed. |
| DB present, bound to a different bucket or endpoint | Held ("refusing to switch replicas automatically"). No listing. |
| DB present, unbound, replica verified empty | Binds, replicates (first enable). |
| DB present, unbound, replica has data or listing fails | Held. |
| No DB, restore writes a non-empty DB | Binds, replicates. |
| No DB, restore writes nothing (or a zero-byte file), replica verified empty | Binds, replicates a new DB. |
| No DB, restore fails, or listing fails or isn't empty | Held, new empty DB. |

If the hold marker or the binding file can't be written, the container exits
non-zero instead of running unprotected.

**Moving to a different bucket on purpose.** Take a copy of the old backup
(see "Retention and lineage"), change the secrets, and boot: it's held with
`bound to <old>, configured <new>`. Then run the override command from the
held log (it writes the new binding and removes the marker) and restart.

**Rule: after restoring a volume snapshot or copying the DB, delete the
binding before it boots.** A copy of `/data` (a Fly volume snapshot restored
with `fly volumes create --snapshot-id`, a forked machine, a second app given
the same bucket secrets) carries `reef.db.replica-bound`, so it looks bound.
If that copy is older than the bucket, replicating it rolls the backup back
to the copy and the newer data ages out. Before its first boot with backup
secrets:

```sh
rm /data/reef.db.replica-bound
```

That forces the listing path: the bucket isn't empty, so the boot is held and
you choose explicitly (see "Replication held").

Why this is a rule and not a check: Litestream 0.5.17 does expose both
positions (local LTX files under `/data/.reef.db-litestream/ltx/`, and the
bucket's via `litestream ltx`), but that local directory is undocumented
internal state that a plain file copy doesn't carry, comparing them needs a
bucket listing on every boot (so an outage at boot would either hold
replication or skip the check), and it was not verified how local retention
prunes those files. A check that's only sometimes right is worse than a clear
rule.

### Verifying replication

```sh
# Boot log should say "backups enabled", not "backups disabled".
fly logs -a coralreefar --no-tail | grep -E 'entrypoint|litestream|level=(WARN|ERROR)'

# What Litestream has in the bucket, every compaction level (LTX files).
fly ssh console -a coralreefar -C 'litestream ltx -level all -config /etc/litestream.yml /data/reef.db'
```

`level=ERROR` lines from Litestream mean replication is failing (bad keys,
bucket gone). The server keeps running either way; fix the secrets and it
catches up on the next restart.

### Restoring

**Automatic, on an empty volume.** When the entrypoint finds no DB at
`DB_PATH` it runs `litestream restore -if-replica-exists` before starting the
server. It never touches an existing DB file. So after losing the volume:

```sh
fly volumes create reef_data --size 1 --region iad -a coralreefar
fly deploy --image ghcr.io/costajohnt/coralreefar:latest -a coralreefar
fly logs -a coralreefar --no-tail | grep entrypoint   # "restored /data/reef.db from s3://..."
```

If that restore fails (bucket unreachable, bad keys, wrong region), or it
reports "no backup" but a listing of the bucket isn't provably empty, the
server still starts on a new empty DB, with **replication held** (next
section) so that empty DB is never pushed over the real backup.

**Manual, to a point in time** (e.g. after a bad admin action). Restore to a
side file, check it, then swap it in while the server is stopped:

```sh
fly ssh console -a coralreefar
# inside the machine:
litestream restore -config /etc/litestream.yml -o /tmp/reef-restore.db \
  -timestamp 2026-10-28T12:00:00Z /data/reef.db
sqlite3 /tmp/reef-restore.db 'PRAGMA integrity_check; SELECT count(*) FROM polyps;'
```

To swap it in: copy it to your machine (`fly ssh sftp get /tmp/reef-restore.db`),
then stop the app, replace `/data/reef.db` (deleting `/data/reef.db-wal` and
`/data/reef.db-shm`), and start it. The DB stays bound, so the swapped-in file
becomes the latest backup, which is the point of a rollback. An easier route
for a full rollback: create a new empty volume, point the app at it, and let
the automatic restore run.

**Off Fly** (any machine with `litestream` and the bucket keys):

```sh
export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
litestream restore -o reef.db "s3://coralreefar-backups/reef.db?endpoint=fly.storage.tigris.dev&region=auto"
```

### Replication held

The entrypoint writes `/data/reef.db.replication-hold` (a UTC timestamp and
the reason) whenever it can't prove replicating is safe (the "Held" rows in
the table above):

- the boot-time restore failed;
- the restore found no backup, but the listing failed or listed files;
- the local DB isn't bound and the replica already holds data, or couldn't
  be listed. A listing error (auth, region, network, missing bucket) is never
  read as "empty";
- the local DB is bound to a different replica than the one configured;
- the local DB is zero bytes.

While that file exists, **every** boot starts the server without Litestream
and logs, for example:

```
[entrypoint] replication HELD: 2026-10-29T16:37:43Z local DB not bound to this replica and s3://coralreefar-backups/reef.db already holds data; see docs/runbook.md "Replica binding"
[entrypoint] the server runs WITHOUT backups until /data/reef.db.replication-hold is removed (see docs/runbook.md, "Replication held")
[entrypoint] to make THIS local DB the latest backup instead (copy the replica first): echo 's3://coralreefar-backups/reef.db endpoint=https://fly.storage.tigris.dev' > /data/reef.db.replica-bound && rm /data/reef.db.replication-hold, then restart
```

Check for it with
`fly logs -a coralreefar --no-tail | grep 'replication HELD'`. To clear it,
first read "Retention and lineage" below and take a copy of the backup, then
pick one:

- **The backup is the truth** (usual case after a lost volume): fix the cause
  (secrets, bucket), then in `fly ssh console` run
  `rm /data/reef.db /data/reef.db-wal /data/reef.db-shm /data/reef.db.replica-bound /data/reef.db.replication-hold`
  and `fly machine restart`. The boot restores from the bucket and binds.
  Anything written to the local DB since is lost.
- **The local DB is the truth** (you've decided the bucket's contents don't
  matter): run the `echo ... && rm ...` command from the third log line in
  `fly ssh console` (it writes the binding and removes the marker), then
  `fly machine restart`. Replication resumes and the local DB becomes the
  latest backup. Removing only the marker isn't enough: an unbound DB over a
  non-empty bucket is held again.

### Retention and lineage (read before any manual intervention)

Behaviour verified against Litestream 0.5.17 and a local S3 server:

- Litestream 0.5 has no separate "generations". A DB that starts replicating
  to a bucket path that already holds data is treated as the **next state of
  that same history**: the log only says `detected database behind replica`
  (level INFO, no warning), and from then on a plain restore returns the new
  DB, not the old one.
- The old state stays reachable for a while with `litestream restore -txid
  <old max_txid>` (find it with `litestream ltx -level all`), but it ages out:
  in a test with a short snapshot retention, the old snapshot was replaced and
  its level 0 and 1 files were deleted within about six minutes, leaving one
  higher-level file. With this repo's settings (daily snapshots, 7 days
  retention) assume the old state is gone within a week, possibly sooner.

That's why the entrypoint holds replication when in doubt. It also means any
manual step that starts a different DB replicating (removing a hold marker,
swapping in a restored file, pointing a new app at the bucket) overwrites
what a plain restore returns. **Before any of those, take an off-box copy of
the current backup:**

```sh
export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...   # from your password manager, not the shell history
litestream restore -o "reef-$(date -u +%Y%m%dT%H%M%SZ).db" \
  "s3://coralreefar-backups/reef.db?endpoint=fly.storage.tigris.dev&region=auto"
sqlite3 reef-*.db 'PRAGMA integrity_check; SELECT count(*) FROM polyps;'
```

Keep that file until the reef has replicated cleanly for a while. For a
second safety net, Tigris buckets can be switched to snapshot-enabled in the
Tigris dashboard (Bucket Settings, Storage Settings), which keeps object
history independent of Litestream's retention. That isn't set up by this
repo, and its exact snapshot workflow hasn't been tested here.

### Tested

`infra/docker-entrypoint.test.sh` covers the entrypoint's decisions with stubs:
disabled and partial config; first enable (existing DB, empty replica: binds
and replicates, `[]` and `null` both read as empty); normal restart (bound:
replicates without listing); foreign replica (unbound DB, non-empty replica:
held); listing errors (held); bucket or endpoint changed (held, never
rebound, whatever the new replica holds); endpoint spelling variants (same
replica); zero-byte DB (held, bound or not);
restore, zero-byte restore, verified-empty and non-empty replica on an empty
volume; restore failure and a restart after it (held until the marker is
removed); and hold-marker or binding write failures (exit non-zero).
`infra/litestream-smoke.sh` runs the real image against a local S3 server:
first enable, restore into a fresh volume plus a normal restart, a foreign
replica (held, and the bucket still restores the original data), a fresh
volume on an empty bucket, an unreachable replica then a restart with it
reachable (held both times), a bound DB pointed at another bucket (held)
and at a respelled endpoint for the same bucket (replicating), and a bound DB
with the replica down (server up, replicating). CI runs both.
