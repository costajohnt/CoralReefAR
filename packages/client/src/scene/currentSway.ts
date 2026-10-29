import type { Mesh, MeshStandardMaterial } from 'three';

const SWAY_COMMON = `#include <common>
       uniform float uTime;
       vec3 reefSway(vec3 p) {
         float s = smoothstep(0.0, 0.2, p.y);
         float w = sin(uTime * 1.3 + p.x * 5.0) * 0.004
                 + sin(uTime * 0.8 + p.z * 7.0) * 0.003;
         return vec3(w * s, 0.0, w * s * 0.6);
       }`;
const SWAY_BEGIN = `vec3 transformed = vec3(position) + reefSway(position);`;

const BLEACH_COMMON = `#include <common>
         uniform float uBleach;`;
// After vertex colours are applied: pale towards bone white, keeping a trace
// of luminance so shapes still read.
const BLEACH_COLOR = `#include <color_fragment>
         float bleachLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.91, 0.86) * (0.75 + 0.25 * bleachLum), uBleach);`;

// One console.error per injection kind per page, not one per polyp material.
const warned = new Set<string>();

/** Test hook: forget which missing-anchor errors were already logged. */
export function __resetSwayWarningsForTests(): void {
  warned.clear();
}

/**
 * Apply every [anchor, replacement] pair to `src`, or none of them. A
 * half-applied patch (e.g. a uniform used but never declared) would stop the
 * material compiling, so if any anchor is missing (say three.js renamed an
 * include) the source comes back unchanged and the effect is skipped.
 */
function patchAll(src: string, edits: Array<[anchor: string, replacement: string]>, kind: string): string | null {
  let out = src;
  for (const [anchor, replacement] of edits) {
    const next = out.replace(anchor, replacement);
    if (next === out) {
      if (!warned.has(kind)) {
        warned.add(kind);
        console.error(`reef ${kind} shader patch skipped: anchor "${anchor}" not found in the three.js shader`);
      }
      return null;
    }
    out = next;
  }
  return out;
}

/**
 * Adds a gentle low-frequency sway to a MeshStandardMaterial via an
 * onBeforeCompile hook. Every polyp mesh gets the same shader, driven by a
 * shared uniform clock. The caller is responsible for ensuring this runs at
 * most once per material.
 */
export function installSway(
  mesh: Mesh,
  clock: { value: number },
  // Optional reef-wide bleaching (#117), 0..MAX_BLEACHING. Shared by every
  // polyp, so one write per frame grades the whole reef; no per-mesh work.
  bleach?: { value: number },
): void {
  const mat = mesh.material as MeshStandardMaterial;
  mat.onBeforeCompile = (shader) => {
    if (bleach) {
      const frag = patchAll(shader.fragmentShader, [
        ['#include <common>', BLEACH_COMMON],
        ['#include <color_fragment>', BLEACH_COLOR],
      ], 'bleach');
      if (frag !== null) {
        shader.fragmentShader = frag;
        shader.uniforms.uBleach = bleach;
      }
    }
    const vert = patchAll(shader.vertexShader, [
      ['#include <common>', SWAY_COMMON],
      ['#include <begin_vertex>', SWAY_BEGIN],
    ], 'sway');
    if (vert !== null) {
      shader.vertexShader = vert;
      shader.uniforms.uTime = clock;
    }
  };
  mat.needsUpdate = true;
}
