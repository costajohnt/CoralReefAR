import type { VariantGenerateInput, VariantOutput } from '../variant.js';
import {
  tipAttachPoint,
  emitFrustum,
  computeAABB,
  seededRand,
  jitter,
} from '../variant.js';
import { colorVec3 } from '../../species/_common.js';

const TRUNK_BASE_RADIUS = 0.008;
const TRUNK_TIP_RADIUS = 0.006;
const TRUNK_HEIGHT = 0.06;
const BRANCH_LENGTH = 0.045;
const BRANCH_BASE_RADIUS = 0.006;
const BRANCH_TIP_RADIUS = 0.003;
const BRANCH_ANGLE = Math.PI / 6; // 30°
const SEGMENTS = 10;
// Displacement amplitude raised so the branch swells visibly (multi-octave
// noise is applied inside emitFrustum; the amplitude here is per-octave scale).
const NOISE_AMP = 0.15;
const RIDGE_AMP = 0.12; // ring-level banding for rib/pinch look
const LENGTH_SUBS = 4; // intermediate rings for length-wise modulation

export function generateForked(input: VariantGenerateInput): VariantOutput {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = colorVec3(input.colorKey);

  // Per-piece dimensional jitter: each rolled constant gets ±% of its base
  // so no two pieces of the same variant look identical.
  const rand = seededRand(input.seed);
  const trunkHeight = jitter(rand, TRUNK_HEIGHT, 0.1);
  const branchLength = jitter(rand, BRANCH_LENGTH, 0.15);
  const branchAngle = jitter(rand, BRANCH_ANGLE, 0.12);
  const angleAsymmetry = jitter(rand, 1, 0.15); // branches don't mirror exactly
  const trunkBaseR = jitter(rand, TRUNK_BASE_RADIUS, 0.1);
  const trunkTipR = jitter(rand, TRUNK_TIP_RADIUS, 0.1);
  const branchBaseR = jitter(rand, BRANCH_BASE_RADIUS, 0.1);
  const branchTipR = jitter(rand, BRANCH_TIP_RADIUS, 0.15);

  // Trunk: frustum from (0,0,0) up to (0, trunkHeight, 0).
  emitFrustum(
    positions, normals, colors, indices,
    { x: 0, y: 0, z: 0 },
    { x: 0, y: trunkHeight, z: 0 },
    trunkBaseR, trunkTipR, color, SEGMENTS,
    {
      seed: input.seed * 7 + 1,
      noiseAmplitude: NOISE_AMP,
      ridgeAmplitude: RIDGE_AMP,
      lengthSubdivisions: LENGTH_SUBS,
      nodulesEnabled: true,
    },
  );

  // Two branches — slightly asymmetric so the Y isn't a mirror.
  const angleA = branchAngle;
  const angleB = branchAngle * angleAsymmetry;
  const tipA = {
    x: Math.sin(angleA) * branchLength,
    y: trunkHeight + Math.cos(angleA) * branchLength,
    z: 0,
  };
  const tipB = {
    x: -Math.sin(angleB) * branchLength,
    y: trunkHeight + Math.cos(angleB) * branchLength,
    z: 0,
  };
  const dirA = { x: Math.sin(angleA), y: Math.cos(angleA), z: 0 };
  const dirB = { x: -Math.sin(angleB), y: Math.cos(angleB), z: 0 };

  emitFrustum(
    positions, normals, colors, indices,
    { x: 0, y: trunkHeight, z: 0 }, tipA,
    branchBaseR, branchTipR, color, SEGMENTS,
    {
      seed: input.seed * 11 + 2,
      noiseAmplitude: NOISE_AMP,
      ridgeAmplitude: RIDGE_AMP,
      lengthSubdivisions: LENGTH_SUBS,
      nodulesEnabled: true,
    },
  );
  emitFrustum(
    positions, normals, colors, indices,
    { x: 0, y: trunkHeight, z: 0 }, tipB,
    branchBaseR, branchTipR, color, SEGMENTS,
    {
      seed: input.seed * 13 + 3,
      noiseAmplitude: NOISE_AMP,
      ridgeAmplitude: RIDGE_AMP,
      lengthSubdivisions: LENGTH_SUBS,
      nodulesEnabled: true,
    },
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
