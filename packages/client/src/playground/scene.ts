import { CylinderGeometry, Mesh, MeshStandardMaterial } from 'three';

/**
 * Virtual pedestal mesh. The reef's anchor sits at world origin (no AR
 * tracker to provide a pose), so the pedestal is positioned so its top face
 * lands exactly at y=0 — polyps grow "up" from the pedestal surface.
 *
 * Matte, low-saturation color so the coral pulse doesn't have to compete
 * with a flashy base.
 */
const PEDESTAL_RADIUS = 0.12;
const PEDESTAL_HEIGHT = 0.04;
const PEDESTAL_COLOR = 0x2a3a4a;

export function createPedestal(): Mesh {
  const geom = new CylinderGeometry(PEDESTAL_RADIUS, PEDESTAL_RADIUS, PEDESTAL_HEIGHT, 48);
  const mat = new MeshStandardMaterial({
    color: PEDESTAL_COLOR,
    roughness: 0.9,
    metalness: 0.02,
    emissiveIntensity: 0,
  });
  const mesh = new Mesh(geom, mat);
  // Top face at y=0 so Reef geometry (which lives in positive-y local space)
  // grows from the pedestal surface.
  mesh.position.y = -PEDESTAL_HEIGHT / 2;
  return mesh;
}
