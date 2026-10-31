import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// config.ts validates at import time, so each case boots a child process.
function bootWith(env: Record<string, string>): { status: number | null; stderr: string } {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', 'await import(process.env.CONFIG_PATH)'], {
    env: { ...process.env, ...env, CONFIG_PATH: fileURLToPath(new URL('./config.js', import.meta.url)) },
    encoding: 'utf8',
  });
  return { status: r.status, stderr: r.stderr };
}

test('config: malformed rate-limit knobs fail loud instead of disabling the limit (audit M2)', () => {
  for (const [name, bad] of [
    ['RATE_LIMIT_MAX', '1x'],
    ['RATE_LIMIT_IP_MAX', '-1'],
    ['QUEST_RATE_LIMIT_MAX', '2.5'],
    ['READ_RATE_LIMIT_PER_MIN', '6o'],
    ['RATE_LIMIT_WINDOW_MS', '0'],
    ['RATE_LIMIT_WINDOW_MS', 'abc'],
  ] as const) {
    const r = bootWith({ [name]: bad });
    assert.notEqual(r.status, 0, `${name}=${JSON.stringify(bad)} must refuse to boot`);
    assert.match(r.stderr, new RegExp(name));
  }
});

test('config: valid rate-limit knobs boot', () => {
  const r = bootWith({ RATE_LIMIT_MAX: '1', RATE_LIMIT_IP_MAX: '50', QUEST_RATE_LIMIT_MAX: '0', READ_RATE_LIMIT_PER_MIN: '300', RATE_LIMIT_WINDOW_MS: '3600000' });
  assert.equal(r.status, 0, r.stderr);
});
