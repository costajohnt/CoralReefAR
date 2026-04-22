import { Plane, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';

const PEDESTAL_PLANE = new Plane(new Vector3(0, 1, 0), 0);  // y=0, normal up

/**
 * Cast a ray from the camera through an NDC click point onto the pedestal's
 * y=0 plane. Returns the local-space hit point, or null if the ray misses
 * the plane or the hit falls outside `maxRadius`.
 */
export function computePlacementFromClick(
  ndc: Vector2,
  camera: PerspectiveCamera,
  maxRadius = 0.12,
): Vector3 | null {
  const ray = new Raycaster();
  ray.setFromCamera(ndc, camera);
  const hit = new Vector3();
  const intersected = ray.ray.intersectPlane(PEDESTAL_PLANE, hit);
  if (!intersected) return null;
  const r = Math.hypot(hit.x, hit.z);
  if (r > maxRadius) return null;
  return hit;
}
