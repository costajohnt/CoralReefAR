import { Box3, Vector3 } from 'three';

/**
 * Coral mesh bounding boxes include surface nodules that extend ~20–30%
 * of segment radius outward from the skeleton cylinder. Nodules are
 * visual polish, not a physical collision surface — without compensation
 * the placement check falsely rejects many slot choices that look like
 * clear space to the viewer.
 *
 * Shrinking both boxes around their centers before the intersection
 * test permits adjacent branches to graze their outer polyp surfaces.
 * 0.85 matches the approximate ratio of skeleton-only AABB to
 * nodule-inclusive AABB across the five variants; a generator-side
 * skeleton AABB would be more principled, deferred.
 */
const COLLISION_SHRINK_FACTOR = 0.85;

function shrink(box: Box3): Box3 {
  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3()).multiplyScalar(COLLISION_SHRINK_FACTOR);
  return new Box3().setFromCenterAndSize(center, size);
}

export function wouldCollide(
  proposedBox: Box3,
  existingBoxes: Iterable<Box3>,
): boolean {
  const a = shrink(proposedBox);
  for (const other of existingBoxes) {
    if (a.intersectsBox(shrink(other))) return true;
  }
  return false;
}
