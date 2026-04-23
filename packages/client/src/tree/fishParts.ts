import {
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  Shape,
  ShapeGeometry,
} from 'three';

export interface FinOptions {
  /** Width at the base. */
  width: number;
  /** Height from base to apex. */
  height: number;
  /** Solid color. */
  color: number;
  /** Emissive tint. Defaults to `color` dimmed; set to 0 to disable. */
  emissive?: number;
  /** Emissive intensity. */
  emissiveIntensity?: number;
  /** Horizontal offset of apex from base-mid as a fraction of width. */
  sweepBack?: number;
}

/**
 * Creates a triangular fin in the local XY plane with its base centered on
 * the local X axis and the apex pointing along +Y. Normal is +Z, rendered
 * double-sided so the fin reads from either angle. Callers rotate/position
 * the returned Mesh to attach it to a body.
 */
export function createFin(opts: FinOptions): Mesh {
  const {
    width, height, color,
    emissive = color,
    emissiveIntensity = 0.25,
    sweepBack = 0.15,
  } = opts;
  const shape = new Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width * sweepBack, height);
  shape.closePath();
  const geom = new ShapeGeometry(shape);
  const mat = new MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity,
    roughness: 0.6,
    side: DoubleSide,
  });
  return new Mesh(geom, mat);
}
