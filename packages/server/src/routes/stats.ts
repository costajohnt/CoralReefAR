import type { FastifyInstance } from 'fastify';
import type { ReefDb } from '../db.js';

export function registerStatsRoutes(app: FastifyInstance, db: ReefDb): void {
  app.get('/api/stats', async () => db.stats());
}
