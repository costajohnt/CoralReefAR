# AR Phase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `treeAr.html` — a new AR surface that renders the tree reef through the 8th Wall tracker, reusing tree-mode's existing state machine, effects runner, TreeReef, TreePlacement, TreePicker, and socket. Landscape surface untouched.

**Spec:** `docs/superpowers/specs/2026-04-24-ar-phase-2-migration.md`. Read before starting.

**Branch:** stacked on current development (tree-coral-realism → tree-ui-undo → main). Target `main`; rebase as needed before the PR.

**Defaults locked (not knobs to ask about):**

- `SCALE = 5` (reef anchor scale multiplier; tune in the field via follow-up)
- Creatures live under `treeReef.anchor` (inherit scale)
- Landscape surface stays indefinitely — retirement is a follow-up PR

## File structure

**New:**

- `packages/client/src/tracking/anchor.ts` — `applyAnchorPose(anchor: Group, poseMatrixElements: ArrayLike<number>, scaleMultiplier?: number): void`
- `packages/client/src/tracking/anchor.test.ts` — unit tests for the helper
- `packages/client/src/treeApp.ts` — `TreeApp` class (AR orchestrator using tree data)
- `packages/client/src/treeAr.ts` — bootstrap (≈25 lines, parallel to `main.ts`)
- `packages/client/treeAr.html` — HTML entry, tree picker markup, 8th Wall script tag

**Modified:**

- `packages/client/src/scene/reef.ts` — delete the static `Reef.applyAnchorPose` method; replace its usage in `app.ts` with the shared helper import. Behavior preserved.
- `packages/client/src/app.ts` — import + call `applyAnchorPose` from the new shared module (1-line change at line 89).
- `packages/client/src/tree.ts` — add creatures under `treeReef.anchor` instead of `scene`. Four lines change (the four spawn helpers). Preserves tree.html visuals.

**Unchanged (verified before starting):**

- `packages/client/src/tree/{state,effects,reef,placement,indicators,variants,material,scene,config,api,shark,clownfish,jellyfish,seaTurtle,pulse}.ts`
- `packages/client/src/tracking/{eightwall,noop,index}.ts`
- `packages/client/src/ui/treePicker.ts`
- `packages/generator/**/*`, `packages/server/**/*`, `packages/shared/**/*`

---

## Task 1: Shared `applyAnchorPose` helper

Extract the static method from `Reef` into a pose-agnostic module so both `App` (landscape) and `TreeApp` (AR tree) can use it. Add an optional `scaleMultiplier` argument.

**Files:**
- Create: `packages/client/src/tracking/anchor.ts`
- Create: `packages/client/src/tracking/anchor.test.ts`
- Modify: `packages/client/src/scene/reef.ts` (remove static method)
- Modify: `packages/client/src/app.ts` (swap call site)

- [ ] **Step 1: Write failing tests** in `anchor.test.ts`:
  - Identity pose with `scaleMultiplier` undefined → anchor position `(0,0,0)`, quaternion identity, scale `(1,1,1)`.
  - Identity pose with `scaleMultiplier = 5` → scale `(5,5,5)`.
  - Non-identity pose (translation `(1,2,3)`) → position applied, `scaleMultiplier = 2` multiplies decomposed scale.
  - Empty or non-16-length array input → no-op (behavior from existing static method).

- [ ] **Step 2: Verify failure.** `pnpm --filter @reef/client test src/tracking/anchor.test.ts`

- [ ] **Step 3: Implement** `anchor.ts`:

  ```ts
  import { Group, Matrix4, Quaternion, Vector3 } from 'three';

  export function applyAnchorPose(
    anchor: Group,
    poseMatrixElements: ArrayLike<number>,
    scaleMultiplier = 1,
  ): void {
    if (poseMatrixElements.length !== 16) return;
    const m = new Matrix4();
    const te = m.elements;
    for (let i = 0; i < 16; i++) te[i] = poseMatrixElements[i] ?? 0;
    const pos = new Vector3();
    const quat = new Quaternion();
    const scl = new Vector3();
    m.decompose(pos, quat, scl);
    anchor.position.copy(pos);
    anchor.quaternion.copy(quat);
    anchor.scale.copy(scl.multiplyScalar(scaleMultiplier));
    anchor.matrix.copy(m);
  }
  ```

- [ ] **Step 4: Remove `Reef.applyAnchorPose` static method** from `scene/reef.ts` and replace the call at `app.ts:89` with `applyAnchorPose(this.reef.anchor, pose.elements)` imported from `./tracking/anchor.js`.

- [ ] **Step 5: Verify.** `pnpm --filter @reef/client typecheck && pnpm --filter @reef/client test`. All tests pass.

- [ ] **Step 6: Commit.**

  ```
  Tracking: extract applyAnchorPose to shared helper + scaleMultiplier

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

---

## Task 2: Reparent creatures under tree anchor

Creatures currently attach to `scene` in `tree.ts`. Reparenting them to `treeReef.anchor` means they move with the SLAM pose in AR and inherit the anchor scale. Tree.html's desktop view is unaffected because the anchor's transform is identity there.

**Files:**
- Modify: `packages/client/src/tree.ts` (four spawn helpers)

- [ ] **Step 1: Change the four `spawnX()` functions** in `tree.ts` — replace `scene.add(X.group)` with `treeReef.anchor.add(X.group)` in each of `spawnShark`, `spawnClownfish`, `spawnJellyfish`, `spawnSeaTurtle`.

- [ ] **Step 2: Verify.** `pnpm --filter @reef/client typecheck && pnpm --filter @reef/client test`. All tests pass; existing creature tests don't assert scene graph parentage.

- [ ] **Step 3: Manual sanity** — reload `http://localhost:5173/tree.html`, spawn each creature, confirm they still orbit the tree visually (they should; the anchor is at origin in tree.html).

- [ ] **Step 4: Commit.**

  ```
  Tree: add creatures under treeReef.anchor for AR anchor inheritance

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

---

## Task 3: `treeAr.html` + `treeAr.ts` bootstrap skeleton

The landing page + 8th Wall script tag + picker markup + start button, and a minimal bootstrap that instantiates `TreeApp` (which doesn't exist yet — stub it).

**Files:**
- Create: `packages/client/treeAr.html`
- Create: `packages/client/src/treeAr.ts`
- Create: `packages/client/src/treeApp.ts` (skeleton: empty `TreeApp` class with `start()` / `stop()` no-ops)

- [ ] **Step 1: Write `treeAr.html`** — copy structure from `index.html` (landing, `#cam`, `#gl`, `#status`) but use the tree picker markup from `tree.html` (forked/trident/starburst/claw/wishbone, reroll/cancel/grow/hint). Keep the 8th Wall script tag. Include mode-badge and the sea-life toolbar+panel markup from `tree.html` so users get the same controls. `<script type="module" src="/src/treeAr.ts"></script>`.

- [ ] **Step 2: Write `treeAr.ts`** — copy structure from `main.ts`. Read config via `readTreeConfig()`. Instantiate `TreeApp` with the canvas/video/picker/status elements. On Start-button click, call `treeApp.start()`.

- [ ] **Step 3: Write skeleton `treeApp.ts`** — export `TreeApp` class with constructor params matching `AppOptions` (canvas, video, pickerRoot, statusEl), plus `start(): Promise<void>` and `stop(): void` methods that are no-ops.

- [ ] **Step 4: Verify.** `pnpm --filter @reef/client typecheck`. Opening `http://localhost:5173/treeAr.html` should show the landing page with the Start button.

- [ ] **Step 5: Commit.**

  ```
  Tree AR: scaffold treeAr.html + treeAr.ts bootstrap + empty TreeApp class

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

---

## Task 4: `TreeApp` — scene, camera, tracker, render loop

Fill in the scaffold. Renderer is transparent (alpha) for camera passthrough. No underwater background, no fog, no bloom. Underwater lighting retained. No `OrbitControls`.

**Files:**
- Modify: `packages/client/src/treeApp.ts`

- [ ] **Step 1: Implement** the renderer + scene + camera + tracker lifecycle, mirroring `app.ts:47–114` but swapping:
  - `Reef` → `TreeReef` (create `this.treeReef = new TreeReef()`; add `this.treeReef.anchor` to the scene).
  - `installLighting` → `installUnderwaterLighting` (from `./tree/scene.js`).
  - No `createUnderwaterBackground`, no `createUnderwaterFog`, no `createBloomComposer`.
  - In `onAnchorFound`: call `applyAnchorPose(this.treeReef.anchor, pose.elements, SCALE)` with `SCALE = 5` module-level constant.
  - Render loop: `this.renderer.render(this.scene, this.camera)` directly (no bloom composer).

- [ ] **Step 2: Verify typecheck.** Browser: open `treeAr.html`, tap Start, point at the 8th Wall marker. Anchor should find + scene should render (empty tree, no polyps yet — that's Task 5).

- [ ] **Step 3: Commit.**

  ```
  Tree AR: TreeApp scene + camera + tracker lifecycle

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

---

## Task 5: `TreeApp` — state machine, picker, tap-to-attach

Wire the existing state machine (same `reduce`, same `createEffects`) into `TreeApp`. Wire the picker. Implement tap-to-attach that raycasts against `attachIndicators.group.children` and dispatches `ATTACH_CLICKED`.

**Files:**
- Modify: `packages/client/src/treeApp.ts`

- [ ] **Step 1: Compose modules** — instantiate `TreePlacement`, `AttachIndicators`, `TreePicker` inside `TreeApp`. Add their groups/anchors under `treeReef.anchor` (not scene) so they inherit the SLAM pose + scale.

- [ ] **Step 2: Wire state machine** — `let state = initialState(picker.get())`; implement `dispatch(action)` that calls `reduce` then `effects.apply(prev, next, action)`. `createEffects` gets `{ placement, treeReef, indicators, picker, hintEl, apiBase, dispatch, addPiecesAndRefresh }` exactly like `tree.ts`.

- [ ] **Step 3: Wire picker** — `picker.onChange`, `onReroll`, `onCancel`, `onCommit` → dispatch. Identical to `tree.ts`.

- [ ] **Step 4: Wire tap-to-attach** — in `handleTap(x, y)` raycast against `attachIndicators.group.children` (not against a reef ground plane like landscape). On hit, dispatch `ATTACH_CLICKED` with the indicator's `userData.parentId` / `userData.attachIndex`.

- [ ] **Step 5: Wire initial fetch** — `fetchTree(apiBase).then(...)` → `addPiecesAndRefresh(polyps)`. Same pattern as tree.ts.

- [ ] **Step 6: Wire socket** — `TreeSocket` on the appropriate WS URL, dispatch tree messages.

- [ ] **Step 7: Verify.** Browser smoke test on desktop via `?tracker=noop` query (uses `NoopProvider`, which pins the anchor in front of the camera — lets us iterate without the physical marker). Tree should render, tap an indicator, ghost appears, Grow commits.

- [ ] **Step 8: Commit.**

  ```
  Tree AR: TreeApp state machine + picker + tap-to-attach + socket

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

---

## Task 6: `TreeApp` — toolbar (Clear, Undo, creatures)

Wire the existing toolbar buttons in `treeAr.html` to dispatches / spawn helpers. Creature spawn helpers add to `treeReef.anchor` (not `scene`), reusing the same pattern from tree.ts (post-Task-2).

**Files:**
- Modify: `packages/client/src/treeApp.ts`

- [ ] **Step 1: Wire Clear, Undo** to `dispatch({ type: 'CLEAR_CLICKED' })` and `dispatch({ type: 'UNDO_CLICKED' })`.

- [ ] **Step 2: Wire the sea-life panel** toggle + `+`/`−` buttons to the creature spawn/remove helpers.

- [ ] **Step 3: Wire creature count refresh** matching tree.ts's `refreshPanel` pattern.

- [ ] **Step 4: Verify.** `pnpm --filter @reef/client typecheck && pnpm --filter @reef/client test`. Browser smoke: Clear, Undo, add/remove each creature type.

- [ ] **Step 5: Commit.**

  ```
  Tree AR: TreeApp toolbar + sea-life panel wiring

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  ```

---

## Task 7: Field smoke test + PR

Full workspace verification, then real-device AR smoke test.

- [ ] **Step 1: Workspace check.** `pnpm -r typecheck && pnpm -r test`. All green.

- [ ] **Step 2: Local dev smoke** — `pnpm --filter @reef/client dev` + `pnpm --filter @reef/server dev`. Load `http://localhost:5173/tree.html` (desktop tree — should be unchanged) and `http://localhost:5173/treeAr.html?tracker=noop` (AR tree via noop — should render with pinned anchor).

- [ ] **Step 3: Physical marker smoke** — deploy to the LXC (or serve over local HTTPS so 8th Wall will run), open `treeAr.html` on a phone, point at the printed marker. Verify: anchor finds, tree renders at SCALE=5 (~2.5m tall), tap-to-attach works, indicators are reachable at arm's length.

- [ ] **Step 4: PR** — target `main`. Body: spec link + per-task commit list + test plan (desktop smoke, marker smoke, both landscape + tree AR surfaces still load). Drafted via `draft-review-post` skill; wait for explicit approval.

---

## Follow-ups (not in this plan)

1. Retire landscape surface — delete `app.ts`, `scene/reef.ts`, `placement.ts`, landscape `Picker`, `FishSchool`. Own PR after field validation.
2. Mobile-safe bloom preset for AR tree.
3. Two-finger gesture for ghost rotation in AR.
4. Persisted drag yaw.
5. Dynamic SCALE control (pinch-to-resize or picker slider).
