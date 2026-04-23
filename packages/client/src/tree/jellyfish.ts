import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';

const DEFAULT_ORBIT_RADIUS = 0.22;
const DEFAULT_ORBIT_HEIGHT = 0.2;
const DEFAULT_ORBIT_PERIOD_SEC = 24;

const BELL_RADIUS = 0.022;
const TENTACLE_COUNT = 7;
const TENTACLE_LENGTH = 0.055;
const TENTACLE_RADIUS = 0.0015;

export interface JellyfishOrbitParams {
  orbitRadius?: number;
  orbitHeight?: number;
  orbitPeriodSec?: number;
  /** Starting offset in radians so multiple jellies don't stack. */
  phaseRad?: number;
  /** +1 clockwise (viewed from +Y), -1 counter-clockwise. */
  direction?: 1 | -1;
}

const BELL_COLOR = 0xd6a6d9;
const BELL_EMISSIVE = 0x8c4fa4;
const TENTACLE_COLOR = 0xc994d1;

/**
 * Translucent bell-shaped jellyfish drifting slowly around the tree. The
 * bell squishes on a slow pulse while the tentacles sway with a phase
 * offset, giving a subtle breathing effect. Vertical bob on the orbit
 * layers a secondary motion on top of the circular path.
 */
export class Jellyfish {
  readonly group = new Group();
  private readonly bell: Mesh;
  private readonly tentacles: Mesh[] = [];
  private readonly orbitRadius: number;
  private readonly orbitHeight: number;
  private readonly orbitPeriodSec: number;
  private readonly phaseRad: number;
  private readonly direction: 1 | -1;

  constructor(params: JellyfishOrbitParams = {}) {
    this.orbitRadius = params.orbitRadius ?? DEFAULT_ORBIT_RADIUS;
    this.orbitHeight = params.orbitHeight ?? DEFAULT_ORBIT_HEIGHT;
    this.orbitPeriodSec = params.orbitPeriodSec ?? DEFAULT_ORBIT_PERIOD_SEC;
    this.phaseRad = params.phaseRad ?? 0;
    this.direction = params.direction ?? 1;

    // Bell: hemisphere (thetaLength = PI/2), translucent so the tentacles
    // show through faintly from behind.
    const bellGeom = new SphereGeometry(BELL_RADIUS, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const bellMat = new MeshStandardMaterial({
      color: BELL_COLOR,
      emissive: BELL_EMISSIVE,
      emissiveIntensity: 0.4,
      transparent: true,
      opacity: 0.55,
      roughness: 0.4,
      depthWrite: false,
    });
    this.bell = new Mesh(bellGeom, bellMat);
    this.group.add(this.bell);

    // Tentacles: thin cylinders splayed out around the rim. Each one lives
    // in its own Group so it can pivot from the bell rim during sway.
    const tentacleGeom = new CylinderGeometry(
      TENTACLE_RADIUS * 0.4, // narrower tip
      TENTACLE_RADIUS,       // wider at attach point
      TENTACLE_LENGTH,
      6,
    );
    // Translate geometry so the top sits at y=0 and the body hangs down.
    tentacleGeom.translate(0, -TENTACLE_LENGTH / 2, 0);
    const tentacleMat = new MeshStandardMaterial({
      color: TENTACLE_COLOR,
      emissive: BELL_EMISSIVE,
      emissiveIntensity: 0.18,
      transparent: true,
      opacity: 0.72,
      roughness: 0.6,
    });
    for (let i = 0; i < TENTACLE_COUNT; i++) {
      const t = new Mesh(tentacleGeom, tentacleMat);
      const angle = (i / TENTACLE_COUNT) * Math.PI * 2;
      const rimOffset = BELL_RADIUS * 0.75;
      t.position.set(Math.cos(angle) * rimOffset, 0, Math.sin(angle) * rimOffset);
      this.group.add(t);
      this.tentacles.push(t);
    }
  }

  update(clockSec: number): void {
    const angle =
      this.direction * (clockSec / this.orbitPeriodSec) * Math.PI * 2 + this.phaseRad;
    const x = Math.cos(angle) * this.orbitRadius;
    const z = Math.sin(angle) * this.orbitRadius;
    // Gentle vertical bob layered on top of the circular path — amplitude
    // is small so it reads as buoyancy rather than teleporting.
    const bob = Math.sin(clockSec * 0.9 + this.phaseRad) * 0.015;
    this.group.position.set(x, this.orbitHeight + bob, z);

    // Bell pulse: squish vertically while expanding horizontally slightly,
    // the classic jellyfish breath. Scale range 0.88–1.08 keeps it subtle.
    const pulse = Math.sin(clockSec * 1.8 + this.phaseRad) * 0.1;
    this.bell.scale.set(1 + pulse, 1 - pulse, 1 + pulse);

    // Tentacles sway with a phase offset per tentacle so they don't all
    // wave in unison. Rotation around local X/Z; amplitude small to keep
    // them hanging approximately downward.
    for (let i = 0; i < this.tentacles.length; i++) {
      const t = this.tentacles[i]!;
      const sway = clockSec * 1.3 + i * 0.8 + this.phaseRad;
      t.rotation.x = Math.sin(sway) * 0.18;
      t.rotation.z = Math.cos(sway * 0.7) * 0.14;
    }
  }
}
