import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { RNG } from './rng.js';

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
