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
  });
  return new Mesh(geometry, material);
}
