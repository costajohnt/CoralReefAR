# AR Phase 2 — Tree Data in the AR Client

## Context

[DECISIONS.md 2026-04-22](../../DECISIONS.md) ("Tree mode Phase 1 → Phase 2 staging") promises that once tree-mode visuals feel right, the AR client migrates to read tree data. The pedestal on `tree.html` becomes a portal into the same fractal reef the AR client renders.

Current state (verified):

- `packages/client/src/app.ts` is the AR entry. It composes `Reef` (`packages/client/src/scene/reef.ts`), `Placement` (`packages/client/src/placement.ts`), `Picker` (`packages/client/src/ui/picker.ts`), `fetchReef`/`submitPolyp`, and `ReefSocket` (`polyp_added` / `polyp_removed` / `sim_update` / `hello`).
- The 8th Wall `TrackingProvider` (`packages/client/src/tracking/eightwall.ts`) emits `onAnchorFound({ pose })`; the app passes `pose.elements` into `Reef.applyAnchorPose(this.reef.anchor, pose.elements)` at `app.ts:89`. This static helper decomposes the 16-element matrix into `position/quaternion/scale` on the anchor `Group`. Everything else lives under that anchor and moves with it.
- Tree mode's `TreeReef` (`packages/client/src/tree/reef.ts`) owns its own `anchor: Group`, already bakes piece transforms into vertex positions under it, and exposes `allPieces()` / `getAvailableAttachPoints()` / `clear()`. It has no `applyAnchorPose` method — `Reef.applyAnchorPose` is pose-agnostic though (just decomposes a matrix onto any `Group`), so the same static helper works for a `TreeReef.anchor`.
- Sea-life creatures (`Shark`, `Clownfish`, `Jellyfish`, `SeaTurtle`) are currently added to `scene` directly in `tree.ts`, not under `treeReef.anchor`. In AR that means they'd orbit the world origin instead of the marker. They need to move under the tree anchor during migration.
- `DECISIONS.md 2026-04-22` ("Avatar-bioluminescent aesthetic for tree mode") explicitly notes: "Bloom costs 2-4ms/frame on modern GPUs — trivial for desktop screen view, potentially rough for phone AR (which is why this aesthetic is scoped to tree mode, not the existing AR client)." Bloom will need a mobile-AR preset or to be off entirely in the first migration.

## Goals

1. AR client renders the tree reef, not the landscape reef. Marker-found → tree anchored to marker, visitors can add/remove branches through the same state machine tree mode already uses.
2. Preserve the 8th Wall tracking lifecycle (`onAnchorFound` / `onAnchorLost` / anchor visibility) with no regressions. Tracking isn't touched.
3. Creatures live under the tree anchor so they move with the marker, not the world.
4. Introduce a single scale factor at the anchor level so "room-filling" is one config knob (default set once, tunable per deployment or via query param for site-testing).
5. Coexist with the landscape surface during migration — don't delete anything landscape-related until Phase 2 is proven in the field.

## Non-goals

- Any changes to the tree-mode state machine (`state.ts` / `effects.ts`) or generator. The AR client hosts the same state machine; it's just a different orchestrator calling `reduce` / `effects.apply`.
- WebXR. 8th Wall stays. This doc is about data/source swap, not tracker swap.
- Landscape retirement. Landscape reef, `Reef`, landscape `Placement`, `FishSchool`, `ReefSocket`'s `sim_update` path remain intact and reachable via an opt-out path until a follow-up PR deletes them.
- New interaction patterns. Tap-an-attach-indicator is the interaction; same as tree mode.
- 2+ branches per attach point, persisted drag yaw, rejection toasts — same deferrals DECISIONS.md and the state-machine spec already list.

## Architecture

Three decisions shape the migration:

### D1 — New surface alongside existing, not destructive rewrite

The project already follows a "one HTML file per surface" pattern: `index.html` (AR landscape), `tree.html` (desktop tree), `playground.html` (desktop orbit). `index.html` hardcodes the landscape picker species in markup; `tree.html` hardcodes the tree variants. A query-param fork inside `index.html` would mix the two picker markups.

Phase 2 introduces a fourth surface: `treeAr.html` (AR tree data), bootstrapped by `packages/client/src/treeAr.ts`, which instantiates a new `TreeApp` class. It imports the same `TreeReef` / `TreePlacement` / `TreePicker` / state machine the desktop `tree.html` uses, plus the 8th Wall `TrackingProvider` the existing `app.ts` uses.

`index.html` + `app.ts` + landscape `Reef` keep working unchanged. `treeAr.html` lingers as the AR tree testbed until field-validated, at which point a follow-up PR either retires the landscape surface (rename `treeAr.html` → `index.html`) or keeps both as separate deployed entry points.

### D2 — TreeApp composes existing tree-mode modules, not parallel copies

`TreeApp` (`packages/client/src/treeApp.ts`) imports the same `TreeReef`, `TreePlacement`, `AttachIndicators`, `TreePicker`, `initialState` + `reduce`, `createEffects` that `tree.ts` uses. No forks. The differences from `tree.ts` are:

- No `OrbitControls`. Camera is driven by the tracker, not user input.
- No `createUnderwaterBackground`, no `createUnderwaterFog`. In AR the background is the camera feed (`clearColor` stays transparent on `WebGLRenderer(alpha:true)`, as in current `app.ts`). Fog would interfere with passthrough.
- `installUnderwaterLighting` is kept (tree mode relies on it for the bioluminescent palette), but `createBloomComposer` is replaced by a direct `renderer.render(scene, camera)` for the first migration. A mobile-safe bloom preset can land as a follow-up.
- No pointer-drag rotation of the ghost for the first cut. Keep placement dead-simple: tap an attach indicator, preview the ghost, commit via the Grow button. Drag rotation can reappear as a two-finger gesture in a follow-up if needed.
- `Reef.applyAnchorPose` is lifted to a shared helper `applyAnchorPose` in `packages/client/src/tracking/anchor.ts` (pose-agnostic; both landscape and tree anchors call it). No behavior change.
- Tap-to-attach raycasts against `attachIndicators.group.children` (same as current `tree.ts`), but takes the screen coords from `touchend`/`click` the same way `app.ts` does. The two-finger gesture path from `app.ts` is not brought over (no ghost rotation in v1).

The state machine is identical to tree-mode's. Picker, collision, reset flow, WebSocket message handling — all reused verbatim by importing the same modules.

### D3 — Scale at the anchor, not at the generator

`TreeApp` sets `treeReef.anchor.scale.setScalar(SCALE)` before the first pose arrives. The anchor's transform is what `applyAnchorPose` writes to on every anchor-found. Since the static helper decomposes the pose matrix and writes `position/quaternion/scale` directly, it will *overwrite* any pre-set scale on the next `onAnchorFound` call.

The fix: `applyAnchorPose` takes an optional third argument `scaleMultiplier` that multiplies the decomposed scale before it's applied. Default 1 preserves current behavior. `TreeApp` passes e.g. 5 to target a ~2–3m tall reef anchored to the marker.

Open tuning knobs (first cut values, iterate in the field):

- `SCALE = 5` — visual size of the full reef. 1 would match tree.html desktop scale (~50cm); 5 makes pieces ~75cm tall → full reef up to 2.5m.
- No change to piece-internal dimensions (generator output stays). Collision AABBs, attach-point distances, indicator radii all scale uniformly with the anchor.
- Scale also modifies the tap-raycast hit radius on indicators — no special handling needed, the proxy sphere geometry (`packages/client/src/tree/indicators.ts`) scales with its parent.

## Risks and open questions

**Creature orbit centers.** Sharks/clownfish/jellyfish/turtles compute positions from world-origin in the current tree mode. Under the anchor, world-origin lives at the marker after transform. But the orbit radius itself is scene-units; with `SCALE = 5`, a 0.3-unit shark orbit becomes a 1.5m radius swim loop around the reef — probably too big for a marker-tabletop setup, probably right for a room-scale install. **Decision needed**: apply the anchor scale to creature group too (creatures stay proportional to reef), or keep creature radii in absolute scene units and add scale-aware spawn params. First cut: add them under `treeReef.anchor` so they inherit the scale; tune orbit radii in spawn functions if they end up too wide.

**SLAM drift at distance.** 8th Wall's accuracy degrades with distance from the printed marker. A room-filling reef implies the visitor walks around it — they'll be 2–4m from the marker for long stretches. We don't have field data on drift at those distances. Mitigation options (not part of this spec; resurface if observed): larger marker, multi-marker anchor, or scale down if wobble is unacceptable.

**Mobile GPU budget without bloom.** Tree mode's palette depends on bloom for the glow look. Without bloom in AR, the material's `emissive` still brightens surfaces but doesn't produce halos. Visitors on the AR client will see a duller version of the desktop tree look. Option to revisit: a cheap "kawase blur + additive" cut of bloom tuned for mobile — ~1ms/frame instead of 2–4. Ship without bloom first, add back on measurement.

**Anchor scale + gestures.** `TreePlacement`'s collision and attach-point math all run in world space post-anchor-transform. Read through to confirm no assumptions about unit magnitude (e.g., minimum spacing constants hard-coded in meters-or-whatever). If any exist, multiply them by `SCALE` or factor the scale into the collision check.

## Out of scope follow-ups

1. Retire landscape client entirely — delete `app.ts`, `scene/reef.ts`, `placement.ts`, `FishSchool`, landscape `Picker`, landscape API/socket. Own PR after field validation.
2. Pointer/two-finger drag to rotate the ghost in AR.
3. Bloom preset for mobile AR.
4. Persisted drag yaw (same follow-up as tree mode).
5. Multi-marker or device-world-mesh anchoring for larger spaces.
6. Dynamic scale adjustment (slider in picker UI, or pinch-to-resize via two-finger gesture).

## Success criteria

1. Open `https://reef.home.local/?reef=tree` on a supported phone (8th Wall's required Safari/Chrome versions).
2. Point at the printed marker → tree anchor appears, any existing tree polyps render.
3. Tap an attach indicator → ghost previews, Grow button activates.
4. Tap Grow → piece commits, WebSocket echo updates the picker hint.
5. Walk around the reef → tracking holds, pieces stay where they were placed.
6. `?reef=landscape` still works (landscape reef still renders as before).
