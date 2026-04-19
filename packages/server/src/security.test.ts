import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { perIpRateLimit } from './security.js';

test('perIpRateLimit admits tokens up to budget', () => {
  const limit = perIpRateLimit({ tokensPerInterval: 3, intervalMs: 10_000 });
  assert.equal(limit('a').ok, true);
  assert.equal(limit('a').ok, true);
  assert.equal(limit('a').ok, true);
  const denied = limit('a');
  assert.equal(denied.ok, false);
  assert.ok(denied.retryAfterMs > 0);
});

test('perIpRateLimit isolates IPs', () => {
  const limit = perIpRateLimit({ tokensPerInterval: 1, intervalMs: 10_000 });
  assert.equal(limit('a').ok, true);
  assert.equal(limit('b').ok, true);
  assert.equal(limit('a').ok, false);
  assert.equal(limit('b').ok, false);
});
