import { Vector3 } from 'three';

// Slow enough that the viewer perceives motion as ambient, not animated.
// 60s per full revolution feels right for a museum screen next to a pedestal.
export const AUTO_ORBIT_PERIOD_SEC = 60;
export const AUTO_ORBIT_RADIUS = 0.45;   // 45 cm from origin
export const AUTO_ORBIT_HEIGHT = 0.20;   // 20 cm above the reef floor

export interface OrbitPose {
  position: Vector3;
  target: Vector3;
}

/**
 * Pure math for the screen-mode auto-orbit camera. Given a time in seconds,
 * returns a camera position orbiting the reef at a fixed height, plus a
 * target at the origin.
 */
export function computeOrbitPose(clockSec: number): OrbitPose {
  const omega = (2 * Math.PI) / AUTO_ORBIT_PERIOD_SEC;
  const theta = clockSec * omega;
  return {
    position: new Vector3(
      Math.cos(theta) * AUTO_ORBIT_RADIUS,
      AUTO_ORBIT_HEIGHT,
      Math.sin(theta) * AUTO_ORBIT_RADIUS,
    ),
    target: new Vector3(0, 0, 0),
  };
}

export interface CinematicOptions {
  /** prefers-reduced-motion: half-speed orbit, no drift. */
  reducedMotion?: boolean;
}

const TAU = 2 * Math.PI;

/**
 * Gallery-display camera: the base orbit plus slow "idle drift" so a wall
 * display doesn't loop visibly every minute. Radius, height, orbit speed and
 * look-at height each wander on their own long, mutually prime periods
 * (29-97 s), so the combined path takes hours to repeat. Speed variation is
 * small enough that the orbit never stalls or reverses. Pure and
 * deterministic in `clockSec`, like computeOrbitPose.
 */
export function computeCinematicPose(clockSec: number, opts: CinematicOptions = {}): OrbitPose {
  const omega = TAU / AUTO_ORBIT_PERIOD_SEC;
  if (opts.reducedMotion) {
    const theta = clockSec * omega * 0.5;
    return {
      position: new Vector3(
        Math.cos(theta) * AUTO_ORBIT_RADIUS,
        AUTO_ORBIT_HEIGHT,
        Math.sin(theta) * AUTO_ORBIT_RADIUS,
      ),
      target: new Vector3(0, 0.02, 0),
    };
  }
  const t = clockSec;
  const theta = t * omega + 0.35 * Math.sin((TAU * t) / 97);
  const radius = AUTO_ORBIT_RADIUS * (1 + 0.12 * Math.sin((TAU * t) / 47 + 1.1));
  const height = AUTO_ORBIT_HEIGHT
    + 0.05 * Math.sin((TAU * t) / 71)
    + 0.02 * Math.sin((TAU * t) / 29 + 0.7);
  return {
    position: new Vector3(Math.cos(theta) * radius, height, Math.sin(theta) * radius),
    target: new Vector3(0, 0.02 + 0.015 * Math.sin((TAU * t) / 53), 0),
  };
}
