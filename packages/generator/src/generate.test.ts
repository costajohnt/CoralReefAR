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

// ---- Tip-node invariants ----

function isFiniteVec3(v: readonly [number, number, number]): boolean {
  return v.every((n) => Number.isFinite(n));
}

test('every species returns a tips array (possibly empty)', () => {
  for (const species of SPECIES) {
    const p = generatePolyp({ species, seed: 42, colorKey: 'coral-pink' });
    assert.ok(Array.isArray(p.tips), `${species}: tips should be an array`);
  }
});

test('encrusting has no tips (cannot be grown from)', () => {
  const p = generatePolyp({ species: 'encrusting', seed: 42, colorKey: 'coral-pink' });
  assert.equal(p.tips!.length, 0);
});

test('branching exposes up to 3 tips, all with finite position + unit-ish normal', () => {
  const p = generatePolyp({ species: 'branching', seed: 42, colorKey: 'coral-pink' });
  assert.ok(p.tips!.length >= 1, 'branching produces at least one tip');
  assert.ok(p.tips!.length <= 3, 'branching exposes at most three tips');
  for (const tip of p.tips!) {
    assert.ok(isFiniteVec3(tip.position), 'tip position finite');
    assert.ok(isFiniteVec3(tip.normal), 'tip normal finite');
    const nlen = Math.hypot(tip.normal[0], tip.normal[1], tip.normal[2]);
    assert.ok(Math.abs(nlen - 1) < 1e-6, `tip normal should be unit length, got ${nlen}`);
  }
});

test('bulbous / fan / tube each expose exactly one upward-pointing tip', () => {
  for (const species of ['bulbous', 'fan', 'tube'] as const) {
    const p = generatePolyp({ species, seed: 42, colorKey: 'coral-pink' });
    assert.equal(p.tips!.length, 1, `${species} should have one tip`);
    const tip = p.tips![0]!;
    assert.equal(tip.normal[1], 1, `${species} tip normal should point straight up`);
    assert.ok(tip.position[1]! > 0, `${species} tip should sit above the base`);
  }
});

test('branching tip positions are deterministic for the same seed', () => {
  const a = generatePolyp({ species: 'branching', seed: 999, colorKey: 'teal' });
  const b = generatePolyp({ species: 'branching', seed: 999, colorKey: 'teal' });
  assert.equal(a.tips!.length, b.tips!.length);
  for (let i = 0; i < a.tips!.length; i++) {
    const ta = a.tips![i]!, tb = b.tips![i]!;
    assert.deepEqual(ta.position, tb.position);
    assert.deepEqual(ta.normal, tb.normal);
  }
});

test('branching tips are spatially distinct (no two within 3cm of each other)', () => {
  // Regression for the bug where every L-system segment was a candidate
  // and the top-3-by-Y clustered three intermediate points on a single
  // tall branch. The dedup requires 3cm minimum separation between tips.
  const MIN = 0.03;
  for (const seed of [1, 42, 12345, 0xdeadbeef]) {
    const p = generatePolyp({ species: 'branching', seed, colorKey: 'coral-pink' });
    const tips = p.tips!;
    for (let i = 0; i < tips.length; i++) {
      for (let j = i + 1; j < tips.length; j++) {
        const dx = tips[i]!.position[0] - tips[j]!.position[0];
        const dy = tips[i]!.position[1] - tips[j]!.position[1];
        const dz = tips[i]!.position[2] - tips[j]!.position[2];
        const dist = Math.hypot(dx, dy, dz);
        assert.ok(
          dist >= MIN,
          `seed ${seed}: tips ${i} and ${j} are ${dist}m apart, should be >= ${MIN}m`,
        );
      }
    }
  }
});
