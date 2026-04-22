import { describe, expect, test } from 'vitest';
import { Mesh, Box3, MeshStandardMaterial } from 'three';
import { generateTreeVariantMesh } from './variants.js';

const VARIANTS = ['forked', 'trident', 'starburst', 'claw', 'wishbone'] as const;
const ATTACH_COUNTS = { forked: 2, trident: 3, starburst: 4, claw: 2, wishbone: 2 };

describe('generateTreeVariantMesh', () => {
  test.each(VARIANTS)('returns a Three.Mesh for variant %s', (variant) => {
    const result = generateTreeVariantMesh({ variant, seed: 1, colorKey: 'neon-magenta' });
    expect(result.mesh).toBeInstanceOf(Mesh);
    expect(result.mesh.geometry).toBeDefined();
    expect(result.mesh.material).toBeDefined();
  });

  test.each(VARIANTS)('attach-point count matches variant %s', (variant) => {
    const result = generateTreeVariantMesh({ variant, seed: 1, colorKey: 'neon-magenta' });
    expect(result.attachPointsLocal).toHaveLength(ATTACH_COUNTS[variant]);
  });

  test('applies Avatar material preset (opacity 1 + high emissive)', () => {
    const result = generateTreeVariantMesh({ variant: 'starburst', seed: 1, colorKey: 'neon-cyan' });
    const mat = result.mesh.material as MeshStandardMaterial;
    expect(mat.opacity).toBe(1);
    expect(mat.transparent).toBe(false);
    expect(mat.emissiveIntensity).toBeGreaterThanOrEqual(0.9);
  });

  test('returns a Box3 bounding box', () => {
    const result = generateTreeVariantMesh({ variant: 'forked', seed: 1, colorKey: 'neon-magenta' });
    expect(result.boundingBox).toBeInstanceOf(Box3);
    expect(result.boundingBox.isEmpty()).toBe(false);
  });
});
