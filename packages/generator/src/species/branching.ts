import type { RNG } from '../rng.js';
import type { MeshData } from '../meshdata.js';
import type { GeneratedPolyp } from '../generate.js';
import { tintColor, type Rgb } from './_common.js';

/**
 * Staghorn-style branching coral via L-system.
 *
 * Axiom: F
 * Rule:  F -> F[+F][-F]F   (with small random angle jitter per application)
 *
 * The L-system string drives a turtle walking in 3D. Branches get thinner as
 * depth increases. Cylinders are low-poly (4-sided) — reads as an organic
 * branching form from phone distance, renders cheap at hundreds-per-scene.
 */
export function generateBranching(rng: RNG, baseColor: Rgb): GeneratedPolyp {
  const iterations = rng.int(3, 4);
  const baseAngle = rng.range(22, 38);
  const initialLength = rng.range(0.03, 0.045);
  const lengthDecay = rng.range(0.68, 0.78);
  const initialRadius = rng.range(0.007, 0.011);
  const radiusDecay = rng.range(0.7, 0.8);

  // Rule yields 4 F's per F. At iteration N the string has ~4^N Fs.
  // Cap at 4 → ~256 segments → a few thousand verts, comfortably
  // renderable with hundreds of polyps in the scene.
  const axiom = 'F';
  const rule = (_c: string): string => 'F[+F][-F]F';
  let s = axiom;
  for (let i = 0; i < iterations; i++) {
    let next = '';
    for (const c of s) next += c === 'F' ? rule(c) : c;
    s = next;
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  type State = {
    x: number; y: number; z: number;
    yaw: number; pitch: number; roll: number;
    length: number; radius: number; depth: number;
  };
  const stack: State[] = [];
  let st: State = {
    x: 0, y: 0, z: 0,
    yaw: 0, pitch: Math.PI / 2, roll: 0,
    length: initialLength, radius: initialRadius, depth: 0,
  };

  const SIDES = 5;
  let maxY = 0;
  let maxRadial = 0;

  for (const c of s) {
    if (c === 'F') {
      const jitterYaw = (rng.next() - 0.5) * 0.25;
      const jitterPitch = (rng.next() - 0.5) * 0.15;
      const yaw = st.yaw + jitterYaw;
      const pitch = st.pitch + jitterPitch;

      const dx = Math.cos(yaw) * Math.cos(pitch);
      const dy = Math.sin(pitch);
      const dz = Math.sin(yaw) * Math.cos(pitch);

      const x2 = st.x + dx * st.length;
      const y2 = st.y + dy * st.length;
      const z2 = st.z + dz * st.length;

      emitSegment(
        positions, normals, colors, indices,
        st.x, st.y, st.z, x2, y2, z2,
        st.radius, st.radius * radiusDecay, SIDES,
        tintColor(rng, baseColor, 0.08),
      );

      st = { ...st, x: x2, y: y2, z: z2, length: st.length * lengthDecay, radius: st.radius * radiusDecay, depth: st.depth + 1 };
      if (y2 > maxY) maxY = y2;
      const r = Math.hypot(x2, z2);
      if (r > maxRadial) maxRadial = r;
    } else if (c === '+') {
      st = { ...st, yaw: st.yaw + rad(baseAngle) + (rng.next() - 0.5) * 0.1 };
    } else if (c === '-') {
      st = { ...st, yaw: st.yaw - rad(baseAngle) + (rng.next() - 0.5) * 0.1 };
    } else if (c === '[') {
      stack.push(st);
      st = { ...st, pitch: st.pitch + (rng.next() - 0.5) * rad(baseAngle) };
    } else if (c === ']') {
      const popped = stack.pop();
      if (popped) st = popped;
    }
  }

  const mesh: MeshData = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    colors: new Float32Array(colors),
    indices: new Uint32Array(indices),
  };

  return {
    mesh,
    boundingRadius: Math.max(maxRadial, 0.05),
    approxHeight: Math.max(maxY, 0.05),
  };
}

function rad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function emitSegment(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  x1: number, y1: number, z1: number,
  x2: number, y2: number, z2: number,
  r1: number, r2: number,
  sides: number,
  color: Rgb,
): void {
  const ax = x2 - x1;
  const ay = y2 - y1;
  const az = z2 - z1;
  const len = Math.hypot(ax, ay, az) || 1e-6;
  const axn = ax / len, ayn = ay / len, azn = az / len;

  let ux: number, uy: number, uz: number;
  if (Math.abs(ayn) < 0.9) {
    ux = -azn; uy = 0; uz = axn;
  } else {
    ux = 1; uy = 0; uz = 0;
  }
  // Gram-Schmidt against axis so u lies exactly in the plane perpendicular
  // to axis. The first branch is algebraically perpendicular already
  // (dot = 0), the `else` branch isn't — without this step near-vertical
  // segments emit normals that are visibly off unit length.
  const dot = axn * ux + ayn * uy + azn * uz;
  ux -= axn * dot;
  uy -= ayn * dot;
  uz -= azn * dot;
  const un = Math.hypot(ux, uy, uz) || 1e-6;
  ux /= un; uy /= un; uz /= un;
  const vx = ayn * uz - azn * uy;
  const vy = azn * ux - axn * uz;
  const vz = axn * uy - ayn * ux;

  const baseIdx = positions.length / 3;
  for (let i = 0; i < sides; i++) {
    const theta = (i / sides) * Math.PI * 2;
    const ct = Math.cos(theta), stt = Math.sin(theta);
    const nx = ux * ct + vx * stt;
    const ny = uy * ct + vy * stt;
    const nz = uz * ct + vz * stt;

    positions.push(x1 + nx * r1, y1 + ny * r1, z1 + nz * r1);
    normals.push(nx, ny, nz);
    colors.push(color[0], color[1], color[2]);
    positions.push(x2 + nx * r2, y2 + ny * r2, z2 + nz * r2);
    normals.push(nx, ny, nz);
    colors.push(color[0], color[1], color[2]);
  }

  for (let i = 0; i < sides; i++) {
    const a = baseIdx + i * 2;
    const b = baseIdx + i * 2 + 1;
    const c = baseIdx + ((i + 1) % sides) * 2;
    const d = baseIdx + ((i + 1) % sides) * 2 + 1;
    indices.push(a, b, d, a, d, c);
  }
}
