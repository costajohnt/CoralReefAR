import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Storage } from './storage.js';
import { ReefDb } from './db.js';
import { TreeDb } from './tree/db.js';

test('storage: ReefDb and TreeDb built from one Storage share its handle and migrations', () => {
  const storage = new Storage(':memory:');
  const reef = new ReefDb(storage);
  const tree = new TreeDb(storage);
  assert.equal(reef.db, storage.db);
  tree.insertRoot({ variant: 'forked', seed: 1, colorKey: 'neon-cyan' });
  // A tree write is visible through the shared handle, so both live in one file.
  const n = (storage.db.prepare('SELECT COUNT(*) AS n FROM tree_polyps').get() as { n: number }).n;
  assert.equal(n, 1);
  assert.equal(reef.countLivePolyps(), 0);
});

test('storage: ReefDb(path) still opens its own Storage', () => {
  const reef = new ReefDb(':memory:');
  assert.ok(reef.storage instanceof Storage);
  assert.equal(reef.storage.db, reef.db);
});
