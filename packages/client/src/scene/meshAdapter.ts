import { BufferGeometry, BufferAttribute, Mesh, MeshStandardMaterial } from 'three';
import type { MeshData } from '@reef/generator';

export function toGeometry(mesh: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  g.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  g.setAttribute('color', new BufferAttribute(mesh.colors, 3));
  g.setIndex(new BufferAttribute(mesh.indices, 1));
  g.computeBoundingSphere();
  return g;
}

export function polypMesh(mesh: MeshData): Mesh {
  const geometry = toGeometry(mesh);
  const material = new MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.7,
    metalness: 0.05,
    // Subtle wet/gelatinous translucency. Kept above 0.8 so clustered polyps
    // don't produce obvious draw-order glitches even with depthWrite still on.
    transparent: true,
    opacity: 0.85,
    // Baseline self-illumination. installPulse modulates emissiveIntensity
    // per polyp on a slow sine for a breathing/bioluminescent effect; the
    // baseline here is what the coral looks like mid-breath.
    emissive: 0xffffff,
    emissiveIntensity: 0.2,
  });
  return new Mesh(geometry, material);
}
