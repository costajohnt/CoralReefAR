import { describe, expect, test } from 'vitest';
import { Color, MeshStandardMaterial } from 'three';
import { applyTreeMaterial } from './material.js';

describe('applyTreeMaterial', () => {
  test('sets a slight translucency (Avatar wet-emissive aesthetic)', () => {
    const m = new MeshStandardMaterial();
    applyTreeMaterial(m, '#ff1ad9');
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBeGreaterThan(0.6);
    expect(m.opacity).toBeLessThan(0.95);
  });

  test('emissive is set to the provided palette hex (not the default white)', () => {
    const m = new MeshStandardMaterial();
    applyTreeMaterial(m, '#2dffe4');
    const expected = new Color('#2dffe4');
    expect(m.emissive.r).toBeCloseTo(expected.r, 5);
    expect(m.emissive.g).toBeCloseTo(expected.g, 5);
    expect(m.emissive.b).toBeCloseTo(expected.b, 5);
  });

  test('vertexColors remain enabled (piece color is per-vertex)', () => {
    const m = new MeshStandardMaterial({ vertexColors: true });
    applyTreeMaterial(m, '#ff1ad9');
    expect(m.vertexColors).toBe(true);
  });

  test('different palette hexes produce different emissive colors', () => {
    const a = new MeshStandardMaterial();
    const b = new MeshStandardMaterial();
    applyTreeMaterial(a, '#ff1ad9'); // magenta
    applyTreeMaterial(b, '#b0ff3a'); // lime
    expect(a.emissive.getHex()).not.toBe(b.emissive.getHex());
  });
});
