import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { generatePolyp } from './generate.js';
import type { Species } from '@reef/shared';

// Per-species golden hash of the generated mesh at a fixed seed+color.
// If the generation algorithm changes unintentionally (noise, indexing,
// scaling), the hash flips and these tests fail. When changes are
// intentional, regenerate the hashes by running the test once, reading the
// actual values from the failure message, and pasting them back in.
const FIXED_SEED = 12345;
const FIXED_COLOR = 'coral-pink';

const EXPECTED: Record<Species, {
  vertexCount: number;
  triangleCount: number;
  sha256: string;
}> = {
  branching:  { vertexCount: 2560, triangleCount: 2560, sha256: '2864cad3ae042d0d83678606a47318c1d8b09b6da09ec21d586d5388388fbab7' },
  bulbous:    { vertexCount:  551, triangleCount: 1008, sha256: '1f9fced98e063ca3cbf574ed55a0beb5d506246b96910b5d3fd946b91088462a' },
  fan:        { vertexCount:  324, triangleCount:  324, sha256: '925d9133a6e01eda453f75b07467a5a4769aef08c58a5048a4eefa416a9b43a3' },
  tube:       { vertexCount:  168, triangleCount:  240, sha256: '899c22f91f5d70ea333a8821575da1c2578781bff2f26195bc42ccf4b845b788' },
  encrusting: { vertexCount:  121, triangleCount:  220, sha256: '367c65f2120dcf610a65ce6e58391d03ae8c052863a2f364650f571694e98b27' },
};

function hashMesh(positions: Float32Array, normals: Float32Array, colors: Float32Array, indices: Uint32Array): string {
  const h = createHash('sha256');
  h.update(Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength));
  h.update(Buffer.from(normals.buffer, normals.byteOffset, normals.byteLength));
  h.update(Buffer.from(colors.buffer, colors.byteOffset, colors.byteLength));
  h.update(Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength));
  return h.digest('hex');
}

const SPECIES: Species[] = ['branching', 'bulbous', 'fan', 'tube', 'encrusting'];

// Structural invariants — complement the hash goldens. A mesh that passes
// the hash is still fatal at render time if it contains NaN, has indices
// past the vertex buffer, or has non-unit normals.
for (const species of SPECIES) {
  test(`mesh invariants: ${species} arrays are finite and well-formed`, () => {
    const { mesh } = generatePolyp({ species, seed: FIXED_SEED, colorKey: FIXED_COLOR });
    const vertexCount = mesh.positions.length / 3;

    for (let i = 0; i < mesh.positions.length; i++) {
      assert.ok(Number.isFinite(mesh.positions[i]), `positions[${i}] is not finite`);
    }
    for (let i = 0; i < mesh.normals.length; i++) {
      assert.ok(Number.isFinite(mesh.normals[i]), `normals[${i}] is not finite`);
    }
    for (let i = 0; i < mesh.colors.length; i++) {
      const v = mesh.colors[i]!;
      assert.ok(Number.isFinite(v), `colors[${i}] is not finite`);
      assert.ok(v >= 0 && v <= 1, `colors[${i}] = ${v} outside [0,1]`);
    }
    for (let i = 0; i < mesh.indices.length; i++) {
      const idx = mesh.indices[i]!;
      assert.ok(idx >= 0 && idx < vertexCount,
        `indices[${i}] = ${idx} out of range [0, ${vertexCount})`);
    }
    // Spot-check normal unit length at each vertex.
    for (let v = 0; v < vertexCount; v++) {
      const nx = mesh.normals[v * 3]!;
      const ny = mesh.normals[v * 3 + 1]!;
      const nz = mesh.normals[v * 3 + 2]!;
      const len = Math.hypot(nx, ny, nz);
      assert.ok(Math.abs(len - 1) < 1e-3, `normal at vertex ${v} length ${len}`);
    }
  });
}

// Bootstrap: compute hashes the first time, print them so they can be pasted
// into EXPECTED. After that the test asserts they stay stable.
for (const species of SPECIES) {
  test(`golden: ${species} is deterministic at fixed seed+color`, () => {
    const result = generatePolyp({ species, seed: FIXED_SEED, colorKey: FIXED_COLOR });
    const vertexCount = result.mesh.positions.length / 3;
    const triangleCount = result.mesh.indices.length / 3;
    const sha256 = hashMesh(
      result.mesh.positions,
      result.mesh.normals,
      result.mesh.colors,
      result.mesh.indices,
    );

    const expected = EXPECTED[species];
    if (!expected.sha256) {
      // First-run bootstrap: emit the hash and fail loudly so the author pastes it back in.
      console.log(`\n[golden-bootstrap] ${species}:`);
      console.log(`  { vertexCount: ${vertexCount}, triangleCount: ${triangleCount}, sha256: '${sha256}' }`);
      assert.fail(`golden for ${species} not yet recorded — paste the value above into EXPECTED and re-run`);
    }

    assert.equal(vertexCount, expected.vertexCount, `${species} vertex count drift`);
    assert.equal(triangleCount, expected.triangleCount, `${species} triangle count drift`);
    assert.equal(sha256, expected.sha256, `${species} mesh hash drift`);
  });
}
