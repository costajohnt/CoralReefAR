import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import Fastify from 'fastify';
import { makeServer } from './index.js';
import { config } from './config.js';
import { makeTrustProxy } from './proxyTrust.js';

const valid = {
  species: 'branching',
  seed: 42,
  colorKey: 'coral-pink',
  position: [0, 0, 0],
  orientation: [0, 0, 0, 1],
  scale: 1,
};

async function ipFor(hops: number, remoteAddress: string, xff?: string): Promise<string> {
  const app = Fastify({ logger: false, trustProxy: makeTrustProxy(hops) });
  app.get('/ip', async (req) => ({ ip: req.ip }));
  const headers = xff === undefined ? {} : { 'x-forwarded-for': xff };
  const r = await app.inject({ method: 'GET', url: '/ip', remoteAddress, headers });
  await app.close();
  return (r.json() as { ip: string }).ip;
}

test('hops=0 ignores X-Forwarded-For and uses the socket address', async () => {
  assert.equal(await ipFor(0, '172.16.0.2', '6.6.6.6, 203.0.113.9'), '172.16.0.2');
});

test('hops=1 behind a private proxy takes the address the proxy appended, not the client-supplied one', async () => {
  assert.equal(await ipFor(1, '172.16.0.2', '6.6.6.6, 203.0.113.9'), '203.0.113.9');
  assert.equal(await ipFor(1, 'fdaa:0:1::3', '6.6.6.6, 203.0.113.9'), '203.0.113.9');
  assert.equal(await ipFor(1, '::ffff:10.0.0.5', '6.6.6.6, 203.0.113.9'), '203.0.113.9');
});

test('hops=1 does not trust X-Forwarded-For from a public peer (direct client)', async () => {
  assert.equal(await ipFor(1, '198.51.100.7', '6.6.6.6'), '198.51.100.7');
});

test('spoofed X-Forwarded-For cannot dodge the per-IP write backstop behind the proxy', async () => {
  // The per-visitor limit is keyed on the owner token, so req.ip only feeds
  // the per-IP backstop; that is what a spoofed first XFF entry must not move.
  const savedMax = config.rateLimitMax;
  const savedIpMax = config.rateLimitIpMax;
  config.rateLimitMax = 0;
  config.rateLimitIpMax = 1;
  const { app } = await makeServer({
    dbPath: ':memory:',
    adminToken: '',
    corsOrigins: ['*'],
    clientDistDir: undefined,
    logger: false,
    trustProxyHops: 1,
  });
  try {
    const post = (spoof: string, owner: string) =>
      app.inject({
        method: 'POST',
        url: '/api/reef/polyp',
        payload: valid,
        remoteAddress: '172.16.0.2',
        headers: {
          'user-agent': 'test-ua',
          'x-forwarded-for': `${spoof}, 203.0.113.9`,
          'x-reef-owner': owner.repeat(64),
        },
      });
    const first = await post('6.6.6.6', 'a');
    assert.equal(first.statusCode, 201);
    const second = await post('7.7.7.7', 'b');
    assert.equal(second.statusCode, 429);
  } finally {
    config.rateLimitMax = savedMax;
    config.rateLimitIpMax = savedIpMax;
    await app.close();
  }
});
