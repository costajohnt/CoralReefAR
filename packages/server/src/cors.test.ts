import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { resolveCorsOrigin, corsIsWideOpenOrEmpty, assertProductionCorsSafe } from './cors.js';

test('resolveCorsOrigin: "*" → true (wide open)', () => {
  assert.equal(resolveCorsOrigin(['*']), true);
});

test('resolveCorsOrigin: explicit origins → the cleaned allowlist', () => {
  assert.deepEqual(resolveCorsOrigin(['https://a.com', ' https://b.com ']), [
    'https://a.com',
    'https://b.com',
  ]);
});

test('resolveCorsOrigin: empty/whitespace → [] (deny all cross-origin)', () => {
  assert.deepEqual(resolveCorsOrigin(['']), []);
  assert.deepEqual(resolveCorsOrigin([' ', '']), []);
});

test('corsIsWideOpenOrEmpty', () => {
  assert.equal(corsIsWideOpenOrEmpty(['*']), true);
  assert.equal(corsIsWideOpenOrEmpty(['']), true);
  assert.equal(corsIsWideOpenOrEmpty(['https://a.com']), false);
  assert.equal(corsIsWideOpenOrEmpty(['https://a.com', '*']), true);
});

test('assertProductionCorsSafe: throws in production on wide-open or empty', () => {
  assert.throws(() => assertProductionCorsSafe(['*'], 'production'), /wide-open/);
  assert.throws(() => assertProductionCorsSafe([''], 'production'), /empty/);
});

test('assertProductionCorsSafe: passes in production with explicit origins', () => {
  assert.doesNotThrow(() => assertProductionCorsSafe(['https://reef.example.com'], 'production'));
});

test('assertProductionCorsSafe: never throws outside production', () => {
  assert.doesNotThrow(() => assertProductionCorsSafe(['*'], undefined));
  assert.doesNotThrow(() => assertProductionCorsSafe(['*'], 'development'));
  assert.doesNotThrow(() => assertProductionCorsSafe([''], 'test'));
});
