import { assertProductionCorsSafe } from './cors.js';

export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? './data/reef.db',
  adminToken: process.env.ADMIN_TOKEN ?? '',
  // When set, GET /metrics requires `Authorization: Bearer <METRICS_TOKEN>`
  // (Prometheus-style scrape auth). Unset = open, for a network-isolated
  // scrape target.
  metricsToken: process.env.METRICS_TOKEN ?? '',
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 3_600_000),
  // 0 = disabled. Default off while the project is in testing; before
  // productionalizing set RATE_LIMIT_MAX to something like 1. Follow-up
  // tracked in the repo issue list.
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 0),
  // Looser bucket for Quest sessions where users plant many polyps quickly.
  // 0 = falls through to rateLimitMax.
  questRateLimitMax: Number(process.env.QUEST_RATE_LIMIT_MAX ?? 20),
  // 0 = disabled. Default off; set READ_RATE_LIMIT_PER_MIN=60 (or similar)
  // to re-enable the per-IP read-side token bucket on /api/reef and /api/stats.
  readRateLimitPerMin: Number(process.env.READ_RATE_LIMIT_PER_MIN ?? 0),
  // Short-TTL read cache (ms) for /api/reef and /api/stats so a burst of reads
  // coalesces into one DB scan. 0 = disabled (default, matching the testing
  // posture). Set e.g. 1000 in production. Staleness is bounded by this value;
  // WS keeps connected clients live regardless.
  readCacheTtlMs: Number(process.env.READ_CACHE_TTL_MS ?? 0),
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
  // Max concurrent WebSocket connections per hub (reef and tree count
  // separately). 0 = unlimited. Bounds a connection flood from exhausting
  // memory / file descriptors before the heartbeat reaps idle sockets.
  wsMaxClients: Number(process.env.WS_MAX_CLIENTS ?? 1000),
  // Fixed seed for the first-boot Starburst root. Unset (or blank) = random per
  // fresh volume (the chosen seed is logged, so the root is reproducible after
  // the fact). Set an integer in [0, 2^32) to make the root identical across
  // boots — handy for golden-style testing or a branded default reef.
  treeRootSeed:
    (process.env.TREE_ROOT_SEED ?? '').trim() === ''
      ? undefined
      : Number(process.env.TREE_ROOT_SEED),
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

if (!Number.isFinite(config.readCacheTtlMs) || config.readCacheTtlMs < 0) {
  throw new Error(
    `READ_CACHE_TTL_MS must be a non-negative number of milliseconds (0 disables), ` +
      `got ${JSON.stringify(process.env.READ_CACHE_TTL_MS)}`,
  );
}

if (!Number.isInteger(config.wsMaxClients) || config.wsMaxClients < 0) {
  throw new Error(
    `WS_MAX_CLIENTS must be a non-negative integer (0 = unlimited), ` +
      `got ${JSON.stringify(process.env.WS_MAX_CLIENTS)}`,
  );
}

// Fail loud on a malformed TREE_ROOT_SEED rather than seeding with NaN or an
// out-of-range value. mulberry32 does `(seed | 0) >>> 0`, so an integer outside
// [0, 2^32) is silently truncated to a different effective seed — which would
// break the "the logged seed reproduces the root" invariant this knob exists
// for. Bound it to the same domain the random path uses (0..0xffffffff).
if (
  config.treeRootSeed !== undefined &&
  (!Number.isInteger(config.treeRootSeed) ||
    config.treeRootSeed < 0 ||
    config.treeRootSeed > 0xffffffff)
) {
  throw new Error(
    `TREE_ROOT_SEED must be an integer in [0, 4294967295] when set (unset = random root), ` +
      `got ${JSON.stringify(process.env.TREE_ROOT_SEED)}`,
  );
}

// Fail closed on CORS in production: refuse to start if origins are wide-open
// or unset. Testing keeps the convenient `*` default.
assertProductionCorsSafe(config.corsOrigins, process.env.NODE_ENV);

