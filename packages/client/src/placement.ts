import {
  Group, Matrix4, Mesh, MeshStandardMaterial, PerspectiveCamera, Plane,
  Quaternion, Raycaster, Vector2, Vector3,
} from 'three';
import { generatePolyp } from '@reef/generator';
import type { GestureFrame, Species } from '@reef/shared';
import { polypMesh } from './scene/meshAdapter.js';
import type { Reef } from './scene/reef.js';
import { disposeTree } from './scene/dispose.js';

export interface PlacementResult {
  position: Vector3;       // anchor-local
  normal: Vector3;         // anchor-local
  orientation: Quaternion; // anchor-local; +Y aligned with normal plus any user twist
  scale: number;           // final scale after user pinch adjustments
}

const MIN_SCALE = 0.3;
const MAX_SCALE = 3;
const pedestalPlane = new Plane(new Vector3(0, 1, 0), 0);

export class Placement {
  private ghost: Mesh | null = null;
  private lastResult: PlacementResult | null = null;
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly invAnchor = new Matrix4();

  constructor(
    private readonly reef: Reef,
    private readonly camera: PerspectiveCamera,
    private readonly anchor: Group,
  ) {}

  getLast(): PlacementResult | null { return this.lastResult; }

  handleTap(clientX: number, clientY: number, w: number, h: number): PlacementResult | null {
    // Anchor matrix may have been updated since the last render. Refresh
    // matrixWorld for the anchor subtree before raycasting, otherwise hits
    // resolve against the previous frame's pose.
    this.anchor.updateMatrixWorld(true);
    this.ndc.set((clientX / w) * 2 - 1, -((clientY / h) * 2 - 1));
    this.raycaster.setFromCamera(this.ndc, this.camera);

    const objects: Mesh[] = [];
    for (const o of this.reef.all()) if ((o as Mesh).isMesh) objects.push(o as Mesh);
    const hit = this.raycaster.intersectObjects(objects, true)[0];

    let worldPoint: Vector3;
    let worldNormal: Vector3;
    if (hit?.face) {
      worldPoint = hit.point.clone();
      worldNormal = hit.face.normal.clone()
        .transformDirection(hit.object.matrixWorld).normalize();
    } else {
      const anchorPlane = pedestalPlane.clone().applyMatrix4(this.anchor.matrixWorld);
      const p = new Vector3();
      if (!this.raycaster.ray.intersectPlane(anchorPlane, p)) return null;
      worldPoint = p;
      worldNormal = new Vector3(0, 1, 0).transformDirection(this.anchor.matrixWorld).normalize();
    }

    this.invAnchor.copy(this.anchor.matrixWorld).invert();
    const localPoint = worldPoint.clone().applyMatrix4(this.invAnchor);
    const nudged = this.reef.densityNudge(localPoint, 0.04);
    const localNormal = worldNormal.clone().transformDirection(this.invAnchor).normalize();
    const orientation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), localNormal);

    this.lastResult = { position: nudged, normal: localNormal, orientation, scale: 1 };
    return this.lastResult;
  }

  showGhost(species: Species, seed: number, colorKey: string): void {
    this.clearGhost();
    const gen = generatePolyp({ species, seed, colorKey });
    const m = polypMesh(gen.mesh);
    const mat = m.material as MeshStandardMaterial;
    mat.transparent = true;
    mat.opacity = 0.55;
    mat.depthWrite = false;
    this.ghost = m;
    this.anchor.add(m);
    this.updateGhostTransform();
  }

  updateGhost(species: Species, seed: number, colorKey: string): void {
    this.showGhost(species, seed, colorKey);
  }

  // Compose a gesture frame onto the current placement. Rotation is applied
  // around the anchor-local +Y axis (which the base orientation already
  // aligned to the surface normal), so twisting feels like spinning the
  // polyp on the pedestal. Scale multiplies and clamps to a visible range.
  applyGesture(frame: GestureFrame): void {
    if (!this.lastResult) return;
    const twist = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), frame.rotateRadians);
    // Quaternion.multiply does not auto-normalize. Without this, 60+ calls/sec
    // during a long twist accumulate float drift — the quaternion magnitude
    // wanders from 1 and both rotation and scale read from orientation start
    // to skew visibly.
    this.lastResult.orientation.multiply(twist).normalize();
    const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.lastResult.scale * frame.scaleFactor));
    this.lastResult.scale = nextScale;
    this.updateGhostTransform();
  }

  private updateGhostTransform(): void {
    if (!this.ghost || !this.lastResult) return;
    this.ghost.position.copy(this.lastResult.position);
    this.ghost.quaternion.copy(this.lastResult.orientation);
    this.ghost.scale.setScalar(this.lastResult.scale);
  }

  clearGhost(): void {
    if (!this.ghost) return;
    this.anchor.remove(this.ghost);
    disposeTree(this.ghost);
    this.ghost = null;
  }

  reset(): void {
    this.clearGhost();
    this.lastResult = null;
  }
}
