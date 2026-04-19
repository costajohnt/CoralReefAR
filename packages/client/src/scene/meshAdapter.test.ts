import { describe, expect, test } from 'vitest';
import { BufferAttribute, MeshStandardMaterial } from 'three';
import type { MeshData } from '@reef/generator';
import { polypMesh, toGeometry } from './meshAdapter.js';

// Minimal valid mesh: single triangle. Enough to verify attribute wiring
// and stride without leaning on the full generator.
function fixtureMesh(): MeshData {
  return {
    positions: new Float32Array([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ]),
    normals: new Float32Array([
      0, 0, 1,
      0, 0, 1,
      0, 0, 1,
    ]),
    colors: new Float32Array([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ]),
    indices: new Uint32Array([0, 1, 2]),
  };
}

describe('toGeometry', () => {
  test('wires position, normal, color with itemSize 3 and correct counts', () => {
    const m = fixtureMesh();
    const g = toGeometry(m);

    const pos = g.getAttribute('position') as BufferAttribute;
    const nrm = g.getAttribute('normal') as BufferAttribute;
    const col = g.getAttribute('color') as BufferAttribute;

    expect(pos.itemSize).toBe(3);
    expect(nrm.itemSize).toBe(3);
    expect(col.itemSize).toBe(3);
    expect(pos.count).toBe(3);
    expect(nrm.count).toBe(3);
    expect(col.count).toBe(3);
    expect(pos.array).toBe(m.positions);
  });

  test('preserves index buffer and computes a bounding sphere', () => {
    const m = fixtureMesh();
    const g = toGeometry(m);

    const idx = g.getIndex();
    expect(idx).not.toBeNull();
    expect(idx!.count).toBe(3);
    expect(idx!.array).toBe(m.indices);
    expect(g.boundingSphere).not.toBeNull();
    expect(g.boundingSphere!.radius).toBeGreaterThan(0);
  });
});

describe('polypMesh', () => {
  test('builds a Mesh with a StandardMaterial that uses vertex colors', () => {
    const mesh = polypMesh(fixtureMesh());

    expect(mesh.geometry.getAttribute('position').count).toBe(3);
    const mat = mesh.material as MeshStandardMaterial;
    expect(mat).toBeInstanceOf(MeshStandardMaterial);
    expect(mat.vertexColors).toBe(true);
    // PBR values that give the coral its matte-wet-rock look; guard so a
    // future tweak is at least conscious.
    expect(mat.roughness).toBeCloseTo(0.7);
    expect(mat.metalness).toBeCloseTo(0.05);
  });

  test('material is translucent with a baseline emissive glow', () => {
    const mat = polypMesh(fixtureMesh()).material as MeshStandardMaterial;

    expect(mat.transparent).toBe(true);
    expect(mat.opacity).toBeCloseTo(0.85);
    // White emissive so it reads as self-illuminated without tinting vertex
    // colors. installPulse later rides on top of this baseline.
    expect(mat.emissive.getHex()).toBe(0xffffff);
    expect(mat.emissiveIntensity).toBeCloseTo(0.2);
  });
});
