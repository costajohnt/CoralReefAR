// Regression tests from the adversarial review of the 2026-10-30 audit fixes.
// Each asserts a property the rate-limit / CSP changes claim.
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { OWNER_HEADER } from '@reef/shared';
import { ReefDb } from './db.js';
import { Hub } from './hub.js';
import { registerReefRoutes } from './routes/reef.js';
import { TreeDb } from './tree/db.js';
import { registerTreeRoutes } from './tree/routes.js';
import { config } from './config.js';
import { ENGINE_CDN_PATH, installSecurityHeaders } from './security.js';

const owner = (c: string) => ({ [OWNER_HEADER]: c.repeat(64) });
const valid = {
  species: 'branching', seed: 42, colorKey: 'coral-pink',
  position: [0, 0, 0], orientation: [0, 0, 0, 1], scale: 1,
};

function reefApp() {
  const dir = mkdtempSync(join(tmpdir(), 'reef-adv-'));
  const db = new ReefDb(join(dir, 'reef.db'));
  const app = Fastify({ logger: false, trustProxy: true });
  registerReefRoutes(app, db, new Hub());
  return app;
}

async function withConfig<T>(patch: Partial<typeof config>, fn: () => Promise<T>): Promise<T> {
  const saved = { ...config };
  Object.assign(config, patch);
  try { return await fn(); } finally { Object.assign(config, saved); }
}

test('review-1: RATE_LIMIT_IP_MAX is keyed on IP alone, so rotating UA and token does not defeat it', async () =>
  withConfig({ rateLimitMax: 1, rateLimitIpMax: 2, questRateLimitMax: 0 }, async () => {
    const app = reefApp();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await app.inject({
        method: 'POST', url: '/api/reef/polyp',
        headers: { 'user-agent': `curl/8.${i}`, ...owner(String(i)) },
        payload: { ...valid, seed: i },
      });
      codes.push(r.statusCode);
    }
    await app.close();
    // Six polyps from one IP in one window with RATE_LIMIT_MAX=1 and
    // RATE_LIMIT_IP_MAX=2: the backstop must fire at least once.
    assert.ok(codes.includes(429), `one IP minted 6 polyps past a backstop of 2: ${codes.join(',')}`);
  }));

test('review-2: a forged "OculusBrowser" fragment without a version does not get the Quest bucket', async () =>
  withConfig({ rateLimitMax: 1, questRateLimitMax: 20 }, async () => {
    const app = reefApp();
    const headers = { 'user-agent': 'curl/8.0 OculusBrowser', ...owner('f') };
    const first = await app.inject({ method: 'POST', url: '/api/reef/polyp', headers, payload: { ...valid, surface: 'quest' } });
    const second = await app.inject({ method: 'POST', url: '/api/reef/polyp', headers, payload: { ...valid, seed: 2, surface: 'quest' } });
    await app.close();
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 429, 'a curl client with a forged UA raised its own cap 20x');
  }));

test('review-3: tree writes are not keyed on UA|IP (venue collision, audit H3)', async () =>
  withConfig({ rateLimitMax: 1 }, async () => {
    const reef = new ReefDb(':memory:');
    const app = Fastify({ logger: false });
    registerTreeRoutes(app, new TreeDb(reef.storage), new Hub());
    const ua = { 'user-agent': 'same-iphone-same-wifi' };
    const piece = { variant: 'starburst', seed: 1, colorKey: 'neon-cyan', parentId: null, attachIndex: 0 };
    const a = await app.inject({ method: 'POST', url: '/api/tree/polyp', headers: { ...ua, ...owner('a') }, payload: piece });
    const b = await app.inject({ method: 'POST', url: '/api/tree/polyp', headers: { ...ua, ...owner('b') }, payload: { ...piece, seed: 2 } });
    await app.close();
    assert.equal(a.statusCode, 200);
    assert.equal(b.statusCode, 200, `second visitor on the same wifi/phone model was blocked: ${b.body}`);
  }));

test('review-4: tokenless-then-token does not double RATE_LIMIT_MAX for one device', async () =>
  withConfig({ rateLimitMax: 1, rateLimitIpMax: 50 }, async () => {
    const app = reefApp();
    const ua = { 'user-agent': 'one-phone' };
    const first = await app.inject({ method: 'POST', url: '/api/reef/polyp', headers: ua, payload: valid });
    const second = await app.inject({ method: 'POST', url: '/api/reef/polyp', headers: { ...ua, ...owner('a') }, payload: { ...valid, seed: 2 } });
    await app.close();
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 429, 'same UA|IP planted twice under RATE_LIMIT_MAX=1');
  }));

test('review-5: page CSP img-src allows the engine CDN path (powered-by.svg)', async () => {
  const app = Fastify({ logger: false });
  installSecurityHeaders(app);
  app.get('/', async () => 'ok');
  const res = await app.inject({ method: 'GET', url: '/' });
  await app.close();
  const csp = res.headers['content-security-policy'] as string;
  const imgSrc = /img-src ([^;]*)/.exec(csp)?.[1] ?? '';
  assert.ok(imgSrc.split(' ').some((t) => ENGINE_CDN_PATH.startsWith(t)), `img-src blocks the engine's powered-by logo: ${imgSrc}`);
});

test('review-6: an unmatched GET under /api/ still draws from the read bucket', async () => {
  const { installReadRateLimit } = await import('./security.js');
  await withConfig({ readRateLimitPerMin: 2 }, async () => {
    const app = Fastify({ logger: false });
    installReadRateLimit(app);
    app.get('/api/tree', async () => ({}));
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await app.inject({ method: 'GET', url: '/api/nope' })).statusCode);
    await app.close();
    assert.ok(codes.includes(429), `5 unmatched /api/ GETs, none limited: ${codes.join(',')}`);
  });
});
