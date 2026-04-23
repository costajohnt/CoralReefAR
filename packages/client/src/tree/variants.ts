import {
  Box3,
  Color,
  Mesh,
  MeshPhysicalMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { paletteByKey, type AttachPoint, type TreeVariant } from '@reef/shared';
import { generateTreeVariant } from '@reef/generator';
import { polypMesh } from '../scene/meshAdapter.js';
import { applyTreeMaterial } from './material.js';

export interface TreeMeshResult {
  mesh: Mesh;
  attachPointsLocal: AttachPoint[];
  boundingBox: Box3;
}

// Radius of the "joint" sphere dropped at each piece's local origin so the
// disc edges of parent-tip / child-base frustums blend smoothly. Conservative
// value — slightly larger than the max trunk-base radius across variants
// (~0.008) so it fully covers the hard edge without ballooning the silhouette.
const JOINT_RADIUS = 0.009;

export function generateTreeVariantMesh(input: {
  variant: TreeVariant;
  seed: number;
  colorKey: string;
}): TreeMeshResult {
  const { mesh: meshData, attachPoints, boundingBox: bb } = generateTreeVariant(input);

  const mesh = polypMesh(meshData);
  const hex = paletteByKey(input.colorKey).hex;
  applyTreeMaterial(mesh, hex);

  // Joint sphere at local (0,0,0). When the piece is placed at a parent's
  // attach point, the sphere sits over the seam where the parent's tip
  // frustum meets this piece's base frustum, rounding the connection.
  // Matches the main mesh's physical-material aesthetic so the join doesn't
  // read as a different material.
  const jointColor = new Color(hex);
  const jointMat = new MeshPhysicalMaterial({
    color: jointColor,
    emissive: jointColor,
    emissiveIntensity: 0.35,
    transparent: true,
    opacity: 0.9,
    roughness: 0.4,
    metalness: 0.0,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
  });
  const joint = new Mesh(new SphereGeometry(JOINT_RADIUS, 14, 10), jointMat);
  mesh.add(joint);

  const boundingBox = new Box3(
    new Vector3(bb.min.x, bb.min.y, bb.min.z),
    new Vector3(bb.max.x, bb.max.y, bb.max.z),
  );

  return { mesh, attachPointsLocal: attachPoints, boundingBox };
}
