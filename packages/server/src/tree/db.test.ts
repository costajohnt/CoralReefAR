import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { ReefDb } from '../db.js';
import { TreeDb } from './db.js';

function makeDb(): { tree: TreeDb; close: () => void } {
  const reef = new ReefDb(':memory:');
  const tree = new TreeDb(reef);
  return { tree, close: (): void => { /* ReefDb doesn't expose close, GC handles it */ } };
}

describe('TreeDb.insertRoot', () => {
  test('inserts a root piece (parentId=null, attachIndex=0)', () => {
    const { tree } = makeDb();
    const p = tree.insertRoot({ variant: 'starburst', seed: 42, colorKey: 'neon-cyan' });
    assert.equal(p.parentId, null);
    assert.equal(p.variant, 'starburst');
    assert.equal(p.attachIndex, 0);
  });
});

describe('TreeDb.insertChild', () => {
  test('inserts a child referencing a valid parent + unused attach index', () => {
    const { tree } = makeDb();
    const root = tree.insertRoot({ variant: 'starburst', seed: 1, colorKey: 'neon-cyan' });
    const child = tree.insertChild({
      variant: 'forked', seed: 2, colorKey: 'neon-magenta',
      parentId: root.id, attachIndex: 1,
    });
    assert.equal(child.parentId, root.id);
    assert.equal(child.attachIndex, 1);
  });

  test('rejects insert when parent does not exist', () => {
    const { tree } = makeDb();
    assert.throws(() => tree.insertChild({
      variant: 'forked', seed: 1, colorKey: 'x',
      parentId: 99999, attachIndex: 0,
    }), /parent not found/i);
  });

  test('rejects insert when attach slot is already claimed', () => {
    const { tree } = makeDb();
    const root = tree.insertRoot({ variant: 'starburst', seed: 1, colorKey: 'x' });
    tree.insertChild({ variant: 'forked', seed: 2, colorKey: 'x', parentId: root.id, attachIndex: 0 });
    assert.throws(() => tree.insertChild({
      variant: 'forked', seed: 3, colorKey: 'x', parentId: root.id, attachIndex: 0,
    }), /attach index.*already claimed/i);
  });

  test('rejects insert when parent is soft-deleted', () => {
    const { tree } = makeDb();
    const root = tree.insertRoot({ variant: 'starburst', seed: 1, colorKey: 'x' });
    tree.softDelete(root.id);
    assert.throws(() => tree.insertChild({
      variant: 'forked', seed: 2, colorKey: 'x', parentId: root.id, attachIndex: 0,
    }), /parent not found/i);
  });

  test('stores and returns attachYaw (radians) when provided', () => {
    const { tree } = makeDb();
    const root = tree.insertRoot({ variant: 'starburst', seed: 1, colorKey: 'x' });
    const child = tree.insertChild({
      variant: 'forked', seed: 2, colorKey: 'x',
      parentId: root.id, attachIndex: 1, attachYaw: 1.25,
    });
    assert.equal(child.attachYaw, 1.25);
  });

  test('defaults attachYaw to 0 when omitted', () => {
    const { tree } = makeDb();
    const root = tree.insertRoot({ variant: 'starburst', seed: 1, colorKey: 'x' });
    const child = tree.insertChild({
      variant: 'forked', seed: 2, colorKey: 'x',
      parentId: root.id, attachIndex: 0,
    });
    assert.equal(child.attachYaw, 0);
  });
});

describe('TreeDb.listLive', () => {
  test('returns all live pieces with deviceHash stripped', () => {
    const { tree } = makeDb();
    tree.insertRoot({ variant: 'starburst', seed: 1, colorKey: 'x' });
    const list = tree.listLive();
    assert.equal(list.length, 1);
    assert.equal((list[0] as { deviceHash?: string }).deviceHash, undefined);
  });
});

describe('TreeDb.softDelete (leaf-only)', () => {
  test('deletes a leaf piece', () => {
    const { tree } = makeDb();
    const root = tree.insertRoot({ variant: 'starburst', seed: 1, colorKey: 'x' });
    const result = tree.softDelete(root.id);
    assert.equal(result.ok, true);
    assert.equal(tree.listLive().length, 0);
  });

  test('refuses to delete a piece that has live children', () => {
    const { tree } = makeDb();
    const root = tree.insertRoot({ variant: 'starburst', seed: 1, colorKey: 'x' });
    tree.insertChild({ variant: 'forked', seed: 2, colorKey: 'x', parentId: root.id, attachIndex: 0 });
    const result = tree.softDelete(root.id);
    assert.equal(result.ok, false);
    assert.match(result.reason ?? '', /has children/i);
  });

  test('returns ok=false not_found for unknown ids', () => {
    const { tree } = makeDb();
    const result = tree.softDelete(99999);
    assert.equal(result.ok, false);
    assert.match(result.reason ?? '', /not.?found/i);
  });
});

describe('TreeDb.hasAnyLive', () => {
  test('returns false on an empty tree', () => {
    const { tree } = makeDb();
    assert.equal(tree.hasAnyLive(), false);
  });
  test('returns true once any root is inserted', () => {
    const { tree } = makeDb();
    tree.insertRoot({ variant: 'starburst', seed: 1, colorKey: 'x' });
    assert.equal(tree.hasAnyLive(), true);
  });
});
