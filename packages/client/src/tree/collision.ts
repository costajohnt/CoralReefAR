import type { Box3 } from 'three';

export function wouldCollide(
  proposedBox: Box3,
  existingBoxes: Iterable<Box3>,
): boolean {
  for (const other of existingBoxes) {
    if (proposedBox.intersectsBox(other)) return true;
  }
  return false;
}
