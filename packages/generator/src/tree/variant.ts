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
  /**
   * When set, scatter coral-polyp nodules on the outer surface of this
   * frustum and merge their vertices into the same geometry arrays.
   * Value is a seed offset used to deterministically place the nodules
   * (combined with the main `seed` for the PRNG).
   */
  nodulesEnabled?: boolean;
  /**
   * Width segments for each nodule sphere (default 6). Reduce on high
   * frustum-count variants (e.g. wishbone's 12 bezier arms) to keep total
   * vertex counts inside the ~4000 per-piece budget.
   */
  noduleWidthSegs?: number;
  /**
   * Height segments for each nodule sphere (default 4). Pairs with
   * noduleWidthSegs to trade visual quality for vertex budget.
   */
  noduleHeightSegs?: number;
  /**
   * Hard cap on nodule count per frustum (default 22). Set lower on variants
   * with many frustum calls (e.g. wishbone's 12 bezier arms) to keep total
   * vertex counts inside the ~4000 per-piece budget.
   */
  noduleMaxCount?: number;
}

/**
 * Low-frequency noise helper used for both displacement and color variation.
 * Evaluates a smooth periodic function from a seeded PRNG at a given
 * normalized phase [0,1] — good enough for "organic banding" without a full
 * Perlin implementation, and keeps the file dependency-free.
 *
 * Returns a value in [-1, 1] with multi-octave character.
 */
function evalLengthNoise(rand: () => number, phase: number): number {
  // Two octaves: fundamental + half-amplitude harmonic at 2× frequency.
  // The PRNG drives amplitude and phase offsets so each piece differs.
  const a0 = rand() * 2 - 1; // amplitude ±1
  const p0 = rand() * Math.PI * 2; // random phase offset
  const a1 = (rand() * 2 - 1) * 0.5; // second octave, half amplitude
  const p1 = rand() * Math.PI * 2;
  return a0 * Math.sin(phase * Math.PI * 2 + p0) + a1 * Math.sin(phase * Math.PI * 4 + p1);
}

/**
 * Emit a low-poly sphere (icosphere approximation via lat/lon bands) into the
 * geometry arrays. Used for coral-polyp nodules sitting on branch surfaces.
 * Vertices are merged directly into the parent geometry — no extra draw call.
 *
 * wSegs × hSegs controls polygon count. For nodules: 6–8 wide, 4–6 tall is
 * enough visual resolution while keeping total vertex budgets manageable.
 */
function emitSphere(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  cr: number,
  cg: number,
  cb: number,
  wSegs: number,
  hSegs: number,
): void {
  const baseIdx = positions.length / 3;

  // Lat/lon sphere: hSegs+1 latitude rings, wSegs vertices per ring.
  for (let j = 0; j <= hSegs; j++) {
    const phi = (j / hSegs) * Math.PI; // 0 → PI (north to south pole)
    const sinPhi = Math.sin(phi);
    const cosPhi = Math.cos(phi);
    for (let i = 0; i <= wSegs; i++) {
      const theta = (i / wSegs) * Math.PI * 2;
      const nx = Math.sin(theta) * sinPhi;
      const ny = cosPhi;
      const nz = Math.cos(theta) * sinPhi;
      positions.push(cx + nx * radius, cy + ny * radius, cz + nz * radius);
      normals.push(nx, ny, nz);
      colors.push(cr, cg, cb);
    }
  }

  // Stitch quads between consecutive latitude rings.
  const stride = wSegs + 1;
  for (let j = 0; j < hSegs; j++) {
    for (let i = 0; i < wSegs; i++) {
      const a = baseIdx + j * stride + i;
      const b = baseIdx + (j + 1) * stride + i;
      const c = baseIdx + j * stride + (i + 1);
      const d = baseIdx + (j + 1) * stride + (i + 1);
      // Degenerate quads at poles collapse to triangles; emit both halves.
      indices.push(a, b, d, a, d, c);
    }
  }
}

/**
 * Scatter coral-polyp nodules on the outer surface of a frustum segment.
 * Nodules are small spheres whose centers sit exactly on the frustum surface
 * (axisPoint + radialDir × segmentRadius), so they protrude outward.
 *
 * All vertices are merged into the caller's geometry arrays (no extra mesh).
 * Count and placement are seeded-deterministic via the provided PRNG.
 *
 * wSegs/hSegs control nodule sphere resolution; reduce on high frustum-count
 * variants to keep per-piece vertex budgets manageable.
 */
function emitFrustumNodules(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  from: Vec3Obj,
  to: Vec3Obj,
  r0: number,
  r1: number,
  color: ColorInput,
  rand: () => number,
  wSegs: number,
  hSegs: number,
  maxCount: number,
): void {
  // Build the same orthonormal basis as emitFrustum so we can offset radially.
  const ax = to.x - from.x;
  const ay = to.y - from.y;
  const az = to.z - from.z;
  const len = Math.hypot(ax, ay, az) || 1e-6;
  const axn = ax / len, ayn = ay / len, azn = az / len;

  let ux: number, uy: number, uz: number;
  if (Math.abs(ayn) < 0.9) {
    ux = -azn; uy = 0; uz = axn;
  } else {
    ux = 1; uy = 0; uz = 0;
  }
  const dot = axn * ux + ayn * uy + azn * uz;
  ux -= axn * dot; uy -= ayn * dot; uz -= azn * dot;
  const un = Math.hypot(ux, uy, uz) || 1e-6;
  ux /= un; uy /= un; uz /= un;
  const vx = ayn * uz - azn * uy;
  const vy = azn * ux - axn * uz;
  const vz = axn * uy - ayn * ux;

  // 12–22 nodules per segment (capped by maxCount for budget control).
  const rawCount = 12 + Math.floor(rand() * 11); // [12, 22]
  const count = Math.min(rawCount, maxCount);

  for (let n = 0; n < count; n++) {
    // Longitudinal position: 10% to 90% of segment length, away from the join.
    const t = 0.1 + rand() * 0.8;
    // Random azimuth around the circumference.
    const theta = rand() * Math.PI * 2;
    // Nodule radius: 18%–32% of the local segment radius, with per-nodule jitter.
    const segR = r0 + (r1 - r0) * t;
    const noduleR = segR * (0.18 + rand() * 0.14);

    // Radial direction in the frustum's cross-section plane.
    const ct = Math.cos(theta), st = Math.sin(theta);
    const radX = ux * ct + vx * st;
    const radY = uy * ct + vy * st;
    const radZ = uz * ct + vz * st;

    // Center = axis point + radial offset (nodule sits on the surface).
    // Small inward/outward jitter so nodules don't form a perfect cylinder.
    const radialOffset = segR + noduleR * (0.6 + rand() * 0.4);
    const cx = from.x + ax * t + radX * radialOffset;
    const cy = from.y + ay * t + radY * radialOffset;
    const cz = from.z + az * t + radZ * radialOffset;

    // Nodule color inherits the local branch shade (set by Pass 3 before this runs).
    const cr = colorR(color), cg = colorG(color), cb = colorB(color);

    emitSphere(positions, normals, colors, indices, cx, cy, cz, noduleR, cr, cg, cb, wSegs, hSegs);
  }
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

  const baseCr = colorR(color), baseCg = colorG(color), baseCb = colorB(color);
  const baseIdx = positions.length / 3;

  // Pass 2: multi-octave displacement. Amplitude raised to 12–18% of radius,
  // favoring outward swells over inward necks (positive noise × 1.0, negative
  // noise × 0.4). Two octaves gives rough-at-multiple-scales feel.
  const vertexAmp = opts.noiseAmplitude ?? 0;
  const ridgeAmp = opts.ridgeAmplitude ?? 0;
  const lenSubs = Math.max(0, Math.floor(opts.lengthSubdivisions ?? 0));
  const rings = lenSubs + 2; // endpoints + subdivisions
  const hasNoise = opts.seed !== undefined && (vertexAmp > 0 || ridgeAmp > 0);
  const rand = hasNoise ? seededRand(opts.seed!) : null;

  // Pass 3: pre-sample the per-ring color noise so nodules inherit local shade.
  // Low-frequency along-length banding in [-0.08, +0.08] per channel.
  // The PRNG is advanced for the color-noise parameters regardless of whether
  // color variation is active, keeping the sequence stable for nodule placement.
  const COLOR_VAR = 0.08;
  // Reserve four random draws per ring for the evalLengthNoise internals.
  // We sample ahead-of-time and store per-ring color deltas so the main loop
  // is clean and the nodule pass can access them by ring index.
  //
  // Color noise uses a separate PRNG seeded from opts.seed + 0xC010R to avoid
  // polluting the displacement PRNG state.
  const colorRand = opts.seed !== undefined ? seededRand(opts.seed ^ 0xc010c) : null;
  const ringColorDelta = new Float32Array(rings);
  if (colorRand) {
    for (let k = 0; k < rings; k++) {
      // evalLengthNoise advances colorRand 4× per call (a0, p0, a1, p1).
      const phase = k / Math.max(1, rings - 1);
      const raw = evalLengthNoise(colorRand, phase); // [-~1.5, +~1.5] roughly
      ringColorDelta[k] = raw * COLOR_VAR; // clamp in apply step
    }
  }

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

    // Pass 3: apply color variation. Clamp to [0, 1] to stay in valid range.
    const cd = ringColorDelta[k]!;
    const cr = Math.max(0, Math.min(1, baseCr + cd));
    const cg = Math.max(0, Math.min(1, baseCg + cd));
    const cb = Math.max(0, Math.min(1, baseCb + cd));

    for (let i = 0; i < segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      const ct = Math.cos(theta), st = Math.sin(theta);
      const nx = ux * ct + vx * st;
      const ny = uy * ct + vy * st;
      const nz = uz * ct + vz * st;

      // Pass 2: two-octave noise with outward bias.
      // Octave 1: fundamental displacement.
      // Octave 2: half amplitude, higher frequency for fine roughness.
      // Negative displacement is damped by 0.4 so the branch swells more
      // than it necks, matching the look of real coral skeletons.
      let vj = 0;
      if (rand && vertexAmp > 0) {
        const n1 = (rand() - 0.5) * 2; // [-1, 1]
        const n2 = (rand() - 0.5) * 2 * 0.5; // half amplitude second octave
        const raw = n1 + n2; // combined noise, range roughly [-1.5, 1.5]
        const biased = raw < 0 ? raw * 0.4 : raw; // squash inward
        vj = biased * vertexAmp;
      }
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

  // Pass 1: scatter coral-polyp nodules on this frustum's outer surface.
  // Uses a dedicated PRNG seeded separately from displacement so the two
  // noise streams don't interfere with each other.
  if (opts.nodulesEnabled && opts.seed !== undefined) {
    const noduleRand = seededRand(opts.seed ^ 0xface7);
    const wSegs = opts.noduleWidthSegs ?? 6;
    const hSegs = opts.noduleHeightSegs ?? 4;
    const maxCount = opts.noduleMaxCount ?? 22;
    // The color passed here is the base color; nodules inherit per-vertex
    // color variation via the average midpoint shade (use base color since
    // nodule positions are distributed across the segment).
    emitFrustumNodules(positions, normals, colors, indices, from, to, r0, r1, color, noduleRand, wSegs, hSegs, maxCount);
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
