import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { deviceHash, deviceHashesForCounting } from './deviceHash.js';

describe('deviceHash', () => {
  let realNow: () => number;

  beforeEach(() => {
    realNow = Date.now;
  });

  afterEach(() => {
    Date.now = realNow;
  });

  test('stable within the same bucket for identical inputs', () => {
    Date.now = () => 1_000_500;
    const windowMs = 1000;
    const a = deviceHash('Mozilla/5.0', '1.2.3.4', windowMs);
    const b = deviceHash('Mozilla/5.0', '1.2.3.4', windowMs);
    assert.equal(a, b);
  });

  test('different user agents produce different hashes in the same bucket', () => {
    Date.now = () => 2_000_500;
    const windowMs = 1000;
    const a = deviceHash('UA-A', '1.2.3.4', windowMs);
    const b = deviceHash('UA-B', '1.2.3.4', windowMs);
    assert.notEqual(a, b);
  });

  test('different IPs produce different hashes in the same bucket', () => {
    Date.now = () => 3_000_500;
    const windowMs = 1000;
    const a = deviceHash('UA', '1.2.3.4', windowMs);
    const b = deviceHash('UA', '5.6.7.8', windowMs);
    assert.notEqual(a, b);
  });

  test('crossing a bucket boundary rolls the salt', () => {
    const windowMs = 1000;
    Date.now = () => 4_000_500;
    const inBucket = deviceHash('UA', 'IP', windowMs);
    // Step past the next bucket boundary — same UA/IP, different salt.
    Date.now = () => 4_001_500;
    const nextBucket = deviceHash('UA', 'IP', windowMs);
    assert.notEqual(inBucket, nextBucket);
  });

  test('produces a hex-encoded SHA-256 digest (64 chars)', () => {
    Date.now = () => 5_000_500;
    const out = deviceHash('UA', 'IP', 1000);
    assert.equal(out.length, 64);
    assert.match(out, /^[0-9a-f]{64}$/);
  });

  test('counting hashes: first entry equals the current store hash', () => {
    Date.now = () => 6_000_500;
    const windowMs = 1000;
    const stored = deviceHash('UA', 'IP', windowMs);
    const [current] = deviceHashesForCounting('UA', 'IP', windowMs);
    assert.equal(current, stored);
  });

  test('counting hashes: current and previous entries differ', () => {
    Date.now = () => 7_000_500;
    const [current, previous] = deviceHashesForCounting('UA', 'IP', 1000);
    assert.notEqual(current, previous);
  });

  test('boundary fix: a polyp stored last window is still attributed this window', () => {
    const windowMs = 1000;
    // Store under bucket 8000's hash.
    Date.now = () => 8_000_500;
    const storedLastWindow = deviceHash('UA', 'IP', windowMs);
    // One window later (bucket 8001): the counting set must include the prior
    // hash, so the device can't shed its earlier polyp by crossing the boundary.
    Date.now = () => 8_001_500;
    const counting = deviceHashesForCounting('UA', 'IP', windowMs);
    assert.ok(
      counting.includes(storedLastWindow),
      'previous-window hash must be in the counting set',
    );
  });
});
