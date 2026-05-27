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
  // Tip lives on the actual top opening of the tallest stalk, not at
  // world origin. Track which stalk wins and where its top vertex
  // (center of the opening) sits.
  let tallestTopCenter = { x: 0, y: 0, z: 0 };

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
    if (h > maxH) {
      maxH = h;
      // emitCylinder places the top opening's center at
      // (cx + sin(tilt)*h, h, cz) — see line ~72.
      tallestTopCenter = { x: cx + Math.sin(tilt) * h, y: h, z: cz };
    }
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
    // Tube coral grows from the top opening of the tallest stalk —
    // anchored to that stalk's actual top center, accounting for both
    // its (cx, cz) offset from origin and its tilt.
    tips: [{
      position: [tallestTopCenter.x, tallestTopCenter.y, tallestTopCenter.z] as const,
      normal: [0, 1, 0] as const,
    }],
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
  for (let i = 0; i < sides; i++) {
    const theta = (i / sides) * Math.PI * 2;
    const x = Math.cos(theta) * radius;
    const z = Math.sin(theta) * radius;
    positions.push(cx + x, cy, cz + z);
    normals.push(x / radius, 0, z / radius);
    colors.push(color[0], color[1], color[2]);
    positions.push(cx + x + tx, cy + height, cz + z);
    normals.push(x / radius, 0, z / radius);
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
