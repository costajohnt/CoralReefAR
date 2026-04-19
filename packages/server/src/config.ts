export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? './data/reef.db',
  adminToken: process.env.ADMIN_TOKEN ?? '',
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 3_600_000),
  // 0 = disabled. Default off while the project is in testing; before
  // productionalizing set RATE_LIMIT_MAX to something like 1. Follow-up
  // tracked in the repo issue list.
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 0),
  // 0 = disabled. Default off; set READ_RATE_LIMIT_PER_MIN=60 (or similar)
  // to re-enable the per-IP read-side token bucket.
  readRateLimitPerMin: Number(process.env.READ_RATE_LIMIT_PER_MIN ?? 0),
  simIntervalMs: Number(process.env.SIM_INTERVAL_MS ?? 3_600_000),
  snapshotIntervalMs: Number(process.env.SNAPSHOT_INTERVAL_MS ?? 86_400_000),
  corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),
  // Absolute path to the built Vite client bundle. When set, the server
  // serves the static files and SPA index fallbacks. Leave unset in dev so
  // the Vite dev server keeps handling the frontend.
  clientDistDir: process.env.CLIENT_DIST_DIR,
};

