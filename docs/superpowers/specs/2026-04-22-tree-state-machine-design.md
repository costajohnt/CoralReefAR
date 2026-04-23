# Tree Placement State Machine — Design Spec

## Context

The tree-mode client (`packages/client/src/tree.ts`) has grown organically since v0.5.0. State is spread across several module-level mutable variables:

- `pendingParentId`, `pendingAttachIndex`, `currentSeed` — owned by `tree.ts`
- `placement.pending`, `placement.ghost` — owned by `TreePlacement`
- `dragState`, `suppressNextClick` — pointer-drag scratch
- `picker.state` — owned by `TreePicker`

Multiple listeners (canvas click, `onChange`, `onReroll`, `onCancel`, `onCommit`, pointerdown/up, `clearBtn`, socket handler) read and write these fields with overlapping responsibilities. Concrete bug patterns observed so far:

- Reroll-twice: `setVariant` fired `onChange` which called `showGhost` with the stale seed, then reroll's explicit `showGhost` fired with the new seed. Both `showGhost` calls could reject on collision, leaving the user with no ghost and a dangling `pendingParentId`.
- Drag-rotate had to add `suppressNextClick` as a fourth piece of state to prevent clicks that were actually drags from re-attaching to the same slot.
- Cross-client socket echoes (e.g., `tree_polyp_added` from an own submit) were handled in the same code path as remote updates, with ad-hoc "is this our pending piece?" matching.

A deterministic state machine gives us one place to express what transitions are legal, one place to fire side effects, and exhaustive unit tests on the reducer with zero Three.js or DOM cost.

## Goals

1. Make invalid states unrepresentable via a TypeScript discriminated union.
2. Centralize transitions in a pure reducer for deterministic testing.
3. Eliminate ad-hoc module-level mutable flags in `tree.ts`.
4. Decouple "what the state is" from "what side effects fire" — bugs in either layer are isolated.

## Non-goals

- Changes to generator, `TreeReef`, `TreePlacement`, `TreePicker`, or `AttachIndicators` internals. Their public APIs are preserved.
- The "2+ branches per attach point" feature (requires schema migration; separate design).
- Indicator hit-test sizing (a simple constant bump; do separately if still needed after the refactor).
- The material + environment polish already in flight (orthogonal; stays as-is).

## Architecture

Three layers with strict boundaries:

**Layer 1 — Pure state (`packages/client/src/tree/state.ts`)**

- `TreeState` discriminated union.
- `TreeAction` discriminated union covering every user + network event that changes state.
- `reduce(state: TreeState, action: TreeAction): TreeState` — pure, deterministic, no imports from `three`, no DOM access, no network. Same input always yields same output.
- `initialState(picker: PickerSelection): TreeState` — factory for the starting idle state.

**Layer 2 — Effect runner (`packages/client/src/tree/effects.ts`)**

- `createEffects(deps): { apply(prev, next) }` factory.
- Dependencies are injected so the runner can be tested or swapped: `placement`, `indicators`, `picker`, `controls`, `hintEl`, `apiBase`, `treeReef`, `dispatch`.
- `apply(prev, next)` compares the two states and fires exactly the side effects implied by the transition. Runs synchronously.
- `placement.showGhost` is synchronous; its result (`mesh` or `null`) is immediately dispatched as `PLACEMENT_OK` or `PLACEMENT_BLOCKED`. That dispatch re-enters `apply`, which only updates commit-button/hint for a pure `blocked` flip — no infinite loop.
- Only the explicit async calls (`submitTreePolyp`, `resetTree`) defer and dispatch their terminal actions (`COMMIT_RESOLVED`/`REJECTED`, `RESET_RESOLVED`/`REJECTED`) on resolution.

**Layer 3 — Orchestration (`packages/client/src/tree.ts`)**

- Owns DOM element references, the `Scene`, `renderer`, `controls`, `placement`, `reef`, `picker`, `indicators`, `socket`, toolbar button listeners, and the render loop.
- One module-level `state: TreeState` variable.
- One `dispatch(action: TreeAction)` function: runs the reducer, then `effects.apply(prev, next)`.
- Every DOM event and socket message handler does exactly one thing: build an action and dispatch it.
- Pointer-drag ghost rotation stays local (a `dragState` closure) since it's imperative visual manipulation not logical state; it reads `state.kind === 'placing'` to decide whether to engage.

## State

```ts
export interface PickerSelection {
  variant: TreeVariant;
  colorKey: string;
}

export type TreeState =
  | { kind: 'idle'; picker: PickerSelection }
  | {
      kind: 'placing';
      picker: PickerSelection;
      parentId: number;
      attachIndex: number;
      seed: number;
      blocked: boolean;
    }
  | {
      kind: 'submitting';
      picker: PickerSelection;
      parentId: number;
      attachIndex: number;
      seed: number;
    }
  | { kind: 'resetting'; picker: PickerSelection };
```

Field meanings:

- `picker` — the user's current variant + color selection. Always present, carries across all transitions so picker UI is consistent.
- `parentId`, `attachIndex` — where the pending child will attach (`(parent_id, attach_index)` pair).
- `seed` — the random integer used to generate the mesh. Regenerated on variant change and reroll; preserved across color change (same shape, different hue).
- `blocked` (placing only) — `true` when the current placement collides with an existing piece (`showGhost` returned null). Grow button is disabled; user can still reroll, cancel, or pick a different attach slot.

## Actions

```ts
export type TreeAction =
  // Picker UI changes (always legal)
  | { type: 'VARIANT_CHOSEN'; variant: TreeVariant; seed: number }
  | { type: 'COLOR_CHOSEN'; colorKey: string }
  // Attach point selection
  | { type: 'ATTACH_CLICKED'; parentId: number; attachIndex: number; seed: number }
  | { type: 'REROLL_CLICKED'; variant: TreeVariant; seed: number }
  // Placement feedback from effects layer
  | { type: 'PLACEMENT_BLOCKED' }
  | { type: 'PLACEMENT_OK' }
  // Commit flow
  | { type: 'CANCEL_CLICKED' }
  | { type: 'GROW_CLICKED' }
  | { type: 'COMMIT_RESOLVED' }
  | { type: 'COMMIT_REJECTED'; error: string }
  // Reset flow
  | { type: 'CLEAR_CLICKED' }
  | { type: 'RESET_RESOLVED' }
  | { type: 'RESET_REJECTED'; error: string }
  // Remote reset: another client (or our own echo) reset the tree. No API
  // call fires for this — server has already done the work. Placement state
  // snaps to idle from any kind.
  | { type: 'TREE_RESET_EXTERNAL' };
```

All random values (seeds, reroll variants) are sampled by the caller before dispatch so the reducer stays pure. The reducer ignores a `seed` field on actions where the resulting state doesn't need it (e.g., `VARIANT_CHOSEN` while idle just updates the picker).

## Transitions

The reducer returns an unchanged state for any (state, action) pair not listed below. This makes illegal events silent no-ops — the UI surface (button disabled, indicator hidden, etc.) is the primary gate; the reducer is the safety net.

| From state | Action | To state | Payload carried / computed |
|---|---|---|---|
| any | `VARIANT_CHOSEN` | same kind | `picker.variant ← action.variant`. If in `placing`/`submitting`, also `seed ← action.seed`. |
| any | `COLOR_CHOSEN` | same kind | `picker.colorKey ← action.colorKey`. |
| `idle` | `ATTACH_CLICKED` | `placing` | inherits `picker`; `parentId/attachIndex/seed` from action; `blocked: false`. |
| `placing` | `ATTACH_CLICKED` | `placing` | inherits `picker`; updates `parentId/attachIndex/seed` from action; `blocked: false`. |
| `placing` | `REROLL_CLICKED` | `placing` | `picker.variant ← action.variant`; `seed ← action.seed`; `blocked: false`. |
| `placing` | `PLACEMENT_BLOCKED` | `placing` | `blocked: true`. |
| `placing` | `PLACEMENT_OK` | `placing` | `blocked: false`. |
| `placing` | `CANCEL_CLICKED` | `idle` | inherits `picker`. |
| `placing` (blocked=false) | `GROW_CLICKED` | `submitting` | copies `picker/parentId/attachIndex/seed`. |
| `placing` (blocked=true) | `GROW_CLICKED` | unchanged | no-op. |
| `submitting` | `COMMIT_RESOLVED` | `idle` | inherits `picker`. |
| `submitting` | `COMMIT_REJECTED` | `placing` | inherits all submitting fields; `blocked: false` (server may know something we don't — let user retry or reroll). |
| `idle`/`placing`/`submitting` | `CLEAR_CLICKED` | `resetting` | inherits `picker`. |
| `resetting` | `RESET_RESOLVED` | `idle` | inherits `picker`. |
| `resetting` | `RESET_REJECTED` | `idle` | inherits `picker`. |
| any | `TREE_RESET_EXTERNAL` | `idle` | inherits `picker`. No API call fires. |

Notes on intentional no-ops:

- `CANCEL_CLICKED` while `idle`, `submitting`, or `resetting` → no-op. Cancel has no meaning outside placing.
- `GROW_CLICKED` outside `placing` → no-op.
- `REROLL_CLICKED` outside `placing` → no-op.
- `ATTACH_CLICKED` during `submitting` or `resetting` → no-op. Buttons should be disabled by effects layer, but reducer is also defensive.
- `CLEAR_CLICKED` during `resetting` → no-op. Server call is already in flight.
- `PLACEMENT_BLOCKED/OK` outside `placing` → no-op. Late feedback from an effect that's no longer relevant (e.g., user canceled between the `showGhost` call and the blocked/ok dispatch). In practice `showGhost` is synchronous, so this is mostly defensive.
- `RESET_RESOLVED`/`RESET_REJECTED` outside `resetting` → no-op. Late response arriving after `TREE_RESET_EXTERNAL` already moved us to idle.
- `COMMIT_RESOLVED`/`COMMIT_REJECTED` outside `submitting` → no-op. E.g., user clicked Clear after Grow — server response for the (now-superseded) commit lands while we're in `resetting`; safely ignored.

## Side effects (effects.ts)

The effect runner looks at `(prev, next)` and fires the set of side effects the transition implies. Ordered for each transition so the UI never sees an intermediate inconsistent state.

- `* → placing` (fresh attach or slot change) **or** `placing → placing` with changed `parentId`/`attachIndex`/`variant`/`seed`/`colorKey`:
  1. `placement.showGhost(variant, seed, colorKey, parentId, attachIndex)` → mesh or null.
  2. Dispatch `PLACEMENT_BLOCKED` (if null) or `PLACEMENT_OK` (otherwise).
  3. `picker.setCommittable(!blocked)`.
  4. `hintEl.textContent` updates accordingly.

- `placing → placing` with only `blocked` flipping (pure PLACEMENT_BLOCKED/OK): update commit button + hint only.

- `placing → idle` (cancel): `placement.reset()`, `picker.setCommittable(false)`, hint.

- `placing → submitting` (grow):
  1. `picker.setSubmitting(true)`.
  2. `submitTreePolyp({ variant, seed, colorKey, parentId, attachIndex })`.
  3. On resolve → dispatch `COMMIT_RESOLVED`.
  4. On reject → write the error to `hintEl.textContent` first (error string is in scope in this callback), then dispatch `COMMIT_REJECTED { error }`. The subsequent `apply(submitting, placing)` doesn't need to know the error — it's already on screen.

- `submitting → idle` (commit resolved): `placement.reset()`, `picker.setSubmitting(false)`, `picker.setCommittable(false)`, success hint.

- `submitting → placing` (commit rejected): `picker.setSubmitting(false)`. Hint was already set by the async reject callback above; don't overwrite.

- `* → resetting` (user clicked Clear):
  1. `placement.reset()` and `picker.setCommittable(false)` immediately so any in-flight ghost disappears and the UI feels responsive before the network trip resolves.
  2. `resetTree(apiBase)` kicks off.
  3. On resolve → `treeReef.clear()`, `fetchTree()`, add returned polyps via `treeReef.addPiece`, `indicators.refresh()`, dispatch `RESET_RESOLVED`.
  4. On reject → dispatch `RESET_REJECTED`. No local mutation beyond step 1 — hint shows the error. User can retry.

- `resetting → idle` (either `RESET_RESOLVED` or `RESET_REJECTED`): hint update (success or error, respectively). No further API call.

- `* → idle` via `TREE_RESET_EXTERNAL`: `placement.reset()`. No API call, no `treeReef.clear()` — the socket handler that dispatched this action already took care of reef cleanup (see socket section below).

Orbit controls, pointer-drag tracking, and the socket handler remain in `tree.ts` since they're UI concerns that read `state.kind` but don't own it.

## Socket message handling

The WebSocket listener stays in `tree.ts`. Each message handler does exactly one tree-content mutation on `treeReef` / `indicators` (reef content is owned by the socket handler, not the state machine) and, where relevant, dispatches a state-machine action for the placement cursor.

- `tree_polyp_added` → `treeReef.addPiece(polyp)`; install sway/pulse on the new mesh; `indicators.refresh()`. Idempotent on `polyp.id`, so duplicate echoes are safe.
- `tree_polyp_removed` → `treeReef.removePiece(id)`; `indicators.refresh()`.
- `tree_reset` → `treeReef.clear()`; `indicators.refresh()`; **dispatch `TREE_RESET_EXTERNAL`** so the state machine snaps to idle. Do NOT dispatch `CLEAR_CLICKED` (that would trigger another API call). The follow-up `tree_polyp_added` broadcast (server re-seeds a Starburst after reset) populates the empty reef with the new root.
- `tree_hello` → ignored (log only).

Rationale: tree content (which polyps exist) is owned by `treeReef` and fed directly from the socket; it's idempotent and doesn't need the state machine as an intermediary. The state machine only tracks the placement cursor — what ghost is the user aiming, what buttons are enabled. Reset is the single case where the two concerns touch, and `TREE_RESET_EXTERNAL` exists explicitly to route that without triggering an effect-layer API call.

## File layout

New:

- `packages/client/src/tree/state.ts` — types + reducer, ~130 lines.
- `packages/client/src/tree/state.test.ts` — ~40 tests, ~250 lines.
- `packages/client/src/tree/effects.ts` — `createEffects` factory + transition-based side effect routing, ~150 lines.

Modified:

- `packages/client/src/tree.ts` — rewritten. Current is ~430 lines with many mutable flags and nested handlers; target is ~180 lines of wiring.

Unchanged (public APIs preserved):

- `packages/client/src/tree/{reef,placement,indicators,variants,material,pulse,scene,config,api,shark,clownfish,fishParts}.ts`
- `packages/client/src/ui/treePicker.ts`
- All existing tests (material, placement, reef, variants, pulse, indicators, shark, clownfish, collision, config, api).

## Testing strategy

**state.test.ts** — full reducer coverage.

For each state kind:

- Every listed legal action produces the expected next state (field-by-field assertions).
- Every unlisted action returns the same state reference (`expect(reduce(s, a)).toBe(s)` — reference equality).

Specific behaviors:

- `VARIANT_CHOSEN` in `idle` updates `picker.variant` and ignores `seed` (no seed field exists on idle).
- `VARIANT_CHOSEN` in `placing` updates both `picker.variant` and `seed`.
- `VARIANT_CHOSEN` in `submitting` updates `picker.variant` and `seed` — harmless during submit; becomes relevant on `COMMIT_REJECTED` so the retry uses the new selection.
- `COLOR_CHOSEN` never changes `seed` (same shape, different hue).
- `ATTACH_CLICKED` in `placing` preserves `picker`, replaces `parentId/attachIndex/seed`, clears `blocked`.
- `REROLL_CLICKED` only transitions from `placing` (no-op in others).
- `GROW_CLICKED` in `placing` with `blocked: true` returns unchanged state (reference-equal).
- `CLEAR_CLICKED` works from `idle`, `placing`, and `submitting`; no-op in `resetting`.
- `COMMIT_REJECTED` carries all fields back to `placing` with `blocked: false`.
- `TREE_RESET_EXTERNAL` from any kind → idle with inherited picker.
- All unlisted (state, action) pairs return the same reference (identity).

Target: ~40-50 unit tests, all pure (no Three.js/DOM imports).

**effects.test.ts (optional)** — happy-path integration with mocked deps. A few tests to verify:

- `idle → placing`: `placement.showGhost` called with correct args.
- `placing (blocked=true) → submitting`: guarded by reducer, but also verify effects don't call submit if somehow invoked (defensive).
- `submitting → idle`: `placement.reset` and `picker.setSubmitting(false)` both called.

Skip if reducer coverage is thorough enough.

## Migration plan

1. Add `state.ts` + `state.test.ts`. Land green.
2. Add `effects.ts` (no tests yet, just wire it).
3. Add new `tree.ts` alongside the old logic (keep imports separate) — in a single commit, swap the orchestration over. Delete old scaffolding.
4. Run `pnpm -r test` + typecheck.
5. Manual smoke in browser: click attach → ghost; reroll ×5 → new ghost each time; cancel → orbit resumes; grow → piece appears; clear → fresh root; add shark/clownfish buttons still work; drag-rotate still rotates ghost; pointer-up re-enables orbit.
6. Update any existing tests that referenced the old mutable flags (unlikely; the existing tests target sub-modules that are unchanged).

## Risks

- **Socket race with submit**: server may broadcast `tree_polyp_added` before or after our HTTP response resolves. The state machine transitions `submitting → idle` on HTTP resolve; the broadcast adds the piece to `treeReef` regardless. `treeReef.addPiece` is idempotent on `id`, so the piece lands exactly once. Safe.

- **Rapid click spam**: multiple `ATTACH_CLICKED` before the first `PLACEMENT_BLOCKED/OK` arrives. Each action overwrites the placing state; each `showGhost` disposes the previous ghost via `placement.reset()`. Late `PLACEMENT_BLOCKED/OK` events may apply to a stale slot; they still produce valid states (blocked either way), and the effect layer re-runs showGhost on next legitimate transition. Acceptable.

- **Clear during submit**: server may still insert the submit then immediately soft-delete via reset. Net result is an empty tree plus the fresh seeded Starburst. Fine.

- **Local clear + remote echo**: after our own `resetTree` resolves and we dispatch `RESET_RESOLVED`, the server's subsequent `tree_reset` broadcast arrives. Socket handler dispatches `TREE_RESET_EXTERNAL`, which is a no-op at that point (we're already in `idle`), and calls `treeReef.clear()` on a reef that's also already clear. Both operations are idempotent; no double-cleanup issue.

- **Dispatch inside effects**: `effects.apply` can dispatch follow-up actions (e.g., `PLACEMENT_BLOCKED` after showGhost). This introduces re-entrant dispatch. Guard by ensuring `dispatch` serializes — apply the reducer and effects synchronously before returning. No queue needed since actions fire from discrete events; the re-entrant path terminates after at most one recursion (effect's dispatch leads to a terminal state change that doesn't re-dispatch).

## Open follow-ups (separate designs)

1. **2+ branches per attach point**: schema migration (`tree_polyps.attach_sub_index` column or similar), uniqueness constraint revision, client rendering with angular offset per sub-index. Separate design once core refactor lands.
2. **Persisted drag yaw**: add `attach_yaw REAL NOT NULL DEFAULT 0` column. Drag-rotate stores to state, sent at commit, applied in `TreeReef.addPiece`'s world matrix.
3. **Indicator hit-test**: bump radius constant or use raycast Threshold — quick tuning, not architectural.
4. **Rejection UI**: visible error toast/banner when `COMMIT_REJECTED` fires; currently just hintEl text.
