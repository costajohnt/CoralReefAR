import type { FastifyInstance } from 'fastify';
import type { ReefDb } from '../db.js';
import type { Hub } from '../hub.js';
import { counters } from '../metrics-registry.js';
import { config } from '../config.js';
import { enforceBearerIfConfigured } from '../auth.js';

// Minimal Prometheus text-format emitter. Any HELP/TYPE line whose value
// contains `\n` or `\\` would need escaping — we control these strings so no
// escaping is needed today.
function metric(name: string, help: string, type: 'gauge' | 'counter', value: number): string {
  return `# HELP ${name} ${help}\n# TYPE ${name} ${type}\n${name} ${value}\n`;
}

export function registerMetricsRoutes(app: FastifyInstance, db: ReefDb, hub: Hub): void {
  app.get('/metrics', async (req, reply) => {
    // Gated when METRICS_TOKEN is set (open otherwise, for a network-isolated
    // scrape target). Returns 401 before doing any work on an unauthorized hit.
    if (!enforceBearerIfConfigured(req, reply, config.metricsToken)) return reply;
    // application/openmetrics-text would also be acceptable, but Prometheus
    // 2.x default scraping expects the classic text format.
    reply.type('text/plain; version=0.0.4; charset=utf-8');
    // Cheap aggregate count — no per-scrape row hydration / device_hash strip.
    const polyps = db.countLivePolyps();
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
