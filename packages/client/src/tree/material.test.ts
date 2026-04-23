import { describe, expect, test } from 'vitest';
import { BufferGeometry, Color, Mesh, MeshPhysicalMaterial } from 'three';
import { applyTreeMaterial } from './material.js';

function makeMesh(): Mesh {
  return new Mesh(new BufferGeometry());
}

describe('applyTreeMaterial', () => {
  test('replaces the mesh material with a MeshPhysicalMaterial', () => {
    const mesh = makeMesh();
    applyTreeMaterial(mesh, '#ff1ad9');
    expect(mesh.material).toBeInstanceOf(MeshPhysicalMaterial);
  });

  test('sets a slight translucency (Avatar wet-coral aesthetic)', () => {
    const mesh = makeMesh();
    applyTreeMaterial(mesh, '#ff1ad9');
    const mat = mesh.material as MeshPhysicalMaterial;
    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBeGreaterThan(0.6);
    expect(mat.opacity).toBeLessThan(0.95);
  });

  test('emissive is set to the provided palette hex (not the default white)', () => {
    const mesh = makeMesh();
    applyTreeMaterial(mesh, '#2dffe4');
    const mat = mesh.material as MeshPhysicalMaterial;
    const expected = new Color('#2dffe4');
    expect(mat.emissive.r).toBeCloseTo(expected.r, 5);
    expect(mat.emissive.g).toBeCloseTo(expected.g, 5);
    expect(mat.emissive.b).toBeCloseTo(expected.b, 5);
  });

  test('vertexColors enabled so per-vertex color drives per-piece hue', () => {
    const mesh = makeMesh();
    applyTreeMaterial(mesh, '#ff1ad9');
    const mat = mesh.material as MeshPhysicalMaterial;
    expect(mat.vertexColors).toBe(true);
  });

  test('has clearcoat + transmission for the wet look', () => {
    const mesh = makeMesh();
    applyTreeMaterial(mesh, '#ff1ad9');
    const mat = mesh.material as MeshPhysicalMaterial;
    expect(mat.clearcoat).toBeGreaterThan(0);
    expect(mat.transmission).toBeGreaterThan(0);
  });

  test('different palette hexes produce different emissive colors', () => {
    const a = makeMesh();
    const b = makeMesh();
    applyTreeMaterial(a, '#ff1ad9');
    applyTreeMaterial(b, '#b0ff3a');
    expect((a.material as MeshPhysicalMaterial).emissive.getHex())
      .not.toBe((b.material as MeshPhysicalMaterial).emissive.getHex());
  });
});
