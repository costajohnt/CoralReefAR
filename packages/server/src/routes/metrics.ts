import type { FastifyInstance } from 'fastify';
import type { ReefDb } from '../db.js';
import type { Hub } from '../hub.js';
import { counters } from '../metrics-registry.js';

// Minimal Prometheus text-format emitter. Any HELP/TYPE line whose value
// contains `\n` or `\\` would need escaping — we control these strings so no
// escaping is needed today.
function metric(name: string, help: string, type: 'gauge' | 'counter', value: number): string {
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}\n`;
}

export function registerMetricsRoutes(app: FastifyInstance, db: ReefDb, hub: Hub): void {
  app.get('/metrics', async (_req, reply) => {
    // application/openmetrics-text would also be acceptable, but Prometheus
    // 2.x default scraping expects the classic text format.
    reply.type('text/plain; version=0.0.4; charset=utf-8');
    const polyps = db.listPublicPolyps().length;
    const clients = hub.size();
    return [
      metric('reef_polyps_total', 'Number of live (non-deleted) polyps.', 'gauge', polyps),
      metric('reef_ws_clients', 'Currently connected WebSocket clients.', 'gauge', clients),
      metric('reef_rate_limited_total',
        'Requests rejected by the rate limiter since process start.',
        'counter', counters.get('rate_limited')),
    ].join('');
  });
}
