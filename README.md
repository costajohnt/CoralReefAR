# Coral Reef AR

Self-hosted, persistent, collaborative AR coral reef. See `PLAN.md` for the full spec.

## Layout

```
packages/
  shared/      # types, zod schema, palette, tracking interface
  generator/   # procedural polyp generator (L-systems, reaction-diffusion)
  server/      # Fastify + SQLite + WebSocket hub + sim worker
  client/      # Vite + Three.js AR app
infra/
  Dockerfile.server
docker-compose.yml
```

## Dev

```bash
pnpm install
pnpm --filter @reef/server dev          # http://localhost:8787
pnpm --filter @reef/client dev          # http://localhost:5173
```

The client proxies `/api` and `/ws` to the server in dev.

For desktop testing (no camera or tracker), use `?tracker=noop` — the reef anchors a fixed distance in front of the camera.

## Production (Beelink)

1. Copy `.env.example` to `.env` and fill in `ADMIN_TOKEN` and `CLOUDFLARE_TUNNEL_TOKEN`.
2. Build the client once (`pnpm --filter @reef/client build`) and serve it via a static host (or add a Fastify static plugin).
3. `docker compose up -d` on the Beelink.

## Seeding the reef

```bash
pnpm --filter @reef/server build
node packages/server/dist/seed.js
```

## Developer pages

Vite serves three entry points in addition to the main AR app:

- `/` — visitor-facing AR app (uses camera + tracker)
- `/preview.html` — grid of all 5 species rendered non-AR with orbit cameras, for visually tuning the generator
- `/timelapse.html` — scrub through daily snapshots (reads `/api/snapshots`)

## Server routes

- `GET  /healthz` — liveness
- `GET  /api/reef` — full public reef state (no `deviceHash` ever leaves)
- `POST /api/reef/polyp` — submit a polyp (rate-limited to 1/hour/device)
- `GET  /api/stats` — polyp count, unique devices, per-species, last 24h/7d
- `GET  /api/snapshots` / `GET /api/snapshots/:id` — timelapse data
- `GET  /admin` — admin shell (no auth on the page; API calls require a Bearer token)
- `DELETE /api/admin/polyp/:id` — soft-delete (Bearer token required)
- `WS   /ws` — `hello` / `polyp_added` / `polyp_removed` / `sim_update`

All responses carry CSP + `X-Frame-Options: DENY` + other standard hardening headers.

## Tests

```bash
pnpm --filter @reef/generator test   # RNG determinism, mesh invariants per species
pnpm --filter @reef/server test      # DB, routes, rate limit, admin auth, sim
```

## Tracker fallback

The default tracker is 8th Wall if `window.XR8` is present, otherwise MindAR stub. Force a specific one with `?tracker=eightwall|mindar|noop`.

The 8th Wall XR engine binary is not vendored in this repo. Place it in `packages/client/vendor/8thwall/` before building for production. The `.gitignore` excludes that directory.
