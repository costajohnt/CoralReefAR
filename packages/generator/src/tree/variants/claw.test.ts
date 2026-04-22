import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { generateClaw } from './claw.js';

describe('generateClaw', () => {
  test('produces a mesh with positions/normals/colors/indices', () => {
    const out = generateClaw({ seed: 1, colorKey: 'neon-magenta' });
    assert.ok(out.mesh.positions.length > 0, 'positions should be non-empty');
    assert.strictEqual(out.mesh.positions.length % 3, 0, 'positions length must be divisible by 3');
    assert.strictEqual(out.mesh.normals.length, out.mesh.positions.length, 'normals length must match positions');
    assert.strictEqual(out.mesh.colors.length, out.mesh.positions.length, 'colors length must match positions');
    assert.strictEqual(out.mesh.indices.length % 3, 0, 'indices length must be divisible by 3');
  });

  test('exposes exactly 2 attach points (two tips of the claw)', () => {
    const out = generateClaw({ seed: 1, colorKey: 'neon-magenta' });
    assert.strictEqual(out.attachPoints.length, 2);
  });

  test('attach-point normals are unit length', () => {
    const out = generateClaw({ seed: 1, colorKey: 'neon-cyan' });
    for (const ap of out.attachPoints) {
      const n = Math.hypot(ap.normal.x, ap.normal.y, ap.normal.z);
      assert.ok(Math.abs(n - 1) < 1e-5, `normal magnitude should be 1, got ${n}`);
    }
  });

  test('attach-point positions are spatially distinct', () => {
    const [a, b] = generateClaw({ seed: 1, colorKey: 'neon-magenta' }).attachPoints;
    const dx = a!.position.x - b!.position.x;
    const dy = a!.position.y - b!.position.y;
    const dz = a!.position.z - b!.position.z;
    assert.ok(Math.hypot(dx, dy, dz) > 0.01, 'tips must be separated by more than 0.01');
  });

  test('bounding box contains all vertex positions', () => {
    const out = generateClaw({ seed: 1, colorKey: 'neon-magenta' });
    const { min, max } = out.boundingBox;
    for (let i = 0; i < out.mesh.positions.length; i += 3) {
      const x = out.mesh.positions[i]!;
      const y = out.mesh.positions[i + 1]!;
      const z = out.mesh.positions[i + 2]!;
      assert.ok(x >= min.x - 1e-6, `position x=${x} below min.x=${min.x}`);
      assert.ok(x <= max.x + 1e-6, `position x=${x} above max.x=${max.x}`);
      assert.ok(y >= min.y - 1e-6, `position y=${y} below min.y=${min.y}`);
      assert.ok(y <= max.y + 1e-6, `position y=${y} above max.y=${max.y}`);
      assert.ok(z >= min.z - 1e-6, `position z=${z} below min.z=${min.z}`);
      assert.ok(z <= max.z + 1e-6, `position z=${z} above max.z=${max.z}`);
    }
  });

  test('attach-point tips are significantly offset horizontally from the trunk base', () => {
    const out = generateClaw({ seed: 1, colorKey: 'neon-magenta' });
    const [a, b] = out.attachPoints;
    const aHoriz = Math.hypot(a!.position.x, a!.position.z);
    const bHoriz = Math.hypot(b!.position.x, b!.position.z);
    const maxHoriz = Math.max(aHoriz, bHoriz);
    assert.ok(maxHoriz > 0.03, `at least one tip should be displaced > 0.03 horizontally, got ${maxHoriz}`);
  });
});
