import { describe, expect, test } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import type { SimDelta } from '@reef/shared';
import { applySimDecoration } from './simDecor.js';

function fakePolyp(color = 0xcc4477): Mesh {
  const geom = new SphereGeometry(0.1, 8, 6);
  const mat = new MeshStandardMaterial({ color, roughness: 0.7 });
  return new Mesh(geom, mat);
}

function delta(kind: 'barnacle' | 'algae' | 'weather', params: Record<string, number> = {}): SimDelta {
  return { polypId: 1, kind, params, createdAt: Date.now() };
}

describe('applySimDecoration — barnacle', () => {
  test('adds a child mesh marked with userData.sim', () => {
    const polyp = fakePolyp();
    applySimDecoration(polyp, delta('barnacle', { size: 0.5, u: 0.3, v: 0.6 }));

    expect(polyp.children).toHaveLength(1);
    const barnacle = polyp.children[0] as Mesh;
    expect(barnacle.isMesh).toBe(true);
    expect(barnacle.userData.sim).toBe(true);
  });

  test('position is bounded to the polyp surface (|xz| ≤ 0.06, y ≤ 0.04)', () => {
    // The placement math: r = 0.02 + v * 0.04, y = v * 0.04. Both capped at
    // v = 1. A bad refactor could let the barnacle drift into space.
    const polyp = fakePolyp();
    applySimDecoration(polyp, delta('barnacle', { u: 1, v: 1 }));

    const b = polyp.children[0]!;
    expect(Math.hypot(b.position.x, b.position.z)).toBeLessThanOrEqual(0.061);
    expect(b.position.y).toBeLessThanOrEqual(0.041);
  });

  test('missing params fall back to sensible defaults without throwing', () => {
    // NaN / undefined / non-number values should be replaced per the num()
    // helper, not render as NaN on the mesh.
    const polyp = fakePolyp();
    applySimDecoration(polyp, delta('barnacle', {}));

    const b = polyp.children[0]!;
    expect(Number.isFinite(b.position.x)).toBe(true);
    expect(Number.isFinite(b.position.y)).toBe(true);
    expect(Number.isFinite(b.position.z)).toBe(true);
  });
});

describe('applySimDecoration — algae', () => {
  test('lerps the material color toward green-ish', () => {
    const polyp = fakePolyp(0xff0000); // start bright red
    const before = (polyp.material as MeshStandardMaterial).color.clone();

    applySimDecoration(polyp, delta('algae'));

    const after = (polyp.material as MeshStandardMaterial).color;
    // Green channel grew, red dropped. Lerp toward 0x4a6b2f at 0.15.
    expect(after.g).toBeGreaterThan(before.g);
    expect(after.r).toBeLessThan(before.r);
  });

  test('does not add child meshes (no geometry change)', () => {
    const polyp = fakePolyp();
    applySimDecoration(polyp, delta('algae'));
    expect(polyp.children).toHaveLength(0);
  });
});

describe('applySimDecoration — weather', () => {
  test('reduces color saturation', () => {
    const polyp = fakePolyp(0xff4477); // saturated pink
    const hslBefore = { h: 0, s: 0, l: 0 };
    (polyp.material as MeshStandardMaterial).color.getHSL(hslBefore);

    applySimDecoration(polyp, delta('weather'));

    const hslAfter = { h: 0, s: 0, l: 0 };
    (polyp.material as MeshStandardMaterial).color.getHSL(hslAfter);
    // s scaled by 0.8
    expect(hslAfter.s).toBeLessThan(hslBefore.s);
    expect(hslAfter.s).toBeCloseTo(hslBefore.s * 0.8, 5);
    // hue + lightness untouched
    expect(hslAfter.h).toBeCloseTo(hslBefore.h, 5);
    expect(hslAfter.l).toBeCloseTo(hslBefore.l, 5);
  });
});

describe('applySimDecoration — non-mesh target', () => {
  test('silently no-ops on a non-Mesh Object3D for algae + weather paths', () => {
    // getMaterial() returns undefined for a Group, so the color-mutating
    // branches skip. A future refactor that wraps polyps in a Group would
    // trip this silently; the test documents that that would be broken.
    const g = new Group();
    expect(() => applySimDecoration(g, delta('algae'))).not.toThrow();
    expect(() => applySimDecoration(g, delta('weather'))).not.toThrow();
  });
});
