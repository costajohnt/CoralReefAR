import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { generateTrident } from './trident.js';

describe('generateTrident', () => {
  test('produces a mesh with positions/normals/colors/indices', () => {
    const out = generateTrident({ seed: 1, colorKey: 'neon-magenta' });
    assert.ok(out.mesh.positions.length > 0, 'positions should be non-empty');
    assert.strictEqual(out.mesh.positions.length % 3, 0, 'positions length must be divisible by 3');
    assert.strictEqual(out.mesh.normals.length, out.mesh.positions.length, 'normals length must match positions');
    assert.strictEqual(out.mesh.colors.length, out.mesh.positions.length, 'colors length must match positions');
    assert.strictEqual(out.mesh.indices.length % 3, 0, 'indices length must be divisible by 3');
  });

  test('exposes exactly 3 attach points (three spikes)', () => {
    const out = generateTrident({ seed: 1, colorKey: 'neon-magenta' });
    assert.strictEqual(out.attachPoints.length, 3);
  });

  test('attach-point normals are unit length', () => {
    const out = generateTrident({ seed: 1, colorKey: 'neon-cyan' });
    for (const ap of out.attachPoints) {
      const n = Math.hypot(ap.normal.x, ap.normal.y, ap.normal.z);
      assert.ok(Math.abs(n - 1) < 1e-5, `normal magnitude should be 1, got ${n}`);
    }
  });

  test('attach-point positions are spatially distinct', () => {
    const out = generateTrident({ seed: 1, colorKey: 'neon-magenta' }).attachPoints;
    // Check pairwise distances; with 3 spikes at 120° intervals, they should all differ
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const dx = out[i]!.position.x - out[j]!.position.x;
        const dy = out[i]!.position.y - out[j]!.position.y;
        const dz = out[i]!.position.z - out[j]!.position.z;
        const dist = Math.hypot(dx, dy, dz);
        assert.ok(dist > 0.01, `attach points ${i} and ${j} too close (dist=${dist})`);
      }
    }
  });

  test('bounding box contains all vertex positions', () => {
    const out = generateTrident({ seed: 1, colorKey: 'neon-magenta' });
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
});
