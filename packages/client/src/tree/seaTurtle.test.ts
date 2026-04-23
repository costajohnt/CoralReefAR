import { describe, expect, test } from 'vitest';
import { Mesh } from 'three';
import { SeaTurtle } from './seaTurtle.js';

describe('SeaTurtle', () => {
  test('constructs with shell + belly + head + 4 flipper groups (7 children)', () => {
    const t = new SeaTurtle();
    // shell, belly, head, front-left, front-right, rear-left, rear-right = 7.
    expect(t.group.children.length).toBe(7);
    expect(t.group.children[0]).toBeInstanceOf(Mesh);
  });

  test('update(0) places the turtle on the +X side of its orbit', () => {
    const t = new SeaTurtle();
    t.update(0);
    expect(t.group.position.x).toBeGreaterThan(0);
    expect(t.group.position.z).toBeCloseTo(0, 5);
  });

  test('orbit position is periodic — a full period returns to the start', () => {
    const t = new SeaTurtle();
    t.update(0);
    const start = t.group.position.clone();
    // Default period 32s.
    t.update(32);
    expect(t.group.position.x).toBeCloseTo(start.x, 4);
    expect(t.group.position.z).toBeCloseTo(start.z, 4);
  });

  test('flippers animate (rotation.z changes over time)', () => {
    const t = new SeaTurtle();
    t.update(0);
    // front-left flipper is 4th child (index 3)
    const flipperAt0 = t.group.children[3]!.rotation.z;
    t.update(1);
    const flipperAt1 = t.group.children[3]!.rotation.z;
    expect(Math.abs(flipperAt0 - flipperAt1)).toBeGreaterThan(0.01);
  });
});
