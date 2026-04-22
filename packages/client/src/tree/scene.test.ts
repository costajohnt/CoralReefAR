import { describe, expect, test } from 'vitest';
import { Mesh } from 'three';
import { createTreePedestal } from './scene.js';

// createBloomComposer requires a live WebGLRenderer which happy-dom cannot
// provide (no WebGL context). Only createTreePedestal is exercised here.

describe('createTreePedestal', () => {
  test('returns a Mesh with non-null geometry and material', () => {
    const mesh = createTreePedestal();
    expect(mesh).toBeInstanceOf(Mesh);
    expect(mesh.geometry).not.toBeNull();
    expect(mesh.material).not.toBeNull();
  });

  test('pedestal sits below world origin (position.y is negative)', () => {
    const mesh = createTreePedestal();
    expect(mesh.position.y).toBeLessThan(0);
  });
});
