import { describe, it, expect, vi } from 'vitest';
import type { Mesh } from 'three';
import { VisitorFish, VISITOR_FISH_SCALE } from './visitorFish.js';

const v = (id: string, x: number) => ({ id, p: [x, 1.4, 0] as [number, number, number], q: [0, 0, 0, 1] as [number, number, number, number] });

describe('VisitorFish', () => {
  it('adds one scaled fish per visitor and moves it to the interpolated pose', () => {
    const fish = new VisitorFish();
    fish.ingest([v('a', 0), v('b', 2)], 1000);
    fish.update(1000);
    expect(fish.count()).toBe(2);
    const a = fish.object3d.children[0]!;
    expect(a.scale.x).toBe(VISITOR_FISH_SCALE);
    fish.ingest([v('a', 1)], 1200);
    fish.update(1600); // render time 1200
    expect(a.position.x).toBeCloseTo(1);
  });

  it('removes and disposes a fish once its visitor goes stale', () => {
    const fish = new VisitorFish();
    fish.ingest([v('a', 0)], 1000);
    fish.update(1000);
    const meshes: Mesh[] = [];
    fish.object3d.traverse((o) => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });
    const spies = meshes.map((m) => vi.spyOn(m.geometry, 'dispose'));
    fish.update(3500);
    expect(fish.count()).toBe(0);
    expect(fish.object3d.children).toHaveLength(0);
    expect(spies.every((s) => s.mock.calls.length > 0)).toBe(true);
  });

  it('clear() drops every fish', () => {
    const fish = new VisitorFish();
    fish.ingest([v('a', 0), v('b', 1)], 1000);
    fish.update(1000);
    fish.clear();
    expect(fish.count()).toBe(0);
  });
});
