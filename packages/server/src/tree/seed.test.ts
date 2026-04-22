import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { ReefDb } from '../db.js';
import { TreeDb } from './db.js';
import { seedRootIfEmpty } from './seed.js';

describe('seedRootIfEmpty', () => {
  test('inserts exactly one Starburst root when the tree is empty', () => {
    const reef = new ReefDb(':memory:');
    const tree = new TreeDb(reef);
    const result = seedRootIfEmpty(tree);
    assert.equal(result.seeded, true);
    const all = tree.listLive();
    assert.equal(all.length, 1);
    assert.equal(all[0]!.variant, 'starburst');
    assert.equal(all[0]!.parentId, null);
  });

  test('is a no-op when the tree already has pieces', () => {
    const reef = new ReefDb(':memory:');
    const tree = new TreeDb(reef);
    tree.insertRoot({ variant: 'forked', seed: 1, colorKey: 'x' });
    const result = seedRootIfEmpty(tree);
    assert.equal(result.seeded, false);
    assert.equal(tree.listLive().length, 1);
    // Existing piece untouched.
    assert.equal(tree.listLive()[0]!.variant, 'forked');
  });

  test('the seed uses a random seed + colorKey (not hard-coded)', () => {
    const results = new Set<number>();
    for (let i = 0; i < 5; i++) {
      const reef = new ReefDb(':memory:');
      const tree = new TreeDb(reef);
      seedRootIfEmpty(tree);
      results.add(tree.listLive()[0]!.seed);
    }
    // Not all five identical — random.
    assert.ok(results.size > 1, `expected randomness, got ${[...results].join(',')}`);
  });
});
