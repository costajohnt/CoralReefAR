import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PolypInputSchema } from './schema.js';

const validBase = {
  species: 'branching' as const,
  seed: 42,
  colorKey: 'coral-pink',
  position: [0, 0, 0] as [number, number, number],
  orientation: [0, 0, 0, 1] as [number, number, number, number],
  scale: 1,
};

test('schema: surface field is optional and defaults to undefined', () => {
  const parsed = PolypInputSchema.safeParse(validBase);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.surface, undefined);
  }
});

test('schema: surface accepts "web"', () => {
  const parsed = PolypInputSchema.safeParse({ ...validBase, surface: 'web' });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.surface, 'web');
});

test('schema: surface accepts "quest"', () => {
  const parsed = PolypInputSchema.safeParse({ ...validBase, surface: 'quest' });
  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(parsed.data.surface, 'quest');
});

test('schema: surface rejects unknown values', () => {
  const parsed = PolypInputSchema.safeParse({ ...validBase, surface: 'vr' });
  assert.equal(parsed.success, false);
});
