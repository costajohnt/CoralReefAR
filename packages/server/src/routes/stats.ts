import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import type { ReefDb } from '../db.js';
import { ttlCache } from '../security.js';

export function registerStatsRoutes(app: FastifyInstance, db: ReefDb): void {
  const readStats = config.readCacheTtlMs > 0
    ? ttlCache(() => db.stats(), config.readCacheTtlMs)
    : (): ReturnType<ReefDb['stats']> => db.stats();

  // Read limiting is the shared GET /api/* hook (installReadRateLimit).
  app.get('/api/stats', async () => readStats());
}
