import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mulberry32, RNG } from './rng.js';
import { seededRand } from './tree/variant.js';

test('RNG is deterministic across instances for the same seed', () => {
  const a = new RNG(12345);
  const b = new RNG(12345);
  for (let i = 0; i < 100; i++) {
    assert.equal(a.next(), b.next());
  }
});

test('RNG produces values in [0, 1)', () => {
  const r = new RNG(99);
  for (let i = 0; i < 1000; i++) {
    const v = r.next();
    assert.ok(v >= 0, `got ${v}`);
    assert.ok(v < 1, `got ${v}`);
  }
});

test('RNG.int respects inclusive bounds', () => {
  const r = new RNG(7);
  for (let i = 0; i < 200; i++) {
    const v = r.int(3, 5);
    assert.ok(v === 3 || v === 4 || v === 5, `got ${v}`);
  }
});

test('RNG.pick throws on empty', () => {
  assert.throws(() => new RNG(1).pick([]), /empty/);
});

test('RNG handles seed 0 by falling through to 1', () => {
  const a = new RNG(0);
  const b = new RNG(1);
  for (let i = 0; i < 10; i++) assert.equal(a.next(), b.next());
});

test('seededRand is the canonical mulberry32 (single implementation)', () => {
  assert.equal(seededRand, mulberry32);
});

test('RNG wraps mulberry32 with its seed-0 guard', () => {
  // RNG(seed) is mulberry32(seed || 1); for nonzero seeds the streams match.
  for (const seed of [1, 42, 2_147_483_647, 3_000_000_000]) {
    const viaRng = new RNG(seed);
    const viaFn = mulberry32(seed);
    for (let i = 0; i < 50; i++) assert.equal(viaRng.next(), viaFn());
  }
  // Seed 0 is where they diverge by design: RNG remaps to 1, the raw fn does not.
  assert.notEqual(new RNG(0).next(), mulberry32(0)());
});
