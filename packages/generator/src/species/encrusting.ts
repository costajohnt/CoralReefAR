import type { RNG } from '../rng.js';
import type { GeneratedPolyp } from '../generate.js';
import { tintColor, type Rgb } from './_common.js';

/**
 * Low-profile patch. Disk subdivided into a radial grid, Y displaced by
 * seeded 2D noise.
 */
export function generateEncrusting(rng: RNG, baseColor: Rgb): GeneratedPolyp {
  const radius = rng.range(0.06, 0.1);
  const radial = 20;
  const rings = 6;
  const maxBump = rng.range(0.008, 0.018);
  const freq = rng.range(6, 12);
  const phaseX = rng.range(0, 10);
  const phaseZ = rng.range(0, 10);

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  positions.push(0, maxBump * 0.5, 0);
  normals.push(0, 1, 0);
  const cc = tintColor(rng, baseColor, 0.05);
  colors.push(cc[0], cc[1], cc[2]);

  for (let ring = 1; ring <= rings; ring++) {
    const r = (ring / rings) * radius;
    for (let i = 0; i < radial; i++) {
      const theta = (i / radial) * Math.PI * 2;
      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;
      const y = maxBump *
        (0.5 + 0.5 * Math.sin(x * freq + phaseX) * Math.cos(z * freq + phaseZ)) *
        (1 - ring / rings);
      positions.push(x, y, z);
      normals.push(0, 1, 0);
      const c = tintColor(rng, baseColor, 0.08);
      colors.push(c[0], c[1], c[2]);
    }
  }

  for (let i = 0; i < radial; i++) {
    const a = 0;
    const b = 1 + i;
    const c = 1 + ((i + 1) % radial);
    indices.push(a, b, c);
  }
  for (let ring = 0; ring < rings - 1; ring++) {
    const ringStart = 1 + ring * radial;
    const nextStart = 1 + (ring + 1) * radial;
    for (let i = 0; i < radial; i++) {
      const a = ringStart + i;
      const b = ringStart + ((i + 1) % radial);
      const c = nextStart + i;
      const d = nextStart + ((i + 1) % radial);
      indices.push(a, c, d, a, d, b);
    }
  }

  return {
    mesh: {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      colors: new Float32Array(colors),
      indices: new Uint32Array(indices),
    },
    boundingRadius: radius,
    approxHeight: maxBump,
  };
}
