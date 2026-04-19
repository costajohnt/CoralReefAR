# Coral Reef AR — Install Runbook

Step-by-step deployment for a self-hosted Beelink (or any x86-64 Linux
host running Docker). Targets a single-venue install with one reef, one
pedestal, one public hostname.

## Prerequisites

- A Linux host with Docker + Docker Compose v2. An 8 GB / 4-core Beelink
  with an SSD is overkill for this workload but gives you headroom.
- A Cloudflare account. Free tier is sufficient.
- A domain or subdomain you control (`reef.example.com`).
- 5–10 NTAG215 NFC tags (or whatever the venue wants — anything with
  NDEF URL support works).
- A printed image-target for the pedestal. See "Pedestal marker" below.

## 1. Clone and configure

```sh
git clone https://github.com/costajohnt/CoralReefAR.git
cd CoralReefAR
cp .env.example .env
```

Edit `.env`:

```
ADMIN_TOKEN=<paste `openssl rand -hex 32`>
CLOUDFLARE_TUNNEL_TOKEN=<paste from Cloudflare Zero Trust UI>
CORS_ORIGINS=https://reef.example.com
```

The `ADMIN_TOKEN` gates `DELETE /api/admin/polyp/:id` and nothing else.
Pick something you can paste into the admin UI once when moderating and
forget. `CLOUDFLARE_TUNNEL_TOKEN` comes from the Cloudflare Zero Trust
dashboard (see step 4).

## 2. Client hosting

The server container builds and serves the client out of the same
Docker image. The Dockerfile runs `pnpm --filter @reef/client build`
and bakes `CLIENT_DIST_DIR=/app/packages/client/dist` into the
environment. `@fastify/static` picks that up and serves `/` and all
static assets alongside `/api/*` and `/ws`. No sidecar needed.

Alternatives if you want the client on a CDN edge:

- **Cloudflare Pages.** Push `packages/client/dist` to a Pages project.
  Route `reef.example.com/*` to Pages, `reef.example.com/api/*` and
  `/ws` to the tunnel. Unset `CLIENT_DIST_DIR` so the server stops
  serving static files.
- **nginx / Caddy sidecar.** Same idea, but on-prem. Also requires
  unsetting `CLIENT_DIST_DIR`.

## 3. Bring the stack up

Two options — pick one:

**Pre-built image (recommended for production):**

```sh
docker compose pull
docker compose up -d
docker compose logs -f server
```

Compose pulls `ghcr.io/costajohnt/coralreefar:latest`. Pin to a
specific version for reproducibility — edit `docker-compose.yml` and
replace `:latest` with `:vX.Y.Z`. Released versions appear at
<https://github.com/costajohnt/CoralReefAR/pkgs/container/coralreefar>.

**Build from source (local dev or un-released changes):**

```sh
docker compose up -d --build
docker compose logs -f server
```

You should see `reef server listening` within a few seconds. A loud
`ADMIN_TOKEN is not set` warning means step 1 wasn't applied —
fix before going public.

Sanity check:

```sh
curl -s http://127.0.0.1:8787/healthz
# → {"ok":true,"time":<epoch_ms>}
```

## 4. Cloudflare Tunnel

In **Cloudflare dashboard → Zero Trust → Networks → Tunnels**:

1. Create a tunnel named `reef`.
2. Copy the tunnel token into `.env` as `CLOUDFLARE_TUNNEL_TOKEN`.
   Restart the stack: `docker compose up -d`.
3. Add a public hostname:
   - Subdomain: `reef`, domain: `example.com`.
   - Service: `http://server:8787` (the compose network name).
4. If using Option B (nginx sidecar), add a second hostname or path
   rule routing `/` → `http://web:80` and everything else →
   `http://server:8787`. Cloudflare Tunnel path-based routing works
   but WebSockets need `/ws` pinned to the server service.

## 5. NFC tags

Write a single NDEF URL record per tag:

```
https://reef.example.com/
```

iOS Safari and Android Chrome both auto-open the URL on tap (iOS
requires the tag to be active against the top of the device). Test
with a single tag before programming the batch.

Tips:

- Use NTAG215 — larger memory than 213 and works fine in a pedestal
  without line-of-sight constraints.
- Seal tags behind a thin non-metallic plate; metal kills the field.

## 6. Pedestal marker

The tracking layer needs a printed image as the origin anchor. 8th Wall
SLAM extends tracking beyond the marker, so visitors only need the
marker to be in-frame briefly.

A placeholder marker lives at `assets/pedestal/marker.svg` — good
enough for local smoke testing but not for production. See
`assets/pedestal/README.md` for the characteristics a production
marker needs and how to swap yours in.

Commit the actual marker image to the repo (or a private asset bin)
once chosen so reinstalls are reproducible.

## 7. Verify the flow

- Tap an NFC tag with a phone. Safari or Chrome should open
  `https://reef.example.com/`.
- Tap **Start**, grant camera permission.
- Aim at the pedestal marker. The status should flip to "Tap a spot…".
- Place a test polyp. Open `/admin` in a second tab, paste the admin
  token, delete it. The reef on the first tab should show the polyp
  disappear in real time (WebSocket `polyp_removed`).
- Let the stack run overnight. Check `docker compose logs --tail 50
  server` the next morning — look for `snapshot` entries from the
  daily snapshot worker.

## Operations

**Data.** The SQLite database lives at `./data/reef.db`. Back it up on a
cron. `sqlite3 reef.db ".backup /tmp/backup.db"` is safe against a live
writer; scp the result anywhere.

**Log level.** Pino JSON to stdout. Docker's json-file driver keeps
logs until you rotate them — set `"log-opts": { "max-size": "10m" }`
in `/etc/docker/daemon.json`.

**Admin workflow.** Open `https://reef.example.com/admin`, paste the
token, click delete on anything unwelcome. Deletions are soft — rows
stay in the DB with `deleted=1` so you can audit after the fact. No
"undo" UI yet; `UPDATE polyps SET deleted=0 WHERE id=?` un-deletes.

**Rate limits.** Defaults: 1 polyp per device per hour, 60 reads per IP
per minute. Override via env: `RATE_LIMIT_MAX`, `RATE_LIMIT_WINDOW_MS`.
Rate-limit salt rolls on the same window, so limits hold across
midnight.

**Upgrades.** `git pull && docker compose build server && docker
compose up -d`. The DB schema migrations in
`packages/server/migrations/` run automatically on startup; don't edit
applied migrations, add new ones.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| All requests return 401 to `/api/admin/polyp/:id` | `ADMIN_TOKEN` env var is empty — check the startup warning |
| WebSocket connects then disconnects every ~60 s | Cloudflare idle timeout; heartbeat is enabled server-side but verify `ws` upgrade headers pass through any proxy |
| `polyp_added` arrives on some tabs but not others | Hub evicted the stale client; check `docker compose logs server` for `hub broadcast failed` lines |
| Client shows "Looking for the reef…" and never advances | Pedestal marker is out of frame, too dim, or at a glancing angle. Good light is non-optional. |
| Container restarts repeatedly | `ADMIN_TOKEN` missing in `.env` and compose fails the `:?` check; set it and `docker compose up -d` |
