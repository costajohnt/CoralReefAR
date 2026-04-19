import type { RNG } from '../rng.js';
import type { MeshData } from '../meshdata.js';
import type { GeneratedPolyp } from '../generate.js';
import { tintColor, type Rgb } from './_common.js';

/**
 * Brain coral via sphere displaced by a reaction-diffusion-inspired field.
 *
 * We don't run a full Gray-Scott sim at generation time — instead we stack a
 * few low-frequency trig fields keyed off seed. The result has the right
 * visual language (curving grooves) without the CPU cost.
 */
export function generateBulbous(rng: RNG, baseColor: Rgb): GeneratedPolyp {
  const radius = rng.range(0.06, 0.09);
  const widthSegments = 28;
  const heightSegments = 18;
  const grooveDepth = rng.range(0.08, 0.14);
  const f1 = rng.range(6, 10);
  const f2 = rng.range(3, 5);
  const phase1 = rng.range(0, Math.PI * 2);
  const phase2 = rng.range(0, Math.PI * 2);

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let y = 0; y <= heightSegments; y++) {
    const v = y / heightSegments;
    const phi = v * Math.PI;
    for (let x = 0; x <= widthSegments; x++) {
      const u = x / widthSegments;
      const theta = u * Math.PI * 2;

      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);

      const groove =
        Math.sin(theta * f1 + phase1 + Math.cos(phi * 3) * 1.5) *
        Math.sin(phi * f2 + phase2);
      const r = radius * (1 - grooveDepth * (0.5 + 0.5 * groove));

      // Actually flatten the bottom: clamp ny to >=0.05 so the hemisphere
      // sits on the pedestal rather than sinking into it. Then translate up
      // so y=0 coincides with the pedestal surface.
      const nyAdj = Math.max(0.05, ny);
      const flatten = 0.6 + 0.4 * nyAdj;
      const rr = r * flatten;
      const yOffset = radius * 0.1;

      positions.push(nx * rr, nyAdj * rr + yOffset, nz * rr);
      normals.push(nx, nyAdj, nz);
      const c = tintColor(rng, baseColor, 0.1 + 0.1 * groove);
      colors.push(c[0], c[1], c[2]);
    }
  }

  for (let y = 0; y < heightSegments; y++) {
    for (let x = 0; x < widthSegments; x++) {
      const a = y * (widthSegments + 1) + x;
      const b = a + widthSegments + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const pos = new Float32Array(positions);
  const nrm = new Float32Array(positions.length);
  const idx = new Uint32Array(indices);
  recomputeNormals(pos, nrm, idx);

  return {
    mesh: {
      positions: pos,
      normals: nrm,
      colors: new Float32Array(colors),
      indices: idx,
    },
    boundingRadius: radius,
    approxHeight: radius * 1.6,
  };
}

/**
 * Recompute per-vertex normals by accumulating triangle normals and
 * normalizing. Proper shading for a displaced surface — the sphere's
 * unperturbed normals flatten out the grooves.
 */
function recomputeNormals(
  positions: Float32Array,
  normals: Float32Array,
  indices: Uint32Array,
): void {
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i]! * 3;
    const ib = indices[i + 1]! * 3;
    const ic = indices[i + 2]! * 3;
    const ax = positions[ia]!, ay = positions[ia + 1]!, az = positions[ia + 2]!;
    const bx = positions[ib]!, by = positions[ib + 1]!, bz = positions[ib + 2]!;
    const cx = positions[ic]!, cy = positions[ic + 1]!, cz = positions[ic + 2]!;
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    normals[ia] = normals[ia]! + nx;
    normals[ia + 1] = normals[ia + 1]! + ny;
    normals[ia + 2] = normals[ia + 2]! + nz;
    normals[ib] = normals[ib]! + nx;
    normals[ib + 1] = normals[ib + 1]! + ny;
    normals[ib + 2] = normals[ib + 2]! + nz;
    normals[ic] = normals[ic]! + nx;
    normals[ic + 1] = normals[ic + 1]! + ny;
    normals[ic + 2] = normals[ic + 2]! + nz;
  }
  for (let i = 0; i < normals.length; i += 3) {
    const x = normals[i]!, y = normals[i + 1]!, z = normals[i + 2]!;
    const len = Math.hypot(x, y, z) || 1;
    normals[i] = x / len; normals[i + 1] = y / len; normals[i + 2] = z / len;
  }
}
