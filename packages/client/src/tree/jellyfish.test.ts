import { describe, expect, test } from 'vitest';
import { Mesh } from 'three';
import { Jellyfish } from './jellyfish.js';

describe('Jellyfish', () => {
  test('constructs with a bell plus 7 tentacles (8 children total)', () => {
    const j = new Jellyfish();
    expect(j.group.children.length).toBe(8);
    expect(j.group.children[0]).toBeInstanceOf(Mesh);
  });

  test('update(0) places the jellyfish on the +X side of its orbit', () => {
    const j = new Jellyfish();
    j.update(0);
    expect(j.group.position.x).toBeGreaterThan(0);
    // z has a small phase term so allow a tiny tolerance
    expect(j.group.position.z).toBeCloseTo(0, 5);
  });

  test('orbit position is periodic — a full period returns to the start', () => {
    const j = new Jellyfish();
    j.update(0);
    const start = j.group.position.clone();
    // Default period is 24s; bob has period ~7s so this returns XZ exactly
    // but Y differs — only assert the orbit plane.
    j.update(24);
    expect(j.group.position.x).toBeCloseTo(start.x, 4);
    expect(j.group.position.z).toBeCloseTo(start.z, 4);
  });

  test('bell pulses (scale changes) over time', () => {
    const j = new Jellyfish();
    j.update(0);
    const startYScale = j.group.children[0]!.scale.y;
    j.update(1);
    const laterYScale = j.group.children[0]!.scale.y;
    expect(Math.abs(startYScale - laterYScale)).toBeGreaterThan(0.01);
  });
});
