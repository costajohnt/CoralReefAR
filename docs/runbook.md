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
| `RATE_LIMIT_MAX` | `1` | Polyps per device per window. Also bounds tree writes. `0` = off. |
| `READ_RATE_LIMIT_PER_MIN` | `60` | Per-IP token bucket on `GET /api/reef` and `/api/stats`. `0` = off. |
| `TRUST_PROXY_HOPS` | `1` | Reverse-proxy hops whose `X-Forwarded-For` entry sets `req.ip`, which every rate limit keys on. Only private/loopback peers are trusted. `0` (code default) = socket address, header ignored. After a deploy, confirm the logged `remoteAddress` is the visitor's IP, not Fly's proxy. |
| `READ_CACHE_TTL_MS` | `1000` | Coalesce read scans within this window. `0` = off. |
| `WS_MAX_CLIENTS` | `1000` (default) | Max concurrent WebSocket connections per hub (reef + tree counted separately). `0` = unlimited. |
| `SIM_RETENTION_MS` | `2592000000` (30d, default) | Prune sim decorations older than this. `0` = keep all. |
| `SNAPSHOT_RETENTION_COUNT` | `90` (default) | Keep the N most recent daily snapshots. `0` = keep all. |
| `ADMIN_TOKEN` | secret | Gates the reef admin routes and (when set) the destructive tree reset/delete. |
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
`/data/reef.db-shm`), and start it. An easier route for a full rollback: create
a new empty volume, point the app at it, and let the automatic restore run.

**Off Fly** (any machine with `litestream` and the bucket keys):

```sh
export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=...
litestream restore -o reef.db "s3://coralreefar-backups/reef.db?endpoint=fly.storage.tigris.dev&region=auto"
```

### Replication held

The entrypoint writes `/data/reef.db.replication-hold` (a UTC timestamp and
the reason) whenever it can't prove replicating is safe:

- the boot-time restore failed, or
- the restore found no backup, but `litestream ltx -json -level all` either
  failed (auth, region, network; a listing error is never read as "empty") or
  listed files.

While that file exists, **every** boot starts the server without Litestream
and logs:

```
[entrypoint] replication HELD: 2026-10-29T16:37:43Z restore failed from s3://coralreefar-backups/reef.db; the server started on a new empty DB
[entrypoint] the server runs WITHOUT backups until /data/reef.db.replication-hold is removed (see docs/runbook.md, "Replication held")
```

Check for it with
`fly logs -a coralreefar --no-tail | grep 'replication HELD'`. To clear it,
first read "Retention and lineage" below and take a copy of the backup, then
pick one:

- **The backup is the truth** (usual case after a lost volume): fix the cause
  (secrets, bucket), then in `fly ssh console` run
  `rm /data/reef.db /data/reef.db-wal /data/reef.db-shm /data/reef.db.replication-hold`
  and `fly machine restart`. The boot restores from the bucket. Anything
  written to the interim empty DB is lost.
- **The local DB is the truth** (you've decided the bucket's contents don't
  matter): `rm /data/reef.db.replication-hold` and `fly machine restart`.
  Replication resumes and the local DB becomes the latest backup.

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
disabled, partial config, existing DB untouched, restore, verified-empty
replica, non-empty or unlistable replica (held), restore failure (held), and a
restart after a failure (still held until the marker is removed).
`infra/litestream-smoke.sh` runs the real image against a local S3 server:
replicate from an empty bucket, restore into a fresh volume, boot with an
unreachable replica (held, marker written), restart that volume with the
replica reachable (still held), and an existing DB with a dead replica
(replicating, server up). CI runs both.
