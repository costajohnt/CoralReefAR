# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely;
versions are SemVer.

## [Unreleased]

### Added — Quest 3 MR surface (2026-05-25)

A new client surface at `quest.html` runs the shared global reef in the
Meta Quest Browser via WebXR `immersive-ar`. Passthrough MR, hand
tracking only (no controllers), session-scoped spatial anchor.

- **`quest.html`** — seventh client entry alongside index / preview /
  timelapse / playground / tree / treeAr. Reuses `@reef/generator`,
  `@reef/shared`, the existing scene / mesh adapters, and the WebSocket
  client. No new backend endpoints.
- **WebXR session lifecycle** — `QuestApp` owns the 7-state machine
  (idle / xr-starting / placement / loading / interactive /
  tracking-lost / error) and the WebGL renderer driven by
  `XRSession.requestAnimationFrame`. Deliberately does NOT extend the
  `Tracker` interface used by the phone-AR path — WebXR owns its own
  reference space and render loop.
- **Anchor placement** — right-hand pinch on the floor captures an
  `XRAnchor` on the next frame; the shared reef materializes life-size
  around it. Move-reef button re-enters placement (closes the WS, drops
  the old reef, releases the anchor, all cleanly).
- **Hand-tracking interaction** — pinch detection with hysteresis
  (`PINCH_THRESHOLD_METERS=0.025` start, `0.04` release) prevents
  micro-tremor flicker. Pinch-hold-twist-release places a polyp with
  rotation: capture wrist yaw at pinch start, update preview rotation
  on each frame from the wrist yaw delta (wrapped to (-π, π]), commit
  on pinch release.
- **Wrist palette** — two rows pinned to the user's left wrist: shape
  cycle (5 species) + color picker (5 swatches), plus a Move-reef
  button. Right-hand poke selects.
- **In-XR instruction overlay** — canvas-textured 3D panel billboarded
  in front of the head pose, since the 2D status div is invisible once
  immersive starts. Text updates per state transition.
- **`surface: "quest"` on the polyp schema** — optional transport-only
  field selects a looser server rate-limit bucket
  (`questRateLimitMax`, default 20/hour) for active demoing. Stripped
  before persistence so it doesn't leak into the DB.
- **HTTPS dev** — `vite-plugin-mkcert` gated behind
  `VITE_ENABLE_MKCERT=1` so Quest browsers on the LAN can hit the dev
  server. Doesn't run during tests or production builds.

### Added — Quest 3 v1.1 (still on the same branch)

- **Tip-node hotspots.** Each species generator exposes a `tips:
  TipNode[]` field (up to 3 for branching, 1 for bulbous/fan/tube, 0
  for encrusting). The Quest `HotspotLayer` mirrors the reef and
  attaches visible glowing-sphere markers at every tip in world space.
  Right-hand pinches that ray-hit a hotspot snap the compose preview
  to the hotspot's world position; misses fall through to free-space.
- **Cross-session anchor persistence behind `?persist=1`.** Opt-in via
  URL flag. On restore success, the reef materializes in the same
  physical spot without the user re-pinching. Storage is per-device
  (localStorage); the spec says room geometry must remain
  recognizable to Quest, so stale handles are caught + cleared
  silently. Move-Reef clears the saved handle.
- **Ambient life on Quest.** `installSway` and `installPulse` (the
  same shaders the phone-AR path uses) are now installed on every
  Quest reef polyp via an idempotent per-mesh symbol guard. The
  shared clock ticks from `XRFrame.predictedDisplayTime` so the
  motion stays in sync with Quest's reprojection.

### Audit fixes (caught on second-pass review)

- **Broken palette poke.** `handlePinchStart` was calling `pickHotspot`
  against palette buttons, but palette buttons aren't tagged with
  `hotspotId` — so the raycast always returned `null` and every pinch
  fell through to placing a polyp. Replaced with `pickPokedButton`, a
  distance-based picker that recognizes any palette `userData` tag
  (right semantic for direct-touch poke anyway).
- **Permanent "Loading…" on backend failure.** `loadReef` now lets the
  `fetchReef` rejection bubble up; the caller distinguishes anchor
  failure from reef-load failure and surfaces the right error message.
- Palette face-toward target was the world Y axis at wrist height
  (palette stared at the world origin's vertical column regardless of
  user position); now faces the captured head pose.
- Compose preview meshes leaked geometry + material; now disposed via
  `disposeTree`.
- Move-Reef during an in-progress compose left a dangling preview
  parented to the about-to-be-deleted anchor; now disposed first.
- `handleSessionEnd` didn't reset compose state, head-pose cache,
  pending anchor pose, or reef contents; now fully resets.
- Head forward direction was hardcoded to world `(0,0,-1)` after a
  refactor; restored to actual viewer orientation.

### Docs

- **`docs/superpowers/specs/2026-05-25-quest3-mr-surface-design.md`** —
  design with goals, non-goals, architecture, anchor flow, state
  machine, server changes, dev workflow, error handling, testing,
  risks.
- **`docs/superpowers/plans/2026-05-25-quest3-mr-surface.md`** —
  13-task TDD plan with file paths, full code, expected commands and
  outputs.

## [0.6.0] — 2026-04-24

AR Phase 2 — a new `treeAr.html` surface runs the branching-coral tree
reef through 8th Wall SLAM tracking. All the tree-mode polish from
v0.5.x is now reachable through the AR client.

### Added

- **`treeAr.html`** — fourth client surface. `TreeApp` composes the
  same state machine, effects runner, `TreeReef`, `TreePlacement`,
  `TreePicker`, and socket as the desktop `tree.html`. On anchor-found
  the entire reef hierarchy (pieces, indicators, ghost, creatures)
  aligns to the SLAM pose. `?scale=N` URL override tunes the anchor
  multiplier (default 5, ~2.5m reef from ~50cm pedestal units) for
  tabletop vs room-scale deployments. `?tracker=noop` skips camera
  init for desktop smoke testing.
- **Persisted drag yaw.** Committed polyps retain the ghost rotation
  the user applied at placement. `attach_yaw` column added to the
  tree DB via pragma-guarded ALTER; plumbed through the shared
  schema, server routes, state-machine `GHOST_ROTATED` action, and
  `TreeReef.addPiece` (applies yaw around the parent attach-point
  normal). `TreePlacement` no longer bakes the world matrix into
  vertex positions, so `rotateGhost` can pivot on the correct axis
  via `rotateOnWorldAxis`.
- **Collision loosening.** `wouldCollide` now shrinks both AABBs to
  85% around their center before the intersection test, compensating
  for coral-nodule envelope inflation. User-reported "spot is
  blocked" rejections drop dramatically without permitting true
  skeleton overlap.
- **Drag-gate fix.** Pointer drags fall through to `OrbitControls`
  when `placing` is blocked — the camera can orbit again on slots
  that rejected a piece.
- **Shared `applyAnchorPose` helper** at
  `packages/client/src/tracking/anchor.ts`, with a `scaleMultiplier`
  parameter used by `TreeApp`. Lifted from the static method on
  landscape `Reef` so both surfaces share the decomposition.
- **Sea-life creatures (from v0.5.x window) now parent under
  `treeReef.anchor`.** In AR they track the SLAM pose and inherit the
  anchor scale instead of orbiting the world origin.

### Changed

- Placement hint when a slot is blocked now explains the cause
  ("Adding this piece here would touch another spot. Try a different
  piece.") rather than the generic "that spot is blocked" which read
  as a bug.

### Docs

- `docs/superpowers/specs/2026-04-24-ar-phase-2-migration.md` — Phase
  2 design rationale.
- `docs/superpowers/plans/2026-04-24-ar-phase-2-migration.md` — 7-task
  TDD plan executed against that spec.
- Three new `docs/DECISIONS.md` entries covering the yaw persistence
  approach, the new-surface Phase 2 pattern, and the collision shrink.

### Deployment notes

- Server migration is run on startup (`ensureColumn` in
  `ReefDb.migrate`). Rolling back the image without rolling back the
  DB leaves the `attach_yaw` column in place — old code ignores it,
  no data loss. Rolling the DB back without the image loses yaw
  values but nothing else.

## [0.5.0] — 2026-04-22

Tree mode — a third client surface for a fractal branching-coral web,
plus all the overnight polish that came after the initial landing.
Full scope includes PRs #73-#77 which were merged to main between
2026-04-22 and 2026-04-24 before the v0.6.0 cut.

### Added

- **Tree mode (`tree.html`)** — third client surface. Visitors attach
  small composable pieces to each other's exposed tips, growing a
  structure over time. Avatar-bioluminescent styling: bloom
  post-processing, vivid palette (magenta / cyan / violet / lime /
  orange), no translucency. Five variants (forked / trident /
  starburst / claw / wishbone) with 1-4 attach slots each. Separate
  reef in the DB (`tree_polyps` table, `/api/tree/*`, `/ws/tree`),
  seeded with a random Starburst at install so visitors always have
  something to branch off.
- **Coral realism pass** — surface nodules scattered along each
  branch segment, multi-octave vertex displacement biased outward,
  per-vertex color tint variation along the segment axis. Per-piece
  vertex counts jumped from 60–240 to 2000–3700 (under the 4000
  ceiling); branches now read as coral rather than smooth glowing
  tubes.
- **Sea-life spawners** — Shark, Clownfish, Jellyfish, Sea Turtle
  classes with orbit-param constructors. Randomised orbits so
  multiple creatures of the same type don't stack.
- **Undo last branch** — new `undoing` state kind, server
  `DELETE /api/tree/polyp/:id` route with leaf-only guard,
  client-tracked `lastCommittedId` invalidated when another user
  builds on top of the last-placed piece.
- **Mobile-first sea-life panel** — collapsible `Sea life` toolbar
  entry with per-creature counts and `−`/`+` controls. Bottom drawer
  on narrow viewports, dropdown from the trigger on wide screens.
  44×44px minimum touch targets.
- **Attach-indicator hit proxy** — invisible 2.5× sphere around each
  visible orb makes clicking the dots comfortable without growing the
  rendered marker. Visible orbs brightened too.
- **State machine refactor** — tree-mode placement logic split into a
  pure reducer (`packages/client/src/tree/state.ts`) and a
  dep-injected effect runner (`effects.ts`). 93 Vitest tests on the
  reducer including an exhaustive 56-cell no-op matrix (4 states ×
  14 actions). `tree.ts` drops from ~482 lines to a thin orchestrator
  around `dispatch(action)`.

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
