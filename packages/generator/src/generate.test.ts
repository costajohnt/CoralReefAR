import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SPECIES, REEF_PALETTE } from '@reef/shared';
import { generatePolyp } from './generate.js';

function validateMesh(tag: string, species: string, seed: number): void {
  const polyp = generatePolyp({
    species: species as typeof SPECIES[number],
    seed,
    colorKey: REEF_PALETTE[0]!.key,
  });
  const { mesh, boundingRadius, approxHeight } = polyp;

  assert.ok(Number.isFinite(boundingRadius) && boundingRadius > 0, `${tag} boundingRadius`);
  assert.ok(Number.isFinite(approxHeight) && approxHeight > 0, `${tag} approxHeight`);
  assert.ok(mesh.positions.length > 0, `${tag} has vertices`);
  assert.equal(mesh.positions.length % 3, 0, `${tag} positions triplet`);
  assert.equal(mesh.normals.length, mesh.positions.length, `${tag} normals match`);
  assert.equal(mesh.colors.length, mesh.positions.length, `${tag} colors match`);
  assert.ok(mesh.indices.length > 0, `${tag} has indices`);
  assert.equal(mesh.indices.length % 3, 0, `${tag} indices triangle`);

  const vertexCount = mesh.positions.length / 3;
  for (let i = 0; i < mesh.positions.length; i++) {
    assert.ok(Number.isFinite(mesh.positions[i]!), `${tag} finite pos[${i}]`);
  }
  for (let i = 0; i < mesh.normals.length; i++) {
    assert.ok(Number.isFinite(mesh.normals[i]!), `${tag} finite nrm[${i}]`);
  }
  for (let i = 0; i < mesh.colors.length; i++) {
    const c = mesh.colors[i]!;
    assert.ok(c >= 0 && c <= 1, `${tag} color[${i}] in [0,1]: ${c}`);
  }
  for (let i = 0; i < mesh.indices.length; i++) {
    const idx = mesh.indices[i]!;
    assert.ok(idx < vertexCount, `${tag} index ${idx} < ${vertexCount}`);
  }

  // Reasonable size budget: pedestal is roughly 20cm, a single polyp should
  // fit inside ~30cm. (Scale is applied at render time; generator output is
  // unit-scaled geometry.)
  assert.ok(boundingRadius < 0.3, `${tag} bounding radius ${boundingRadius}`);
  assert.ok(approxHeight < 0.3, `${tag} approx height ${approxHeight}`);

  // Origin near base — polyps grow from y ≈ 0 upward. Allow a little slack.
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 1; i < mesh.positions.length; i += 3) {
    minY = Math.min(minY, mesh.positions[i]!);
    maxY = Math.max(maxY, mesh.positions[i]!);
  }
  assert.ok(minY >= -0.02, `${tag} minY ${minY} should be ≈0`);
  assert.ok(maxY > 0, `${tag} maxY ${maxY} should extend above`);
}

for (const species of SPECIES) {
  test(`${species}: basic mesh invariants across seeds`, () => {
    for (const seed of [1, 42, 12345, 0xdeadbeef]) {
      validateMesh(`${species}@${seed}`, species, seed);
    }
  });
}

test('generatePolyp is deterministic for the same inputs', () => {
  const a = generatePolyp({ species: 'branching', seed: 123, colorKey: 'coral-pink' });
  const b = generatePolyp({ species: 'branching', seed: 123, colorKey: 'coral-pink' });
  assert.equal(a.mesh.positions.length, b.mesh.positions.length);
  for (let i = 0; i < a.mesh.positions.length; i++) {
    assert.equal(a.mesh.positions[i], b.mesh.positions[i]);
  }
});

test('different seeds produce different branching structures', () => {
  const a = generatePolyp({ species: 'branching', seed: 1, colorKey: 'teal' });
  const b = generatePolyp({ species: 'branching', seed: 2, colorKey: 'teal' });
  // L-system iterations differ per seed, so vertex count differs too most of
  // the time; but even when the count matches, at least one position should
  // differ.
  let differs = a.mesh.positions.length !== b.mesh.positions.length;
  if (!differs) {
    for (let i = 0; i < a.mesh.positions.length; i++) {
      if (a.mesh.positions[i] !== b.mesh.positions[i]) { differs = true; break; }
    }
  }
  assert.ok(differs);
});
