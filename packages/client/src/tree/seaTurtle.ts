import {
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three';

const DEFAULT_ORBIT_RADIUS = 0.3;
const DEFAULT_ORBIT_HEIGHT = 0.07;
const DEFAULT_ORBIT_PERIOD_SEC = 32;

const SHELL_RADIUS = 0.025;
const HEAD_RADIUS = 0.009;
const FLIPPER_LENGTH = 0.022;
const FLIPPER_WIDTH = 0.012;
const FLIPPER_THICKNESS = 0.003;

export interface SeaTurtleOrbitParams {
  orbitRadius?: number;
  orbitHeight?: number;
  orbitPeriodSec?: number;
  /** Starting offset in radians so multiple turtles don't stack. */
  phaseRad?: number;
  /** +1 clockwise (viewed from +Y), -1 counter-clockwise. */
  direction?: 1 | -1;
}

const SHELL_COLOR = 0x3d5a3a;
const SHELL_EMISSIVE = 0x2b4a5a;
const BELLY_COLOR = 0xb8a978;
const FLIPPER_COLOR = 0x354a35;

/**
 * Slow-cruising sea turtle. Domed oval shell + small head pokes forward,
 * four flippers paddle in alternating pairs. Orbits wide and low near
 * the pedestal, much slower than the shark.
 */
export class SeaTurtle {
  readonly group = new Group();
  private readonly frontLeftFlipper: Group;
  private readonly frontRightFlipper: Group;
  private readonly rearLeftFlipper: Group;
  private readonly rearRightFlipper: Group;
  private readonly orbitRadius: number;
  private readonly orbitHeight: number;
  private readonly orbitPeriodSec: number;
  private readonly phaseRad: number;
  private readonly direction: 1 | -1;

  constructor(params: SeaTurtleOrbitParams = {}) {
    this.orbitRadius = params.orbitRadius ?? DEFAULT_ORBIT_RADIUS;
    this.orbitHeight = params.orbitHeight ?? DEFAULT_ORBIT_HEIGHT;
    this.orbitPeriodSec = params.orbitPeriodSec ?? DEFAULT_ORBIT_PERIOD_SEC;
    this.phaseRad = params.phaseRad ?? 0;
    this.direction = params.direction ?? 1;

    // Shell: flattened, slightly elongated sphere. Forward points along -Z
    // so lookAt orients properly.
    const shellMat = new MeshStandardMaterial({
      color: SHELL_COLOR,
      emissive: SHELL_EMISSIVE,
      emissiveIntensity: 0.2,
      roughness: 0.75,
      metalness: 0.05,
    });
    const shellGeom = new SphereGeometry(SHELL_RADIUS, 20, 14);
    const shell = new Mesh(shellGeom, shellMat);
    shell.scale.set(1, 0.55, 1.15);
    this.group.add(shell);

    // Pale underside visible from below — a smaller flattened sphere tucked
    // just under the shell. Reads as a belly at grazing angles.
    const bellyMat = new MeshStandardMaterial({
      color: BELLY_COLOR,
      emissive: BELLY_COLOR,
      emissiveIntensity: 0.08,
      roughness: 0.8,
    });
    const belly = new Mesh(shellGeom, bellyMat);
    belly.scale.set(0.9, 0.35, 1.05);
    belly.position.y = -SHELL_RADIUS * 0.25;
    this.group.add(belly);

    // Head: sphere poking out front (-Z direction).
    const headMat = new MeshStandardMaterial({
      color: SHELL_COLOR,
      emissive: SHELL_EMISSIVE,
      emissiveIntensity: 0.15,
      roughness: 0.7,
    });
    const headGeom = new SphereGeometry(HEAD_RADIUS, 12, 10);
    const head = new Mesh(headGeom, headMat);
    head.position.set(0, -SHELL_RADIUS * 0.1, -SHELL_RADIUS * 1.1);
    head.scale.set(1, 0.9, 1.2);
    this.group.add(head);

    // Flippers: four flattened ellipsoid "paddles". Each flipper lives in
    // its own Group so the paddle can pivot from near the shell edge
    // during animation. Front flippers are larger + more active.
    const makeFlipper = (scaleX: number, emissive: number): Group => {
      const node = new Group();
      const flipperMat = new MeshStandardMaterial({
        color: FLIPPER_COLOR,
        emissive,
        emissiveIntensity: 0.15,
        roughness: 0.7,
      });
      const paddle = new Mesh(headGeom, flipperMat);
      // Extend along the flipper's +X axis, flatten vertically, narrow
      // front-to-back. Translate so the root of the paddle sits at the
      // group's origin (which becomes the shoulder pivot).
      paddle.scale.set(
        FLIPPER_LENGTH / (HEAD_RADIUS * 2) * scaleX,
        FLIPPER_THICKNESS / (HEAD_RADIUS * 2),
        FLIPPER_WIDTH / (HEAD_RADIUS * 2),
      );
      paddle.position.x = (FLIPPER_LENGTH * scaleX) / 2;
      node.add(paddle);
      return node;
    };

    // Front-left: pivot at left side of shell, fore position.
    this.frontLeftFlipper = makeFlipper(1.0, SHELL_EMISSIVE);
    this.frontLeftFlipper.position.set(-SHELL_RADIUS * 0.85, -SHELL_RADIUS * 0.15, -SHELL_RADIUS * 0.45);
    this.frontLeftFlipper.rotation.y = 0.25; // slight forward sweep
    this.group.add(this.frontLeftFlipper);

    // Front-right: mirror of front-left.
    this.frontRightFlipper = makeFlipper(1.0, SHELL_EMISSIVE);
    this.frontRightFlipper.position.set(SHELL_RADIUS * 0.85, -SHELL_RADIUS * 0.15, -SHELL_RADIUS * 0.45);
    this.frontRightFlipper.rotation.y = Math.PI - 0.25;
    this.group.add(this.frontRightFlipper);

    // Rear-left: smaller, positioned back.
    this.rearLeftFlipper = makeFlipper(0.65, SHELL_EMISSIVE);
    this.rearLeftFlipper.position.set(-SHELL_RADIUS * 0.7, -SHELL_RADIUS * 0.18, SHELL_RADIUS * 0.7);
    this.rearLeftFlipper.rotation.y = -0.3;
    this.group.add(this.rearLeftFlipper);

    // Rear-right: mirror of rear-left.
    this.rearRightFlipper = makeFlipper(0.65, SHELL_EMISSIVE);
    this.rearRightFlipper.position.set(SHELL_RADIUS * 0.7, -SHELL_RADIUS * 0.18, SHELL_RADIUS * 0.7);
    this.rearRightFlipper.rotation.y = Math.PI + 0.3;
    this.group.add(this.rearRightFlipper);
  }

  update(clockSec: number): void {
    const angle =
      this.direction * (clockSec / this.orbitPeriodSec) * Math.PI * 2 + this.phaseRad;
    const x = Math.cos(angle) * this.orbitRadius;
    const z = Math.sin(angle) * this.orbitRadius;
    this.group.position.set(x, this.orbitHeight, z);

    // Face direction of travel.
    const tangent = new Vector3(
      -Math.sin(angle) * this.direction,
      0,
      Math.cos(angle) * this.direction,
    );
    this.group.lookAt(this.group.position.clone().add(tangent));

    // Flipper stroke: slow sinuous paddle. Front pair dominant, rear pair
    // smaller counter-movement for realism. Rotation around local Z tilts
    // the flipper up (out of the horizontal plane) and back down.
    const stroke = Math.sin(clockSec * 1.1) * 0.4;
    this.frontLeftFlipper.rotation.z = stroke;
    this.frontRightFlipper.rotation.z = -stroke;
    const rearStroke = Math.sin(clockSec * 1.1 + Math.PI / 3) * 0.18;
    this.rearLeftFlipper.rotation.z = rearStroke;
    this.rearRightFlipper.rotation.z = -rearStroke;
  }
}
