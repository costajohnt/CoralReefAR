# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely;
versions are SemVer.

## [Unreleased]

### Planned

- **Tree mode (`tree.html`)** — a third client surface for a
  fractal branching-coral web. Visitors attach small composable
  pieces to each other's exposed tips, growing a structure over
  days. Avatar-bioluminescent styling: bloom post-processing,
  vivid palette (magenta / cyan / violet / lime / orange), no
  translucency. Five variants (forked / trident / starburst / claw
  / wishbone) with 1-4 attach slots each. Separate reef in the DB
  (`tree_polyps` table, `/api/tree/*`, `/ws/tree`), seeded with a
  random Starburst at install so visitors always have something to
  branch off. Implementation plan in
  [`docs/superpowers/plans/2026-04-22-tree-mode.md`](docs/superpowers/plans/2026-04-22-tree-mode.md).

## [0.4.0] — 2026-04-22

Playground — AR-free interactive reef view + museum screen mode.
Full release notes:
<https://github.com/costajohnt/CoralReefAR/releases/tag/v0.4.0>.

### Added

- **Playground (`playground.html`)** — AR-free interactive reef view:
  orbit camera, click-to-place on a virtual pedestal, full picker +
  commit flow, WebSocket live updates. `?mode=screen` drives an
  auto-orbit camera for the eventual museum-screen display;
  `?readonly=1` is a browse-only mode. `?api=URL` points at any
  backend. Reuses `Reef`, `Placement`, `Picker`, `ReefSocket` and
  the existing scene effects (sway, pulse, fish). Four new pure
  modules under `packages/client/src/playground/` — `scene.ts`,
  `config.ts`, `autoOrbit.ts`, `interaction.ts` — plus
  `playground.ts` + `playground.html`.

### Changed

- `Placement.showGhost()` now accepts an optional `positionOverride`
  parameter, letting callers that have already raycast their own
  placement point (e.g. the playground) seed the ghost without
  going through `handleTap()`. AR client behavior unchanged.
- **Test count** across four packages: 161 → 180 (shared 12 /
  generator 22 / server 70 / client 76).

## [0.3.0] — 2026-04-21

Fastify 5 migration + dep hygiene sweep + boot smoke test.
Full release notes:
<https://github.com/costajohnt/CoralReefAR/releases/tag/v0.3.0>.

### Added

- **Full-app boot smoke test.** `packages/server/src/index.ts` now
  exports a `makeServer()` factory; `boot.smoke.test.ts` exercises
  the real plugin load order with an in-memory DB. Catches
  Fastify-plugin-version mismatches (the exact class of bug that
  bit v0.2.0's first two release-build attempts). (#55)
- **Test coverage on previously-untested scene files.** 11 new tests
  across `simDecor` (all three decoration branches + non-Mesh
  no-op documentation) and `currentSway` (shader-anchor injection
  assertions so Three.js include renames don't silently drop sway
  in the next major). Partial close of #47. (#56)
- **Operator runbook for the deployed LXC.** `NEXT_STEPS.md` now
  documents what's running on the Beelink and how to manage it
  (status, logs, admin-token retrieval, image updates, DB backup,
  teardown). (#57)

### Changed

- **Fastify 4 → 5 migration** (closes #54). `fastify` `^4.27.0` →
  `^5.8.5`; `@fastify/cors` unpinned from `^9.0.1` → `^11.2.0`;
  `@fastify/static` `^7.0.4` → `^8.0.0`; `@fastify/websocket`
  `^10.0.1` → `^11.2.0`. Zero code changes — the boot smoke test
  validated the full plugin stack.
- **Dep bumps**: `oxlint` 0.15 → 1.61 (codebase already clean against
  new ruleset), `happy-dom` 19 → 20, `@types/node` 20 → 25, plus 4
  GH Actions bumps.
- **Test count** across four packages: 146 → 161 (shared 12 /
  generator 22 / server 70 / client 57).

## [0.2.0] — 2026-04-19

First release after the self-hosted AR migration + a session-long
audit + hardening cycle. See the full release notes on GitHub:
<https://github.com/costajohnt/CoralReefAR/releases/tag/v0.2.0>.

### Changed

- **AR tracker migrated to the self-hosted 8th Wall engine binary.**
  `packages/client/index.html` now loads
  `@8thwall/engine-binary` from jsDelivr with
  `data-preload-chunks="slam"` and `async`. The retired
  `apps.8thwall.com/xrweb?appKey=…` path is gone.
  `EightWallProvider.waitUntilReady()` absorbs the async-script race
  before the first provider selection so the user doesn't fall
  through to Noop on a fast tap. (#28)

### Removed

- **MindAR fallback** — the stub `MindARProvider`,
  `?tracker=mindar`, and `mindar` from the `TrackingProvider.name`
  union. 8th Wall is the only active tracker; `NoopProvider` is the
  desktop/dev fallback.

### Added

- **Live hosting**:
  - GitHub Pages static demo at <https://jcosta.tech/CoralReefAR/>,
    HTTPS enforced. `/` is a landing page; `/preview.html` is the
    procedurally-rendered species grid; `/ar.html` is the AR entry
    (expects a backend).
  - Fly.io deploy workflow (`fly.toml` + `.github/workflows/fly-deploy.yml`)
    is armed. App is provisioned; deploy deferred per operator
    decision in favor of self-host on Beelink.
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

- TypeScript 5.9 → 6.0, Vite 5.3 → 7.1, Vitest 2.1 → 4.1, happy-dom
  15 → 19, better-sqlite3 11 → 12, @fastify/cors 9 → 11, base Docker
  image node:20-alpine → node:25-alpine,
  `actions/deploy-pages@v4 → @v5`.
- **Rate limits are opt-in**: default `RATE_LIMIT_MAX=0` (off). Tests
  that exercise the 429 path explicitly re-enable. New
  `READ_RATE_LIMIT_PER_MIN` env var for the per-IP read-side bucket.
  Tracked for production re-enable in #25.
- Docker + compose: server container also serves the client bundle via
  `@fastify/static` (`CLIENT_DIST_DIR` env); no more separate web host
  needed.
- README: rewritten for pitch, not spec. Leads with the visitor
  experience (NFC tap → AR → shared persistent reef).

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
