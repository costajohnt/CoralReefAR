import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { generateTreeVariant } from './index.js';

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
});
