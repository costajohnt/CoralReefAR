import { describe, expect, test } from 'vitest';
import { Mesh } from 'three';
import { Shark } from './shark.js';

describe('Shark', () => {
  test('constructs with body + belly + dorsal + 2 pectoral fins + tail node', () => {
    const s = new Shark();
    // body, belly, dorsal, left pectoral, right pectoral, tail node = 6 children.
    expect(s.group.children.length).toBe(6);
    // First child is a Mesh (the body).
    expect(s.group.children[0]).toBeInstanceOf(Mesh);
  });

  test('update(0) places the shark on the +X side of its orbit', () => {
    const s = new Shark();
    s.update(0);
    expect(s.group.position.x).toBeGreaterThan(0);
    expect(s.group.position.z).toBeCloseTo(0, 5);
  });

  test('orbit position is periodic — a full period returns to the start', () => {
    const s = new Shark();
    s.update(0);
    const start = s.group.position.clone();
    // Period is 18s (kept internal; large enough to be well outside landing
    // numerical error for this test).
    s.update(18);
    expect(s.group.position.x).toBeCloseTo(start.x, 4);
    expect(s.group.position.z).toBeCloseTo(start.z, 4);
  });

  test('update(t) moves the shark smoothly over time (not stuck)', () => {
    const s = new Shark();
    s.update(0);
    const a = s.group.position.clone();
    s.update(2);
    const b = s.group.position.clone();
    expect(a.distanceTo(b)).toBeGreaterThan(0.01);
  });
});
