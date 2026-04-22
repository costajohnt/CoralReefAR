import type { VariantGenerateInput, VariantOutput } from '../variant.js';
import { tipAttachPoint, emitFrustum, computeAABB } from '../variant.js';
import { colorVec3 } from '../../species/_common.js';

const HUB_RADIUS = 0.018;                  // dense central mass (~3× a branch radius)
const HUB_TALL = 0.006;                    // vertical extent of the hub blob
const TIP_LENGTH = 0.04;                   // how far each tip extends from center
const TIP_BASE_RADIUS = 0.006;
const TIP_TIP_RADIUS = 0.002;
const TIP_ELEVATION = Math.PI / 4;         // 45° above horizontal
const TIP_COUNT = 4;
const SEGMENTS = 8;                         // slightly higher than Trident since hub is prominent

export function generateStarburst(input: VariantGenerateInput): VariantOutput {
  const positions: number[] = [];
  const normals: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const color = colorVec3(input.colorKey);

  // Central spherical mass: approximate with two stacked short frustums for simplicity.
  // A full UV-sphere would need its own emitter; two fat frustums fused at HUB_TALL/2
  // read plausibly as a dense blob under the bloom pass.
  emitFrustum(positions, normals, colors, indices,
    { x: 0, y: 0, z: 0 },
    { x: 0, y: HUB_TALL / 2, z: 0 },
    HUB_RADIUS * 0.6, HUB_RADIUS, color, SEGMENTS);
  emitFrustum(positions, normals, colors, indices,
    { x: 0, y: HUB_TALL / 2, z: 0 },
    { x: 0, y: HUB_TALL, z: 0 },
    HUB_RADIUS, HUB_RADIUS * 0.6, color, SEGMENTS);

  const hub = { x: 0, y: HUB_TALL / 2, z: 0 };

  // 4 tips: +X, +Z, -X, -Z (sweeping counter-clockwise around Y).
  const cardinalAzimuths = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];
  const horizFactor = Math.cos(TIP_ELEVATION); // lateral component
  const vertFactor = Math.sin(TIP_ELEVATION);  // upward component

  const attachPoints = [];
  for (const az of cardinalAzimuths) {
    const dir = {
      x: Math.cos(az) * horizFactor,
      y: vertFactor,
      z: Math.sin(az) * horizFactor,
    };
    const tip = {
      x: hub.x + dir.x * TIP_LENGTH,
      y: hub.y + dir.y * TIP_LENGTH,
      z: hub.z + dir.z * TIP_LENGTH,
    };
    emitFrustum(positions, normals, colors, indices,
      hub, tip, TIP_BASE_RADIUS, TIP_TIP_RADIUS, color, SEGMENTS);
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
