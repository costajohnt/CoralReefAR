import { describe, expect, test } from 'vitest';
import { CylinderGeometry, Mesh, MeshStandardMaterial } from 'three';
import { createPedestal } from './scene.js';

describe('createPedestal', () => {
  test('returns a Mesh with a CylinderGeometry', () => {
    const p = createPedestal();
    expect(p).toBeInstanceOf(Mesh);
    expect(p.geometry).toBeInstanceOf(CylinderGeometry);
  });

  test('material is a matte MeshStandardMaterial (no self-illumination to compete with the reef pulse)', () => {
    const mat = createPedestal().material as MeshStandardMaterial;
    expect(mat).toBeInstanceOf(MeshStandardMaterial);
    expect(mat.roughness).toBeGreaterThan(0.7);
    expect(mat.metalness).toBeLessThan(0.1);
    expect(mat.emissiveIntensity ?? 0).toBeLessThan(0.01);
  });

  test('pedestal top sits at y=0 so Reef geometry grows from the origin', () => {
    const p = createPedestal();
    const geom = p.geometry as CylinderGeometry;
    const halfHeight = geom.parameters.height / 2;
    expect(p.position.y + halfHeight).toBeCloseTo(0, 4);
  });
});
