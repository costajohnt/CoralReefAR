import { Color, type MeshStandardMaterial } from 'three';

/**
 * Avatar-bioluminescent aesthetic: slight translucency + emissive tinted to
 * the piece's palette hex (not a flat white, which would desaturate the
 * vertex colors under the bloom pass). The pulse helper overrides
 * emissiveIntensity per frame; the color set here is what glows.
 */
export function applyTreeMaterial(mat: MeshStandardMaterial, emissiveHex: string): void {
  mat.transparent = true;
  mat.opacity = 0.78;
  mat.emissive = new Color(emissiveHex);
  mat.needsUpdate = true;
}
