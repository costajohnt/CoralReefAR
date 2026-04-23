import type { MeshData } from '../meshdata.js';
import type { AttachPoint } from '@reef/shared';

export interface VariantGenerateInput {
  seed: number;
  colorKey: string;
}

export interface VariantOutput {
  mesh: MeshData;
  attachPoints: AttachPoint[];
  /** Axis-aligned bounding box in local space, used for client-side collision. */
  boundingBox: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
}

export type VariantModule = (input: VariantGenerateInput) => VariantOutput;

export function tipAttachPoint(
  position: { x: number; y: number; z: number },
  outwardDir: { x: number; y: number; z: number },
): AttachPoint {
  const len = Math.hypot(outwardDir.x, outwardDir.y, outwardDir.z) || 1;
  return {
    position,
    normal: { x: outwardDir.x / len, y: outwardDir.y / len, z: outwardDir.z / len },
  };
}

export interface TreeVariantRegistry {
  forked: VariantModule;
  trident: VariantModule;
  starburst: VariantModule;
  claw: VariantModule;
  wishbone: VariantModule;
}

// ---------------------------------------------------------------------------
// Shared geometry helpers
// ---------------------------------------------------------------------------

type Vec3Obj = { x: number; y: number; z: number };
type ColorInput = Vec3Obj | readonly [number, number, number];

function colorR(c: ColorInput): number { return Array.isArray(c) ? (c as readonly number[])[0]! : (c as Vec3Obj).x; }
function colorG(c: ColorInput): number { return Array.isArray(c) ? (c as readonly number[])[1]! : (c as Vec3Obj).y; }
function colorB(c: ColorInput): number { return Array.isArray(c) ? (c as readonly number[])[2]! : (c as Vec3Obj).z; }

/**
 * Deterministic PRNG (mulberry32). Takes an integer seed, returns a stateful
 * function that yields floats in [0, 1). Used to give each piece a unique but
 * reproducible shape — variant geometry used to be identical across pieces
 * because `seed` was ignored; now it drives dimensional jitter and surface
 * noise so the reef doesn't read as repeated stamps.
 */
export function seededRand(seed: number): () => number {
  let state = (seed | 0) >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

/**
 * Returns `base` multiplied by a random factor in [1 - pct, 1 + pct]. Handy
 * for per-piece constant jitter — e.g. `jitter(rand, TRUNK_HEIGHT, 0.12)` for
 * ±12% variation on a variant's trunk height.
 */
export function jitter(rand: () => number, base: number, pct: number): number {
  return base * (1 - pct + rand() * pct * 2);
}

export interface EmitFrustumOpts {
  /** Seed for the per-vertex surface noise. If absent, geometry is smooth. */
  seed?: number;
  /** Per-vertex radial jitter as a fraction of local radius (bumps around the circumference). */
  noiseAmplitude?: number;
  /**
   * Number of intermediate rings along the frustum axis, on top of the two
   * endpoint rings. 0 = smooth taper (bottom ring + top ring only, the
   * original behavior). 4+ produces visible length-wise modulation so each
   * frustum has ribs/pinches rather than a perfectly linear taper — the
   * look of real coral skeletons.
   */
  lengthSubdivisions?: number;
  /**
   * Ring-level radial modulation as a fraction of local radius. Applied
   * once per ring so entire rings inflate/deflate together, creating bands
   * of thicker and thinner sections along the branch.
   */
  ridgeAmplitude?: number;
}

/**
 * Append an open-ended frustum (truncated cone) to the given geometry arrays.
 *
 * Orientation is arbitrary — `from`/`to` can point in any direction. The ring
 * planes are always perpendicular to the (to − from) axis. Side-face normals
 * use the ring-radial direction (flat-shading approximation; acceptable since
 * the bloom pass washes out fine normal detail at phone distance).
 *
 * No end caps are emitted; branches terminate in tips covered by the next
 * attached piece.
 */
export function emitFrustum(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  from: Vec3Obj,
  to: Vec3Obj,
  r0: number,
  r1: number,
  color: ColorInput,
  segments: number,
  opts: EmitFrustumOpts = {},
): void {
  const ax = to.x - from.x;
  const ay = to.y - from.y;
  const az = to.z - from.z;
  const len = Math.hypot(ax, ay, az) || 1e-6;
  const axn = ax / len, ayn = ay / len, azn = az / len;

  // Build an orthonormal basis (u, v) perpendicular to the axis.
  // Choose the seed vector away from the axis to avoid near-parallel case.
  let ux: number, uy: number, uz: number;
  if (Math.abs(ayn) < 0.9) {
    ux = -azn; uy = 0; uz = axn;
  } else {
    ux = 1; uy = 0; uz = 0;
  }
  // Gram-Schmidt: ensure u is exactly perpendicular to axis.
  const dot = axn * ux + ayn * uy + azn * uz;
  ux -= axn * dot;
  uy -= ayn * dot;
  uz -= azn * dot;
  const un = Math.hypot(ux, uy, uz) || 1e-6;
  ux /= un; uy /= un; uz /= un;
  // v = axis × u  (already unit length since both inputs are unit)
  const vx = ayn * uz - azn * uy;
  const vy = azn * ux - axn * uz;
  const vz = axn * uy - ayn * ux;

  const cr = colorR(color), cg = colorG(color), cb = colorB(color);
  const baseIdx = positions.length / 3;

  const vertexAmp = opts.noiseAmplitude ?? 0;
  const ridgeAmp = opts.ridgeAmplitude ?? 0;
  const lenSubs = Math.max(0, Math.floor(opts.lengthSubdivisions ?? 0));
  const rings = lenSubs + 2; // endpoints + subdivisions
  const hasNoise = opts.seed !== undefined && (vertexAmp > 0 || ridgeAmp > 0);
  const rand = hasNoise ? seededRand(opts.seed!) : null;

  // Compute a per-ring radial scale once so an entire ring expands/contracts
  // together. Reads as a "rib" or "pinch" along the branch. Endpoint rings
  // are left unperturbed so child pieces attach cleanly at the tip.
  const ringScales = new Array<number>(rings).fill(1);
  if (rand && ridgeAmp > 0) {
    for (let k = 1; k < rings - 1; k++) {
      ringScales[k] = 1 + (rand() - 0.5) * 2 * ridgeAmp;
    }
  }

  // Emit `rings` rings of `segments` vertices each, walking along the frustum
  // axis. Each ring: radius = lerp(r0, r1) * ringScale * (1 + per-vertex noise).
  for (let k = 0; k < rings; k++) {
    const t = k / (rings - 1);
    const axisX = from.x + (to.x - from.x) * t;
    const axisY = from.y + (to.y - from.y) * t;
    const axisZ = from.z + (to.z - from.z) * t;
    const ringR = (r0 + (r1 - r0) * t) * ringScales[k]!;

    for (let i = 0; i < segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const ct = Math.cos(theta), st = Math.sin(theta);
      const nx = ux * ct + vx * st;
      const ny = uy * ct + vy * st;
      const nz = uz * ct + vz * st;

      const vj = rand && vertexAmp > 0 ? (rand() - 0.5) * 2 * vertexAmp : 0;
      const rr = ringR * (1 + vj);

      positions.push(axisX + nx * rr, axisY + ny * rr, axisZ + nz * rr);
      normals.push(nx, ny, nz);
      colors.push(cr, cg, cb);
    }
  }

  // Stitch consecutive rings with quad strips. Ring k occupies vertices
  // [baseIdx + k*segments, baseIdx + (k+1)*segments).
  for (let k = 0; k < rings - 1; k++) {
    const ringA = baseIdx + k * segments;
    const ringB = baseIdx + (k + 1) * segments;
    for (let i = 0; i < segments; i++) {
      const iNext = (i + 1) % segments;
      const a = ringA + i;
      const b = ringB + i;
      const c = ringA + iNext;
      const d = ringB + iNext;
      indices.push(a, b, d, a, d, c);
    }
  }
}

/**
 * Compute an axis-aligned bounding box from a flat positions array
 * (layout: x0, y0, z0, x1, y1, z1, …).
 */
export function computeAABB(positions: number[]): {
  min: Vec3Obj;
  max: Vec3Obj;
} {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i]!, y = positions[i + 1]!, z = positions[i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}
