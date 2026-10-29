import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isOwnerToken, UNDO_WINDOW_MS } from './owner.js';

test('isOwnerToken accepts a lowercase 64-char hex digest only', () => {
  assert.equal(isOwnerToken('a'.repeat(64)), true);
  assert.equal(isOwnerToken('0123456789abcdef'.repeat(4)), true);
  assert.equal(isOwnerToken('A'.repeat(64)), false);
  assert.equal(isOwnerToken('a'.repeat(63)), false);
  assert.equal(isOwnerToken('a'.repeat(65)), false);
  assert.equal(isOwnerToken('g'.repeat(64)), false);
  assert.equal(isOwnerToken(undefined), false);
  assert.equal(isOwnerToken(['a'.repeat(64)]), false);
});

test('UNDO_WINDOW_MS is a short grace window', () => {
  assert.equal(UNDO_WINDOW_MS, 60_000);
});
