import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { resolve as resolvePath } from 'node:path';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { ReefDb } from './db.js';
import { Hub } from './hub.js';
import { registerReefRoutes } from './routes/reef.js';
import { registerSnapshotRoutes } from './routes/snapshot.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerStatsRoutes } from './routes/stats.js';
import { registerMetricsRoutes } from './routes/metrics.js';
import { SimWorker, SnapshotWorker } from './sim.js';
import { installSecurityHeaders } from './security.js';

async function main(): Promise<void> {
  const db = new ReefDb(config.dbPath);
  const hub = new Hub();

  // 8 KB fits the largest valid polyp (schema-bounded). Fastify's 1 MB
  // default lets unauthenticated callers make Zod walk a megabyte before
  // rejecting.
  const app = Fastify({ logger: true, trustProxy: true, bodyLimit: 8192 });
  const corsOrigin: boolean | string[] =
    config.corsOrigins.length === 1 && config.corsOrigins[0] === '*' ? true : config.corsOrigins;
  await app.register(cors, { origin: corsOrigin });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });
  installSecurityHeaders(app);

  if (!config.adminToken) {
    app.log.warn('ADMIN_TOKEN is not set — admin endpoints will reject all requests');
  }

  app.get('/healthz', async () => ({ ok: true, time: Date.now() }));

  registerReefRoutes(app, db, hub);
  registerSnapshotRoutes(app, db);
  registerAdminRoutes(app, db, hub);
  registerStatsRoutes(app, db);
  registerMetricsRoutes(app, db, hub);

  // Optional static hosting: serves the built Vite bundle out of the same
  // container so a single-host deploy doesn't need a separate nginx sidecar.
  // Unset in dev so the Vite dev server keeps handling the frontend.
  if (config.clientDistDir) {
    const root = resolvePath(config.clientDistDir);
    if (!existsSync(root)) {
      app.log.warn({ root }, 'CLIENT_DIST_DIR is set but does not exist — skipping static hosting');
    } else {
      await app.register(fastifyStatic, { root, wildcard: false });
      app.log.info({ root }, 'serving client bundle');
    }
  }

  // @fastify/websocket v10 hands the handler the ws.WebSocket directly — v7/v8
  // wrapped it in `{ socket }` but that indirection is gone.
  app.get('/ws', { websocket: true }, (sock) => {
    const ws = sock as unknown as {
      readyState: number;
      send: (data: string) => void;
      on: (event: 'close' | 'pong', cb: () => void) => void;
      ping?(): void;
      terminate?(): void;
    };
    hub.add(ws);
    ws.send(JSON.stringify({
      type: 'hello',
      polypCount: db.listPublicPolyps().length,
      serverTime: Date.now(),
    }));
  });

  const sim = new SimWorker(db, hub, config.simIntervalMs);
  sim.start();
  const snapshots = new SnapshotWorker(db, config.snapshotIntervalMs);
  snapshots.start();
  hub.startHeartbeat();

  const shutdown = async (): Promise<void> => {
    sim.stop();
    snapshots.stop();
    hub.stopHeartbeat();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ port: config.port, host: config.host });
  app.log.info({ port: config.port }, 'reef server listening');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
