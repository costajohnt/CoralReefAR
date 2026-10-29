import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createHash, createHmac } from 'node:crypto';
import { ownerHash } from './ownerHash.js';

const TOKEN = 'c'.repeat(64);

test('ownerHash: without a secret it is a salted SHA-256, never the raw token', () => {
  const h = ownerHash(TOKEN, '');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.notEqual(h, TOKEN);
  assert.notEqual(h, createHash('sha256').update(TOKEN).digest('hex'), 'must be salted');
  assert.equal(h, ownerHash(TOKEN, ''), 'deterministic so ownership survives restarts');
});

test('ownerHash: with a secret it is an HMAC keyed by that secret', () => {
  const h = ownerHash(TOKEN, 's3cret');
  assert.notEqual(h, ownerHash(TOKEN, ''));
  assert.notEqual(h, ownerHash(TOKEN, 'other'));
  assert.notEqual(h, createHmac('sha256', 's3cret').update(TOKEN).digest('hex'), 'domain-separated');
  assert.equal(h, ownerHash(TOKEN, 's3cret'));
});

test('ownerHash: distinct tokens hash distinctly', () => {
  assert.notEqual(ownerHash('a'.repeat(64), ''), ownerHash('b'.repeat(64), ''));
});
