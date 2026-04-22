import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { tipAttachPoint } from './variant.js';

describe('tipAttachPoint', () => {
  test('constructs an attach point from a local-space tip position + outward direction', () => {
    const ap = tipAttachPoint({ x: 0, y: 0.1, z: 0 }, { x: 0, y: 1, z: 0 });
    assert.deepEqual(ap.position, { x: 0, y: 0.1, z: 0 });
    assert.deepEqual(ap.normal, { x: 0, y: 1, z: 0 });
  });

  test('normalizes the outward direction', () => {
    const ap = tipAttachPoint({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0 });
    assert.ok(Math.abs(ap.normal.x - 0.6) < 0.0001, `expected x ≈ 0.6, got ${ap.normal.x}`);
    assert.ok(Math.abs(ap.normal.y - 0.8) < 0.0001, `expected y ≈ 0.8, got ${ap.normal.y}`);
    assert.ok(Math.abs(ap.normal.z - 0) < 0.0001, `expected z ≈ 0, got ${ap.normal.z}`);
  });
});
