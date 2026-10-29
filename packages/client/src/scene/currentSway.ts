import type { Mesh, MeshStandardMaterial } from 'three';

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
    shader.uniforms.uTime = clock;
    if (bleach) {
      shader.uniforms.uBleach = bleach;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         uniform float uBleach;`,
      );
      // After vertex colours are applied: pale towards bone white, keeping a
      // trace of luminance so shapes still read.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float bleachLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.93, 0.91, 0.86) * (0.75 + 0.25 * bleachLum), uBleach);`,
      );
    }
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uTime;
       vec3 reefSway(vec3 p) {
         float s = smoothstep(0.0, 0.2, p.y);
         float w = sin(uTime * 1.3 + p.x * 5.0) * 0.004
                 + sin(uTime * 0.8 + p.z * 7.0) * 0.003;
         return vec3(w * s, 0.0, w * s * 0.6);
       }`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `vec3 transformed = vec3(position) + reefSway(position);`,
    );
  };
  mat.needsUpdate = true;
}
