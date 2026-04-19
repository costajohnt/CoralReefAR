import { describe, expect, test } from 'vitest';
import { AMPLITUDE, BASELINE, PERIOD_SEC, pulseIntensity } from './pulse.js';

describe('pulseIntensity', () => {
  test('at t=0 with seed=0 the phase is 0 and intensity equals baseline', () => {
    expect(pulseIntensity(0, 0)).toBeCloseTo(BASELINE);
  });

  test('stays inside [baseline - amplitude, baseline + amplitude]', () => {
    // Sweep a range of times + seeds; sine is bounded so this should always hold.
    for (let seed = 0; seed < 0xffffffff; seed += 0x11111111) {
      for (let t = 0; t < 20; t += 0.1) {
        const v = pulseIntensity(t, seed);
        expect(v).toBeGreaterThanOrEqual(BASELINE - AMPLITUDE - 1e-9);
        expect(v).toBeLessThanOrEqual(BASELINE + AMPLITUDE + 1e-9);
      }
    }
  });

  test('different seeds produce different phases at the same instant', () => {
    // Two seeds 180° apart on the unit circle should produce mirrored values
    // around the baseline at the same t.
    const seedA = 0;
    const seedB = 0x7fffffff; // ≈ 0.5 of max → phase ≈ π
    const a = pulseIntensity(1, seedA);
    const b = pulseIntensity(1, seedB);
    // Sum lands at ≈ 2 * baseline because sin(x) + sin(x + π) = 0.
    expect(a + b).toBeCloseTo(2 * BASELINE, 2);
  });

  test('completes a full cycle over PERIOD_SEC seconds', () => {
    const seed = 0;
    const start = pulseIntensity(0, seed);
    const oneCycle = pulseIntensity(PERIOD_SEC, seed);
    expect(oneCycle).toBeCloseTo(start, 6);
  });

  test('quarter-period advance equals amplitude offset for seed=0', () => {
    // sin(0 + π/2) = 1, so after a quarter period we should be at the peak.
    const peak = pulseIntensity(PERIOD_SEC / 4, 0);
    expect(peak).toBeCloseTo(BASELINE + AMPLITUDE, 6);
  });
});
