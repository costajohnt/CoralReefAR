# Design Decisions

Running log of significant architectural and design choices made
during CoralReefAR development. Each entry captures the decision,
the context that forced it, the rationale, and the trade-offs
accepted. For current state see
[`NEXT_STEPS.md`](../NEXT_STEPS.md). For implementation detail see
[`docs/superpowers/plans/`](superpowers/plans/). For version
history see [`CHANGELOG.md`](../CHANGELOG.md).

---

## 2026-04-24 — Persisted drag yaw lives in the state machine, applied around the attach-point normal

**Context:** Visitors could drag to rotate the ghost of a pending coral
piece, but the rotation was visual-only. On commit, the POST payload
didn't include yaw and the server had no column for it, so the committed
piece rendered at the canonical attach-normal orientation and "snapped
back" from the user's drag. User-reported.

Separately, `TreePlacement.rotateGhost` used `mesh.rotateY(delta)` after
`mesh.applyMatrix4(worldMatrix)` had baked the alignment transform
into vertex positions. With an identity transform post-bake, `rotateY`
rotated around world +Y — which was only the attach normal for the tree
root, not side branches.

**Options considered:**
1. Add `attachYaw` as a transient client-only field on `TreeReef.addPiece`
   so the committed piece gets the rotation applied at render time
2. Persist `attachYaw` through the full stack (schema → server → wire →
   client state → render) — matches `attachIndex` pattern
3. Store the combined orientation as a quaternion rather than a scalar
   yaw, to support arbitrary free rotation later

**Decision:** Option 2 — `attachYaw: number` (radians) persisted end-to-end.
SQLite column added via imperative pragma-guarded ALTER in `ReefDb.migrate`
(ALTER TABLE ADD COLUMN has no IF NOT EXISTS form). Yaw is tracked on
`placing` + `submitting` state kinds as `yawRad`, accumulated via new
`GHOST_ROTATED` action. Effects layer calls `placement.rotateGhost` only
via state dispatch — no direct mutation path.

Separately, `TreePlacement.showGhost` no longer bakes the world matrix
into vertex positions. The mesh keeps a live `position`/`quaternion`
transform, and `rotateGhost` uses `rotateOnWorldAxis(attachNormal, delta)`
so the pivot axis matches what `TreeReef.addPiece` applies at commit.

**Rationale:**
- Scalar yaw matches the UX: drag rotates in one plane around the
  attach normal. A full quaternion is unnecessary complexity for now.
- Single source of truth in state machine; the reducer tests already
  cover carry-across transitions (GROW_CLICKED, COMMIT_REJECTED).
- Pivoting via `rotateOnWorldAxis` through a live transform avoids
  accumulating rounding error from repeated vertex-matrix applications.

**Trade-offs accepted:**
- Migration is imperative in `db.ts`, breaking the otherwise
  all-SQL-file migration pattern. Contained to one `ensureColumn` helper.
- Client + server need a coordinated deploy: a client that sends
  `attachYaw` to a server without the column will 500 on insert. Safe
  because the deploy pipeline updates both together.

**Artifacts:** commits `a10004e` (server), `c761e2c` (client), on the
`tree-overnight` branch.

---

## 2026-04-24 — AR Phase 2 migration is a new surface (`treeAr.html`), not a query-param fork of `index.html`

**Context:** `DECISIONS.md 2026-04-22` ("Tree mode Phase 1 → Phase 2
staging") committed to migrating the AR client to read tree data once
tree-mode visuals felt right. The original spec (first pass) proposed a
`?reef=tree` query param inside `index.html` to swap between landscape
and tree without a new HTML file.

Verification showed each existing surface has its own hand-crafted HTML
with surface-specific picker markup: `index.html` hardcodes landscape
species (branching/bulbous/fan/tube/encrusting), `tree.html` hardcodes
tree variants (forked/trident/starburst/claw/wishbone). A query-param
fork would have to inject markup at runtime for the non-default surface,
or keep both pickers in one DOM and hide one.

**Decision:** Add `treeAr.html` + `packages/client/src/treeAr.ts` +
`packages/client/src/treeApp.ts` as a fourth surface. Composition pattern
for `TreeApp`: import the same `TreeReef`, `TreePlacement`,
`AttachIndicators`, `TreePicker`, state machine, effects, socket the
desktop `tree.html` uses. Drops desktop-only pieces: no `OrbitControls`,
no `createUnderwaterBackground`, no `createUnderwaterFog`, no
`createBloomComposer`. Keeps `installUnderwaterLighting`.

`Reef.applyAnchorPose` lifted from a static method on the landscape
`Reef` class to `packages/client/src/tracking/anchor.ts` as a shared
helper. Takes an optional `scaleMultiplier` (default 1) so `TreeApp`
can request room-scale rendering by passing e.g. 5.

**Rationale:**
- Matches existing project pattern (one HTML per surface).
- `TreeApp` imports existing modules instead of forking them; zero
  duplication of the state machine or the effects runner.
- Landscape surface stays fully intact; `?reef=landscape` continues to
  work. Retirement of the landscape client is a follow-up PR after
  field validation.
- `scaleMultiplier` is a single knob at the anchor level, not a
  pervasive change to generator units or collision constants.

**Trade-offs accepted:**
- Two AR surfaces deployed side-by-side during transition period. Visitors
  get different experiences depending on URL until retirement happens.
- Bloom is off for the first AR migration; the palette will look duller
  on phones than on desktop. Accepted per earlier decision on bloom cost
  on mobile GPUs; revisit with a Kawase-style cheap preset if needed.

**Artifacts:** spec at `docs/superpowers/specs/2026-04-24-ar-phase-2-migration.md`,
plan at `docs/superpowers/plans/2026-04-24-ar-phase-2-migration.md`,
commits `8f5c2cf`, `6b93e84`, `282b8ed`, `f986fcb`, `bc077aa`, `daded10`
on `tree-overnight`.

---

## 2026-04-24 — Collision AABBs shrink by 15% before intersection test

**Context:** The coral-realism pass (PR #77) added surface nodules that
extend roughly 20–30% of segment radius outward from the skeleton
cylinder. Nodule vertices are included in `computeAABB(positions)`, so
each piece's world AABB is noticeably wider than its skeleton cylinder.
Users started hitting "That spot is blocked" on attach slots that
visually had clear space between skeleton cylinders. User-reported.

**Options considered:**
1. Compute a skeleton-only AABB in the generator (separate positions
   tracker before nodule emit), expose as a second output field,
   `TreePlacement` uses it for collision
2. Shrink both boxes by a constant factor around their centers before
   the intersection test in `wouldCollide`
3. Keep behavior; just update the hint wording to explain the "touching"
   behavior as intentional (the already-landed hint fix)

**Decision:** Both (3) — the hint clarifies intent — AND (2), the shrink
factor, for the user's practical complaint. Skipped (1) for now because
it requires restructuring `emitFrustum` to surface skeleton vs full
positions, and the shrink approximation is close enough (0.85 ≈
skeleton/full ratio across the five variants).

**Rationale:**
- Shrinking each box by 15% around the center permits the shrunk boxes
  to pass through each other exactly when the skeleton cylinders would
  clear — the nodule envelopes can graze without the placement check
  seeing it as overlap.
- Low-risk one-file change in `collision.ts`, no generator work needed,
  no cross-package coordination.
- User can revert or tighten by adjusting a single constant.

**Trade-offs accepted:**
- The shrink is a uniform approximation; variants whose nodule/skeleton
  ratio is higher than 0.85 might still hit false blocks, and variants
  with lower ratios might permit slightly-overlapping skeletons.
- Not a principled physical-collision model; escalating to capsule-vs-
  capsule or skeleton-only AABB remains the future path if the
  approximation proves too loose in practice.

**Artifacts:** commit `8f51810` on `tree-overnight`.

---

## 2026-04-19 — Migrate from retired hosted 8th Wall to self-hosted engine binary

**Context:** 8th Wall's hosted platform (`apps.8thwall.com/xrweb?appKey=…`)
was retired Feb 28, 2026. The existing `tracking/eightwall.ts` depended
on the cloud-hosted engine + app key pattern.

**Options considered:**
1. Self-host `@8thwall/engine-binary` (their post-shutdown distribution)
2. Replace with MindAR (open-source, pure marker tracking)
3. Dual-provider with runtime fallback

**Decision:** Self-host `@8thwall/engine-binary`. Drop MindAR entirely
— it was only ever a stub and would require significant architectural
surgery to become a working fallback (MindARThree owns its own
renderer/scene/camera, conflicting with our existing stack).

**Rationale:**
- SLAM is the single biggest driver of perceived AR quality; 8th Wall
  has it, MindAR doesn't
- Self-hosted means no phone-home, no appKey, no account — aligns
  with the $0-ongoing-cost goal
- Niantic Spatial signaled binary-engine maintenance ends ~March 2026
  with existing self-hosted projects working through Feb 28, 2027 —
  2-3 year runway is acceptable for an installation piece

**Trade-offs accepted:**
- If a tracker bug surfaces after upstream EOL, we probably can't get
  it fixed
- Single point of failure on engine availability

**Artifacts:** PR #30, version pin to `1.0.0` in PR #34.

---

## 2026-04-19 — Fly deploy gated to manual-only while paused

**Context:** Fly.io trial orgs require a credit card before any VM
runs. Decided to defer in favor of Beelink/Proxmox. But
`.github/workflows/fly-deploy.yml` was triggering on every push to
`main`, failing red, and masking any future real Fly failure.

**Decision:** Drop the `push: branches: [main]` trigger. Keep
`workflow_dispatch` for manual invocation. Document the restore
path in NEXT_STEPS so flipping it back is one line.

**Rationale:** Fail-closed default is better than persistent red CI
that everyone learns to ignore. The deploy pipeline should either
work silently or not run.

**Trade-offs accepted:** Resuming Fly deploys requires a manual
edit to the workflow file.

**Artifacts:** PR #31.

---

## 2026-04-21 — Fastify 4 → 5 migration

**Context:** PR #52 (reverting `@fastify/cors` 11 → 9) was a bandage
— the real answer was upgrading Fastify itself. Other plugin bumps
(`@fastify/websocket` 11, `@fastify/static` 8) were also blocked on
Fastify 5.

**Decision:** Migrate Fastify 4.29 → 5.8.5, unpin cors back to 11,
bump websocket 10 → 11, bump static 7 → 8. Bundle as one PR.

**Rationale:**
- Unpinning cors + bumping websocket + bumping fastify are
  interlocked — none of them work alone
- The boot smoke test added in PR #55 validates the full plugin
  load order, so we have regression coverage
- Fastify 4 is LTS until mid-2026; migrating early means breathing
  room on future plugin bumps

**Trade-offs accepted:** Fastify 5 breaking changes had to be
audited; happily, our usage didn't touch any of the removed APIs
(`schemaErrorFormatter`, route `constraints`, decorate-with-options,
`exposeHeadRoutes`). Zero code changes needed.

**Artifacts:** PR #69, issue #54.

---

## 2026-04-22 — Playground as a second surface (not a replacement)

**Context:** Testing the AR experience requires a printed marker, a
phone with camera permissions, museum-like lighting, and SLAM
tracking to all cooperate. That's a 20-minute setup for each
iteration. Development velocity was tied to physical-world access.

**Decision:** Ship `playground.html` as a third Vite entry
alongside `index.html` (AR) and `preview.html` / `timelapse.html`.
Orbit-camera Three.js view with click-to-place on a virtual
pedestal. Reuses `Reef`, `Placement`, `Picker`, `ReefSocket`, and
all scene effects. Adds `?mode=screen` auto-orbit variant for the
eventual museum-wall display.

**Rationale:**
- Same backend, same data, same sim loop — just a different view
- Dev cycle drops from 20 minutes to 2 seconds (edit + refresh)
- The `?mode=screen` variant doubles as a real installation
  artifact (wall-mounted monitor next to the pedestal)
- Extending `Placement.showGhost` with an optional
  `positionOverride` parameter was the only invasive change, and
  it's backwards-compatible

**Trade-offs accepted:**
- Two surfaces to maintain; the playground can't fully substitute
  for AR testing (no camera, no SLAM, no marker)
- Playground is desktop-mouse-only; touch is deferred

**Artifacts:** PR #71, v0.4.0 release, deployed to LXC 300.

---

## 2026-04-22 — Tree mode as a different reef (not a new view of the same reef)

**Context:** The user wanted visitors to build on each other's pieces
— existing polyps exposing attach points where new polyps connect.
Initial sketches proposed extending the landscape `Reef` with a
`parentId` field so all polyps could be either root-on-pedestal or
child-of-parent.

**Options considered:**
1. Single polyp table, `parent_id` nullable — one reef with both
   modes possible
2. Separate `tree_polyps` table, distinct routes + WS namespace —
   two independent reefs
3. Fork the whole codebase into a new repo

**Decision:** Option 2 — separate table, separate routes
(`/api/tree/*`), separate WebSocket hub (`/ws/tree`).

**Rationale:**
- Different schema (tree needs `parent_id` + `attach_index`;
  landscape doesn't; forcing nulls everywhere is ugly)
- Different placement model (tree: raycast against attach-point
  orbs; landscape: raycast against a pedestal plane)
- Different visual aesthetic (Avatar-bioluminescent vs
  subtly-reef-realistic)
- Different growth pattern (web of children vs scatter of
  independent pieces)
- Mixing both in one table invites accidental display of one in
  the other's UI

**Trade-offs accepted:**
- Duplicated server routes (`/api/reef/*` and `/api/tree/*`)
- Two hubs to maintain
- No single "grand unified reef" view (if you want that later, it's
  a join)

**Artifacts:** Plan at
[`docs/superpowers/plans/2026-04-22-tree-mode.md`](superpowers/plans/2026-04-22-tree-mode.md).

---

## 2026-04-22 — Fractal web, not coral tree with a trunk

**Context:** Initial framing was "pieces build on pieces like a
tree." The user clarified the vision: not a tree with a trunk, but
a **fractal branching-coral web** — no dominant axis, no visible
root. The installation's endpoint is a dense structure that
potentially fills a room through AR after a week of visitor
contributions.

**Decision:**
- Every variant follows the same "base + N tips" shape grammar —
  interchangeable, every piece attaches to every other piece
- Five variants chosen to actively break verticality: Forked (2
  tips), Trident (3), Starburst (4), Claw (bends 60° off the parent),
  Wishbone (two long horizontal curves)
- Auto-seed a Starburst at the origin on install so the very first
  visitor already has 4 attach points radiating in 4 directions —
  no one piece becomes "the trunk"

**Rationale:** The "trunk" framing suggested vertical growth and a
hierarchy. "Fractal web" is horizontal as much as vertical,
self-similar at every scale, and has no single dominant piece.
Starburst as the seed drives immediate multi-directional spread.

**Trade-offs accepted:**
- More geometrically complex than a single-tip branch; AABB
  collision becomes more important because branches cross in 3D
  space
- Visitors don't get to plant the very first piece — an
  install-time seed plays that role

**Artifacts:** Plan doc.

---

## 2026-04-22 — Avatar-bioluminescent aesthetic for tree mode

**Context:** The current landscape reef uses subtle translucency
(opacity 0.85) with low emissive (intensity 0.2, white). The user
wants tree mode to read as **surreal and fluorescent** — closer to
Pandora's bioluminescent flora than wet coral.

**Decision:**
- Opacity 1.0 (fully opaque — fluorescent things don't look
  translucent)
- `emissive: material.color` (glow color-matches the surface color,
  not a generic white)
- `emissiveIntensity: 1.0` (was 0.2)
- `UnrealBloomPass` post-processing (threshold ~0.4, strength ~1.2,
  radius ~0.6) — this is the single biggest lever; turns emissive
  into visible halos
- Vivid palette (magenta, cyan, violet, lime, orange) — high
  saturation, mid-to-high brightness
- Pulse + sway retained but amplitude bumped to match higher
  baseline

**Rationale:** Bloom is *the* technique for glow-as-light-emission.
Without it, emissive just brightens the surface. With it, bright
pixels leak halos into surrounding dark pixels — which is how every
Avatar shot works.

**Trade-offs accepted:**
- Bloom costs 2-4ms/frame on modern GPUs — trivial for desktop
  screen view, potentially rough for phone AR (which is why this
  aesthetic is scoped to tree mode, not the existing AR client)
- Fully-opaque pieces lose the "wet-gelatinous" quality the
  landscape reef has; intentional — different reefs have different
  moods

**Artifacts:** Plan doc, Task 15 (material preset) + Task 21 (scene
with bloom composer).

---

## 2026-04-22 — Tree mode Phase 1 → Phase 2 staging

**Context:** Ideal endpoint is that the **AR client** reads the same
tree data as the screen views — pedestal becomes a portal into the
same fractal web the wall monitor shows. But getting tree mode
looking right has its own iteration cycle, and mixing that iteration
with AR device testing would slow both.

**Decision:**
- **Phase 1 (in the current plan):** tree mode ships as a browser
  surface (`tree.html`) with its own data. Landscape reef stays
  intact. AR client still shows landscape.
- **Phase 2 (deferred):** once tree-mode visuals feel right, migrate
  the AR client to read tree data. Landscape mode becomes vestigial
  or retires.

**Rationale:**
- Fast iteration: every tree-mode tweak is `pnpm --filter @reef/client
  dev` + refresh
- Derisks visuals before touching AR
- Phase 2 is a small change (swap the data source in `app.ts`) once
  tree mode proves out

**Trade-offs accepted:**
- Two working reefs in the DB during Phase 1 (landscape and tree,
  side by side)
- An interim "the AR pedestal shows one reef but the wall monitor
  shows another" state

**Artifacts:** Plan doc, staging note in PLAN.md.

---

## 2026-04-22 — AABB collision for tree placements (MVP)

**Context:** "Two branches shouldn't occupy the same space" —
explicit user requirement for realism. Full mesh-intersection
collision is expensive; bounding-box collision is fast and
approximate.

**Decision:** Client-side AABB-vs-AABB check on placement. Reject
a placement if the new piece's world-space bounding box would
intersect any existing piece's bounding box.

**Rationale:**
- `Three.Box3.intersectsBox` is a one-line fast check
- For the installation's expected size (50-200 pieces), even naive
  all-pairs AABB is trivial
- Client-side for MVP because immediate UX feedback is more
  important than defense-in-depth at this stage

**Trade-offs accepted:**
- Thin branches that spatially avoid bounding-box overlap but
  visually cross will pass the check
- No server-side protection against a scripted POST bypass;
  deferred to a follow-up issue
- If the visual result looks messy in practice, escalate to
  capsule-vs-capsule

**Artifacts:** Plan doc, Task 19 (collision helper) + Task 20
(placement integration).

---

## 2026-04-22 — Leaf-only delete for tree mode

**Context:** What happens when an admin deletes a piece in the
middle of a tree? Options: cascade (delete children too), orphan
(show floating pieces), or refuse (require bottom-up deletion).

**Decision:** Refuse deletion of any piece with live children. The
admin must delete leaves first, then walk up.

**Rationale:**
- Zero orphans, ever — the tree stays structurally honest
- Makes moderation deliberate — you can't accidentally wipe out a
  dozen visitors' contributions by clicking "delete" on a root
- Simplest behavior to explain to the admin UI

**Trade-offs accepted:**
- Deleting a deeply-nested piece requires multiple admin actions
- No bulk-delete-a-subtree flow (deferred; could add with
  confirmation UI later)

**Artifacts:** Plan doc, TreeDb spec.

---

## Format for new entries

```markdown
## YYYY-MM-DD — One-line decision summary

**Context:** What made this a decision (the problem, the forcing
function, the observation that needed action).

**Decision:** The concrete choice.

**Rationale:** Why this option over the others.

**Trade-offs accepted:** What we gave up by choosing this.

**Artifacts:** Links to PRs, plans, issues, commits.
```

Keep entries terse. The log is a **reference**, not prose — scan
quickly, understand why the code looks how it looks. Don't
editorialize.
