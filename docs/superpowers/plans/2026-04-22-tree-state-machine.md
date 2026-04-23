# Tree Placement State Machine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace tree.ts's ad-hoc mutable flag machinery with a deterministic finite state machine — pure reducer + dep-injected effect runner + thin orchestrator.

**Architecture:** Three layers. `state.ts` owns the discriminated union state + pure `reduce` function (no Three.js, no DOM). `effects.ts` owns side effects, receives deps by injection, dispatches follow-up actions on async resolution. `tree.ts` becomes thin wiring — DOM/socket events translate to `dispatch(action)`.

**Tech Stack:** TypeScript 6, Vitest, existing `@reef/shared` types (`TreeVariant`, `PublicTreePolyp`), existing packages (`TreeReef`, `TreePlacement`, `AttachIndicators`, `TreePicker`). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-04-22-tree-state-machine-design.md`. Read before starting.

---

## File Structure

**New:**
- `packages/client/src/tree/state.ts` — `TreeState` + `TreeAction` unions, `reduce`, `initialState`. Pure.
- `packages/client/src/tree/state.test.ts` — reducer tests (Vitest). Pure, no Three.js imports.
- `packages/client/src/tree/effects.ts` — `createEffects(deps): { apply(prev, next) }` factory.

**Modified:**
- `packages/client/src/tree.ts` — rewritten as thin orchestrator in a single swap (last task).

**Unchanged (public APIs preserved):**
- `packages/client/src/tree/{reef,placement,indicators,variants,material,pulse,scene,config,api,shark,clownfish,fishParts}.ts`
- `packages/client/src/ui/treePicker.ts`
- `packages/generator/**/*`, `packages/server/**/*`, `packages/shared/**/*`

**Out of scope (separate work):**
- The in-flight material (`MeshPhysicalMaterial`) + environment (fog, gradient background, underwater lighting) edits stay as-is. They touch `material.ts`, `variants.ts`, `scene.ts`, `tree.ts` — none of the files listed above as unchanged, so there's no conflict with this plan.
- Multi-branch-per-attach feature.
- Drag-yaw persistence to server.

---

## Task 1: state.ts scaffold — types + initialState + no-op reducer

**Files:**
- Create: `packages/client/src/tree/state.ts`
- Create: `packages/client/src/tree/state.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// packages/client/src/tree/state.test.ts
import { describe, expect, test } from 'vitest';
import { initialState, reduce, type TreeAction, type TreeState } from './state.js';

describe('initialState', () => {
  test('returns idle with the provided picker selection', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    expect(s.kind).toBe('idle');
    if (s.kind === 'idle') {
      expect(s.picker).toEqual({ variant: 'forked', colorKey: 'neon-cyan' });
    }
  });
});

describe('reduce default behavior', () => {
  test('any unhandled action returns the same state reference', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    // At this stage no actions are implemented; any action should be a no-op.
    const a: TreeAction = { type: 'CANCEL_CLICKED' };
    expect(reduce(s, a)).toBe(s);
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm --filter @reef/client test src/tree/state.test.ts`
Expected: FAIL with module-not-found (`./state.js`).

- [ ] **Step 3: Implement state.ts**

```ts
// packages/client/src/tree/state.ts
import type { TreeVariant } from '@reef/shared';

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

export type TreeAction =
  | { type: 'VARIANT_CHOSEN'; variant: TreeVariant; seed: number }
  | { type: 'COLOR_CHOSEN'; colorKey: string }
  | { type: 'ATTACH_CLICKED'; parentId: number; attachIndex: number; seed: number }
  | { type: 'REROLL_CLICKED'; variant: TreeVariant; seed: number }
  | { type: 'PLACEMENT_BLOCKED' }
  | { type: 'PLACEMENT_OK' }
  | { type: 'CANCEL_CLICKED' }
  | { type: 'GROW_CLICKED' }
  | { type: 'COMMIT_RESOLVED' }
  | { type: 'COMMIT_REJECTED'; error: string }
  | { type: 'CLEAR_CLICKED' }
  | { type: 'RESET_RESOLVED' }
  | { type: 'RESET_REJECTED'; error: string }
  | { type: 'TREE_RESET_EXTERNAL' };

export function initialState(picker: PickerSelection): TreeState {
  return { kind: 'idle', picker };
}

export function reduce(state: TreeState, _action: TreeAction): TreeState {
  return state;
}
```

- [ ] **Step 4: Verify the tests pass**

Run: `pnpm --filter @reef/client test src/tree/state.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/tree/state.ts packages/client/src/tree/state.test.ts
git commit -m "Tree state: scaffold types, initialState, default-identity reducer"
```

---

## Task 2: Reducer — picker actions (VARIANT_CHOSEN, COLOR_CHOSEN)

These actions are always legal. `VARIANT_CHOSEN` updates `picker.variant` in every state, and additionally updates `seed` when the current state has one (`placing`/`submitting`). `COLOR_CHOSEN` only updates `picker.colorKey`, never touches `seed`.

**Files:**
- Modify: `packages/client/src/tree/state.ts`
- Modify: `packages/client/src/tree/state.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `state.test.ts`:

```ts
describe('VARIANT_CHOSEN', () => {
  test('in idle: updates picker.variant, seed ignored', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    const next = reduce(s, { type: 'VARIANT_CHOSEN', variant: 'claw', seed: 123 });
    expect(next).toEqual({ kind: 'idle', picker: { variant: 'claw', colorKey: 'neon-cyan' } });
  });

  test('in placing: updates both picker.variant and seed', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, blocked: false,
    };
    const next = reduce(s, { type: 'VARIANT_CHOSEN', variant: 'wishbone', seed: 99 });
    expect(next).toEqual({
      kind: 'placing',
      picker: { variant: 'wishbone', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 99, blocked: false,
    });
  });

  test('in submitting: updates picker.variant and seed', () => {
    const s: TreeState = {
      kind: 'submitting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10,
    };
    const next = reduce(s, { type: 'VARIANT_CHOSEN', variant: 'trident', seed: 42 });
    expect(next).toEqual({
      kind: 'submitting',
      picker: { variant: 'trident', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 42,
    });
  });

  test('in resetting: updates picker.variant; no seed field exists', () => {
    const s: TreeState = {
      kind: 'resetting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
    };
    const next = reduce(s, { type: 'VARIANT_CHOSEN', variant: 'starburst', seed: 7 });
    expect(next).toEqual({
      kind: 'resetting',
      picker: { variant: 'starburst', colorKey: 'neon-cyan' },
    });
  });
});

describe('COLOR_CHOSEN', () => {
  test('in idle: updates picker.colorKey', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    const next = reduce(s, { type: 'COLOR_CHOSEN', colorKey: 'neon-magenta' });
    expect(next).toEqual({ kind: 'idle', picker: { variant: 'forked', colorKey: 'neon-magenta' } });
  });

  test('in placing: preserves seed, updates picker.colorKey only', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, blocked: false,
    };
    const next = reduce(s, { type: 'COLOR_CHOSEN', colorKey: 'neon-lime' });
    expect(next).toEqual({
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-lime' },
      parentId: 1, attachIndex: 0, seed: 10, blocked: false,
    });
  });
});
```

- [ ] **Step 2: Verify they fail**

Run: `pnpm --filter @reef/client test src/tree/state.test.ts`
Expected: 6 new failures (reducer still returns state unchanged).

- [ ] **Step 3: Implement the reducer cases**

Replace the body of `reduce` in `state.ts`:

```ts
export function reduce(state: TreeState, action: TreeAction): TreeState {
  switch (action.type) {
    case 'VARIANT_CHOSEN': {
      const picker = { ...state.picker, variant: action.variant };
      switch (state.kind) {
        case 'idle':      return { ...state, picker };
        case 'placing':   return { ...state, picker, seed: action.seed };
        case 'submitting':return { ...state, picker, seed: action.seed };
        case 'resetting': return { ...state, picker };
      }
    }
    case 'COLOR_CHOSEN': {
      const picker = { ...state.picker, colorKey: action.colorKey };
      return { ...state, picker };
    }
    default:
      return state;
  }
}
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm --filter @reef/client test src/tree/state.test.ts`
Expected: PASS — 8 tests total.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/tree/state.ts packages/client/src/tree/state.test.ts
git commit -m "Tree state: picker actions (VARIANT_CHOSEN, COLOR_CHOSEN)"
```

---

## Task 3: Reducer — attach selection (ATTACH_CLICKED, REROLL_CLICKED)

`ATTACH_CLICKED` transitions `idle → placing` or overwrites the slot in `placing → placing`; no-op in `submitting`/`resetting`. `REROLL_CLICKED` is only valid in `placing`.

**Files:**
- Modify: `packages/client/src/tree/state.ts`
- Modify: `packages/client/src/tree/state.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `state.test.ts`:

```ts
describe('ATTACH_CLICKED', () => {
  test('from idle → placing with picker inherited, blocked false', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    const next = reduce(s, { type: 'ATTACH_CLICKED', parentId: 5, attachIndex: 2, seed: 77 });
    expect(next).toEqual({
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 5, attachIndex: 2, seed: 77, blocked: false,
    });
  });

  test('from placing → placing with new params, blocked reset to false', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'wishbone', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, blocked: true,
    };
    const next = reduce(s, { type: 'ATTACH_CLICKED', parentId: 3, attachIndex: 1, seed: 55 });
    expect(next).toEqual({
      kind: 'placing',
      picker: { variant: 'wishbone', colorKey: 'neon-cyan' },
      parentId: 3, attachIndex: 1, seed: 55, blocked: false,
    });
  });

  test('from submitting: no-op (same reference returned)', () => {
    const s: TreeState = {
      kind: 'submitting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10,
    };
    const next = reduce(s, { type: 'ATTACH_CLICKED', parentId: 9, attachIndex: 9, seed: 9 });
    expect(next).toBe(s);
  });

  test('from resetting: no-op (same reference returned)', () => {
    const s: TreeState = {
      kind: 'resetting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
    };
    const next = reduce(s, { type: 'ATTACH_CLICKED', parentId: 1, attachIndex: 0, seed: 1 });
    expect(next).toBe(s);
  });
});

describe('REROLL_CLICKED', () => {
  test('from placing → placing with new variant + seed, blocked reset', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, blocked: true,
    };
    const next = reduce(s, { type: 'REROLL_CLICKED', variant: 'claw', seed: 42 });
    expect(next).toEqual({
      kind: 'placing',
      picker: { variant: 'claw', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 42, blocked: false,
    });
  });

  test('from idle: no-op', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    const next = reduce(s, { type: 'REROLL_CLICKED', variant: 'claw', seed: 42 });
    expect(next).toBe(s);
  });

  test('from submitting: no-op', () => {
    const s: TreeState = {
      kind: 'submitting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10,
    };
    const next = reduce(s, { type: 'REROLL_CLICKED', variant: 'claw', seed: 42 });
    expect(next).toBe(s);
  });
});
```

- [ ] **Step 2: Verify they fail**

Run: `pnpm --filter @reef/client test src/tree/state.test.ts`
Expected: 7 new failures.

- [ ] **Step 3: Implement the reducer cases**

Add `ATTACH_CLICKED` and `REROLL_CLICKED` cases to the `switch (action.type)` in `reduce`, above the `default`:

```ts
    case 'ATTACH_CLICKED': {
      if (state.kind === 'idle' || state.kind === 'placing') {
        return {
          kind: 'placing',
          picker: state.picker,
          parentId: action.parentId,
          attachIndex: action.attachIndex,
          seed: action.seed,
          blocked: false,
        };
      }
      return state;
    }
    case 'REROLL_CLICKED': {
      if (state.kind !== 'placing') return state;
      return {
        ...state,
        picker: { ...state.picker, variant: action.variant },
        seed: action.seed,
        blocked: false,
      };
    }
```

- [ ] **Step 4: Verify tests pass**

Run: `pnpm --filter @reef/client test src/tree/state.test.ts`
Expected: PASS — 15 tests total.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/tree/state.ts packages/client/src/tree/state.test.ts
git commit -m "Tree state: attach selection (ATTACH_CLICKED, REROLL_CLICKED)"
```

---

## Task 4: Reducer — placement feedback (PLACEMENT_BLOCKED, PLACEMENT_OK)

These are dispatched by the effects layer after `showGhost` runs. Only valid in `placing`.

**Files:**
- Modify: `packages/client/src/tree/state.ts`
- Modify: `packages/client/src/tree/state.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `state.test.ts`:

```ts
describe('PLACEMENT_BLOCKED', () => {
  test('in placing: sets blocked=true', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, blocked: false,
    };
    const next = reduce(s, { type: 'PLACEMENT_BLOCKED' });
    expect(next).toEqual({ ...s, blocked: true });
  });

  test('outside placing: no-op', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    expect(reduce(s, { type: 'PLACEMENT_BLOCKED' })).toBe(s);
  });
});

describe('PLACEMENT_OK', () => {
  test('in placing: sets blocked=false', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, blocked: true,
    };
    const next = reduce(s, { type: 'PLACEMENT_OK' });
    expect(next).toEqual({ ...s, blocked: false });
  });

  test('outside placing: no-op', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    expect(reduce(s, { type: 'PLACEMENT_OK' })).toBe(s);
  });
});
```

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement**

Add cases to `reduce`:

```ts
    case 'PLACEMENT_BLOCKED': {
      if (state.kind !== 'placing') return state;
      return { ...state, blocked: true };
    }
    case 'PLACEMENT_OK': {
      if (state.kind !== 'placing') return state;
      return { ...state, blocked: false };
    }
```

- [ ] **Step 4: Verify pass.** 19 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/tree/state.ts packages/client/src/tree/state.test.ts
git commit -m "Tree state: placement feedback (PLACEMENT_BLOCKED, PLACEMENT_OK)"
```

---

## Task 5: Reducer — commit flow (CANCEL, GROW, COMMIT_RESOLVED, COMMIT_REJECTED)

- `CANCEL_CLICKED`: `placing → idle`, no-op elsewhere.
- `GROW_CLICKED`: `placing` (blocked=false) → `submitting`; no-op elsewhere (including `placing` blocked=true).
- `COMMIT_RESOLVED`: `submitting → idle`, no-op elsewhere.
- `COMMIT_REJECTED`: `submitting → placing` with blocked=false, no-op elsewhere.

**Files:**
- Modify: `packages/client/src/tree/state.ts`
- Modify: `packages/client/src/tree/state.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `state.test.ts`:

```ts
describe('CANCEL_CLICKED', () => {
  test('from placing → idle with picker inherited', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, blocked: false,
    };
    const next = reduce(s, { type: 'CANCEL_CLICKED' });
    expect(next).toEqual({ kind: 'idle', picker: s.picker });
  });

  test('from idle/submitting/resetting: no-op', () => {
    const idle = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    const submitting: TreeState = {
      kind: 'submitting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10,
    };
    const resetting: TreeState = {
      kind: 'resetting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
    };
    expect(reduce(idle, { type: 'CANCEL_CLICKED' })).toBe(idle);
    expect(reduce(submitting, { type: 'CANCEL_CLICKED' })).toBe(submitting);
    expect(reduce(resetting, { type: 'CANCEL_CLICKED' })).toBe(resetting);
  });
});

describe('GROW_CLICKED', () => {
  test('from placing (blocked=false) → submitting with fields copied', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, blocked: false,
    };
    const next = reduce(s, { type: 'GROW_CLICKED' });
    expect(next).toEqual({
      kind: 'submitting',
      picker: s.picker,
      parentId: 1, attachIndex: 0, seed: 10,
    });
  });

  test('from placing (blocked=true): no-op', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, blocked: true,
    };
    expect(reduce(s, { type: 'GROW_CLICKED' })).toBe(s);
  });

  test('from idle/submitting/resetting: no-op', () => {
    const idle = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    const submitting: TreeState = {
      kind: 'submitting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10,
    };
    expect(reduce(idle, { type: 'GROW_CLICKED' })).toBe(idle);
    expect(reduce(submitting, { type: 'GROW_CLICKED' })).toBe(submitting);
  });
});

describe('COMMIT_RESOLVED', () => {
  test('from submitting → idle with picker inherited', () => {
    const s: TreeState = {
      kind: 'submitting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10,
    };
    const next = reduce(s, { type: 'COMMIT_RESOLVED' });
    expect(next).toEqual({ kind: 'idle', picker: s.picker });
  });

  test('outside submitting: no-op', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    expect(reduce(s, { type: 'COMMIT_RESOLVED' })).toBe(s);
  });
});

describe('COMMIT_REJECTED', () => {
  test('from submitting → placing with blocked=false, fields carried', () => {
    const s: TreeState = {
      kind: 'submitting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10,
    };
    const next = reduce(s, { type: 'COMMIT_REJECTED', error: 'boom' });
    expect(next).toEqual({
      kind: 'placing',
      picker: s.picker,
      parentId: 1, attachIndex: 0, seed: 10, blocked: false,
    });
  });

  test('outside submitting: no-op', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    expect(reduce(s, { type: 'COMMIT_REJECTED', error: 'x' })).toBe(s);
  });
});
```

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement**

Add cases to `reduce`:

```ts
    case 'CANCEL_CLICKED': {
      if (state.kind !== 'placing') return state;
      return { kind: 'idle', picker: state.picker };
    }
    case 'GROW_CLICKED': {
      if (state.kind !== 'placing' || state.blocked) return state;
      return {
        kind: 'submitting',
        picker: state.picker,
        parentId: state.parentId,
        attachIndex: state.attachIndex,
        seed: state.seed,
      };
    }
    case 'COMMIT_RESOLVED': {
      if (state.kind !== 'submitting') return state;
      return { kind: 'idle', picker: state.picker };
    }
    case 'COMMIT_REJECTED': {
      if (state.kind !== 'submitting') return state;
      return {
        kind: 'placing',
        picker: state.picker,
        parentId: state.parentId,
        attachIndex: state.attachIndex,
        seed: state.seed,
        blocked: false,
      };
    }
```

- [ ] **Step 4: Verify pass.** 27 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/tree/state.ts packages/client/src/tree/state.test.ts
git commit -m "Tree state: commit flow (CANCEL, GROW, COMMIT_RESOLVED/REJECTED)"
```

---

## Task 6: Reducer — reset flow (CLEAR, RESET_RESOLVED/REJECTED, TREE_RESET_EXTERNAL)

- `CLEAR_CLICKED`: `idle`/`placing`/`submitting` → `resetting`, no-op in `resetting`.
- `RESET_RESOLVED` / `RESET_REJECTED`: `resetting → idle`, no-op elsewhere.
- `TREE_RESET_EXTERNAL`: any kind → `idle`, picker inherited.

**Files:**
- Modify: `packages/client/src/tree/state.ts`
- Modify: `packages/client/src/tree/state.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `state.test.ts`:

```ts
describe('CLEAR_CLICKED', () => {
  test('from idle → resetting with picker inherited', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    const next = reduce(s, { type: 'CLEAR_CLICKED' });
    expect(next).toEqual({ kind: 'resetting', picker: s.picker });
  });

  test('from placing → resetting with picker inherited', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, blocked: false,
    };
    const next = reduce(s, { type: 'CLEAR_CLICKED' });
    expect(next).toEqual({ kind: 'resetting', picker: s.picker });
  });

  test('from submitting → resetting', () => {
    const s: TreeState = {
      kind: 'submitting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10,
    };
    const next = reduce(s, { type: 'CLEAR_CLICKED' });
    expect(next).toEqual({ kind: 'resetting', picker: s.picker });
  });

  test('from resetting: no-op', () => {
    const s: TreeState = {
      kind: 'resetting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
    };
    expect(reduce(s, { type: 'CLEAR_CLICKED' })).toBe(s);
  });
});

describe('RESET_RESOLVED', () => {
  test('from resetting → idle with picker inherited', () => {
    const s: TreeState = {
      kind: 'resetting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
    };
    expect(reduce(s, { type: 'RESET_RESOLVED' }))
      .toEqual({ kind: 'idle', picker: s.picker });
  });

  test('outside resetting: no-op', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    expect(reduce(s, { type: 'RESET_RESOLVED' })).toBe(s);
  });
});

describe('RESET_REJECTED', () => {
  test('from resetting → idle with picker inherited', () => {
    const s: TreeState = {
      kind: 'resetting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
    };
    expect(reduce(s, { type: 'RESET_REJECTED', error: 'x' }))
      .toEqual({ kind: 'idle', picker: s.picker });
  });

  test('outside resetting: no-op', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    expect(reduce(s, { type: 'RESET_REJECTED', error: 'x' })).toBe(s);
  });
});

describe('TREE_RESET_EXTERNAL', () => {
  test('from any kind → idle with picker inherited', () => {
    const idle = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    const placing: TreeState = {
      kind: 'placing',
      picker: { variant: 'wishbone', colorKey: 'neon-lime' },
      parentId: 1, attachIndex: 0, seed: 10, blocked: false,
    };
    const submitting: TreeState = {
      kind: 'submitting',
      picker: { variant: 'claw', colorKey: 'neon-violet' },
      parentId: 2, attachIndex: 1, seed: 20,
    };
    const resetting: TreeState = {
      kind: 'resetting',
      picker: { variant: 'trident', colorKey: 'neon-orange' },
    };
    expect(reduce(idle, { type: 'TREE_RESET_EXTERNAL' }))
      .toEqual({ kind: 'idle', picker: idle.picker });
    expect(reduce(placing, { type: 'TREE_RESET_EXTERNAL' }))
      .toEqual({ kind: 'idle', picker: placing.picker });
    expect(reduce(submitting, { type: 'TREE_RESET_EXTERNAL' }))
      .toEqual({ kind: 'idle', picker: submitting.picker });
    expect(reduce(resetting, { type: 'TREE_RESET_EXTERNAL' }))
      .toEqual({ kind: 'idle', picker: resetting.picker });
  });
});
```

- [ ] **Step 2: Verify fail.**

- [ ] **Step 3: Implement**

Add cases:

```ts
    case 'CLEAR_CLICKED': {
      if (state.kind === 'resetting') return state;
      return { kind: 'resetting', picker: state.picker };
    }
    case 'RESET_RESOLVED':
    case 'RESET_REJECTED': {
      if (state.kind !== 'resetting') return state;
      return { kind: 'idle', picker: state.picker };
    }
    case 'TREE_RESET_EXTERNAL':
      return { kind: 'idle', picker: state.picker };
```

- [ ] **Step 4: Verify pass.** 36 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/client/src/tree/state.ts packages/client/src/tree/state.test.ts
git commit -m "Tree state: reset flow (CLEAR, RESET_*, TREE_RESET_EXTERNAL)"
```

---

## Task 7: Reducer — exhaustive no-op coverage

Add a parametrized test that asserts reference-equality for every (state, action) combination not covered above. This is the safety net.

**Files:**
- Modify: `packages/client/src/tree/state.test.ts`

- [ ] **Step 1: Write the test**

Append:

```ts
describe('reduce — no-op matrix', () => {
  // Sample states of each kind, populated with deterministic field values.
  const samples: Record<TreeState['kind'], TreeState> = {
    idle: { kind: 'idle', picker: { variant: 'forked', colorKey: 'neon-cyan' } },
    placing: {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, blocked: false,
    },
    submitting: {
      kind: 'submitting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10,
    },
    resetting: { kind: 'resetting', picker: { variant: 'forked', colorKey: 'neon-cyan' } },
  };

  // The `valid` matrix lists which action types produce a real transition
  // (non-identity result) from each state kind.
  const valid: Record<TreeState['kind'], readonly TreeAction['type'][]> = {
    idle: ['VARIANT_CHOSEN', 'COLOR_CHOSEN', 'ATTACH_CLICKED', 'CLEAR_CLICKED', 'TREE_RESET_EXTERNAL'],
    placing: [
      'VARIANT_CHOSEN', 'COLOR_CHOSEN', 'ATTACH_CLICKED', 'REROLL_CLICKED',
      'PLACEMENT_BLOCKED', 'PLACEMENT_OK', 'CANCEL_CLICKED', 'GROW_CLICKED',
      'CLEAR_CLICKED', 'TREE_RESET_EXTERNAL',
    ],
    submitting: [
      'VARIANT_CHOSEN', 'COLOR_CHOSEN',
      'COMMIT_RESOLVED', 'COMMIT_REJECTED',
      'CLEAR_CLICKED', 'TREE_RESET_EXTERNAL',
    ],
    resetting: [
      'VARIANT_CHOSEN', 'COLOR_CHOSEN',
      'RESET_RESOLVED', 'RESET_REJECTED',
      'TREE_RESET_EXTERNAL',
    ],
  };

  // Every TreeAction shape with sample payload, enumerated once.
  const allActions: TreeAction[] = [
    { type: 'VARIANT_CHOSEN', variant: 'claw', seed: 1 },
    { type: 'COLOR_CHOSEN', colorKey: 'neon-magenta' },
    { type: 'ATTACH_CLICKED', parentId: 1, attachIndex: 0, seed: 1 },
    { type: 'REROLL_CLICKED', variant: 'wishbone', seed: 2 },
    { type: 'PLACEMENT_BLOCKED' },
    { type: 'PLACEMENT_OK' },
    { type: 'CANCEL_CLICKED' },
    { type: 'GROW_CLICKED' },
    { type: 'COMMIT_RESOLVED' },
    { type: 'COMMIT_REJECTED', error: 'x' },
    { type: 'CLEAR_CLICKED' },
    { type: 'RESET_RESOLVED' },
    { type: 'RESET_REJECTED', error: 'x' },
    { type: 'TREE_RESET_EXTERNAL' },
  ];

  for (const kind of Object.keys(samples) as Array<TreeState['kind']>) {
    const state = samples[kind];
    for (const action of allActions) {
      const expectIdentity = !valid[kind].includes(action.type);
      test(`${kind} + ${action.type} → ${expectIdentity ? 'identity' : 'transition'}`, () => {
        const next = reduce(state, action);
        if (expectIdentity) {
          expect(next).toBe(state);
        } else {
          // For covered transitions we already assert specifics elsewhere;
          // here just ensure we *didn't* return identity.
          expect(next).not.toBe(state);
        }
      });
    }
  }
});
```

- [ ] **Step 2: Verify the tests pass**

Run: `pnpm --filter @reef/client test src/tree/state.test.ts`
Expected: PASS — 36 + 56 = 92 tests (4 kinds × 14 actions = 56 matrix tests).

If any test fails, there's either a bug in the reducer or a miscategorization in the `valid` table. Fix before committing.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/tree/state.test.ts
git commit -m "Tree state: exhaustive no-op matrix — 56 identity assertions"
```

---

## Task 8: Effects scaffold — createEffects factory + deps interface

Set up the effect runner shell. Skeleton `apply` that does nothing yet — we'll add transition branches in subsequent tasks.

**Files:**
- Create: `packages/client/src/tree/effects.ts`

- [ ] **Step 1: Implement the scaffold**

```ts
// packages/client/src/tree/effects.ts
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { TreeReef } from './reef.js';
import type { TreePlacement } from './placement.js';
import type { AttachIndicators } from './indicators.js';
import type { TreePicker } from '../ui/treePicker.js';
import type { TreeState, TreeAction } from './state.js';

export interface EffectsDeps {
  placement: TreePlacement;
  treeReef: TreeReef;
  indicators: AttachIndicators;
  picker: TreePicker;
  controls: OrbitControls;
  hintEl: HTMLElement;
  apiBase: string;
  /** Called by async callbacks inside effects to drive state transitions. */
  dispatch: (action: TreeAction) => void;
  /** Factory for adding a fetched polyp set back into the reef. Called after
   *  a successful reset so the re-seeded root renders. */
  addPiecesAndRefresh: (polyps: import('@reef/shared').PublicTreePolyp[]) => void;
}

export interface Effects {
  /**
   * Fire side effects for a state transition. `action` is included because
   * some transitions (notably `submitting → idle` and `resetting → idle`) can
   * arrive via different actions and need different UI behavior:
   *   - submitting → idle via COMMIT_RESOLVED: success hint
   *   - submitting → idle via TREE_RESET_EXTERNAL: reset hint
   *   - resetting → idle via RESET_RESOLVED: success hint
   *   - resetting → idle via RESET_REJECTED: error hint (already set in reject callback)
   */
  apply(prev: TreeState, next: TreeState, action: TreeAction): void;
}

export function createEffects(_deps: EffectsDeps): Effects {
  return {
    apply(_prev: TreeState, _next: TreeState, _action: TreeAction): void {
      // Filled in by subsequent tasks.
    },
  };
}
```

The `addPiecesAndRefresh` dep exists because adding a polyp requires also installing sway/pulse effects, which is a concern owned by tree.ts (where `swayClock` lives). Exposing it as a dep avoids duplicating that logic here.

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @reef/client typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/tree/effects.ts
git commit -m "Tree effects: createEffects scaffold + EffectsDeps interface"
```

---

## Task 9: Effects — placement transitions

Fills in the two biggest branches: any transition into `placing` with different params (call `showGhost`, dispatch `PLACEMENT_BLOCKED/OK`, update picker committable, update hint) and a pure `blocked` flip inside `placing` (just update button + hint).

**Files:**
- Modify: `packages/client/src/tree/effects.ts`

- [ ] **Step 1: Implement the placement branches**

Replace the body of `apply` in `effects.ts` with this full implementation (the commit/reset branches are no-ops for now, filled in later):

```ts
export function createEffects(deps: EffectsDeps): Effects {
  return {
    apply(prev: TreeState, next: TreeState, action: TreeAction): void {
      // Entering placing from elsewhere, or changing slot/variant/seed/color
      // within placing → re-show the ghost and refresh indicators hint.
      if (
        next.kind === 'placing' &&
        (prev.kind !== 'placing' || hasPlacingIdentityChanged(prev, next))
      ) {
        const { variant, colorKey } = next.picker;
        const ghost = deps.placement.showGhost(
          variant,
          next.seed,
          colorKey,
          next.parentId,
          next.attachIndex,
        );
        if (ghost) {
          deps.dispatch({ type: 'PLACEMENT_OK' });
          deps.picker.setCommittable(true);
          deps.hintEl.textContent = 'Happy with it? Click Grow.';
        } else {
          deps.dispatch({ type: 'PLACEMENT_BLOCKED' });
          deps.picker.setCommittable(false);
          deps.hintEl.textContent = 'That spot is blocked. Try another dot or reroll.';
        }
        return;
      }

      // Pure blocked flip within placing (triggered by PLACEMENT_BLOCKED/OK
      // dispatched after showGhost — which already ran above).
      if (
        next.kind === 'placing' && prev.kind === 'placing' &&
        !hasPlacingIdentityChanged(prev, next) &&
        prev.blocked !== next.blocked
      ) {
        deps.picker.setCommittable(!next.blocked);
        return;
      }

      // Leaving placing for idle (cancel).
      if (prev.kind === 'placing' && next.kind === 'idle' && action.type === 'CANCEL_CLICKED') {
        deps.placement.reset();
        deps.picker.setCommittable(false);
        deps.hintEl.textContent = 'Cancelled. Click a glowing dot to try again.';
        return;
      }
    },
  };
}

/** True when the placing-state identity fields (slot + variant + seed + color)
 *  changed between prev and next. Used to decide whether to re-show the ghost
 *  vs. only updating the commit button for a pure blocked flip. */
function hasPlacingIdentityChanged(
  prev: TreeState & { kind: 'placing' },
  next: TreeState & { kind: 'placing' },
): boolean {
  return (
    prev.parentId !== next.parentId ||
    prev.attachIndex !== next.attachIndex ||
    prev.seed !== next.seed ||
    prev.picker.variant !== next.picker.variant ||
    prev.picker.colorKey !== next.picker.colorKey
  );
}
```

Note: `hasPlacingIdentityChanged` is declared at the module level (not inside `createEffects`) so it can be tested independently if desired.

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @reef/client typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/tree/effects.ts
git commit -m "Tree effects: placement transitions (showGhost, blocked flip, cancel)"
```

---

## Task 10: Effects — commit flow

Adds branches for `placing → submitting` (call `submitTreePolyp`, attach resolve/reject handlers), `submitting → idle` (commit resolved), and `submitting → placing` (commit rejected).

**Files:**
- Modify: `packages/client/src/tree/effects.ts`

- [ ] **Step 1: Add the commit-flow branches**

Add `submitTreePolyp` import at the top of `effects.ts`:

```ts
import { submitTreePolyp } from './api.js';
```

Insert these branches in `apply`, after the placing-flow branches and before the final closing brace:

```ts
      // Grow: placing → submitting. Fire the POST and wire its resolution.
      if (prev.kind === 'placing' && next.kind === 'submitting') {
        deps.picker.setSubmitting(true);
        submitTreePolyp(
          {
            variant: next.picker.variant,
            seed: next.seed,
            colorKey: next.picker.colorKey,
            parentId: next.parentId,
            attachIndex: next.attachIndex,
          },
          deps.apiBase,
        ).then(
          () => deps.dispatch({ type: 'COMMIT_RESOLVED' }),
          (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            deps.hintEl.textContent = `Grow failed: ${msg}`;
            deps.dispatch({ type: 'COMMIT_REJECTED', error: msg });
          },
        );
        return;
      }

      // Commit resolved: submitting → idle via COMMIT_RESOLVED.
      // (submitting → idle can also happen via TREE_RESET_EXTERNAL; that case
      // is handled by the external-reset branch in Task 11.)
      if (
        prev.kind === 'submitting' && next.kind === 'idle' &&
        action.type === 'COMMIT_RESOLVED'
      ) {
        deps.placement.reset();
        deps.picker.setSubmitting(false);
        deps.picker.setCommittable(false);
        deps.hintEl.textContent = 'Grown! Click another dot to plant again.';
        return;
      }

      // Commit rejected: submitting → placing. Hint was set by the reject
      // callback above; just unwind the submitting UI.
      if (
        prev.kind === 'submitting' && next.kind === 'placing' &&
        action.type === 'COMMIT_REJECTED'
      ) {
        deps.picker.setSubmitting(false);
        return;
      }
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @reef/client typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/tree/effects.ts
git commit -m "Tree effects: commit flow (submit, resolved, rejected)"
```

---

## Task 11: Effects — reset flow + TREE_RESET_EXTERNAL

Handles `* → resetting` (clear ghost immediately, call resetTree, re-populate on resolve), `resetting → idle` (hint update), and `* → idle` via `TREE_RESET_EXTERNAL` (placement reset only).

**Files:**
- Modify: `packages/client/src/tree/effects.ts`

- [ ] **Step 1: Add the reset branches**

Add `resetTree` and `fetchTree` to the api.js import at the top of `effects.ts`:

```ts
import { fetchTree, resetTree, submitTreePolyp } from './api.js';
```

Insert these branches in `apply`, after the commit-flow branches:

```ts
      // Clear: any → resetting. Wipe the ghost immediately, fire the API.
      if (prev.kind !== 'resetting' && next.kind === 'resetting') {
        deps.placement.reset();
        deps.picker.setCommittable(false);
        deps.hintEl.textContent = 'Clearing…';
        resetTree(deps.apiBase).then(
          async () => {
            // Clear local reef, then re-fetch authoritative state.
            deps.treeReef.clear();
            deps.indicators.refresh([]);
            try {
              const { polyps } = await fetchTree(deps.apiBase);
              deps.addPiecesAndRefresh(polyps);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              deps.hintEl.textContent = `Clear: re-fetch failed — ${msg}`;
            }
            deps.dispatch({ type: 'RESET_RESOLVED' });
          },
          (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            deps.hintEl.textContent = `Clear failed: ${msg}`;
            deps.dispatch({ type: 'RESET_REJECTED', error: msg });
          },
        );
        return;
      }

      // Resetting → idle via RESET_RESOLVED. Success hint.
      if (
        prev.kind === 'resetting' && next.kind === 'idle' &&
        action.type === 'RESET_RESOLVED'
      ) {
        deps.hintEl.textContent = 'Cleared. Click a glowing dot to start growing.';
        return;
      }

      // Resetting → idle via RESET_REJECTED. Error hint was already written
      // by the reject callback above; no further work.
      if (
        prev.kind === 'resetting' && next.kind === 'idle' &&
        action.type === 'RESET_REJECTED'
      ) {
        return;
      }

      // TREE_RESET_EXTERNAL: any → idle. The socket handler in tree.ts
      // already called treeReef.clear() and indicators.refresh(); here we
      // just drop any pending ghost and unwind submit UI if applicable.
      //
      // Four cases depending on `prev.kind`:
      //   - placing/submitting: a remote user reset while we were interacting.
      //   - resetting: our own local clear — the server's tree_reset echo
      //     arrived before our HTTP resolve. Success hint.
      //   - idle: nothing to do (no ghost, no UI to unwind).
      if (next.kind === 'idle' && action.type === 'TREE_RESET_EXTERNAL') {
        if (prev.kind === 'placing') {
          deps.placement.reset();
          deps.picker.setCommittable(false);
          deps.hintEl.textContent = 'Tree was reset by another user.';
        } else if (prev.kind === 'submitting') {
          deps.placement.reset();
          deps.picker.setSubmitting(false);
          deps.picker.setCommittable(false);
          deps.hintEl.textContent = 'Tree was reset by another user.';
        } else if (prev.kind === 'resetting') {
          deps.hintEl.textContent = 'Cleared. Click a glowing dot to start growing.';
        }
        // prev === 'idle': no-op.
        return;
      }
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @reef/client typecheck`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/tree/effects.ts
git commit -m "Tree effects: reset flow (clear, re-fetch, external reset)"
```

---

## Task 12: tree.ts rewrite — shell with state + dispatch

Replaces `tree.ts` with a thin orchestrator. Single module-level `state`, single `dispatch` function, no more `pendingParentId`/`pendingAttachIndex`/`currentSeed`/`suppressNextClick`/`dragState` scattered across the file.

This is the biggest single task. It replaces the whole file in one swap.

**Files:**
- Modify: `packages/client/src/tree.ts`

- [ ] **Step 1: Rewrite tree.ts in full**

Before editing: read the CURRENT `packages/client/src/tree.ts` in its entirety so you understand which imports, DOM setup, and toolbar wiring are already there. The rewrite below preserves all of that — scene setup, camera, renderer, controls, lighting, fog, bloom, spawnable creatures (shark/clownfish/add-fish buttons), socket, sway/pulse — and only replaces the placement-related event handling with the state machine.

Replace the entire contents of `packages/client/src/tree.ts` with:

```ts
import {
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer,
  type Mesh,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PublicTreePolyp } from '@reef/shared';
import { installSway } from './scene/currentSway.js';
import { installTreePulse } from './tree/pulse.js';
import { readTreeConfig } from './tree/config.js';
import {
  createTreePedestal,
  createBloomComposer,
  createUnderwaterBackground,
  createUnderwaterFog,
  installUnderwaterLighting,
} from './tree/scene.js';
import { TreeReef } from './tree/reef.js';
import { AttachIndicators } from './tree/indicators.js';
import { TreePlacement } from './tree/placement.js';
import { fetchTree, TreeSocket, defaultTreeWsUrl } from './tree/api.js';
import { TREE_VARIANTS, TreePicker } from './ui/treePicker.js';
import { computeOrbitPose } from './playground/autoOrbit.js';
import { Shark } from './tree/shark.js';
import { Clownfish } from './tree/clownfish.js';
import { initialState, reduce, type TreeAction, type TreeState } from './tree/state.js';
import { createEffects } from './tree/effects.js';

// ------------------------------------------------------------------
// Config + canvas
// ------------------------------------------------------------------
const config = readTreeConfig();
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const modeBadge = document.getElementById('mode-badge')!;
modeBadge.textContent = `${config.mode}${config.readonly ? ' · readonly' : ''}`;

// ------------------------------------------------------------------
// Renderer + scene
// ------------------------------------------------------------------
const renderer = new WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));

const scene = new Scene();
scene.background = createUnderwaterBackground();
scene.fog = createUnderwaterFog();
renderer.setClearColor(0x01060d, 1);

installUnderwaterLighting(scene);
scene.add(createTreePedestal());

// ------------------------------------------------------------------
// Camera + controls
// ------------------------------------------------------------------
const camera = new PerspectiveCamera(50, 1, 0.01, 20);
camera.position.set(0.45, 0.2, 0);
camera.lookAt(0, 0, 0);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.minDistance = 0.2;
controls.maxDistance = 1.2;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
controls.enableDamping = true;

const bloomSetup = createBloomComposer(renderer, scene, camera);

// ------------------------------------------------------------------
// Tree content + placement
// ------------------------------------------------------------------
const treeReef = new TreeReef();
scene.add(treeReef.anchor);

const attachIndicators = new AttachIndicators();
scene.add(attachIndicators.group);

const placement = new TreePlacement(treeReef);
scene.add(placement.ghostAnchor);

// ------------------------------------------------------------------
// Sway/pulse effect installer (used on every newly-added piece).
// ------------------------------------------------------------------
const SWAY_INSTALLED = Symbol('sway-installed');
const PULSE_INSTALLED = Symbol('pulse-installed');
const swayClock = { value: 0 };

function installEffectsOnNewPieces(): void {
  for (const { polyp, mesh } of treeReef.allPieces()) {
    const flags = mesh.userData as Record<PropertyKey, unknown>;
    if (!flags[SWAY_INSTALLED]) {
      installSway(mesh as Mesh, swayClock);
      flags[SWAY_INSTALLED] = true;
    }
    if (!flags[PULSE_INSTALLED]) {
      installTreePulse(mesh as Mesh, swayClock, polyp.seed);
      flags[PULSE_INSTALLED] = true;
    }
  }
}

function addPiecesAndRefresh(polyps: PublicTreePolyp[]): void {
  const sorted = [...polyps].sort((a, b) => a.createdAt - b.createdAt);
  for (const polyp of sorted) treeReef.addPiece(polyp);
  installEffectsOnNewPieces();
  attachIndicators.refresh(treeReef.getAvailableAttachPoints());
}

// ------------------------------------------------------------------
// Spawnable sea life — empty by default.
// ------------------------------------------------------------------
interface SwimmingCreature { update: (clockSec: number) => void; }
const creatures: SwimmingCreature[] = [];
function spawnShark(): void {
  const s = new Shark({
    orbitRadius: 0.25 + Math.random() * 0.15,
    orbitHeight: 0.05 + Math.random() * 0.2,
    orbitPeriodSec: 14 + Math.random() * 10,
    phaseRad: Math.random() * Math.PI * 2,
    direction: Math.random() < 0.5 ? 1 : -1,
  });
  scene.add(s.group);
  creatures.push(s);
}
function spawnClownfish(): void {
  const c = new Clownfish({
    orbitRadius: 0.15 + Math.random() * 0.15,
    orbitHeight: 0.04 + Math.random() * 0.2,
    orbitPeriodSec: 5 + Math.random() * 6,
    phaseRad: Math.random() * Math.PI * 2,
    direction: Math.random() < 0.5 ? 1 : -1,
  });
  scene.add(c.group);
  creatures.push(c);
}

// ------------------------------------------------------------------
// Picker + state machine
// ------------------------------------------------------------------
const pickerRoot = document.getElementById('picker')!;
const picker = new TreePicker(pickerRoot);
const hintEl = document.getElementById('hint')!;

const effects = createEffects({
  placement, treeReef, indicators: attachIndicators, picker, controls,
  hintEl, apiBase: config.apiBase,
  dispatch: (action) => dispatch(action),
  addPiecesAndRefresh,
});

let state: TreeState = initialState(picker.get());

function dispatch(action: TreeAction): void {
  const prev = state;
  state = reduce(state, action);
  if (state !== prev) effects.apply(prev, state, action);
}

// Wire picker → dispatch.
picker.onChange((sel) => {
  const current = state.picker;
  if (sel.variant !== current.variant) {
    const seed = Math.floor(Math.random() * 0xffffffff);
    dispatch({ type: 'VARIANT_CHOSEN', variant: sel.variant, seed });
  }
  if (sel.colorKey !== current.colorKey) {
    dispatch({ type: 'COLOR_CHOSEN', colorKey: sel.colorKey });
  }
});
picker.onReroll(() => {
  if (state.kind !== 'placing') return;
  const options = TREE_VARIANTS.filter((v) => v !== state.picker.variant);
  const variant = options[Math.floor(Math.random() * options.length)]!;
  const seed = Math.floor(Math.random() * 0xffffffff);
  dispatch({ type: 'REROLL_CLICKED', variant, seed });
});
picker.onCancel(() => dispatch({ type: 'CANCEL_CLICKED' }));
picker.onCommit(() => dispatch({ type: 'GROW_CLICKED' }));

// ------------------------------------------------------------------
// Toolbar → dispatch / direct spawn
// ------------------------------------------------------------------
const clearBtn = document.getElementById('clearBtn') as HTMLButtonElement | null;
const addSharkBtn = document.getElementById('addSharkBtn') as HTMLButtonElement | null;
const addClownfishBtn = document.getElementById('addClownfishBtn') as HTMLButtonElement | null;
if (clearBtn) clearBtn.addEventListener('click', () => dispatch({ type: 'CLEAR_CLICKED' }));
if (addSharkBtn) addSharkBtn.addEventListener('click', spawnShark);
if (addClownfishBtn) addClownfishBtn.addEventListener('click', spawnClownfish);

// ------------------------------------------------------------------
// Pointer-drag: rotate ghost in place instead of orbiting while placing.
// ------------------------------------------------------------------
let dragState: { lastX: number; moved: boolean } | null = null;
let suppressNextClick = false;
const DRAG_THRESHOLD_PX = 3;
const ROT_SENSITIVITY = 0.0055;

canvas.addEventListener(
  'pointerdown',
  (ev) => {
    if (state.kind !== 'placing') return;
    if (config.mode !== 'screen') controls.enabled = false;
    dragState = { lastX: ev.clientX, moved: false };
    canvas.setPointerCapture(ev.pointerId);
  },
  { capture: true },
);
canvas.addEventListener('pointermove', (ev) => {
  if (!dragState) return;
  const dx = ev.clientX - dragState.lastX;
  if (!dragState.moved && Math.abs(dx) > DRAG_THRESHOLD_PX) dragState.moved = true;
  if (dragState.moved) {
    placement.rotateGhost(dx * ROT_SENSITIVITY);
    dragState.lastX = ev.clientX;
  }
});
canvas.addEventListener('pointerup', (ev) => {
  if (!dragState) return;
  if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
  suppressNextClick = dragState.moved;
  dragState = null;
  if (config.mode !== 'screen') controls.enabled = true;
});

// ------------------------------------------------------------------
// Click (attach-orb pick) — interactive mode only
// ------------------------------------------------------------------
if (config.mode === 'interactive') {
  picker.show();
  const raycaster = new Raycaster();
  raycaster.params.Points = { threshold: 0.01 };

  canvas.addEventListener('click', (ev) => {
    if (suppressNextClick) { suppressNextClick = false; return; }
    const rect = canvas.getBoundingClientRect();
    const ndc = new Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -(((ev.clientY - rect.top) / rect.height) * 2 - 1),
    );
    raycaster.setFromCamera(ndc, camera);
    const intersects = raycaster.intersectObjects(attachIndicators.group.children, false);
    if (intersects.length === 0) {
      if (state.kind === 'idle') {
        hintEl.textContent = 'Click a glowing dot to attach your piece.';
      }
      return;
    }
    const hit = intersects[0]!;
    const ud = hit.object.userData as { parentId?: number; attachIndex?: number };
    if (ud.parentId === undefined || ud.attachIndex === undefined) return;
    const seed = Math.floor(Math.random() * 0xffffffff);
    dispatch({
      type: 'ATTACH_CLICKED',
      parentId: ud.parentId,
      attachIndex: ud.attachIndex,
      seed,
    });
  });
}

// ------------------------------------------------------------------
// Resize
// ------------------------------------------------------------------
function resize(): void {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  bloomSetup.composer.setSize(w, h);
  bloomSetup.bloomPass.resolution.set(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

// ------------------------------------------------------------------
// Initial fetch
// ------------------------------------------------------------------
(async () => {
  try {
    const { polyps } = await fetchTree(config.apiBase);
    addPiecesAndRefresh(polyps);
    if (config.mode === 'interactive') {
      hintEl.textContent = polyps.length
        ? 'Click a glowing dot to attach your piece.'
        : 'Click Clear and grow something new.';
    }
  } catch (e) {
    console.error('[tree] Failed to load tree', e);
    hintEl.textContent = 'Failed to load tree. Check the server.';
  }
})();

// ------------------------------------------------------------------
// WebSocket: tree content updates (idempotent on polyp id)
// ------------------------------------------------------------------
function buildTreeWsUrl(): string {
  if (config.apiBase) {
    return config.apiBase.replace(/^http/, 'ws') + '/ws/tree';
  }
  return defaultTreeWsUrl();
}
const socket = new TreeSocket(buildTreeWsUrl());
socket.on((msg) => {
  if (msg.type === 'tree_hello') {
    // No-op; initial state was fetched via HTTP.
  } else if (msg.type === 'tree_polyp_added') {
    treeReef.addPiece(msg.polyp);
    installEffectsOnNewPieces();
    attachIndicators.refresh(treeReef.getAvailableAttachPoints());
  } else if (msg.type === 'tree_polyp_removed') {
    treeReef.removePiece(msg.id);
    attachIndicators.refresh(treeReef.getAvailableAttachPoints());
  } else if (msg.type === 'tree_reset') {
    treeReef.clear();
    attachIndicators.refresh([]);
    dispatch({ type: 'TREE_RESET_EXTERNAL' });
  }
});
socket.connect();

// ------------------------------------------------------------------
// Render loop
// ------------------------------------------------------------------
function loop(t: number): void {
  const tSec = t / 1000;
  swayClock.value = tSec;
  for (const c of creatures) c.update(tSec);

  if (config.mode === 'screen') {
    const pose = computeOrbitPose(tSec);
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
  } else {
    controls.update();
  }
  bloomSetup.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
```

- [ ] **Step 2: Typecheck + tests**

Run: `pnpm --filter @reef/client typecheck`
Expected: clean.

Run: `pnpm --filter @reef/client test`
Expected: all existing tests still pass (nothing in tests imports from `tree.ts` directly — they target submodules that haven't changed). The state machine tests added in earlier tasks also pass.

- [ ] **Step 3: Commit**

```bash
git add packages/client/src/tree.ts
git commit -m "Tree: rewrite tree.ts as thin state-machine orchestrator"
```

---

## Task 13: Final verification — smoke test + full workspace check

Run the whole suite and typechecks across packages, then validate the interactive flows in a browser.

**Files:**
- None modified.

- [ ] **Step 1: Run the full workspace suite**

```bash
cd /Users/johncosta/dev/CoralReefAR
pnpm -r typecheck
pnpm -r test
```

Expected: all packages typecheck clean; all tests pass. The client count includes the 92 new reducer tests added in Tasks 1-7.

- [ ] **Step 2: Manual browser smoke test**

Server + client dev running:

```bash
pnpm --filter @reef/server dev
pnpm --filter @reef/client dev
```

Open `http://localhost:5173/tree.html?api=http://localhost:8787`. Exercise each flow:

- Initial load shows the seeded root with its attach indicators.
- Click an attach indicator → ghost appears, Grow/Reroll/Cancel enabled.
- Click Reroll → ghost changes variant (random non-current variant). Click Reroll 5x in a row → each produces a new ghost, no disappearance.
- Click + drag on the canvas while ghost is showing → ghost rotates in place, camera does not orbit.
- Release drag → subsequent pointer drags orbit the camera again (until ghost is pending).
- Click a different attach indicator while ghost is shown → ghost moves to new slot.
- Click Cancel → ghost disappears, orbit controls fully active.
- Click attach → Grow → piece is committed, indicators refresh to include the new piece's slots.
- Click Clear → ghost clears, tree wipes, new random Starburst root seeds, indicators refresh.
- Click Add shark / Add clownfish → creatures spawn and begin their orbits.

- [ ] **Step 3: Clean up stale stashed changes if any**

Check `git status`. If there are modifications to files in `packages/client/src/tree/` from the in-flight material/env work, decide whether to keep them or revert:

```bash
git status --short
```

Expected: only deliberate changes from this plan. The material + environment upgrades from the prior session (MeshPhysicalMaterial swap in `material.ts`, gradient background + fog in `scene.ts`, indicator radius bump, shark/clownfish constructor params) are allowed to remain — they're orthogonal to the state machine.

- [ ] **Step 4: Final commit if there were any follow-up fixes during verification**

If you had to fix anything during smoke testing (e.g., missing hint text, a typo in an action name), commit it:

```bash
git add -p   # review hunk-by-hunk
git commit -m "Tree: fixes from state-machine smoke testing"
```

Otherwise no commit needed — the refactor is complete.

---

## Follow-ups (not part of this plan)

These were intentionally deferred per the spec:

1. **Multi-branch per attach point** — schema migration + UI support.
2. **Persisted drag yaw** — `attach_yaw` column + wiring at commit + apply in `TreeReef.addPiece`.
3. **Indicator hit-test tuning** — radius constant already bumped; revisit if users still struggle.
4. **Rejection UI** — currently `hintEl.textContent` shows errors; could upgrade to a toast.
5. **Effects unit tests** — spec listed as optional. Add if the integration smoke test surfaces branches that were hard to reason about.
