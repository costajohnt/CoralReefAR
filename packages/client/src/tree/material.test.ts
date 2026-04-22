import { describe, expect, test } from 'vitest';
import { Color, MeshStandardMaterial } from 'three';
import { applyTreeMaterial } from './material.js';

describe('applyTreeMaterial', () => {
  test('sets opacity to 1 (fully opaque — Avatar aesthetic)', () => {
    const m = new MeshStandardMaterial({ color: 0xff00ff });
    applyTreeMaterial(m);
    expect(m.opacity).toBe(1);
    expect(m.transparent).toBe(false);
  });

  test('emissive matches the material color', () => {
    const m = new MeshStandardMaterial({ color: 0x2dffe4 });
    applyTreeMaterial(m);
    const expected = new Color(0x2dffe4);
    expect(m.emissive.r).toBeCloseTo(expected.r, 5);
    expect(m.emissive.g).toBeCloseTo(expected.g, 5);
    expect(m.emissive.b).toBeCloseTo(expected.b, 5);
  });

  test('emissive intensity is high enough to read as fluorescent', () => {
    const m = new MeshStandardMaterial();
    applyTreeMaterial(m);
    expect(m.emissiveIntensity).toBeGreaterThanOrEqual(0.9);
  });

  test('vertexColors remain enabled (piece color is per-vertex)', () => {
    const m = new MeshStandardMaterial({ vertexColors: true });
    applyTreeMaterial(m);
    expect(m.vertexColors).toBe(true);
  });
});
