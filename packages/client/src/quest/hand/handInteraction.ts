import { Raycaster, type Object3D, type Vector3 } from 'three';

/** Distance under which thumb tip + index tip are considered pinched. */
export const PINCH_THRESHOLD_METERS = 0.025;
/** Hysteresis: an in-progress pinch only ends above this larger threshold. */
export const PINCH_RELEASE_THRESHOLD_METERS = 0.04;

/**
 * `wasPinching` enables hysteresis: once a pinch starts, the user has to
 * open their fingers further to release than the distance that started it.
 * Without this, micro-tremors at the threshold produce rapid on/off toggles
 * that read as flicker in the UI.
 */
export function isPinching(
  thumbTip: Vector3,
  indexTip: Vector3,
  wasPinching = false,
): boolean {
  const d = thumbTip.distanceTo(indexTip);
  if (wasPinching) return d < PINCH_RELEASE_THRESHOLD_METERS;
  return d < PINCH_THRESHOLD_METERS;
}

const raycaster = new Raycaster();

/**
 * Returns the closest tip-node hotspot intersected by a ray from `origin`
 * along `direction`. Hotspots are identified by `userData.hotspotId` being
 * a non-null number on the Object3D. Returns null if no hotspot hits.
 *
 * Recursive intersection is off (`false`) — hotspots are flat marker meshes,
 * never nested. Saves cost on every-frame raycasts.
 */
export function pickHotspot(
  origin: Vector3,
  direction: Vector3,
  hotspots: Object3D[],
): { hotspotId: number; distance: number } | null {
  raycaster.ray.origin.copy(origin);
  raycaster.ray.direction.copy(direction).normalize();
  const hits = raycaster.intersectObjects(hotspots, false);
  for (const h of hits) {
    const id = h.object.userData.hotspotId;
    if (typeof id === 'number') {
      return { hotspotId: id, distance: h.distance };
    }
  }
  return null;
}

/** Default radius for "is the user's fingertip touching this button?" */
export const POKE_RADIUS_METERS = 0.03;

/**
 * Pick the button whose world-space center is closest to `fingertip` and
 * within `radius` meters. This is the right semantic for poke-style direct
 * touch interaction (wrist palette buttons): we want "did the fingertip
 * land ON a button," not "did a ray from somewhere intersect it." A button
 * is recognized by ANY of the userData tags it might carry.
 *
 * Returns null if no button is within radius, the closest hit otherwise.
 */
export function pickPokedButton(
  fingertip: Vector3,
  buttons: Object3D[],
  radius = POKE_RADIUS_METERS,
): Object3D | null {
  let closest: Object3D | null = null;
  let closestDist = radius;
  const tmp = new (fingertip.constructor as new () => Vector3)();
  for (const b of buttons) {
    const ud = b.userData;
    if (
      typeof ud.shapeIndex !== 'number' &&
      typeof ud.colorIndex !== 'number' &&
      ud.action !== 'move'
    ) {
      continue;
    }
    // Read world position into a scratch vector to avoid allocation.
    b.getWorldPosition(tmp);
    const d = tmp.distanceTo(fingertip);
    if (d < closestDist) {
      closestDist = d;
      closest = b;
    }
  }
  return closest;
}
