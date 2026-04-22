import type { MeshStandardMaterial } from 'three';

export const TREE_EMISSIVE_INTENSITY = 1.0;

/**
 * Avatar-bioluminescent aesthetic: fully opaque, emissive matches the
 * surface color, vertex colors still drive per-piece hue. Downstream a
 * bloom post-processing pass turns the emissive into halos.
 */
export function applyTreeMaterial(mat: MeshStandardMaterial): void {
  mat.transparent = false;
  mat.opacity = 1;
  mat.emissive.copy(mat.color);
  mat.emissiveIntensity = TREE_EMISSIVE_INTENSITY;
  mat.needsUpdate = true;
}
