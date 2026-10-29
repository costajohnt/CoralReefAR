import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MAX_BLEACHING, MAX_FISH, type EcosystemState } from '@reef/shared';
import {
  BLEACH_DOWN_PER_HOUR, BLEACH_UP_PER_HOUR, FULL_BLEACH_DAYS, GRACE_DAYS, MAX_CATCHUP_HOURS,
  bleachingTarget, fishCountFor, stepEcosystem, type EcosystemInputs,
} from './ecosystem.js';

const H = 3_600_000;
const D = 24 * H;
const T0 = 1_800_000_000_000;

const inputs = (over: Partial<EcosystemInputs> = {}): EcosystemInputs => ({
  now: T0, polypCount: 100, lastPlantedAt: T0, plantedLast7d: 10, ...over,
});

/** Run hourly ticks for `hours`, with planting stopped at `stoppedAt`. */
function run(prev: EcosystemState | null, from: number, hours: number, lastPlantedAt: number): EcosystemState {
  let s = prev;
  for (let h = 1; h <= hours; h++) {
    s = stepEcosystem(s, inputs({ now: from + h * H, lastPlantedAt, plantedLast7d: 0 }));
  }
  return s!;
}

test('fish scale with reef size, bounded both ways, and thin out when bleached', () => {
  assert.equal(fishCountFor(0, 0), 8);
  assert.ok(fishCountFor(100, 0) > fishCountFor(10, 0));
  assert.ok(fishCountFor(1000, 0) > fishCountFor(100, 0));
  assert.equal(fishCountFor(1_000_000, 0), MAX_FISH);
  assert.ok(fishCountFor(100, MAX_BLEACHING) < fishCountFor(100, 0));
  assert.ok(fishCountFor(100, MAX_BLEACHING) >= 8);
});

test('bleaching target: none during the grace period, ramps to the cap by FULL_BLEACH_DAYS', () => {
  assert.equal(bleachingTarget(null), 0);
  assert.equal(bleachingTarget(GRACE_DAYS), 0);
  assert.ok(bleachingTarget((GRACE_DAYS + FULL_BLEACH_DAYS) / 2) > 0);
  assert.equal(bleachingTarget(FULL_BLEACH_DAYS), MAX_BLEACHING);
  assert.equal(bleachingTarget(365), MAX_BLEACHING);
});

test('a fresh, active reef is thriving with no bleaching', () => {
  const s = stepEcosystem(null, inputs());
  assert.equal(s.bleaching, 0);
  assert.equal(s.phase, 'thriving');
  assert.equal(s.version, 1);
  assert.equal(s.computedAt, T0);
  assert.equal(s.polypCount, 100);
});

test('first ever state starts unbleached even on a long-stagnant reef (no jump on deploy)', () => {
  const s = stepEcosystem(null, inputs({ lastPlantedAt: T0 - 30 * D, plantedLast7d: 0 }));
  assert.equal(s.bleaching, 0);
  assert.equal(s.phase, 'stressed');
});

test('stagnation bleaches gradually, never past the cap', () => {
  const start = stepEcosystem(null, inputs());
  const after = run(start, T0, 24 * 30, T0);
  assert.equal(after.bleaching, MAX_BLEACHING);
  assert.equal(after.phase, 'bleaching');
  // Gradual: one tick can only move by the hourly rate.
  const s1 = stepEcosystem(after, inputs({ now: after.computedAt + H, lastPlantedAt: T0, plantedLast7d: 0 }));
  assert.ok(Math.abs(s1.bleaching - after.bleaching) <= BLEACH_UP_PER_HOUR + 1e-9);
});

test('planting again starts recovery, faster than bleaching came on', () => {
  const bleached = run(stepEcosystem(null, inputs()), T0, 24 * 30, T0);
  const resumeAt = bleached.computedAt;
  const r1 = stepEcosystem(bleached, inputs({ now: resumeAt + H, lastPlantedAt: resumeAt + H / 2, plantedLast7d: 1 }));
  assert.equal(r1.phase, 'recovering');
  assert.ok(Math.abs(bleached.bleaching - r1.bleaching - BLEACH_DOWN_PER_HOUR) < 1e-9);
  assert.ok(BLEACH_DOWN_PER_HOUR > BLEACH_UP_PER_HOUR);
  let s = r1;
  for (let h = 2; h <= 48; h++) {
    s = stepEcosystem(s, inputs({ now: resumeAt + h * H, lastPlantedAt: resumeAt + H / 2, plantedLast7d: 1 }));
  }
  assert.equal(s.bleaching, 0);
  assert.equal(s.phase, 'thriving');
});

test('a long gap between ticks (downtime) catches up at most MAX_CATCHUP_HOURS', () => {
  const start = stepEcosystem(null, inputs());
  const s = stepEcosystem(start, inputs({ now: T0 + 30 * D, lastPlantedAt: T0, plantedLast7d: 0 }));
  assert.ok(s.bleaching <= MAX_CATCHUP_HOURS * BLEACH_UP_PER_HOUR + 1e-9);
});

test('a clock that goes backwards does not move bleaching', () => {
  const a = run(stepEcosystem(null, inputs()), T0, 24 * 20, T0);
  const b = stepEcosystem(a, inputs({ now: a.computedAt - 5 * H, lastPlantedAt: T0, plantedLast7d: 0 }));
  assert.equal(b.bleaching, a.bleaching);
});

test('deterministic: same inputs, same output', () => {
  const prev = run(stepEcosystem(null, inputs()), T0, 24 * 10, T0);
  const i = inputs({ now: prev.computedAt + H, lastPlantedAt: T0, plantedLast7d: 0 });
  assert.deepEqual(stepEcosystem(prev, i), stepEcosystem(prev, i));
});

test('an empty reef is calm: no bleaching target, minimum fish', () => {
  const s = stepEcosystem(null, inputs({ polypCount: 0, lastPlantedAt: null, plantedLast7d: 0 }));
  assert.equal(s.daysSinceLastPlant, null);
  assert.equal(s.bleaching, 0);
  assert.equal(s.fishCount, 8);
  assert.equal(s.phase, 'thriving');
});
