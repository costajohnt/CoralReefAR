import type { VariantGenerateInput, VariantOutput } from '../variant.js';
import { tipAttachPoint, emitFrustum, computeAABB } from '../variant.js';
import { colorVec3 } from '../../species/_common.js';

const TRUNK_BASE_RADIUS = 0.008;
const TRUNK_TIP_RADIUS = 0.006;
const TRUNK_HEIGHT = 0.06;
const BRANCH_LENGTH = 0.045;
const BRANCH_BASE_RADIUS = 0.006;
const BRANCH_TIP_RADIUS = 0.003;
const BRANCH_ANGLE = Math.PI / 6; // 30°
const SEGMENTS = 6;

export function generateForked(input: VariantGenerateInput): VariantOutput {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = colorVec3(input.colorKey);

  // Trunk: frustum from (0,0,0) up to (0, TRUNK_HEIGHT, 0).
  emitFrustum(
    positions, normals, colors, indices,
    { x: 0, y: 0, z: 0 },
    { x: 0, y: TRUNK_HEIGHT, z: 0 },
    TRUNK_BASE_RADIUS, TRUNK_TIP_RADIUS, color, SEGMENTS,
  );

  // Two branches: diverging in ±X, each tilted BRANCH_ANGLE from vertical.
  const tipA = {
    x: Math.sin(BRANCH_ANGLE) * BRANCH_LENGTH,
    y: TRUNK_HEIGHT + Math.cos(BRANCH_ANGLE) * BRANCH_LENGTH,
    z: 0,
  };
  const tipB = { x: -tipA.x, y: tipA.y, z: 0 };
  const dirA = { x: Math.sin(BRANCH_ANGLE), y: Math.cos(BRANCH_ANGLE), z: 0 };
  const dirB = { x: -dirA.x, y: dirA.y, z: 0 };

  emitFrustum(
    positions, normals, colors, indices,
    { x: 0, y: TRUNK_HEIGHT, z: 0 }, tipA,
    BRANCH_BASE_RADIUS, BRANCH_TIP_RADIUS, color, SEGMENTS,
  );
  emitFrustum(
    positions, normals, colors, indices,
    { x: 0, y: TRUNK_HEIGHT, z: 0 }, tipB,
    BRANCH_BASE_RADIUS, BRANCH_TIP_RADIUS, color, SEGMENTS,
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
