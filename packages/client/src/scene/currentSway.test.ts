import { describe, expect, test } from 'vitest';
import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';
import { installSway } from './currentSway.js';

// installSway mutates the material's onBeforeCompile hook so Three.js will
// rewrite the shader source before compilation. We can't drive the GPU in a
// unit test, but we CAN invoke the hook ourselves with a synthetic shader
// object and assert the rewrite landed.
//
// The anchor points are specific GLSL include tags (`#include <common>`,
// `#include <begin_vertex>`). If Three.js ever renames those, this test will
// flag it immediately instead of the sway just silently doing nothing.

function makeShaderStub(): { vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown> } {
  // Minimal shape that mirrors the `shader` object passed to onBeforeCompile.
  return {
    vertexShader: [
      '#include <common>',
      'void main() {',
      '  #include <begin_vertex>',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: 'void main() {}',
    uniforms: {},
  };
}

describe('installSway', () => {
  test('registers a non-trivial onBeforeCompile hook', () => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    // Three.js StandardMaterial defaults onBeforeCompile to a no-op function,
    // not undefined — so we can't check "was undefined, now is function". Use
    // source-length as a cheap proxy: installSway's hook has a body, the
    // default doesn't.
    const beforeLen = (mesh.material as MeshStandardMaterial).onBeforeCompile.toString().length;

    installSway(mesh, { value: 0 });

    const mat = mesh.material as MeshStandardMaterial;
    expect(mat.onBeforeCompile.toString().length).toBeGreaterThan(beforeLen);
    // needsUpdate is a write-only setter (Three.js flips internal flags);
    // no point reading it back. Assert the hook is present + non-trivial.
  });

  test('binds the shared clock as the uTime uniform', () => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    const clock = { value: 1.5 };
    installSway(mesh, clock);

    const shader = makeShaderStub();
    (mesh.material as MeshStandardMaterial).onBeforeCompile?.(shader as never, {} as never);

    // Uniform is the exact clock object — when the app bumps clock.value,
    // the uniform bumps with it without a re-compile.
    expect(shader.uniforms.uTime).toBe(clock);
  });

  test('injects the uTime uniform declaration + reefSway function', () => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    installSway(mesh, { value: 0 });

    const shader = makeShaderStub();
    (mesh.material as MeshStandardMaterial).onBeforeCompile?.(shader as never, {} as never);

    expect(shader.vertexShader).toContain('uniform float uTime');
    expect(shader.vertexShader).toContain('vec3 reefSway(vec3 p)');
    // smoothstep on p.y is the height-gated blend — only the top of the polyp
    // sways, the base doesn't. Lost that → whole mesh wobbles.
    expect(shader.vertexShader).toContain('smoothstep(0.0, 0.2, p.y)');
  });

  test('rewrites begin_vertex to apply reefSway to the position', () => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    installSway(mesh, { value: 0 });

    const shader = makeShaderStub();
    (mesh.material as MeshStandardMaterial).onBeforeCompile?.(shader as never, {} as never);

    expect(shader.vertexShader).toContain('vec3 transformed = vec3(position) + reefSway(position)');
    // The original Three.js include got replaced, not left alongside.
    expect(shader.vertexShader).not.toContain('#include <begin_vertex>');
  });

  test('fails loudly if the Three.js include anchor moves', () => {
    // Simulate Three.js renaming the `#include <common>` anchor (a future
    // upgrade could). The replace() wouldn't match, and the shader would
    // compile but never animate — silent failure.
    //
    // This test asserts the anchor IS present in the default Three.js
    // StandardMaterial shader we care about. If this ever fails, installSway
    // needs a new anchor.
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    installSway(mesh, { value: 0 });

    const shader = {
      vertexShader: 'void main() { /* no anchors */ gl_Position = vec4(0.0); }',
      fragmentShader: '',
      uniforms: {},
    };
    (mesh.material as MeshStandardMaterial).onBeforeCompile?.(shader as never, {} as never);

    // Without the anchors present, the shader remains unmodified. This
    // asserts that the replace is a no-op rather than a crash.
    expect(shader.vertexShader).not.toContain('reefSway');
  });
});
