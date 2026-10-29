import { describe, test, expect } from 'vitest';
import { MAX_FISH } from '@reef/shared';
import { FishSchool } from './fish.js';

describe('FishSchool population', () => {
  test('default population is drawn; capacity covers MAX_FISH', () => {
    const f = new FishSchool();
    expect(f.population()).toBe(60);
    expect(f.points.geometry.drawRange.count).toBe(60);
    expect(f.points.geometry.getAttribute('position').count).toBe(MAX_FISH);
  });

  test('setPopulation changes how many fish are drawn, clamped to [0, MAX_FISH]', () => {
    const f = new FishSchool();
    f.setPopulation(12);
    expect(f.population()).toBe(12);
    expect(f.points.geometry.drawRange.count).toBe(12);
    f.setPopulation(10_000);
    expect(f.population()).toBe(MAX_FISH);
    f.setPopulation(-3);
    expect(f.population()).toBe(0);
    f.setPopulation(7.6);
    expect(f.population()).toBe(8);
  });

  test('update only moves active fish', () => {
    const f = new FishSchool();
    f.setPopulation(5);
    const pos = f.points.geometry.getAttribute('position').array as Float32Array;
    const idle = Array.from(pos.slice(5 * 3, 6 * 3));
    f.update(0.5);
    expect(Array.from(pos.slice(5 * 3, 6 * 3))).toEqual(idle);
  });
});
