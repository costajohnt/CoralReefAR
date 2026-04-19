import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { config, requireAdminToken } from './config.js';

describe('requireAdminToken', () => {
  let original: string;

  beforeEach(() => {
    original = config.adminToken;
  });

  afterEach(() => {
    config.adminToken = original;
  });

  test('returns the token when it is set', () => {
    config.adminToken = 'test-token-xyz';
    assert.equal(requireAdminToken(), 'test-token-xyz');
  });

  test('throws when the token is empty (admin disabled without explicit opt-in)', () => {
    // Empty-token-disables-admin is a deliberate safety: forgetting to set the
    // token shouldn't silently leave admin routes open with some default.
    config.adminToken = '';
    assert.throws(() => requireAdminToken(), /ADMIN_TOKEN is required/);
  });
});
