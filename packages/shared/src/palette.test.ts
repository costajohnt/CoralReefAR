import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { REEF_PALETTE, paletteByKey, paletteByKeyOrDefault } from './palette.js';

test('paletteByKey returns the matching entry', () => {
  const entry = paletteByKey('neon-cyan');
  assert.equal(entry.key, 'neon-cyan');
});

test('paletteByKey throws on an unknown key (validated write path)', () => {
  assert.throws(() => paletteByKey('not-a-key'), /Unknown palette key/);
});

test('paletteByKeyOrDefault returns the matching entry for a known key', () => {
  assert.equal(paletteByKeyOrDefault('teal').key, 'teal');
});

test('paletteByKeyOrDefault falls back to the first palette entry for an unknown key', () => {
  const original = console.warn;
  let warned = 0;
  console.warn = () => {
    warned += 1;
  };
  try {
    const a = paletteByKeyOrDefault('definitely-not-a-key');
    assert.equal(a.key, REEF_PALETTE[0]!.key);
    // Warns once per distinct unknown key, not on every call.
    paletteByKeyOrDefault('definitely-not-a-key');
    assert.equal(warned, 1);
  } finally {
    console.warn = original;
  }
});
