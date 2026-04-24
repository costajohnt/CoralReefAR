import { describe, expect, test } from 'vitest';
import { initialState, reduce, type TreeAction, type TreeState } from './state.js';

const idlePicker = { variant: 'forked', colorKey: 'neon-cyan' } as const;

describe('initialState', () => {
  test('returns idle with the provided picker selection', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    expect(s.kind).toBe('idle');
    if (s.kind === 'idle') {
      expect(s.picker).toEqual({ variant: 'forked', colorKey: 'neon-cyan' });
      expect(s.lastCommittedId).toBeNull();
    }
  });
});

describe('reduce default behavior', () => {
  test('any unhandled action returns the same state reference', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    const a: TreeAction = { type: 'CANCEL_CLICKED' };
    expect(reduce(s, a)).toBe(s);
  });
});

describe('VARIANT_CHOSEN', () => {
  test('in idle: updates picker.variant, seed ignored', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    const next = reduce(s, { type: 'VARIANT_CHOSEN', variant: 'claw', seed: 123 });
    expect(next).toEqual({ kind: 'idle', picker: { variant: 'claw', colorKey: 'neon-cyan' }, lastCommittedId: null });
  });

  test('in placing: updates both picker.variant and seed', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: false, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'VARIANT_CHOSEN', variant: 'wishbone', seed: 99 });
    expect(next).toEqual({
      kind: 'placing',
      picker: { variant: 'wishbone', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 99, yawRad: 0, blocked: false, lastCommittedId: null,
    });
  });

  test('in submitting: updates picker.variant and seed', () => {
    const s: TreeState = {
      kind: 'submitting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'VARIANT_CHOSEN', variant: 'trident', seed: 42 });
    expect(next).toEqual({
      kind: 'submitting',
      picker: { variant: 'trident', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 42, yawRad: 0, lastCommittedId: null,
    });
  });

  test('in resetting: updates picker.variant; no seed field exists', () => {
    const s: TreeState = {
      kind: 'resetting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      lastCommittedId: null,
    };
    const next = reduce(s, { type: 'VARIANT_CHOSEN', variant: 'starburst', seed: 7 });
    expect(next).toEqual({
      kind: 'resetting',
      picker: { variant: 'starburst', colorKey: 'neon-cyan' },
      lastCommittedId: null,
    });
  });

  test('in undoing: updates picker.variant', () => {
    const s: TreeState = { kind: 'undoing', picker: { variant: 'forked', colorKey: 'neon-cyan' }, polypId: 5 };
    const next = reduce(s, { type: 'VARIANT_CHOSEN', variant: 'claw', seed: 1 });
    expect(next).toEqual({ kind: 'undoing', picker: { variant: 'claw', colorKey: 'neon-cyan' }, polypId: 5 });
  });
});

describe('COLOR_CHOSEN', () => {
  test('in idle: updates picker.colorKey', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    const next = reduce(s, { type: 'COLOR_CHOSEN', colorKey: 'neon-magenta' });
    expect(next).toEqual({ kind: 'idle', picker: { variant: 'forked', colorKey: 'neon-magenta' }, lastCommittedId: null });
  });

  test('in placing: preserves seed, updates picker.colorKey only', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: false, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'COLOR_CHOSEN', colorKey: 'neon-lime' });
    expect(next).toEqual({
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-lime' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: false, lastCommittedId: null,
    });
  });
});

describe('ATTACH_CLICKED', () => {
  test('from idle → placing with picker inherited, blocked false', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    const next = reduce(s, { type: 'ATTACH_CLICKED', parentId: 5, attachIndex: 2, seed: 77 });
    expect(next).toEqual({
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 5, attachIndex: 2, seed: 77, yawRad: 0, blocked: false, lastCommittedId: null,
    });
  });

  test('from idle with lastCommittedId → placing preserves lastCommittedId', () => {
    const s: TreeState = { kind: 'idle', picker: idlePicker, lastCommittedId: 42 };
    const next = reduce(s, { type: 'ATTACH_CLICKED', parentId: 5, attachIndex: 2, seed: 77 });
    expect(next).toMatchObject({ kind: 'placing', lastCommittedId: 42 });
  });

  test('from placing → placing with new params, blocked reset to false', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'wishbone', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: true, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'ATTACH_CLICKED', parentId: 3, attachIndex: 1, seed: 55 });
    expect(next).toEqual({
      kind: 'placing',
      picker: { variant: 'wishbone', colorKey: 'neon-cyan' },
      parentId: 3, attachIndex: 1, seed: 55, yawRad: 0, blocked: false, lastCommittedId: null,
    });
  });

  test('from submitting: no-op (same reference returned)', () => {
    const s: TreeState = {
      kind: 'submitting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'ATTACH_CLICKED', parentId: 9, attachIndex: 9, seed: 9 });
    expect(next).toBe(s);
  });

  test('from resetting: no-op (same reference returned)', () => {
    const s: TreeState = {
      kind: 'resetting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      lastCommittedId: null,
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
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: true, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'REROLL_CLICKED', variant: 'claw', seed: 42 });
    expect(next).toEqual({
      kind: 'placing',
      picker: { variant: 'claw', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 42, yawRad: 0, blocked: false, lastCommittedId: null,
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
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'REROLL_CLICKED', variant: 'claw', seed: 42 });
    expect(next).toBe(s);
  });
});

describe('GHOST_ROTATED', () => {
  test('in placing: accumulates deltaRad onto yawRad', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0.2, blocked: false, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'GHOST_ROTATED', deltaRad: 0.3 });
    expect(next).toEqual({ ...s, yawRad: 0.5 });
  });

  test('supports negative deltas', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 1, blocked: false, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'GHOST_ROTATED', deltaRad: -0.4 });
    expect((next as typeof s).yawRad).toBeCloseTo(0.6);
  });

  test('ATTACH_CLICKED resets yaw to 0 even when re-entering placing', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 2, blocked: false, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'ATTACH_CLICKED', parentId: 3, attachIndex: 1, seed: 99 });
    expect((next as typeof s).yawRad).toBe(0);
  });

  test('GROW_CLICKED carries yaw into submitting', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0.7, blocked: false, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'GROW_CLICKED' });
    expect(next.kind).toBe('submitting');
    if (next.kind === 'submitting') expect(next.yawRad).toBe(0.7);
  });

  test('COMMIT_REJECTED carries yaw back into placing (so user can retry without re-rotating)', () => {
    const s: TreeState = {
      kind: 'submitting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0.9, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'COMMIT_REJECTED', error: 'boom' });
    expect(next.kind).toBe('placing');
    if (next.kind === 'placing') expect(next.yawRad).toBe(0.9);
  });

  test('outside placing: no-op', () => {
    const idle = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    expect(reduce(idle, { type: 'GHOST_ROTATED', deltaRad: 1 })).toBe(idle);
  });
});

describe('PLACEMENT_BLOCKED', () => {
  test('in placing: sets blocked=true', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: false, lastCommittedId: null,
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
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: true, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'PLACEMENT_OK' });
    expect(next).toEqual({ ...s, blocked: false });
  });

  test('outside placing: no-op', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    expect(reduce(s, { type: 'PLACEMENT_OK' })).toBe(s);
  });
});

describe('CANCEL_CLICKED', () => {
  test('from placing → idle with picker inherited', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: false, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'CANCEL_CLICKED' });
    expect(next).toEqual({ kind: 'idle', picker: s.picker, lastCommittedId: null });
  });

  test('from placing preserves lastCommittedId', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: idlePicker,
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: false, lastCommittedId: 7,
    };
    const next = reduce(s, { type: 'CANCEL_CLICKED' });
    expect(next).toMatchObject({ kind: 'idle', lastCommittedId: 7 });
  });

  test('from idle/submitting/resetting: no-op', () => {
    const idle = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    const submitting: TreeState = {
      kind: 'submitting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, lastCommittedId: null,
    };
    const resetting: TreeState = {
      kind: 'resetting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      lastCommittedId: null,
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
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: false, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'GROW_CLICKED' });
    expect(next).toEqual({
      kind: 'submitting',
      picker: s.picker,
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, lastCommittedId: null,
    });
  });

  test('from placing (blocked=true): no-op', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: true, lastCommittedId: null,
    };
    expect(reduce(s, { type: 'GROW_CLICKED' })).toBe(s);
  });

  test('from idle/submitting/resetting: no-op', () => {
    const idle = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    const submitting: TreeState = {
      kind: 'submitting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, lastCommittedId: null,
    };
    expect(reduce(idle, { type: 'GROW_CLICKED' })).toBe(idle);
    expect(reduce(submitting, { type: 'GROW_CLICKED' })).toBe(submitting);
  });
});

describe('COMMIT_RESOLVED', () => {
  test('from submitting → idle with picker inherited and lastCommittedId set', () => {
    const s: TreeState = {
      kind: 'submitting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'COMMIT_RESOLVED', polypId: 42 });
    expect(next).toEqual({ kind: 'idle', picker: s.picker, lastCommittedId: 42 });
  });

  test('outside submitting: no-op', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    expect(reduce(s, { type: 'COMMIT_RESOLVED', polypId: 1 })).toBe(s);
  });
});

describe('COMMIT_REJECTED', () => {
  test('from submitting → placing with blocked=false, fields carried', () => {
    const s: TreeState = {
      kind: 'submitting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'COMMIT_REJECTED', error: 'boom' });
    expect(next).toEqual({
      kind: 'placing',
      picker: s.picker,
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: false, lastCommittedId: null,
    });
  });

  test('from submitting preserves lastCommittedId on rejection', () => {
    const s: TreeState = {
      kind: 'submitting',
      picker: idlePicker,
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, lastCommittedId: 5,
    };
    const next = reduce(s, { type: 'COMMIT_REJECTED', error: 'boom' });
    expect(next).toMatchObject({ kind: 'placing', lastCommittedId: 5 });
  });

  test('outside submitting: no-op', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    expect(reduce(s, { type: 'COMMIT_REJECTED', error: 'x' })).toBe(s);
  });
});

describe('CLEAR_CLICKED', () => {
  test('from idle → resetting with picker inherited, lastCommittedId cleared', () => {
    const s: TreeState = { kind: 'idle', picker: idlePicker, lastCommittedId: 10 };
    const next = reduce(s, { type: 'CLEAR_CLICKED' });
    expect(next).toEqual({ kind: 'resetting', picker: s.picker, lastCommittedId: null });
  });

  test('from placing → resetting with picker inherited', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: false, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'CLEAR_CLICKED' });
    expect(next).toEqual({ kind: 'resetting', picker: s.picker, lastCommittedId: null });
  });

  test('from submitting → resetting', () => {
    const s: TreeState = {
      kind: 'submitting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, lastCommittedId: null,
    };
    const next = reduce(s, { type: 'CLEAR_CLICKED' });
    expect(next).toEqual({ kind: 'resetting', picker: s.picker, lastCommittedId: null });
  });

  test('from resetting: no-op', () => {
    const s: TreeState = {
      kind: 'resetting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      lastCommittedId: null,
    };
    expect(reduce(s, { type: 'CLEAR_CLICKED' })).toBe(s);
  });
});

describe('RESET_RESOLVED', () => {
  test('from resetting → idle with picker inherited, lastCommittedId null', () => {
    const s: TreeState = {
      kind: 'resetting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      lastCommittedId: null,
    };
    expect(reduce(s, { type: 'RESET_RESOLVED' }))
      .toEqual({ kind: 'idle', picker: s.picker, lastCommittedId: null });
  });

  test('outside resetting: no-op', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    expect(reduce(s, { type: 'RESET_RESOLVED' })).toBe(s);
  });
});

describe('RESET_REJECTED', () => {
  test('from resetting → idle with picker inherited, lastCommittedId null', () => {
    const s: TreeState = {
      kind: 'resetting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      lastCommittedId: null,
    };
    expect(reduce(s, { type: 'RESET_REJECTED', error: 'x' }))
      .toEqual({ kind: 'idle', picker: s.picker, lastCommittedId: null });
  });

  test('outside resetting: no-op', () => {
    const s = initialState({ variant: 'forked', colorKey: 'neon-cyan' });
    expect(reduce(s, { type: 'RESET_REJECTED', error: 'x' })).toBe(s);
  });
});

describe('TREE_RESET_EXTERNAL', () => {
  test('from any kind → idle with picker inherited, lastCommittedId cleared', () => {
    const idle: TreeState = { kind: 'idle', picker: idlePicker, lastCommittedId: 5 };
    const placing: TreeState = {
      kind: 'placing',
      picker: { variant: 'wishbone', colorKey: 'neon-lime' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: false, lastCommittedId: null,
    };
    const submitting: TreeState = {
      kind: 'submitting',
      picker: { variant: 'claw', colorKey: 'neon-violet' },
      parentId: 2, attachIndex: 1, seed: 20, yawRad: 0, lastCommittedId: null,
    };
    const resetting: TreeState = {
      kind: 'resetting',
      picker: { variant: 'trident', colorKey: 'neon-orange' },
      lastCommittedId: null,
    };
    const undoing: TreeState = { kind: 'undoing', picker: idlePicker, polypId: 3 };
    expect(reduce(idle, { type: 'TREE_RESET_EXTERNAL' }))
      .toEqual({ kind: 'idle', picker: idle.picker, lastCommittedId: null });
    expect(reduce(placing, { type: 'TREE_RESET_EXTERNAL' }))
      .toEqual({ kind: 'idle', picker: placing.picker, lastCommittedId: null });
    expect(reduce(submitting, { type: 'TREE_RESET_EXTERNAL' }))
      .toEqual({ kind: 'idle', picker: submitting.picker, lastCommittedId: null });
    expect(reduce(resetting, { type: 'TREE_RESET_EXTERNAL' }))
      .toEqual({ kind: 'idle', picker: resetting.picker, lastCommittedId: null });
    expect(reduce(undoing, { type: 'TREE_RESET_EXTERNAL' }))
      .toEqual({ kind: 'idle', picker: undoing.picker, lastCommittedId: null });
  });
});

describe('UNDO_CLICKED', () => {
  test('from idle with lastCommittedId → undoing', () => {
    const s: TreeState = { kind: 'idle', picker: idlePicker, lastCommittedId: 7 };
    const next = reduce(s, { type: 'UNDO_CLICKED' });
    expect(next).toEqual({ kind: 'undoing', picker: idlePicker, polypId: 7 });
  });

  test('from idle with lastCommittedId null: no-op', () => {
    const s = initialState(idlePicker);
    expect(reduce(s, { type: 'UNDO_CLICKED' })).toBe(s);
  });

  test('from placing: no-op (not idle)', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: idlePicker,
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: false, lastCommittedId: 5,
    };
    expect(reduce(s, { type: 'UNDO_CLICKED' })).toBe(s);
  });

  test('from submitting: no-op', () => {
    const s: TreeState = {
      kind: 'submitting',
      picker: idlePicker,
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, lastCommittedId: 5,
    };
    expect(reduce(s, { type: 'UNDO_CLICKED' })).toBe(s);
  });

  test('from resetting: no-op', () => {
    const s: TreeState = { kind: 'resetting', picker: idlePicker, lastCommittedId: 5 };
    expect(reduce(s, { type: 'UNDO_CLICKED' })).toBe(s);
  });

  test('from undoing: no-op', () => {
    const s: TreeState = { kind: 'undoing', picker: idlePicker, polypId: 5 };
    expect(reduce(s, { type: 'UNDO_CLICKED' })).toBe(s);
  });
});

describe('UNDO_RESOLVED', () => {
  test('from undoing → idle with lastCommittedId cleared', () => {
    const s: TreeState = { kind: 'undoing', picker: idlePicker, polypId: 7 };
    const next = reduce(s, { type: 'UNDO_RESOLVED' });
    expect(next).toEqual({ kind: 'idle', picker: idlePicker, lastCommittedId: null });
  });

  test('from idle: no-op', () => {
    const s = initialState(idlePicker);
    expect(reduce(s, { type: 'UNDO_RESOLVED' })).toBe(s);
  });

  test('from placing: no-op', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: idlePicker,
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: false, lastCommittedId: null,
    };
    expect(reduce(s, { type: 'UNDO_RESOLVED' })).toBe(s);
  });
});

describe('UNDO_REJECTED', () => {
  test('from undoing → idle, lastCommittedId restored to polypId', () => {
    const s: TreeState = { kind: 'undoing', picker: idlePicker, polypId: 7 };
    const next = reduce(s, { type: 'UNDO_REJECTED', error: 'server error' });
    expect(next).toEqual({ kind: 'idle', picker: idlePicker, lastCommittedId: 7 });
  });

  test('from idle: no-op', () => {
    const s = initialState(idlePicker);
    expect(reduce(s, { type: 'UNDO_REJECTED', error: 'x' })).toBe(s);
  });
});

describe('TREE_POLYP_REMOVED_EXTERNAL', () => {
  test('from idle: clears lastCommittedId when id matches', () => {
    const s: TreeState = { kind: 'idle', picker: idlePicker, lastCommittedId: 7 };
    const next = reduce(s, { type: 'TREE_POLYP_REMOVED_EXTERNAL', id: 7 });
    expect(next).toMatchObject({ kind: 'idle', lastCommittedId: null });
  });

  test('from idle: no-op when id does not match', () => {
    const s: TreeState = { kind: 'idle', picker: idlePicker, lastCommittedId: 7 };
    expect(reduce(s, { type: 'TREE_POLYP_REMOVED_EXTERNAL', id: 99 })).toBe(s);
  });

  test('from idle with no lastCommittedId: no-op', () => {
    const s = initialState(idlePicker);
    expect(reduce(s, { type: 'TREE_POLYP_REMOVED_EXTERNAL', id: 1 })).toBe(s);
  });

  test('from placing: clears lastCommittedId when id matches', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: idlePicker,
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: false, lastCommittedId: 7,
    };
    const next = reduce(s, { type: 'TREE_POLYP_REMOVED_EXTERNAL', id: 7 });
    expect(next).toMatchObject({ kind: 'placing', lastCommittedId: null });
  });

  test('from undoing: no-op (undo is in flight)', () => {
    const s: TreeState = { kind: 'undoing', picker: idlePicker, polypId: 7 };
    expect(reduce(s, { type: 'TREE_POLYP_REMOVED_EXTERNAL', id: 7 })).toBe(s);
  });
});

describe('LAST_COMMITTED_INVALIDATED', () => {
  test('from idle with lastCommittedId: clears it', () => {
    const s: TreeState = { kind: 'idle', picker: idlePicker, lastCommittedId: 5 };
    const next = reduce(s, { type: 'LAST_COMMITTED_INVALIDATED' });
    expect(next).toMatchObject({ kind: 'idle', lastCommittedId: null });
  });

  test('from idle with null: no-op', () => {
    const s = initialState(idlePicker);
    expect(reduce(s, { type: 'LAST_COMMITTED_INVALIDATED' })).toBe(s);
  });

  test('from placing with lastCommittedId: clears it', () => {
    const s: TreeState = {
      kind: 'placing',
      picker: idlePicker,
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: false, lastCommittedId: 5,
    };
    const next = reduce(s, { type: 'LAST_COMMITTED_INVALIDATED' });
    expect(next).toMatchObject({ kind: 'placing', lastCommittedId: null });
  });

  test('from undoing: no-op', () => {
    const s: TreeState = { kind: 'undoing', picker: idlePicker, polypId: 5 };
    expect(reduce(s, { type: 'LAST_COMMITTED_INVALIDATED' })).toBe(s);
  });
});

describe('reduce — no-op matrix', () => {
  const samples: Record<TreeState['kind'], TreeState> = {
    idle: { kind: 'idle', picker: { variant: 'forked', colorKey: 'neon-cyan' }, lastCommittedId: null },
    placing: {
      kind: 'placing',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, blocked: false, lastCommittedId: null,
    },
    submitting: {
      kind: 'submitting',
      picker: { variant: 'forked', colorKey: 'neon-cyan' },
      parentId: 1, attachIndex: 0, seed: 10, yawRad: 0, lastCommittedId: null,
    },
    resetting: { kind: 'resetting', picker: { variant: 'forked', colorKey: 'neon-cyan' }, lastCommittedId: null },
    undoing: { kind: 'undoing', picker: { variant: 'forked', colorKey: 'neon-cyan' }, polypId: 1 },
  };

  const valid: Record<TreeState['kind'], readonly TreeAction['type'][]> = {
    // UNDO_CLICKED is not listed here because the sample has lastCommittedId:null so it is identity.
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
    undoing: [
      'VARIANT_CHOSEN', 'COLOR_CHOSEN',
      'UNDO_RESOLVED', 'UNDO_REJECTED',
      'TREE_RESET_EXTERNAL',
    ],
  };

  const allActions: TreeAction[] = [
    { type: 'VARIANT_CHOSEN', variant: 'claw', seed: 1 },
    { type: 'COLOR_CHOSEN', colorKey: 'neon-magenta' },
    { type: 'ATTACH_CLICKED', parentId: 1, attachIndex: 0, seed: 1 },
    { type: 'REROLL_CLICKED', variant: 'wishbone', seed: 2 },
    { type: 'PLACEMENT_BLOCKED' },
    { type: 'PLACEMENT_OK' },
    { type: 'CANCEL_CLICKED' },
    { type: 'GROW_CLICKED' },
    { type: 'COMMIT_RESOLVED', polypId: 1 },
    { type: 'COMMIT_REJECTED', error: 'x' },
    { type: 'CLEAR_CLICKED' },
    { type: 'RESET_RESOLVED' },
    { type: 'RESET_REJECTED', error: 'x' },
    { type: 'TREE_RESET_EXTERNAL' },
    { type: 'UNDO_CLICKED' },
    { type: 'UNDO_RESOLVED' },
    { type: 'UNDO_REJECTED', error: 'x' },
    { type: 'TREE_POLYP_REMOVED_EXTERNAL', id: 999 },
    { type: 'LAST_COMMITTED_INVALIDATED' },
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
          expect(next).not.toBe(state);
        }
      });
    }
  }
});
