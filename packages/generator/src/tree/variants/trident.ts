import type { VariantGenerateInput, VariantOutput } from '../variant.js';
import { tipAttachPoint, emitFrustum, computeAABB } from '../variant.js';
import { colorVec3 } from '../../species/_common.js';

const TRUNK_BASE_RADIUS = 0.008;
const TRUNK_TIP_RADIUS = 0.006;
const TRUNK_HEIGHT = 0.05;
const SPIKE_LENGTH = 0.05;
const SPIKE_BASE_RADIUS = 0.0055;
const SPIKE_TIP_RADIUS = 0.002;
const SPIKE_TILT_FROM_VERTICAL = Math.PI / 6; // 30° off vertical, toward each spike's azimuth
const SPIKE_COUNT = 3;
const SEGMENTS = 6;

export function generateTrident(input: VariantGenerateInput): VariantOutput {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = colorVec3(input.colorKey);

  // Short trunk up to the hub.
  emitFrustum(
    positions, normals, colors, indices,
    { x: 0, y: 0, z: 0 },
    { x: 0, y: TRUNK_HEIGHT, z: 0 },
    TRUNK_BASE_RADIUS, TRUNK_TIP_RADIUS, color, SEGMENTS,
  );

  const hub = { x: 0, y: TRUNK_HEIGHT, z: 0 };
  const attachPoints = [];
  for (let i = 0; i < SPIKE_COUNT; i++) {
    const az = (i * 2 * Math.PI) / SPIKE_COUNT; // 0°, 120°, 240° (= -120°)
    const horizFactor = Math.sin(SPIKE_TILT_FROM_VERTICAL);
    const vertFactor = Math.cos(SPIKE_TILT_FROM_VERTICAL);
    const dir = {
      x: Math.cos(az) * horizFactor,
      y: vertFactor,
      z: Math.sin(az) * horizFactor,
    };
    const tip = {
      x: hub.x + dir.x * SPIKE_LENGTH,
      y: hub.y + dir.y * SPIKE_LENGTH,
      z: hub.z + dir.z * SPIKE_LENGTH,
    };
    emitFrustum(
      positions, normals, colors, indices,
      hub, tip, SPIKE_BASE_RADIUS, SPIKE_TIP_RADIUS, color, SEGMENTS,
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
