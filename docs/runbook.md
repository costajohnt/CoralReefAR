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

# What Litestream has in the bucket (LTX files, newest last).
fly ssh console -a coralreefar -C 'litestream ltx -config /etc/litestream.yml /data/reef.db'
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

If that restore fails (bucket unreachable, bad keys), the server still starts,
with a new empty DB and **replication off** so the empty DB can't be pushed
over the good backup. The log says `restore FAILED`. Fix the cause, then stop
the machine, delete `/data/reef.db*`, and start it again to retry.

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

### Tested

`infra/docker-entrypoint.test.sh` covers the entrypoint's decisions with stubs
(disabled, partial config, existing DB untouched, restore, empty replica,
restore failure). `infra/litestream-smoke.sh` runs the real image against a
local S3 server: replicate, restore into a fresh volume, and boot with an
unreachable replica. CI runs both.
