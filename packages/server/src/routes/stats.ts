import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import type { ReefDb } from '../db.js';
import { perIpRateLimit, ttlCache } from '../security.js';
import { counters } from '../metrics-registry.js';

export function registerStatsRoutes(app: FastifyInstance, db: ReefDb): void {
  const readLimit = config.readRateLimitPerMin > 0
    ? perIpRateLimit({ tokensPerInterval: config.readRateLimitPerMin, intervalMs: 60_000 })
    : null;
  const readStats = config.readCacheTtlMs > 0
    ? ttlCache(() => db.stats(), config.readCacheTtlMs)
    : (): ReturnType<ReefDb['stats']> => db.stats();

  app.get('/api/stats', async (req, reply) => {
    if (readLimit) {
      const check = readLimit(req.ip || 'unknown');
      if (!check.ok) {
        counters.inc('rate_limited');
        reply.header('Retry-After', Math.ceil(check.retryAfterMs / 1000));
        return reply.status(429).send({ error: 'rate_limited' });
      }
    }
    return readStats();
  });
}
