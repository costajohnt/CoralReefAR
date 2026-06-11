import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { TREE_VARIANT_ATTACH_COUNTS, type TreeVariant } from '@reef/shared';
import { generateTreeVariant } from './index.js';
import { generatePolyp } from '../generate.js';

describe('generateTreeVariant', () => {
  test('dispatches to each of the 5 variants', () => {
    const variants = ['forked', 'trident', 'starburst', 'claw', 'wishbone'] as const;
    for (const v of variants) {
      const out = generateTreeVariant({ variant: v, seed: 1, colorKey: 'neon-cyan' });
      assert.ok(out.mesh.positions.length > 0, `${v} should produce non-empty mesh`);
      assert.ok(out.attachPoints.length > 0, `${v} should expose attach points`);
    }
  });

  test('is deterministic per (variant, seed, colorKey)', () => {
    const a = generateTreeVariant({ variant: 'starburst', seed: 42, colorKey: 'neon-magenta' });
    const b = generateTreeVariant({ variant: 'starburst', seed: 42, colorKey: 'neon-magenta' });
    assert.deepEqual(Array.from(a.mesh.positions), Array.from(b.mesh.positions));
  });

  test('throws on unknown variant', () => {
    assert.throws(() => generateTreeVariant({
      variant: 'rubbish' as never, seed: 1, colorKey: 'neon-magenta',
    }));
  });

  // Sync guard: the shared schema's attachIndex bound is derived from
  // TREE_VARIANT_ATTACH_COUNTS. If a variant builder's real attach-point count
  // ever diverges from the declared map, this fails so the schema gets updated
  // instead of silently 400-ing valid placements.
  test('each variant exposes exactly its declared attach-point count', () => {
    for (const [variant, count] of Object.entries(TREE_VARIANT_ATTACH_COUNTS) as [
      TreeVariant,
      number,
    ][]) {
      const out = generateTreeVariant({ variant, seed: 7, colorKey: 'neon-cyan' });
      assert.equal(
        out.attachPoints.length,
        count,
        `${variant} exposes ${out.attachPoints.length} attach points, map says ${count}`,
      );
    }
  });

  test('unknown colorKey falls back instead of throwing', () => {
    assert.doesNotThrow(() =>
      generateTreeVariant({ variant: 'forked', seed: 1, colorKey: 'not-a-real-key' }),
    );
  });
});

describe('generatePolyp (reef) colorKey resilience', () => {
  test('unknown colorKey falls back instead of throwing the whole reef render', () => {
    assert.doesNotThrow(() =>
      generatePolyp({ species: 'branching', seed: 1, colorKey: 'stale-bad-key' }),
    );
  });
});
