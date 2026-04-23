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
