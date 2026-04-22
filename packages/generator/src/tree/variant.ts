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
