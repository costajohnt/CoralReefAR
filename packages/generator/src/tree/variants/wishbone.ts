import type { VariantGenerateInput, VariantOutput } from '../variant.js';
import { tipAttachPoint, emitFrustum, computeAABB } from '../variant.js';
import { colorVec3 } from '../../species/_common.js';

const ARM_LENGTH_X = 0.05;      // horizontal distance from center to tip
const ARM_HEIGHT_Y = 0.035;      // vertical rise of tip above base
const ARM_CONTROL_Y = 0.05;      // apex of the curve (above the tip)
const ARM_STEPS = 6;             // segments per arm
const BASE_RADIUS = 0.0065;
const TIP_RADIUS = 0.002;
const SEGMENTS = 6;

interface Vec3 { x: number; y: number; z: number; }

function quadBezier(p0: Vec3, p1: Vec3, p2: Vec3, t: number): Vec3 {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
    z: u * u * p0.z + 2 * u * t * p1.z + t * t * p2.z,
  };
}

function emitArm(
  positions: number[],
  normals: number[],
  colors: number[],
  indices: number[],
  color: ReturnType<typeof colorVec3>,
  sign: -1 | 1,
): { tip: Vec3; tipDir: Vec3 } {
  const p0 = { x: 0, y: 0, z: 0 };
  const p1 = { x: sign * (ARM_LENGTH_X / 2), y: ARM_CONTROL_Y, z: 0 };
  const p2 = { x: sign * ARM_LENGTH_X, y: ARM_HEIGHT_Y, z: 0 };

  let prev = p0;
  for (let i = 1; i <= ARM_STEPS; i++) {
    const tCurr = i / ARM_STEPS;
    const tPrev = (i - 1) / ARM_STEPS;
    const next = quadBezier(p0, p1, p2, tCurr);
    const r0 = BASE_RADIUS + (TIP_RADIUS - BASE_RADIUS) * tPrev;
    const r1 = BASE_RADIUS + (TIP_RADIUS - BASE_RADIUS) * tCurr;
    emitFrustum(positions, normals, colors, indices, prev, next, r0, r1, color, SEGMENTS);
    prev = next;
  }

  // Tangent at t=1 is (p2 - p1) * 2; normalize.
  const tipDirRaw = { x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
  const dLen = Math.hypot(tipDirRaw.x, tipDirRaw.y, tipDirRaw.z) || 1;
  const tipDir = { x: tipDirRaw.x / dLen, y: tipDirRaw.y / dLen, z: tipDirRaw.z / dLen };
  return { tip: p2, tipDir };
}

export function generateWishbone(input: VariantGenerateInput): VariantOutput {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = colorVec3(input.colorKey);

  const left = emitArm(positions, normals, colors, indices, color, -1);
  const right = emitArm(positions, normals, colors, indices, color, +1);

  return {
    mesh: {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      colors: new Float32Array(colors),
      indices: new Uint32Array(indices),
    },
    attachPoints: [
      tipAttachPoint(left.tip, left.tipDir),
      tipAttachPoint(right.tip, right.tipDir),
    ],
    boundingBox: computeAABB(positions),
  };
}
