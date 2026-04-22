import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TreePolypInputSchema, TreeVariantSchema } from './schema.js';

test('TreeVariantSchema: accepts the five variants', () => {
  for (const v of ['forked', 'trident', 'starburst', 'claw', 'wishbone']) {
    assert.equal(TreeVariantSchema.safeParse(v).success, true);
  }
});

test('TreeVariantSchema: rejects unknown variants', () => {
  assert.equal(TreeVariantSchema.safeParse('rubbish').success, false);
  assert.equal(TreeVariantSchema.safeParse('branching').success, false);
});

test('TreePolypInputSchema: accepts a well-formed payload', () => {
  const valid = {
    variant: 'forked',
    seed: 42,
    colorKey: 'neon-magenta',
    parentId: 1,
    attachIndex: 0,
  };
  assert.equal(TreePolypInputSchema.safeParse(valid).success, true);
});

test('TreePolypInputSchema: allows parentId=null for root pieces', () => {
  const valid = {
    variant: 'forked',
    seed: 42,
    colorKey: 'neon-magenta',
    parentId: 1,
    attachIndex: 0,
  };
  const root = { ...valid, parentId: null };
  assert.equal(TreePolypInputSchema.safeParse(root).success, true);
});

test('TreePolypInputSchema: rejects negative or non-integer attachIndex', () => {
  const valid = {
    variant: 'forked',
    seed: 42,
    colorKey: 'neon-magenta',
    parentId: 1,
    attachIndex: 0,
  };
  assert.equal(TreePolypInputSchema.safeParse({ ...valid, attachIndex: -1 }).success, false);
  assert.equal(TreePolypInputSchema.safeParse({ ...valid, attachIndex: 1.5 }).success, false);
});

test('TreePolypInputSchema: rejects attachIndex >= 4 (max tips per variant is 4, starburst)', () => {
  const valid = {
    variant: 'forked',
    seed: 42,
    colorKey: 'neon-magenta',
    parentId: 1,
    attachIndex: 0,
  };
  assert.equal(TreePolypInputSchema.safeParse({ ...valid, attachIndex: 4 }).success, false);
  assert.equal(TreePolypInputSchema.safeParse({ ...valid, attachIndex: 10 }).success, false);
});

test('TreePolypInputSchema: rejects out-of-range seed', () => {
  const valid = {
    variant: 'forked',
    seed: 42,
    colorKey: 'neon-magenta',
    parentId: 1,
    attachIndex: 0,
  };
  assert.equal(TreePolypInputSchema.safeParse({ ...valid, seed: -1 }).success, false);
  assert.equal(TreePolypInputSchema.safeParse({ ...valid, seed: 2 ** 33 }).success, false);
});
