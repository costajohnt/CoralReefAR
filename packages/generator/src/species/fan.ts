import type { RNG } from '../rng.js';
import type { GeneratedPolyp } from '../generate.js';
import { tintColor, type Rgb } from './_common.js';

/**
 * Gorgonian fan: 2D L-system in the XY plane, extruded slightly along Z,
 * tilted and given a gentle curve.
 */
export function generateFan(rng: RNG, baseColor: Rgb): GeneratedPolyp {
  const iterations = rng.int(3, 4);
  const angle = rng.range(20, 32) * (Math.PI / 180);
  const initialLength = rng.range(0.04, 0.06);
  const lengthDecay = rng.range(0.75, 0.85);
  const thickness = rng.range(0.003, 0.006);

  // Rule yields 3 F's per F. 4 iterations → 81 segments.
  let s = 'F';
  for (let i = 0; i < iterations; i++) {
    let n = '';
    for (const c of s) n += c === 'F' ? 'F[+F][-F]' : c;
    s = n;
  }

  type Seg = { x1: number; y1: number; x2: number; y2: number };
  const segs: Seg[] = [];
  const stack: { x: number; y: number; a: number; l: number }[] = [];
  let st = { x: 0, y: 0, a: Math.PI / 2, l: initialLength };
  let maxY = 0, maxX = 0;

  for (const c of s) {
    if (c === 'F') {
      const x2 = st.x + Math.cos(st.a) * st.l;
      const y2 = st.y + Math.sin(st.a) * st.l;
      segs.push({ x1: st.x, y1: st.y, x2, y2 });
      st = { ...st, x: x2, y: y2, l: st.l * lengthDecay };
      if (y2 > maxY) maxY = y2;
      if (Math.abs(x2) > maxX) maxX = Math.abs(x2);
    } else if (c === '+') st = { ...st, a: st.a + angle };
    else if (c === '-') st = { ...st, a: st.a - angle };
    else if (c === '[') stack.push({ ...st });
    else if (c === ']') {
      const p = stack.pop();
      if (p) st = p;
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  const curveAmp = rng.range(0.01, 0.03);
  for (const seg of segs) {
    const midY = (seg.y1 + seg.y2) / 2;
    const bendZ = Math.sin((midY / (maxY || 1)) * Math.PI) * curveAmp;
    const color = tintColor(rng, baseColor, 0.1);
    addQuad(positions, normals, colors, indices,
      seg.x1, seg.y1, bendZ, seg.x2, seg.y2, bendZ, thickness, color);
  }

  return {
    mesh: {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      colors: new Float32Array(colors),
      indices: new Uint32Array(indices),
    },
    boundingRadius: Math.max(maxX, 0.05),
    approxHeight: Math.max(maxY, 0.05),
  };
}

function addQuad(
  positions: number[], normals: number[], colors: number[], indices: number[],
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  thickness: number,
  color: Rgb,
): void {
  const base = positions.length / 3;
  const t = thickness;
  const verts: [number, number, number][] = [
    [x1, y1, z1 - t], [x2, y2, z2 - t],
    [x2, y2, z2 + t], [x1, y1, z1 + t],
  ];
  for (const v of verts) {
    positions.push(v[0], v[1], v[2]);
    normals.push(0, 0, 1);
    colors.push(color[0], color[1], color[2]);
  }
  indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
}
