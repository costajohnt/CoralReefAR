import {
  Color, Material, Mesh, MeshStandardMaterial, Object3D, SphereGeometry,
} from 'three';
import type { SimDelta } from '@reef/shared';

/**
 * Maps server-side sim deltas onto visual decorations on a polyp:
 * - barnacle: small white bump stuck to the surface
 * - algae: darken + greenify the polyp's base color
 * - weather: reduce material saturation
 *
 * The polyp arg is assumed to BE the textured Mesh — reef.ts creates polyps
 * via polypMesh(), which returns a Mesh directly.
 */
export function applySimDecoration(polyp: Object3D, delta: SimDelta): void {
  const mat = getMaterial(polyp);
  if (delta.kind === 'barnacle') {
    addBarnacle(polyp, delta);
  } else if (delta.kind === 'algae') {
    if (mat) mat.color.lerp(new Color(0x4a6b2f), 0.15);
  } else if (delta.kind === 'weather') {
    if (mat) {
      const hsl = { h: 0, s: 0, l: 0 };
      mat.color.getHSL(hsl);
      mat.color.setHSL(hsl.h, hsl.s * 0.8, hsl.l);
    }
  }
}

function getMaterial(obj: Object3D): MeshStandardMaterial | undefined {
  const mesh = obj as Mesh;
  if (!mesh.isMesh) return undefined;
  const m: Material | Material[] = mesh.material;
  const single = Array.isArray(m) ? m[0] : m;
  return single instanceof MeshStandardMaterial ? single : undefined;
}

function addBarnacle(polyp: Object3D, delta: SimDelta): void {
  const size = num(delta.params.size, 0.5);
  const u = num(delta.params.u, Math.random());
  const v = num(delta.params.v, Math.random());
  const g = new SphereGeometry(0.005 * size, 6, 4);
  const m = new MeshStandardMaterial({ color: 0xefeadd, roughness: 0.9 });
  const s = new Mesh(g, m);
  const theta = u * Math.PI * 2;
  const r = 0.02 + v * 0.04;
  s.position.set(Math.cos(theta) * r, v * 0.04, Math.sin(theta) * r);
  s.userData.sim = true;
  polyp.add(s);
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
