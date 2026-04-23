import { describe, expect, test } from 'vitest';
import { Clownfish } from './clownfish.js';

describe('Clownfish', () => {
  test('has body + 3 stripes + dorsal + 2 pectoral fins + tail node', () => {
    const c = new Clownfish();
    // body + 3 stripes + dorsal + 2 pectoral + tail-node = 8 children.
    expect(c.group.children.length).toBe(8);
  });

  test('update(0) places the clownfish on the +X side of its orbit', () => {
    const c = new Clownfish();
    c.update(0);
    expect(c.group.position.x).toBeGreaterThan(0);
  });

  test('orbit runs opposite to the shark (z decreases from t=0 as time advances)', () => {
    const c = new Clownfish();
    c.update(0);
    const z0 = c.group.position.z;
    c.update(0.5);
    expect(c.group.position.z).toBeLessThan(z0);
  });

  test('update moves the clownfish over time', () => {
    const c = new Clownfish();
    c.update(0);
    const a = c.group.position.clone();
    c.update(1.5);
    expect(a.distanceTo(c.group.position)).toBeGreaterThan(0.01);
  });
});
