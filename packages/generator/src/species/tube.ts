import type { RNG } from '../rng.js';
import type { GeneratedPolyp } from '../generate.js';
import { tintColor, type Rgb } from './_common.js';

export function generateTube(rng: RNG, baseColor: Rgb): GeneratedPolyp {
  const count = rng.int(3, 8);
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  let maxR = 0;
  let maxH = 0;

  for (let i = 0; i < count; i++) {
    const h = rng.range(0.04, 0.12);
    const r = rng.range(0.012, 0.025);
    const cx = rng.range(-0.04, 0.04);
    const cz = rng.range(-0.04, 0.04);
    const tilt = rng.range(-0.2, 0.2);
    const c = tintColor(rng, baseColor, 0.1);
    emitCylinder(positions, normals, colors, indices, cx, 0, cz, h, r, tilt, c);
    const rr = Math.hypot(cx, cz) + r;
    if (rr > maxR) maxR = rr;
    if (h > maxH) maxH = h;
  }

  return {
    mesh: {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      colors: new Float32Array(colors),
      indices: new Uint32Array(indices),
    },
    boundingRadius: Math.max(maxR, 0.05),
    approxHeight: maxH,
  };
}

function emitCylinder(
  positions: number[], normals: number[], colors: number[], indices: number[],
  cx: number, cy: number, cz: number,
  height: number, radius: number, tilt: number, color: Rgb,
): void {
  const sides = 10;
  const base = positions.length / 3;
  const tx = Math.sin(tilt) * height;
  // The cylinder is sheared so its axis runs from (cx,cy,cz) to
  // (cx+tx, cy+height, cz). The side surface is ruled along that axis, so the
  // true outward normal at angle theta is perpendicular to BOTH the ring
  // tangent (-sin, 0, cos) and the axis (tx, height, 0):
  //   n = normalize(cos t, -sin(tilt) * cos t, sin t)
  // which is exactly the old radial normal (cos t, 0, sin t) tilted by the
  // shear. dot(n, axis) = 0, so it's correctly perpendicular to the tilted
  // axis; the old [x/r, 0, z/r] ignored the tilt and was off by ~tilt rad.
  const sinTilt = Math.sin(tilt);
  for (let i = 0; i < sides; i++) {
    const theta = (i / sides) * Math.PI * 2;
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const x = ct * radius;
    const z = st * radius;
    const nx = ct;
    const ny = -sinTilt * ct;
    const nz = st;
    const nlen = Math.hypot(nx, ny, nz) || 1;
    const unx = nx / nlen, uny = ny / nlen, unz = nz / nlen;
    positions.push(cx + x, cy, cz + z);
    normals.push(unx, uny, unz);
    colors.push(color[0], color[1], color[2]);
    positions.push(cx + x + tx, cy + height, cz + z);
    normals.push(unx, uny, unz);
    colors.push(color[0], color[1], color[2]);
  }
  for (let i = 0; i < sides; i++) {
    const a = base + i * 2;
    const b = base + i * 2 + 1;
    const c = base + ((i + 1) % sides) * 2;
    const d = base + ((i + 1) % sides) * 2 + 1;
    indices.push(a, b, d, a, d, c);
  }
  const topCenterIdx = positions.length / 3;
  positions.push(cx + tx, cy + height, cz);
  normals.push(0, 1, 0);
  colors.push(color[0] * 0.6, color[1] * 0.6, color[2] * 0.6);
  for (let i = 0; i < sides; i++) {
    const a = base + i * 2 + 1;
    const b = base + ((i + 1) % sides) * 2 + 1;
    indices.push(topCenterIdx, b, a);
  }
}
