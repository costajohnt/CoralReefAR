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
