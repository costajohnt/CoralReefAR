# Next Steps

What's done, what's open, and what you (the maintainer) still need to do
manually. This file is the single source of truth for project state — keep
it edited alongside the work.

## Current state

- **Main branch CI**: green. 121 tests pass across 4 packages (shared 12 /
  generator 22 / server 61 / client 26).
- **Stack**: TypeScript 6 · Vite 7 · Vitest 4 · better-sqlite3 12 ·
  @fastify/cors 11 · node:25-alpine · happy-dom 19 · Oxlint. All fully
  up-to-date.
- **Live**: static demo at <https://jcosta.tech/CoralReefAR/> (HTTPS
  enforced). HTML landing links to the species preview; the AR entry is
  there too but can't talk to a backend.
- **Docker image**: `ghcr.io/costajohnt/coralreefar:latest`. Verified
  locally — `/healthz`, `/`, `/api/reef`, `/metrics`, POST polyp all work.
  Multi-arch (amd64 + arm64). Auto-published on `vX.Y.Z` tag.
- **Branch protection** on `main`: CI required, linear history, no
  force-push. Hook bypass for `costajohnt/*` repos so operator actions
  flow without per-command approval.
- **Rate limits**: off by default (tracked in [#25] — flip env vars for
  production).

## Deployment

### Primary path: Beelink + Docker Compose

The original plan stands — self-host on the Beelink running in a Proxmox
LXC or VM. Runbook is [`INSTALL.md`](./INSTALL.md).

```sh
git clone https://github.com/costajohnt/CoralReefAR.git
cd CoralReefAR
cp .env.example .env
# edit .env: set ADMIN_TOKEN, CORS_ORIGINS, CLOUDFLARE_TUNNEL_TOKEN
docker compose up -d
docker compose logs -f server
```

`docker-compose.yml` references `ghcr.io/costajohnt/coralreefar:latest`,
so `docker compose pull && docker compose up -d` picks up new versions
without a local build.

### Alternative: Fly.io (on pause)

The Fly app is provisioned but blocked on billing:

- App `coralreefar` created.
- Volume `reef_data` (1 GB, iad) created.
- Secrets `ADMIN_TOKEN` + `CORS_ORIGINS` staged.
- `FLY_API_TOKEN` added to the repo secrets so `.github/workflows/fly-deploy.yml` will run on push.
- **Blocker**: Fly trial orgs need a credit card at
  <https://fly.io/dashboard/john-costa-307/billing> before the first VM
  boots. Decided to defer — Beelink/Proxmox is simpler for testing.

Nothing to clean up — `fly.toml` and the workflow sit dormant. Come back
when ready.

## AR tracker

`packages/client/src/tracking/eightwall.ts` now targets the self-hosted
`@8thwall/engine-binary`. The retired cloud-hosted
`apps.8thwall.com/xrweb?appKey=…` path is gone. The engine loads via
jsDelivr with `data-preload-chunks="slam"`; `EightWallProvider.waitUntilReady()`
absorbs the async-script race on the first user tap. MindAR (the old
fallback) has been dropped — 8th Wall is the only active tracker, with
`NoopProvider` as the desktop/dev path when the engine isn't loaded.

### Still to do for AR (operator tasks)

1. **Compile the pedestal marker.** 8th Wall's image-target
   preprocessing now happens via the desktop app in
   [github.com/8thwall/8thwall/apps/](https://github.com/8thwall/8thwall)
   (post-shutdown workflow). Commit the target under
   `assets/pedestal/`.
2. **Real-device test.** Print the marker, point an iPhone (Safari)
   and an Android (Chrome) at it, confirm anchor stability and the
   walk-around-the-pedestal path.

Tracking issue: [#28].

### Not to lose sight of

- Niantic Spatial's binary-engine maintenance ends ~March 2026 and
  existing self-hosted projects keep working through Feb 28, 2027. If
  a tracker bug surfaces after that you probably can't get it fixed
  upstream. This is an installation piece that might run 2-3 years —
  worth a re-think if the engine stops meeting our needs.

## Testing (what you still need to do)

### 1. Real-device AR smoke test

Print `assets/pedestal/marker.svg` at ~180 mm square, matte paper.
On an iPhone (Safari) and an Android (Chrome):
- Load the live site.
- Confirm tracker picks up the marker within a few seconds under
  venue lighting.
- Place a polyp; close the tab; reopen; the polyp persists.
- In a second tab, admin-delete via `/admin`; the first tab's reef
  updates live over the WebSocket.

Nothing here has ever been driven through a real camera. The vitest +
integration tests cover the code but not the physical world.

### 2. Pedestal marker — production version

`assets/pedestal/marker.svg` is a placeholder. Commission the real
artwork when the design is ready (see
`assets/pedestal/README.md` for the trackability guidelines).

### 3. NFC tags

Program an NTAG215 batch with the live URL. Test one end-to-end (tap
→ Safari/Chrome → AR startup) before programming the batch.

## Optional polish

- **CODEOWNERS** — only useful when collaborators join.
- **Branch protection review-required** — same.
- **Pitch / write-up** — devlog, HN submission, awesome-list PR.
- **Content moderation beyond admin delete** — if the installation is
  public and unsupervised, think about report-abuse link or keyword
  filter on submitted colors or seeds (unlikely attack surface, but).

## Known limitations

Carrying forward — these are intentional or accepted:

- **Metrics are in-process only.** `reef_polyps_total` /
  `reef_ws_clients` / `reef_rate_limited_total` reset on restart.
  Multi-instance deploys need Prometheus aggregation.
- **Rate limiting is off by default.** Intentional for testing; see
  [#25].
- **No auth for regular users.** Anyone can plant once per device
  (or once, period, with limits off). Admin path is the moderation
  surface.
- **Vitest 4 + Vite 7** is current; Vitest 4 needed Vite 6+ and we
  skipped straight to 7. Tests pass; stay alert for Vite 7 ecosystem
  gaps.
- **8th Wall binary EOL** — self-hosted projects work through Feb 28,
  2027; binary-engine maintenance ends ~March 2026. See _AR tracker_
  above.

[#25]: https://github.com/costajohnt/CoralReefAR/issues/25
[#28]: https://github.com/costajohnt/CoralReefAR/issues/28
