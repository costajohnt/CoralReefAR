import { describe, it, expect, beforeEach } from 'vitest';
import type { PublicPolyp } from '@reef/shared';
import { HotspotLayer, getTipsCached, _resetTipCacheForTest } from './hotspotLayer.js';

function polyp(id: number, species: PublicPolyp['species']): PublicPolyp {
  return {
    id,
    species,
    seed: id * 17,
    colorKey: 'coral-pink',
    position: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    scale: 1,
    createdAt: Date.now(),
  };
}

describe('HotspotLayer', () => {
  beforeEach(() => _resetTipCacheForTest());

  it('starts empty', () => {
    const layer = new HotspotLayer();
    expect(layer.object3d.children).toHaveLength(0);
    expect(layer.hotspots()).toHaveLength(0);
  });

  it('adding a branching polyp creates 1-3 hotspot meshes', () => {
    const layer = new HotspotLayer();
    layer.addPolyp(polyp(1, 'branching'));
    const hs = layer.hotspots();
    expect(hs.length).toBeGreaterThanOrEqual(1);
    expect(hs.length).toBeLessThanOrEqual(3);
  });

  it('adding a bulbous polyp creates exactly 1 hotspot', () => {
    const layer = new HotspotLayer();
    layer.addPolyp(polyp(2, 'bulbous'));
    expect(layer.hotspots()).toHaveLength(1);
  });

  it('adding an encrusting polyp creates zero hotspots but still registers the polyp', () => {
    const layer = new HotspotLayer();
    layer.addPolyp(polyp(3, 'encrusting'));
    expect(layer.hotspots()).toHaveLength(0);
    // removePolyp on a registered (but empty) polyp must not throw.
    expect(() => layer.removePolyp(3)).not.toThrow();
  });

  it('add is idempotent — re-adding the same polyp does not duplicate', () => {
    const layer = new HotspotLayer();
    layer.addPolyp(polyp(4, 'bulbous'));
    layer.addPolyp(polyp(4, 'bulbous'));
    expect(layer.hotspots()).toHaveLength(1);
  });

  it('removePolyp drops all that polyp\'s hotspots', () => {
    const layer = new HotspotLayer();
    layer.addPolyp(polyp(5, 'branching'));
    const before = layer.hotspots().length;
    layer.removePolyp(5);
    const after = layer.hotspots().length;
    expect(after).toBe(0);
    expect(before).toBeGreaterThan(0);
  });

  it('clear drops every hotspot across polyps', () => {
    const layer = new HotspotLayer();
    layer.addPolyp(polyp(1, 'branching'));
    layer.addPolyp(polyp(2, 'bulbous'));
    layer.addPolyp(polyp(3, 'fan'));
    expect(layer.hotspots().length).toBeGreaterThan(0);
    layer.clear();
    expect(layer.hotspots()).toHaveLength(0);
  });

  it('encodeHotspotId / decodeHotspotId round-trips', () => {
    const id = HotspotLayer.encodeHotspotId(42, 2);
    const decoded = HotspotLayer.decodeHotspotId(id);
    expect(decoded).toEqual({ polypId: 42, tipIdx: 2 });
  });

  it('hotspotTransform resolves a live hotspot to a world pose', () => {
    const layer = new HotspotLayer();
    layer.addPolyp(polyp(7, 'bulbous'));
    const hs = layer.hotspots()[0]!;
    const id = hs.userData.hotspotId as number;
    layer.object3d.updateMatrixWorld(true);
    const transform = layer.hotspotTransform(id);
    expect(transform).not.toBeNull();
    expect(transform!.worldPosition.y).toBeGreaterThan(0);
  });

  it('hotspotTransform returns null for a since-removed hotspot', () => {
    const layer = new HotspotLayer();
    layer.addPolyp(polyp(8, 'bulbous'));
    const hs = layer.hotspots()[0]!;
    const id = hs.userData.hotspotId as number;
    layer.removePolyp(8);
    expect(layer.hotspotTransform(id)).toBeNull();
  });
});

describe('getTipsCached', () => {
  beforeEach(() => _resetTipCacheForTest());

  it('returns the same array reference on repeat calls with the same identity', () => {
    // Identity is (species, seed, colorKey) — id and other fields are ignored.
    const a = getTipsCached({ ...polyp(1, 'branching'), seed: 100 });
    const b = getTipsCached({ ...polyp(2, 'branching'), seed: 100 });
    expect(b).toBe(a);
  });

  it('returns distinct arrays for different seeds', () => {
    const a = getTipsCached({ ...polyp(1, 'branching'), seed: 100 });
    const b = getTipsCached({ ...polyp(1, 'branching'), seed: 200 });
    expect(b).not.toBe(a);
  });

  it('returns distinct arrays for different species', () => {
    const a = getTipsCached(polyp(1, 'branching'));
    const b = getTipsCached(polyp(1, 'bulbous'));
    expect(b).not.toBe(a);
  });

  it('encrusting yields an empty array (not undefined)', () => {
    const tips = getTipsCached(polyp(1, 'encrusting'));
    expect(tips).toEqual([]);
  });
});
