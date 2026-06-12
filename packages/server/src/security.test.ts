import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { perIpRateLimit, ttlCache } from './security.js';

test('ttlCache: reuses the cached value within the TTL (one production)', () => {
  let calls = 0;
  const cached = ttlCache(() => ++calls, 10_000);
  assert.equal(cached(), 1);
  assert.equal(cached(), 1);
  assert.equal(cached(), 1);
  assert.equal(calls, 1);
});

test('ttlCache: a zero TTL recomputes every call', () => {
  let calls = 0;
  const cached = ttlCache(() => ++calls, 0);
  assert.equal(cached(), 1);
  assert.equal(cached(), 2);
  assert.equal(calls, 2);
});

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
