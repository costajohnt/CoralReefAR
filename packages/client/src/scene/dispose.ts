import {
  BufferGeometry, Material, Mesh, Object3D, Points, Texture,
} from 'three';

function disposeMaterial(mat: Material | Material[]): void {
  const list = Array.isArray(mat) ? mat : [mat];
  for (const m of list) {
    for (const key of Object.keys(m) as (keyof Material)[]) {
      const val = (m as unknown as Record<string, unknown>)[key as string];
      if (val instanceof Texture) val.dispose();
    }
    m.dispose();
  }
}

/** Recursively dispose geometries and materials under the given root. */
export function disposeTree(root: Object3D): void {
  root.traverse((o) => {
    const g = (o as Mesh | Points).geometry as BufferGeometry | undefined;
    if (g && typeof g.dispose === 'function') g.dispose();
    const m = (o as Mesh | Points).material as Material | Material[] | undefined;
    if (m) disposeMaterial(m);
  });
}
