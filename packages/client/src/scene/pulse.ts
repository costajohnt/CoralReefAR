import type { Mesh, MeshStandardMaterial } from 'three';

// Slow breathing. ±AMPLITUDE around BASELINE with a PERIOD_SEC cycle so the
// reef reads as alive without drawing attention away from the geometry.
export const BASELINE = 0.2;
export const AMPLITUDE = 0.15;
export const PERIOD_SEC = 4;

/**
 * Pure emissive-intensity sample for a polyp at a given clock time. Exported
 * so the pulse math can be unit-tested without a Three.js renderer.
 */
export function pulseIntensity(clockSec: number, seed: number): number {
  const phase = ((seed >>> 0) / 0xffffffff) * Math.PI * 2;
  const omega = (2 * Math.PI) / PERIOD_SEC;
  return BASELINE + AMPLITUDE * Math.sin(clockSec * omega + phase);
}

/**
 * Binds emissiveIntensity to a shared clock so each polyp pulses on its own
 * phase (derived from its seed). Assumes the mesh's material is a
 * MeshStandardMaterial (what polypMesh produces).
 */
export function installPulse(mesh: Mesh, clock: { value: number }, seed: number): void {
  const mat = mesh.material as MeshStandardMaterial;
  mesh.onBeforeRender = (): void => {
    mat.emissiveIntensity = pulseIntensity(clock.value, seed);
  };
}
