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

  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const ct = Math.cos(theta), st = Math.sin(theta);
    const nx = ux * ct + vx * st;
    const ny = uy * ct + vy * st;
    const nz = uz * ct + vz * st;

    // Bottom vertex (at "from", radius r0)
    positions.push(from.x + nx * r0, from.y + ny * r0, from.z + nz * r0);
    normals.push(nx, ny, nz);
    colors.push(cr, cg, cb);

    // Top vertex (at "to", radius r1)
    positions.push(to.x + nx * r1, to.y + ny * r1, to.z + nz * r1);
    normals.push(nx, ny, nz);
    colors.push(cr, cg, cb);
  }

  for (let i = 0; i < segments; i++) {
    const a = baseIdx + i * 2;
    const b = baseIdx + i * 2 + 1;
    const c = baseIdx + ((i + 1) % segments) * 2;
    const d = baseIdx + ((i + 1) % segments) * 2 + 1;
    indices.push(a, b, d, a, d, c);
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
