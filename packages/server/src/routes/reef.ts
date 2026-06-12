import type { FastifyInstance } from 'fastify';
import { PolypInputSchema, type Polyp, type ReefState } from '@reef/shared';
import { config } from '../config.js';
import type { ReefDb } from '../db.js';
import { toPublicPolyp } from '../db.js';
import type { Hub } from '../hub.js';
import { deviceHash, deviceHashesForCounting } from '../deviceHash.js';
import { perIpRateLimit, ttlCache } from '../security.js';
import { counters } from '../metrics-registry.js';

export function registerReefRoutes(app: FastifyInstance, db: ReefDb, hub: Hub): void {
  // Rate limits are opt-in. Default off while the project is in testing;
  // set READ_RATE_LIMIT_PER_MIN / RATE_LIMIT_MAX env vars to re-enable.
  const readLimit = config.readRateLimitPerMin > 0
    ? perIpRateLimit({ tokensPerInterval: config.readRateLimitPerMin, intervalMs: 60_000 })
    : null;

  // The polyps + sim scans are the expensive part of GET /api/reef. Cache them
  // for READ_CACHE_TTL_MS so a burst of reads coalesces into one scan. The sim
  // payload is bounded to the retention window (0 = retention disabled → all).
  const buildSnapshot = (): Pick<ReefState, 'polyps' | 'sim'> => ({
    polyps: db.listPublicPolyps(),
    sim: config.simRetentionMs > 0
      ? db.listSimSince(Date.now() - config.simRetentionMs)
      : db.listSim(),
  });
  const readSnapshot = config.readCacheTtlMs > 0
    ? ttlCache(buildSnapshot, config.readCacheTtlMs)
    : buildSnapshot;

  app.get('/api/reef', async (req, reply) => {
    if (readLimit) {
      const check = readLimit(req.ip || 'unknown');
      if (!check.ok) {
        counters.inc('rate_limited');
        reply.header('Retry-After', Math.ceil(check.retryAfterMs / 1000));
        return reply.status(429).send({ error: 'rate_limited' });
      }
    }
    // serverTime is always fresh even when the scans are served from cache.
    const state: ReefState = { ...readSnapshot(), serverTime: Date.now() };
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
    // Count under the current AND previous window's hash so crossing a window
    // boundary can't reset the count (see deviceHashesForCounting).
    const countHashes = deviceHashesForCounting(String(ua), String(ip), config.rateLimitWindowMs);
    const already = countHashes.reduce((n, h) => n + db.countByDeviceSince(h, windowStart), 0);
    if (config.rateLimitMax > 0 && already >= config.rateLimitMax) {
      counters.inc('rate_limited');
      const oldests = countHashes
        .map((h) => db.oldestPolypSince(h, windowStart))
        .filter((t): t is number => t !== null);
      const oldest = oldests.length ? Math.min(...oldests) : null;
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
