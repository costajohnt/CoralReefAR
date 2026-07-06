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
