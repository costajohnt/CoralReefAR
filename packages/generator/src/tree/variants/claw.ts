import type { VariantGenerateInput, VariantOutput } from '../variant.js';
import { tipAttachPoint, emitFrustum, computeAABB } from '../variant.js';
import { colorVec3 } from '../../species/_common.js';

const STRAIGHT_SEG_LENGTH = 0.03;
const BENT_SEG_LENGTH = 0.035;
const TRUNK_BASE_RADIUS = 0.008;
const TRUNK_MID_RADIUS = 0.006;
const TRUNK_TIP_RADIUS = 0.005;
const CLAW_LENGTH = 0.025;
const CLAW_BASE_RADIUS = 0.005;
const CLAW_TIP_RADIUS = 0.002;
const BEND_ANGLE = Math.PI / 3;              // 60° off vertical at the midpoint
const CLAW_SPLIT_ANGLE = Math.PI / 8;        // ~22° fork angle between the two tips
const SEGMENTS = 6;

export function generateClaw(input: VariantGenerateInput): VariantOutput {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = colorVec3(input.colorKey);

  // Segment 1: straight up from origin to midpoint.
  const midBase = { x: 0, y: 0, z: 0 };
  const midApex = { x: 0, y: STRAIGHT_SEG_LENGTH, z: 0 };
  emitFrustum(positions, normals, colors, indices,
    midBase, midApex, TRUNK_BASE_RADIUS, TRUNK_MID_RADIUS, color, SEGMENTS);

  // Segment 2: bent — from midApex in a direction tilted BEND_ANGLE off vertical toward +X.
  const bentDir = { x: Math.sin(BEND_ANGLE), y: Math.cos(BEND_ANGLE), z: 0 };
  const bentEnd = {
    x: midApex.x + bentDir.x * BENT_SEG_LENGTH,
    y: midApex.y + bentDir.y * BENT_SEG_LENGTH,
    z: 0,
  };
  emitFrustum(positions, normals, colors, indices,
    midApex, bentEnd, TRUNK_MID_RADIUS, TRUNK_TIP_RADIUS, color, SEGMENTS);

  // Two claw tips splitting from bentEnd — symmetric around the bentDir axis in XY plane.
  // Rotate bentDir by ±CLAW_SPLIT_ANGLE around the Z axis.
  const rot = (angle: number) => ({
    x: Math.cos(angle) * bentDir.x - Math.sin(angle) * bentDir.y,
    y: Math.sin(angle) * bentDir.x + Math.cos(angle) * bentDir.y,
    z: 0,
  });
  const dirA = rot(+CLAW_SPLIT_ANGLE);
  const dirB = rot(-CLAW_SPLIT_ANGLE);
  const tipA = {
    x: bentEnd.x + dirA.x * CLAW_LENGTH,
    y: bentEnd.y + dirA.y * CLAW_LENGTH,
    z: 0,
  };
  const tipB = {
    x: bentEnd.x + dirB.x * CLAW_LENGTH,
    y: bentEnd.y + dirB.y * CLAW_LENGTH,
    z: 0,
  };
  emitFrustum(positions, normals, colors, indices,
    bentEnd, tipA, CLAW_BASE_RADIUS, CLAW_TIP_RADIUS, color, SEGMENTS);
  emitFrustum(positions, normals, colors, indices,
    bentEnd, tipB, CLAW_BASE_RADIUS, CLAW_TIP_RADIUS, color, SEGMENTS);

  return {
    mesh: {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      colors: new Float32Array(colors),
      indices: new Uint32Array(indices),
    },
    attachPoints: [tipAttachPoint(tipA, dirA), tipAttachPoint(tipB, dirB)],
    boundingBox: computeAABB(positions),
  };
}
