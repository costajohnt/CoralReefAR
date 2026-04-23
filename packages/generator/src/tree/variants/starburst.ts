import type { VariantGenerateInput, VariantOutput } from '../variant.js';
import {
  tipAttachPoint,
  emitFrustum,
  computeAABB,
  seededRand,
  jitter,
} from '../variant.js';
import { colorVec3 } from '../../species/_common.js';

const HUB_RADIUS = 0.018;
const HUB_TALL = 0.006;
const TIP_LENGTH = 0.04;
const TIP_BASE_RADIUS = 0.006;
const TIP_TIP_RADIUS = 0.002;
const TIP_ELEVATION = Math.PI / 4;
const SEGMENTS = 12; // highest among variants — hub is prominent, close to camera
const NOISE_AMP = 0.14;

export function generateStarburst(input: VariantGenerateInput): VariantOutput {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = colorVec3(input.colorKey);

  const rand = seededRand(input.seed);
  const hubR = jitter(rand, HUB_RADIUS, 0.1);
  const hubTall = jitter(rand, HUB_TALL, 0.15);

  // Hub: two stacked fat frustums fused at hubTall/2. Each gets its own noise
  // seed so the blob has irregular surface bumps.
  emitFrustum(
    positions, normals, colors, indices,
    { x: 0, y: 0, z: 0 },
    { x: 0, y: hubTall / 2, z: 0 },
    hubR * 0.6, hubR, color, SEGMENTS,
    { seed: input.seed * 7 + 1, noiseAmplitude: NOISE_AMP },
  );
  emitFrustum(
    positions, normals, colors, indices,
    { x: 0, y: hubTall / 2, z: 0 },
    { x: 0, y: hubTall, z: 0 },
    hubR, hubR * 0.6, color, SEGMENTS,
    { seed: input.seed * 7 + 2, noiseAmplitude: NOISE_AMP },
  );

  const hub = { x: 0, y: hubTall / 2, z: 0 };

  // 4 tips in cardinal horizontal directions. Each tip gets individual jitter
  // so the star isn't perfectly symmetric.
  const cardinalAzimuths = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];
  const attachPoints = [];
  for (let i = 0; i < cardinalAzimuths.length; i++) {
    const tipLen = jitter(rand, TIP_LENGTH, 0.12);
    const elevation = jitter(rand, TIP_ELEVATION, 0.1);
    const tipBaseR = jitter(rand, TIP_BASE_RADIUS, 0.1);
    const tipTipR = jitter(rand, TIP_TIP_RADIUS, 0.15);
    const azJitter = (rand() - 0.5) * 0.18; // ±0.09 rad azimuth wander

    const az = cardinalAzimuths[i]! + azJitter;
    const horizFactor = Math.cos(elevation);
    const vertFactor = Math.sin(elevation);
    const dir = {
      x: Math.cos(az) * horizFactor,
      y: vertFactor,
      z: Math.sin(az) * horizFactor,
    };
    const tip = {
      x: hub.x + dir.x * tipLen,
      y: hub.y + dir.y * tipLen,
      z: hub.z + dir.z * tipLen,
    };
    emitFrustum(
      positions, normals, colors, indices,
      hub, tip, tipBaseR, tipTipR, color, SEGMENTS,
      { seed: input.seed * 11 + (i + 1) * 19, noiseAmplitude: NOISE_AMP },
    );
    attachPoints.push(tipAttachPoint(tip, dir));
  }

  return {
    mesh: {
      positions: new Float32Array(positions),
      normals: new Float32Array(normals),
      colors: new Float32Array(colors),
      indices: new Uint32Array(indices),
    },
    attachPoints,
    boundingBox: computeAABB(positions),
  };
}
