import type { VariantGenerateInput, VariantOutput } from '../variant.js';
import {
  tipAttachPoint,
  emitFrustum,
  computeAABB,
  seededRand,
  jitter,
} from '../variant.js';
import { colorVec3 } from '../../species/_common.js';

const STRAIGHT_SEG_LENGTH = 0.03;
const BENT_SEG_LENGTH = 0.035;
const TRUNK_BASE_RADIUS = 0.008;
const TRUNK_MID_RADIUS = 0.006;
const TRUNK_TIP_RADIUS = 0.005;
const CLAW_LENGTH = 0.025;
const CLAW_BASE_RADIUS = 0.005;
const CLAW_TIP_RADIUS = 0.002;
const BEND_ANGLE = Math.PI / 3;
const CLAW_SPLIT_ANGLE = Math.PI / 8;
const SEGMENTS = 10;
const NOISE_AMP = 0.12;

export function generateClaw(input: VariantGenerateInput): VariantOutput {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = colorVec3(input.colorKey);

  const rand = seededRand(input.seed);
  const straightLen = jitter(rand, STRAIGHT_SEG_LENGTH, 0.12);
  const bentLen = jitter(rand, BENT_SEG_LENGTH, 0.15);
  const bendAngle = jitter(rand, BEND_ANGLE, 0.1);
  const splitAngle = jitter(rand, CLAW_SPLIT_ANGLE, 0.2);
  const splitAsymmetry = jitter(rand, 1, 0.18);
  const clawLenA = jitter(rand, CLAW_LENGTH, 0.15);
  const clawLenB = jitter(rand, CLAW_LENGTH, 0.15);

  // Segment 1: straight up from origin to midpoint.
  const midBase = { x: 0, y: 0, z: 0 };
  const midApex = { x: 0, y: straightLen, z: 0 };
  emitFrustum(
    positions, normals, colors, indices,
    midBase, midApex,
    jitter(rand, TRUNK_BASE_RADIUS, 0.1),
    jitter(rand, TRUNK_MID_RADIUS, 0.1),
    color, SEGMENTS,
    { seed: input.seed * 7 + 1, noiseAmplitude: NOISE_AMP },
  );

  // Segment 2: bent.
  const bentDir = { x: Math.sin(bendAngle), y: Math.cos(bendAngle), z: 0 };
  const bentEnd = {
    x: midApex.x + bentDir.x * bentLen,
    y: midApex.y + bentDir.y * bentLen,
    z: 0,
  };
  emitFrustum(
    positions, normals, colors, indices,
    midApex, bentEnd,
    jitter(rand, TRUNK_MID_RADIUS, 0.1),
    jitter(rand, TRUNK_TIP_RADIUS, 0.1),
    color, SEGMENTS,
    { seed: input.seed * 7 + 2, noiseAmplitude: NOISE_AMP },
  );

  // Two claw tips with asymmetric split angles.
  const rot = (angle: number) => ({
    x: Math.cos(angle) * bentDir.x - Math.sin(angle) * bentDir.y,
    y: Math.sin(angle) * bentDir.x + Math.cos(angle) * bentDir.y,
    z: 0,
  });
  const angleA = splitAngle;
  const angleB = -splitAngle * splitAsymmetry;
  const dirA = rot(angleA);
  const dirB = rot(angleB);
  const tipA = {
    x: bentEnd.x + dirA.x * clawLenA,
    y: bentEnd.y + dirA.y * clawLenA,
    z: 0,
  };
  const tipB = {
    x: bentEnd.x + dirB.x * clawLenB,
    y: bentEnd.y + dirB.y * clawLenB,
    z: 0,
  };
  emitFrustum(
    positions, normals, colors, indices,
    bentEnd, tipA,
    jitter(rand, CLAW_BASE_RADIUS, 0.1),
    jitter(rand, CLAW_TIP_RADIUS, 0.15),
    color, SEGMENTS,
    { seed: input.seed * 11 + 3, noiseAmplitude: NOISE_AMP },
  );
  emitFrustum(
    positions, normals, colors, indices,
    bentEnd, tipB,
    jitter(rand, CLAW_BASE_RADIUS, 0.1),
    jitter(rand, CLAW_TIP_RADIUS, 0.15),
    color, SEGMENTS,
    { seed: input.seed * 13 + 4, noiseAmplitude: NOISE_AMP },
  );

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
