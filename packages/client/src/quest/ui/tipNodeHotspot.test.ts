import { describe, it, expect } from 'vitest';
import { Mesh, MeshBasicMaterial } from 'three';
import { createTipHotspot, setHotspotLit } from './tipNodeHotspot.js';

describe('tipNodeHotspot', () => {
  it('createTipHotspot returns a Mesh tagged with the supplied hotspotId', () => {
    const h = createTipHotspot(42);
    expect(h.userData.hotspotId).toBe(42);
    expect((h as Mesh).isMesh).toBe(true);
  });

  it('two hotspots with different ids share the same geometry instance', () => {
    // Shared geometry is intentional — many hotspots, identical sphere.
    const a = createTipHotspot(1);
    const b = createTipHotspot(2);
    expect(a.geometry).toBe(b.geometry);
  });

  it('setHotspotLit swaps the material to the lit variant', () => {
    const h = createTipHotspot(7);
    const initial = h.material as MeshBasicMaterial;
    setHotspotLit(h, true);
    expect(h.material).not.toBe(initial);
    setHotspotLit(h, false);
    expect(h.material).toBe(initial);
  });

  it('setHotspotLit is a no-op on a non-Mesh Object3D', () => {
    // Pass a Mesh wrapped as Object3D via fake — just verifies we do not
    // throw on objects that lack the isMesh discriminant.
    const fake = { isMesh: false } as unknown as Mesh;
    expect(() => setHotspotLit(fake, true)).not.toThrow();
  });
});
