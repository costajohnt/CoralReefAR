# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely;
versions are SemVer.

## [Unreleased]

### Added

- Admin restore UI: the `/admin` page now shows both live and soft-deleted
  polyps with a per-row Restore button next to Delete.
- `GET /api/admin/deleted` — bearer-token-gated moderation queue of
  soft-deleted polyps.
- `POST /api/admin/polyp/:id/restore` returns a three-way result:
  `200` with the public polyp on restore, `409 Conflict` for
  `already_live`, `404` for `not_found`. Lets the UI tell "no such
  polyp" apart from "nothing to restore."
- Prometheus `reef_rate_limited_total` counter wired to both 429 paths.
- Two-finger pinch + twist gestures on the placement ghost.
- Three.js vendor chunk (client bundle — one shared `three-*.js` across
  all HTML entries).
- Full happy-dom + Vitest harness on the client (`pnpm --filter
  @reef/client test`), 26 tests across picker / net-api / tracker
  selection / placement.
- Mesh-invariant tests per species (catches NaN / Inf / index-OOB /
  non-unit normals that the hash goldens couldn't).
- Live hosting:
  - GitHub Pages static demo at https://jcosta.tech/CoralReefAR/
  - Fly.io deploy workflow (`fly.toml` + `.github/workflows/fly-deploy.yml`)
    using the published GHCR image.
- Dependabot configured for weekly Actions / npm / Docker updates.

### Changed

- TypeScript 5.9 → 6.0, better-sqlite3 11 → 12, @fastify/cors 9 → 11,
  base Docker image node:20-alpine → node:25-alpine.
- Docker + compose: server container also serves the client bundle via
  `@fastify/static` (`CLIENT_DIST_DIR` env); no more separate web host
  needed.

### Fixed

- Non-unit normals in the `branching` species (Gram-Schmidt was missing
  from the near-vertical-axis `else` branch). Visible as subtle shading
  artefacts; the new mesh-invariant tests caught it.
- Quaternion drift during sustained two-finger twists — `.normalize()`
  after every `multiply()` in `Placement.applyGesture`.
- `restorePolyp` UPDATE+SELECT race: wrapped in a better-sqlite3
  transaction so a concurrent soft-delete can't slip between the two
  statements.
- `ws.ts` dispatch: JSON parse and handler invocation split into
  separate try/catches so a handler throw doesn't get classified as a
  "malformed frame" and vanish.
- `loadInitial` failure surfaced via always-visible `#status` (with
  `aria-live`), not the still-hidden `#hint`.

## [0.1.0] — 2026-04-18

First tagged release after splitting CoralReefAR into its own repo.

### Added

- pnpm monorepo: `packages/{shared,generator,server,client}`.
- Server: Fastify + better-sqlite3 + WebSocket hub + hourly sim + daily
  snapshot; rate limit; admin soft-delete; `/healthz`.
- Client: Vite + Three.js AR app; 8th Wall / MindAR / noop tracking;
  placement raycast; ghost preview; species/color picker; reroll /
  cancel / submit-in-flight UX.
- Generator: deterministic procedural polyps across five species.
- CI: typecheck / build / tests; minimum-scope `GITHUB_TOKEN`;
  15-min timeout.
- Release workflow: builds and publishes multi-arch Docker image to
  GHCR on `vX.Y.Z` tag push.
- 97 tests at release (12 shared + 22 generator + 56 server + 7
  client); server integration tests against a real `ws` client.
