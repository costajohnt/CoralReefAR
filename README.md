# Coral Reef AR

Tap an NFC tag in a gallery, open a web-based AR view, and add your own coral
polyp to a shared reef that every future visitor sees. The reef is
procedurally generated — L-systems for branching corals, reaction-diffusion
for bulbous ones, no hand-modeled GLTFs — so every contribution is unique
and nothing is ever deleted. It grows indefinitely.

No app install. No auth. No paid services. Runs on a single small Linux
box behind Cloudflare Tunnel, or a $5/mo Fly.io VM, or anything in between.

- **Live static preview**: <https://jcosta.tech/CoralReefAR/preview.html> —
  orbit-camera grid of all five procedurally-generated species. No server,
  no AR, no setup.
- **Docker image**: `ghcr.io/costajohnt/coralreefar:latest` — multi-arch,
  auto-published on version tags. `docker compose up -d` deploys the whole
  thing.
- **Source of truth**: this repo. See [`PLAN.md`](./PLAN.md) for the
  installation concept, [`INSTALL.md`](./INSTALL.md) for the operator
  runbook, [`NEXT_STEPS.md`](./NEXT_STEPS.md) for what's still ahead.

## What it does

- Procedural coral generator with five species (branching, bulbous, fan,
  tube, encrusting). Determinstic — same seed + color → identical mesh.
- Real-time WebSocket hub — when one visitor plants a polyp, every other
  connected visitor sees it appear within a frame.
- Ambient life: slow current drift, fish boids, server-side "growth" tick
  that adds barnacles / algae to polyps over months.
- Fastify + SQLite backend. Prometheus `/metrics`. `/healthz`. Optional
  static serving of the bundled client out of the same container.
- Admin `/admin` page: soft-delete any polyp, restore any soft-deleted
  polyp, see the live + deleted queues. Moderation loop is done.

## Stack

- **pnpm monorepo**: `shared / generator / server / client`.
- **Server**: TypeScript · Fastify · better-sqlite3 · `ws` via
  `@fastify/websocket`. Zero external services.
- **Client**: TypeScript · Vite · Three.js. Two surfaces share one
  backend:
  - **AR** (`index.html`) — self-hosted 8th Wall engine binary, pedestal
    marker tracking, two-finger pinch + twist placement on phone.
  - **Playground** (`playground.html`) — AR-free orbit-camera view
    with click-to-place, for iterating without marker/phone. Adds
    `?mode=screen` for a fixed museum-display variant.
- **CI**: lint (Oxlint) · typecheck · build · 180 tests across four
  packages · multi-arch Docker image on tag · Pages deploy on push.

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

## Production

See `INSTALL.md` for the full runbook. Three paths:

- **Self-hosted Beelink + Cloudflare Tunnel** (the original deploy target). Free ongoing cost, requires hardware.
- **Fly.io** — `fly.toml` is checked in. One-time: `fly apps create coralreefar`, create a `reef_data` volume, set `ADMIN_TOKEN` + `CORS_ORIGINS` secrets, add a `FLY_API_TOKEN` repo secret. Then every push to main triggers `.github/workflows/fly-deploy.yml`. ~$5/mo for a shared-1x VM.
- **GitHub Pages** (static-only) — `.github/workflows/pages.yml` builds the client and publishes the preview. No backend → no placement persistence, just the generator demo.

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

## Tracker

Default is 8th Wall if `window.XR8` is present, otherwise noop (useful on desktop/dev — fixed anchor in front of the camera). Force a specific one with `?tracker=eightwall|noop`.

The client loads the self-hosted `@8thwall/engine-binary` from jsDelivr — no account, no appKey, no phone-home, and the hosted `apps.8thwall.com` path is gone (retired Feb 28, 2026). See [`NEXT_STEPS.md`](./NEXT_STEPS.md) for the binary-EOL notes.
