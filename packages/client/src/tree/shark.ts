import {
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { createFin } from './fishParts.js';

const DEFAULT_ORBIT_RADIUS = 0.32;
const DEFAULT_ORBIT_HEIGHT = 0.14;
const DEFAULT_ORBIT_PERIOD_SEC = 18;

const BODY_RADIUS = 0.012;
const BODY_LENGTH = 0.075;

export interface SharkOrbitParams {
  orbitRadius?: number;
  orbitHeight?: number;
  orbitPeriodSec?: number;
  /** Starting offset in radians so multiple sharks don't stack. */
  phaseRad?: number;
  /** +1 clockwise (viewed from +Y), -1 counter-clockwise. */
  direction?: 1 | -1;
}

const BODY_COLOR = 0x1a2837;
const BELLY_COLOR = 0xc8d4df;
const EMISSIVE = 0x3a6b8c;

/**
 * A lone shark cruising slowly around the tree. Elongated tapered body with
 * dorsal + pectoral + caudal fins, and a subtle tail wag in sync with its
 * swim cadence.
 */
export class Shark {
  readonly group = new Group();
  private readonly tailNode: Group;
  private readonly orbitRadius: number;
  private readonly orbitHeight: number;
  private readonly orbitPeriodSec: number;
  private readonly phaseRad: number;
  private readonly direction: 1 | -1;

  constructor(params: SharkOrbitParams = {}) {
    this.orbitRadius = params.orbitRadius ?? DEFAULT_ORBIT_RADIUS;
    this.orbitHeight = params.orbitHeight ?? DEFAULT_ORBIT_HEIGHT;
    this.orbitPeriodSec = params.orbitPeriodSec ?? DEFAULT_ORBIT_PERIOD_SEC;
    this.phaseRad = params.phaseRad ?? 0;
    this.direction = params.direction ?? 1;
    const bodyMat = new MeshStandardMaterial({
      color: BODY_COLOR,
      emissive: EMISSIVE,
      emissiveIntensity: 0.32,
      roughness: 0.65,
      metalness: 0.1,
    });

    // Body: stretched sphere along local -Z so lookAt orients the snout
    // forward. Keeping it as a single primitive keeps the silhouette
    // recognizable from distance without tanking perf.
    const bodyGeom = new SphereGeometry(BODY_RADIUS, 20, 14);
    const body = new Mesh(bodyGeom, bodyMat);
    body.scale.set(1, 0.8, BODY_LENGTH / (BODY_RADIUS * 2));
    this.group.add(body);

    // Lighter belly: a smaller sphere tucked under the body to read as a
    // pale underside.
    const bellyMat = new MeshStandardMaterial({
      color: BELLY_COLOR,
      emissive: BELLY_COLOR,
      emissiveIntensity: 0.12,
      roughness: 0.7,
    });
    const belly = new Mesh(bodyGeom, bellyMat);
    belly.scale.set(0.85, 0.45, (BODY_LENGTH / (BODY_RADIUS * 2)) * 0.95);
    belly.position.y = -BODY_RADIUS * 0.35;
    this.group.add(belly);

    // Dorsal fin (top, behind center).
    const dorsal = createFin({
      width: BODY_RADIUS * 1.4,
      height: BODY_RADIUS * 2.2,
      color: BODY_COLOR,
      emissive: EMISSIVE,
      emissiveIntensity: 0.2,
      sweepBack: 0.35,
    });
    // Stand fin vertical, width along local Z (body axis), normal along X.
    dorsal.rotation.set(0, Math.PI / 2, 0);
    dorsal.position.set(0, BODY_RADIUS * 0.75, BODY_LENGTH * 0.05);
    this.group.add(dorsal);

    // Pectoral fins (sides, swept back).
    for (const side of [-1, 1] as const) {
      const pec = createFin({
        width: BODY_RADIUS * 1.3,
        height: BODY_RADIUS * 1.6,
        color: BODY_COLOR,
        emissive: EMISSIVE,
        emissiveIntensity: 0.15,
        sweepBack: 0.5,
      });
      // Horizontal, sticking out laterally. Rotated so fin is in XZ plane with
      // apex pointing outward along +X; then flip for each side.
      pec.rotation.set(Math.PI / 2, 0, side === 1 ? 0 : Math.PI);
      pec.position.set(side * BODY_RADIUS * 0.55, -BODY_RADIUS * 0.15, -BODY_LENGTH * 0.12);
      this.group.add(pec);
    }

    // Caudal (tail) fin: wrapped in a node so we can wag it without moving
    // the body. Shark tail is heterocercal — upper lobe larger than lower —
    // approximated here with a single tall triangle skewed upward.
    this.tailNode = new Group();
    this.tailNode.position.z = BODY_LENGTH * 0.45;
    const tail = createFin({
      width: BODY_RADIUS * 1.1,
      height: BODY_RADIUS * 2.6,
      color: BODY_COLOR,
      emissive: EMISSIVE,
      emissiveIntensity: 0.22,
      sweepBack: 0.6, // apex skewed back → shark-like slant
    });
    tail.rotation.set(0, Math.PI / 2, 0);
    tail.position.set(0, -BODY_RADIUS * 0.25, 0);
    this.tailNode.add(tail);
    this.group.add(this.tailNode);
  }

  update(clockSec: number): void {
    const angle =
      this.direction * (clockSec / this.orbitPeriodSec) * Math.PI * 2 + this.phaseRad;
    const x = Math.cos(angle) * this.orbitRadius;
    const z = Math.sin(angle) * this.orbitRadius;
    this.group.position.set(x, this.orbitHeight, z);
    // Tangent of motion at the current angle, sign depends on orbit direction.
    const tangent = new Vector3(
      -Math.sin(angle) * this.direction,
      0,
      Math.cos(angle) * this.direction,
    );
    this.group.lookAt(this.group.position.clone().add(tangent));

    // Tail wag — slow sinuous sway, just a few degrees either side.
    this.tailNode.rotation.y = Math.sin(clockSec * 3.2) * 0.22;
  }
}
