import { Box3, MeshStandardMaterial, Vector3 } from 'three';
import type { Mesh } from 'three';
import type { AttachPoint, TreeVariant } from '@reef/shared';
import { generateTreeVariant } from '@reef/generator';
import { polypMesh } from '../scene/meshAdapter.js';
import { applyTreeMaterial } from './material.js';

export interface TreeMeshResult {
  mesh: Mesh;
  attachPointsLocal: AttachPoint[];
  boundingBox: Box3;
}

export function generateTreeVariantMesh(input: {
  variant: TreeVariant;
  seed: number;
  colorKey: string;
}): TreeMeshResult {
  const { mesh: meshData, attachPoints, boundingBox: bb } = generateTreeVariant(input);

  const mesh = polypMesh(meshData);
  applyTreeMaterial(mesh.material as MeshStandardMaterial);

  const boundingBox = new Box3(
    new Vector3(bb.min.x, bb.min.y, bb.min.z),
    new Vector3(bb.max.x, bb.max.y, bb.max.z),
  );

  return { mesh, attachPointsLocal: attachPoints, boundingBox };
}
