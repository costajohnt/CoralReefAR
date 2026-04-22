import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { generateStarburst } from './starburst.js';

describe('generateStarburst', () => {
  test('produces a mesh with positions/normals/colors/indices', () => {
    const out = generateStarburst({ seed: 1, colorKey: 'neon-magenta' });
    assert.ok(out.mesh.positions.length > 0, 'positions should be non-empty');
    assert.strictEqual(out.mesh.positions.length % 3, 0, 'positions length must be divisible by 3');
    assert.strictEqual(out.mesh.normals.length, out.mesh.positions.length, 'normals length must match positions');
    assert.strictEqual(out.mesh.colors.length, out.mesh.positions.length, 'colors length must match positions');
    assert.strictEqual(out.mesh.indices.length % 3, 0, 'indices length must be divisible by 3');
  });

  test('exposes exactly 4 attach points (four cardinal tips)', () => {
    const out = generateStarburst({ seed: 1, colorKey: 'neon-magenta' });
    assert.strictEqual(out.attachPoints.length, 4);
  });

  test('attach-point normals are unit length', () => {
    const out = generateStarburst({ seed: 1, colorKey: 'neon-cyan' });
    for (const ap of out.attachPoints) {
      const n = Math.hypot(ap.normal.x, ap.normal.y, ap.normal.z);
      assert.ok(Math.abs(n - 1) < 1e-5, `normal magnitude should be 1, got ${n}`);
    }
  });

  test('attach-point positions are in 4 different horizontal quadrants', () => {
    const out = generateStarburst({ seed: 1, colorKey: 'neon-magenta' }).attachPoints;
    // For cardinal directions (+X, +Z, -X, -Z), verify azimuth distribution
    // Compute azimuth for each attach point
    const azimuths = out.map(ap => Math.atan2(ap.position.z, ap.position.x));

    // Rough check: the 4 azimuths should be roughly at 0, π/2, π, 3π/2
    // Group into quadrants (±π/4 from cardinal)
    const quadrants = [0, 0, 0, 0]; // +X, +Z, -X, -Z
    const threshold = Math.PI / 4 + 0.1; // Allow some tolerance

    for (const az of azimuths) {
      // Normalize to [0, 2π)
      const normalized = az < 0 ? az + 2 * Math.PI : az;

      if (normalized < threshold || normalized > 2 * Math.PI - threshold) {
        quadrants[0]!++; // +X direction (0°)
      } else if (Math.abs(normalized - Math.PI / 2) < threshold) {
        quadrants[1]!++; // +Z direction (90°)
      } else if (Math.abs(normalized - Math.PI) < threshold) {
        quadrants[2]!++; // -X direction (180°)
      } else if (Math.abs(normalized - 3 * Math.PI / 2) < threshold) {
        quadrants[3]!++; // -Z direction (270°)
      }
    }

    // Each quadrant should have exactly one tip
    assert.deepStrictEqual(quadrants, [1, 1, 1, 1], `attach points should be in 4 cardinal directions, got distribution ${quadrants}`);
  });

  test('bounding box contains all vertex positions', () => {
    const out = generateStarburst({ seed: 1, colorKey: 'neon-magenta' });
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
