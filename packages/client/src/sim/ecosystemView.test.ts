import { describe, test, expect } from 'vitest';
import type { EcosystemState } from '@reef/shared';
import { EcosystemView } from './ecosystemView.js';

const eco = (over: Partial<EcosystemState> = {}): EcosystemState => ({
  version: 1, computedAt: 0, polypCount: 10, plantedLast7d: 1, daysSinceLastPlant: 0,
  bleaching: 0, fishCount: 20, phase: 'thriving', ...over,
});

function setup() {
  const fishCalls: number[] = [];
  const bleach = { value: 0 };
  const view = new EcosystemView({ fish: { setPopulation: (n) => fishCalls.push(n) }, bleach });
  return { view, fishCalls, bleach };
}

describe('EcosystemView', () => {
  test('applies the fish count right away', () => {
    const { view, fishCalls } = setup();
    view.apply(eco({ fishCount: 42 }));
    expect(fishCalls).toEqual([42]);
  });

  test('eases bleaching toward the target over a few seconds instead of popping', () => {
    const { view, bleach } = setup();
    view.apply(eco({ bleaching: 0.6 }));
    expect(bleach.value).toBe(0);
    view.update(0.5);
    expect(bleach.value).toBeGreaterThan(0);
    expect(bleach.value).toBeLessThan(0.6);
    for (let i = 0; i < 200; i++) view.update(0.1);
    expect(bleach.value).toBeCloseTo(0.6, 3);
  });

  test('a first state on page load applies instantly (no fade-in of the current look)', () => {
    const { view, bleach } = setup();
    view.apply(eco({ bleaching: 0.4 }), { immediate: true });
    expect(bleach.value).toBe(0.4);
  });

  test('ignores missing or malformed state (older server)', () => {
    const { view, fishCalls, bleach } = setup();
    view.apply(undefined);
    view.apply(eco({ bleaching: Number.NaN, fishCount: Number.NaN }));
    expect(fishCalls).toEqual([]);
    expect(bleach.value).toBe(0);
  });

  test('clamps bleaching to [0, MAX_BLEACHING]', () => {
    const { view, bleach } = setup();
    view.apply(eco({ bleaching: 5 }), { immediate: true });
    expect(bleach.value).toBe(0.6);
    view.apply(eco({ bleaching: -1 }), { immediate: true });
    expect(bleach.value).toBe(0);
  });

  test('phase() reports the last applied phase for UI copy', () => {
    const { view } = setup();
    expect(view.phase()).toBeNull();
    view.apply(eco({ phase: 'recovering' }));
    expect(view.phase()).toBe('recovering');
  });
});

describe('EcosystemView status line', () => {
  test('explains non-thriving phases in words and clears when thriving', () => {
    const statusEl = document.createElement('p');
    const view = new EcosystemView({ bleach: { value: 0 }, statusEl });
    view.apply(eco({ phase: 'bleaching' }));
    expect(statusEl.textContent).toMatch(/bleaching.*plant a coral/i);
    view.apply(eco({ phase: 'recovering' }));
    expect(statusEl.textContent).toMatch(/recovering/i);
    view.apply(eco({ phase: 'stressed' }));
    expect(statusEl.textContent).toMatch(/new corals/i);
    view.apply(eco({ phase: 'thriving' }));
    expect(statusEl.textContent).toBe('');
  });

  test('an unknown phase from a newer server shows nothing', () => {
    const statusEl = document.createElement('p');
    const view = new EcosystemView({ bleach: { value: 0 }, statusEl });
    view.apply(eco({ phase: 'molting' as never }));
    expect(statusEl.textContent).toBe('');
  });
});
