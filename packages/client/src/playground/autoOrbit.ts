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
