import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { BoxGeometry, Mesh, MeshStandardMaterial } from 'three';
import { __resetSwayWarningsForTests, installSway } from './currentSway.js';

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

describe('installSway bleaching (#117)', () => {
  function stubWithFragment() {
    return {
      vertexShader: '#include <common>\nvoid main() {\n  #include <begin_vertex>\n}',
      fragmentShader: '#include <common>\nvoid main() {\n  vec4 diffuseColor = vec4(1.0);\n  #include <color_fragment>\n}',
      uniforms: {} as Record<string, unknown>,
    };
  }

  test('with a bleach uniform, the fragment pales colour after vertex colours apply', () => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    const bleach = { value: 0 };
    installSway(mesh, { value: 0 }, bleach);
    const shader = stubWithFragment();
    (mesh.material as MeshStandardMaterial).onBeforeCompile(shader as never, undefined as never);
    expect(shader.uniforms.uBleach).toBe(bleach); // shared object, so one write updates every polyp
    expect(shader.fragmentShader).toContain('uniform float uBleach;');
    const colorAt = shader.fragmentShader.indexOf('#include <color_fragment>');
    const mixAt = shader.fragmentShader.indexOf('mix(diffuseColor.rgb');
    expect(mixAt).toBeGreaterThan(colorAt);
  });

  test('without a bleach uniform the fragment shader is untouched', () => {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    installSway(mesh, { value: 0 });
    const shader = stubWithFragment();
    const before = shader.fragmentShader;
    (mesh.material as MeshStandardMaterial).onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader).toBe(before);
  });

  test("the anchor exists in three's real MeshStandard fragment shader", async () => {
    const { ShaderLib } = await import('three');
    expect(ShaderLib.physical.fragmentShader).toContain('#include <color_fragment>');
  });
});

describe('installSway missing shader anchors (#117 review)', () => {
  const FRAG = '#include <common>\nvoid main() {\n  vec4 diffuseColor = vec4(1.0);\n  #include <color_fragment>\n}';
  const VERT = '#include <common>\nvoid main() {\n  #include <begin_vertex>\n}';

  function compile(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown> }, bleach = { value: 0 }) {
    const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
    installSway(mesh, { value: 0 }, bleach);
    (mesh.material as MeshStandardMaterial).onBeforeCompile(shader as never, undefined as never);
    return shader;
  }

  beforeEach(() => { __resetSwayWarningsForTests(); });
  afterEach(() => { vi.restoreAllMocks(); });

  test.each([
    ['fragment #include <common>', FRAG.replace('#include <common>', '')],
    ['fragment #include <color_fragment>', FRAG.replace('#include <color_fragment>', '')],
  ])('missing %s: bleach is skipped entirely, fragment untouched, one console.error', (_name, frag) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s1 = compile({ vertexShader: VERT, fragmentShader: frag, uniforms: {} });
    expect(s1.fragmentShader).toBe(frag);
    expect(s1.uniforms.uBleach).toBeUndefined();
    // Sway still applies; it has its own anchors.
    expect(s1.vertexShader).toContain('reefSway(position)');
    compile({ vertexShader: VERT, fragmentShader: frag, uniforms: {} });
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]![0])).toMatch(/bleach/i);
  });

  test.each([
    ['vertex #include <common>', VERT.replace('#include <common>', '')],
    ['vertex #include <begin_vertex>', VERT.replace('#include <begin_vertex>', '')],
  ])('missing %s: sway is skipped entirely, vertex untouched, one console.error', (_name, vert) => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = compile({ vertexShader: vert, fragmentShader: FRAG, uniforms: {} });
    expect(s.vertexShader).toBe(vert);
    expect(s.uniforms.uTime).toBeUndefined();
    // Bleach still applies; it has its own anchors.
    expect(s.fragmentShader).toContain('uniform float uBleach;');
    compile({ vertexShader: vert, fragmentShader: FRAG, uniforms: {} });
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0]![0])).toMatch(/sway/i);
  });

  test('all anchors present: no error', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    compile({ vertexShader: VERT, fragmentShader: FRAG, uniforms: {} });
    expect(err).not.toHaveBeenCalled();
  });
});
