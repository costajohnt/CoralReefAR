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
  // Sim deltas (barnacle/algae/weather decorations) older than this are pruned
  // after each tick, and GET /api/reef only returns deltas inside this window,
  // so sim_state and the reef payload stay bounded instead of growing forever.
  // The reef shows a rolling window of decorations (an aging-reef look); set
  // higher to keep them longer, or 0 to disable pruning and keep everything.
  simRetentionMs: Number(process.env.SIM_RETENTION_MS ?? 30 * 86_400_000),
  // Keep at most this many of the most recent snapshots; older ones are pruned
  // after each new snapshot so the snapshots table (full-state JSON blobs)
  // doesn't grow forever. 0 = keep all (pruning disabled).
  snapshotRetentionCount: Number(process.env.SNAPSHOT_RETENTION_COUNT ?? 90),
  corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),
  // Absolute path to the built Vite client bundle. When set, the server
  // serves the static files and SPA index fallbacks. Leave unset in dev so
  // the Vite dev server keeps handling the frontend.
  clientDistDir: process.env.CLIENT_DIST_DIR,
};

// Fail loud on a malformed SIM_RETENTION_MS rather than silently coercing to
// NaN, which would disable pruning and quietly re-introduce the unbounded
// sim_state growth this knob exists to prevent.
if (!Number.isFinite(config.simRetentionMs) || config.simRetentionMs < 0) {
  throw new Error(
    `SIM_RETENTION_MS must be a non-negative number of milliseconds (0 disables pruning), ` +
      `got ${JSON.stringify(process.env.SIM_RETENTION_MS)}`,
  );
}

if (!Number.isInteger(config.snapshotRetentionCount) || config.snapshotRetentionCount < 0) {
  throw new Error(
    `SNAPSHOT_RETENTION_COUNT must be a non-negative integer (0 keeps all), ` +
      `got ${JSON.stringify(process.env.SNAPSHOT_RETENTION_COUNT)}`,
  );
}

