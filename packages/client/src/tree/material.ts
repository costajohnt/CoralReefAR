import { Color, MeshPhysicalMaterial, type Mesh } from 'three';

/**
 * Avatar-bioluminescent + wet-coral aesthetic: swaps the mesh's material in
 * place with a MeshPhysicalMaterial configured for a slightly translucent,
 * clear-coated surface. Vertex colors carry the per-piece hue; `emissive`
 * is tinted to the palette hex so the bloom pass produces colored halos
 * rather than washed-out whites. The pulse helper overrides
 * `emissiveIntensity` per frame for the breathing effect.
 */
export function applyTreeMaterial(mesh: Mesh, emissiveHex: string): void {
  const prev = mesh.material as { dispose?: () => void };
  if (prev && typeof prev.dispose === 'function') prev.dispose();

  const color = new Color(emissiveHex);
  mesh.material = new MeshPhysicalMaterial({
    vertexColors: true,
    color: 0xffffff,            // let vertex colors carry the hue unmodified
    emissive: color,
    emissiveIntensity: 0.35,    // pulse overrides this per frame
    roughness: 0.32,
    metalness: 0.0,
    clearcoat: 0.7,             // wet-looking top coat
    clearcoatRoughness: 0.22,
    transmission: 0.12,         // subtle see-through for edges
    thickness: 0.01,
    ior: 1.33,                  // water-like refraction
    transparent: true,
    opacity: 0.88,
  });
}
