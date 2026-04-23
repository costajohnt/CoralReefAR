import type { Mesh, MeshStandardMaterial } from 'three';

// Tree-mode bioluminescent pulse: higher baseline + larger amplitude than the
// landscape pulse so the Avatar-style glow reads as clearly alive under the
// bloom pass. Each piece phase-shifts off its own seed so a cluster looks
// organic instead of synchronized.
export const TREE_BASELINE = 0.4;
export const TREE_AMPLITUDE = 0.2;
export const TREE_PERIOD_SEC = 3;

export function treePulseIntensity(clockSec: number, seed: number): number {
  const phase = ((seed >>> 0) / 0xffffffff) * Math.PI * 2;
  const omega = (2 * Math.PI) / TREE_PERIOD_SEC;
  return TREE_BASELINE + TREE_AMPLITUDE * Math.sin(clockSec * omega + phase);
}

export function installTreePulse(mesh: Mesh, clock: { value: number }, seed: number): void {
  const mat = mesh.material as MeshStandardMaterial;
  mesh.onBeforeRender = (): void => {
    mat.emissiveIntensity = treePulseIntensity(clock.value, seed);
  };
}
