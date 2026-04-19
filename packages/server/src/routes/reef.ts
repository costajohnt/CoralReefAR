import type { FastifyInstance } from 'fastify';
import { PolypInputSchema, type Polyp, type ReefState } from '@reef/shared';
import { config } from '../config.js';
import type { ReefDb } from '../db.js';
import { toPublicPolyp } from '../db.js';
import type { Hub } from '../hub.js';
import { deviceHash } from '../deviceHash.js';
import { perIpRateLimit } from '../security.js';
import { counters } from '../metrics-registry.js';

export function registerReefRoutes(app: FastifyInstance, db: ReefDb, hub: Hub): void {
  // Rate limits are opt-in. Default off while the project is in testing;
  // set READ_RATE_LIMIT_PER_MIN / RATE_LIMIT_MAX env vars to re-enable.
  const readLimit = config.readRateLimitPerMin > 0
    ? perIpRateLimit({ tokensPerInterval: config.readRateLimitPerMin, intervalMs: 60_000 })
    : null;

  app.get('/api/reef', async (req, reply) => {
    if (readLimit) {
      const check = readLimit(req.ip || 'unknown');
      if (!check.ok) {
        counters.inc('rate_limited');
        reply.header('Retry-After', Math.ceil(check.retryAfterMs / 1000));
        return reply.status(429).send({ error: 'rate_limited' });
      }
    }
    const state: ReefState = {
      polyps: db.listPublicPolyps(),
      sim: db.listSim(),
      serverTime: Date.now(),
    };
    return state;
  });

  app.post('/api/reef/polyp', async (req, reply) => {
    const parsed = PolypInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    }

    const ua = req.headers['user-agent'] ?? 'unknown';
    const ip = req.ip || req.headers['x-forwarded-for']?.toString() || 'unknown';
    const dh = deviceHash(String(ua), String(ip), config.rateLimitWindowMs);

    const windowStart = Date.now() - config.rateLimitWindowMs;
    const already = db.countByDeviceSince(dh, windowStart);
    if (config.rateLimitMax > 0 && already >= config.rateLimitMax) {
      counters.inc('rate_limited');
      const oldest = db.oldestPolypSince(dh, windowStart);
      const retryAfterMs = oldest !== null
        ? Math.max(0, oldest + config.rateLimitWindowMs - Date.now())
        : config.rateLimitWindowMs;
      reply.header('Retry-After', Math.ceil(retryAfterMs / 1000));
      return reply.status(429).send({ error: 'rate_limited', retryAfterMs });
    }

    const polyp: Omit<Polyp, 'id' | 'deleted'> = {
      ...parsed.data,
      createdAt: Date.now(),
      deviceHash: dh,
    };
    const saved = db.insertPolyp(polyp);
    const pub = toPublicPolyp(saved);
    // Broadcast is a best-effort notification — a failure here must not turn
    // a successfully persisted polyp into a 500 the client would retry.
    try {
      hub.broadcast({ type: 'polyp_added', polyp: pub });
    } catch (err) {
      req.log.warn({ err, polypId: saved.id }, 'hub broadcast failed after insert');
    }
    return reply.status(201).send(pub);
  });
}
