import { describe, expect, test } from 'vitest';
import {
  TREE_AMPLITUDE,
  TREE_BASELINE,
  TREE_PERIOD_SEC,
  treePulseIntensity,
} from './pulse.js';

describe('treePulseIntensity', () => {
  test('baseline is brighter than the landscape pulse so the Avatar glow reads', () => {
    // Regression guard: the tree pulse should not silently drift back to the
    // landscape's dim baseline (0.2). If someone refactors toward a shared
    // helper, this test flags the reduction.
    expect(TREE_BASELINE).toBeGreaterThan(0.25);
    expect(TREE_AMPLITUDE).toBeGreaterThanOrEqual(0.15);
  });

  test('at t=0 with seed=0 intensity equals baseline', () => {
    expect(treePulseIntensity(0, 0)).toBeCloseTo(TREE_BASELINE);
  });

  test('stays inside [baseline - amplitude, baseline + amplitude]', () => {
    for (let seed = 0; seed < 0xffffffff; seed += 0x11111111) {
      for (let t = 0; t < 20; t += 0.1) {
        const v = treePulseIntensity(t, seed);
        expect(v).toBeGreaterThanOrEqual(TREE_BASELINE - TREE_AMPLITUDE - 1e-9);
        expect(v).toBeLessThanOrEqual(TREE_BASELINE + TREE_AMPLITUDE + 1e-9);
      }
    }
  });

  test('different seeds produce different phases at the same instant', () => {
    const seedA = 0;
    const seedB = 0x7fffffff;
    const a = treePulseIntensity(1, seedA);
    const b = treePulseIntensity(1, seedB);
    expect(a + b).toBeCloseTo(2 * TREE_BASELINE, 2);
  });

  test('completes a full cycle over TREE_PERIOD_SEC', () => {
    const start = treePulseIntensity(0, 0);
    const oneCycle = treePulseIntensity(TREE_PERIOD_SEC, 0);
    expect(oneCycle).toBeCloseTo(start, 6);
  });

  test('quarter-period advance hits the peak for seed=0', () => {
    const peak = treePulseIntensity(TREE_PERIOD_SEC / 4, 0);
    expect(peak).toBeCloseTo(TREE_BASELINE + TREE_AMPLITUDE, 6);
  });
});
