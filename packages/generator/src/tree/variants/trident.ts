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
const TRUNK_HEIGHT = 0.05;
const SPIKE_LENGTH = 0.05;
const SPIKE_BASE_RADIUS = 0.0055;
const SPIKE_TIP_RADIUS = 0.002;
const SPIKE_TILT_FROM_VERTICAL = Math.PI / 6;
const SPIKE_COUNT = 3;
const SEGMENTS = 10;
const NOISE_AMP = 0.15;
const RIDGE_AMP = 0.12;
const LENGTH_SUBS = 4;

export function generateTrident(input: VariantGenerateInput): VariantOutput {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = colorVec3(input.colorKey);

  const rand = seededRand(input.seed);
  const trunkHeight = jitter(rand, TRUNK_HEIGHT, 0.1);
  const trunkBaseR = jitter(rand, TRUNK_BASE_RADIUS, 0.1);
  const trunkTipR = jitter(rand, TRUNK_TIP_RADIUS, 0.1);

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

  const hub = { x: 0, y: trunkHeight, z: 0 };
  const attachPoints = [];
  for (let i = 0; i < SPIKE_COUNT; i++) {
    // Each spike gets its own length/angle jitter so the trident's 3 prongs
    // have visibly different sizes and tilts.
    const spikeLength = jitter(rand, SPIKE_LENGTH, 0.12);
    const spikeTilt = jitter(rand, SPIKE_TILT_FROM_VERTICAL, 0.12);
    const spikeBaseR = jitter(rand, SPIKE_BASE_RADIUS, 0.1);
    const spikeTipR = jitter(rand, SPIKE_TIP_RADIUS, 0.15);
    const azJitter = (rand() - 0.5) * 0.2; // ±0.1 rad azimuth wander

    const az = (i * 2 * Math.PI) / SPIKE_COUNT + azJitter;
    const horizFactor = Math.sin(spikeTilt);
    const vertFactor = Math.cos(spikeTilt);
    const dir = {
      x: Math.cos(az) * horizFactor,
      y: vertFactor,
      z: Math.sin(az) * horizFactor,
    };
    const tip = {
      x: hub.x + dir.x * spikeLength,
      y: hub.y + dir.y * spikeLength,
      z: hub.z + dir.z * spikeLength,
    };
    emitFrustum(
      positions, normals, colors, indices,
      hub, tip, spikeBaseR, spikeTipR, color, SEGMENTS,
      {
        seed: input.seed * 11 + (i + 1) * 17,
        noiseAmplitude: NOISE_AMP,
        ridgeAmplitude: RIDGE_AMP,
        lengthSubdivisions: LENGTH_SUBS,
        nodulesEnabled: true,
      },
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
