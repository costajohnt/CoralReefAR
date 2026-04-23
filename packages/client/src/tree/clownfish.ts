import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { createFin } from './fishParts.js';

const DEFAULT_ORBIT_RADIUS = 0.22;
const DEFAULT_ORBIT_HEIGHT = 0.1;
const DEFAULT_ORBIT_PERIOD_SEC = 7;

const BODY_RADIUS = 0.007;
const BODY_LENGTH = 0.028;

export interface ClownfishOrbitParams {
  orbitRadius?: number;
  orbitHeight?: number;
  orbitPeriodSec?: number;
  phaseRad?: number;
  /** +1 clockwise (viewed from +Y), -1 counter-clockwise. Defaults to -1. */
  direction?: 1 | -1;
}

const BODY_COLOR = 0xff7028;   // saturated orange
const STRIPE_COLOR = 0xffffff; // white bands
const FIN_COLOR = 0x1a1a1a;    // near-black fin edges (real clownfish)

/**
 * A single bright clownfish with a tapered body, three white stripe rings,
 * a forked caudal fin, a dorsal fin, and a tail-wag animation. Orbits
 * opposite the shark at a tighter radius.
 */
export class Clownfish {
  readonly group = new Group();
  private readonly tailNode: Group;
  private readonly orbitRadius: number;
  private readonly orbitHeight: number;
  private readonly orbitPeriodSec: number;
  private readonly phaseRad: number;
  private readonly direction: 1 | -1;

  constructor(params: ClownfishOrbitParams = {}) {
    this.orbitRadius = params.orbitRadius ?? DEFAULT_ORBIT_RADIUS;
    this.orbitHeight = params.orbitHeight ?? DEFAULT_ORBIT_HEIGHT;
    this.orbitPeriodSec = params.orbitPeriodSec ?? DEFAULT_ORBIT_PERIOD_SEC;
    this.phaseRad = params.phaseRad ?? 0;
    this.direction = params.direction ?? -1;
    // Body: orange elongated sphere, slight taper via Y scale < 1.
    const bodyGeom = new SphereGeometry(BODY_RADIUS, 18, 12);
    const bodyMat = new MeshStandardMaterial({
      color: BODY_COLOR,
      emissive: 0xff5a18,
      emissiveIntensity: 0.38,
      roughness: 0.5,
    });
    const body = new Mesh(bodyGeom, bodyMat);
    body.scale.set(1, 0.92, BODY_LENGTH / (BODY_RADIUS * 2));
    this.group.add(body);

    // White stripe rings (classic clownfish three-band pattern).
    const stripeMat = new MeshStandardMaterial({
      color: STRIPE_COLOR,
      emissive: STRIPE_COLOR,
      emissiveIntensity: 0.42,
      roughness: 0.5,
    });
    const stripeGeom = new CylinderGeometry(
      BODY_RADIUS * 1.02,
      BODY_RADIUS * 1.02,
      BODY_RADIUS * 0.38,
      14,
    );
    stripeGeom.rotateX(Math.PI / 2);
    for (const frac of [-0.3, 0.0, 0.35]) {
      const stripe = new Mesh(stripeGeom, stripeMat);
      stripe.position.z = BODY_LENGTH * frac;
      this.group.add(stripe);
    }

    // Dorsal fin (short, rounded on the triangle's apex).
    const dorsal = createFin({
      width: BODY_RADIUS * 1.1,
      height: BODY_RADIUS * 1.0,
      color: BODY_COLOR,
      emissive: FIN_COLOR,
      emissiveIntensity: 0.1,
      sweepBack: 0.4,
    });
    dorsal.rotation.set(0, Math.PI / 2, 0);
    dorsal.position.set(0, BODY_RADIUS * 0.85, -BODY_LENGTH * 0.05);
    this.group.add(dorsal);

    // Pectoral fins (tiny, on sides).
    for (const side of [-1, 1] as const) {
      const pec = createFin({
        width: BODY_RADIUS * 0.6,
        height: BODY_RADIUS * 0.9,
        color: BODY_COLOR,
        emissive: FIN_COLOR,
        emissiveIntensity: 0.1,
        sweepBack: 0.35,
      });
      pec.rotation.set(Math.PI / 2, 0, side === 1 ? 0 : Math.PI);
      pec.position.set(side * BODY_RADIUS * 0.7, -BODY_RADIUS * 0.1, -BODY_LENGTH * 0.1);
      this.group.add(pec);
    }

    // Caudal (tail) fin: forked like a real clownfish. Built from two
    // triangles that share a base to simulate the V-shape.
    this.tailNode = new Group();
    this.tailNode.position.z = BODY_LENGTH * 0.5;
    for (const yDir of [1, -1] as const) {
      const lobe = createFin({
        width: BODY_RADIUS * 0.9,
        height: BODY_RADIUS * 1.3,
        color: BODY_COLOR,
        emissive: FIN_COLOR,
        emissiveIntensity: 0.1,
        sweepBack: 0.55,
      });
      lobe.rotation.set(0, Math.PI / 2, yDir === 1 ? 0 : Math.PI);
      lobe.position.set(0, yDir * BODY_RADIUS * 0.25, 0);
      this.tailNode.add(lobe);
    }
    this.group.add(this.tailNode);
  }

  update(clockSec: number): void {
    const angle =
      this.direction * (clockSec / this.orbitPeriodSec) * Math.PI * 2 + this.phaseRad;
    const x = Math.cos(angle) * this.orbitRadius;
    const z = Math.sin(angle) * this.orbitRadius;
    const yBob = Math.sin(clockSec * 1.7 + this.phaseRad) * 0.012;
    this.group.position.set(x, this.orbitHeight + yBob, z);

    const ahead =
      this.direction * ((clockSec + 0.05) / this.orbitPeriodSec) * Math.PI * 2 +
      this.phaseRad;
    const lookTarget = new Vector3(
      Math.cos(ahead) * this.orbitRadius,
      this.orbitHeight + yBob,
      Math.sin(ahead) * this.orbitRadius,
    );
    this.group.lookAt(lookTarget);

    // Faster, livelier tail wag than the shark.
    this.tailNode.rotation.y = Math.sin(clockSec * 6.5 + this.phaseRad) * 0.35;
  }
}
