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
  // Optional HMAC key for hashing "my polyps" owner tokens (see ownerHash.ts).
  // Unset = salted SHA-256. Changing it later orphans existing ownership.
  ownerHashSecret: process.env.OWNER_HASH_SECRET ?? '',
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 3_600_000),
  // 0 = disabled. Default off while the project is in testing; before
  // productionalizing set RATE_LIMIT_MAX to something like 1. Follow-up
  // tracked in the repo issue list.
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 0),
  // Coarse backstop behind the owner-token write limit: polyps per UA|IP
  // device hash per window, across all owner tokens. Stops one device from
  // dodging RATE_LIMIT_MAX by minting fresh owner tokens, while staying wide
  // enough that a venue full of identical phones on one wifi is not throttled
  // as a single visitor. 0 = off.
  rateLimitIpMax: Number(process.env.RATE_LIMIT_IP_MAX ?? 0),
  // Looser bucket for Quest sessions where users plant many polyps quickly.
  // 0 = falls through to rateLimitMax.
  questRateLimitMax: Number(process.env.QUEST_RATE_LIMIT_MAX ?? 20),
  // 0 = disabled. Default off; set READ_RATE_LIMIT_PER_MIN=60 (or similar)
  // to re-enable the per-IP read-side token bucket on /api/reef and /api/stats.
  readRateLimitPerMin: Number(process.env.READ_RATE_LIMIT_PER_MIN ?? 0),
  // Per-IP token bucket on POST /api/reef/polyp/:id/undo. On by default
  // (unlike the testing-era read/write limits): a real visitor undoes at most
  // once per plant, so 10/min never bites, while it caps token-probing and
  // hammering of a write path. 0 = off.
  undoRateLimitPerMin: Number(process.env.UNDO_RATE_LIMIT_PER_MIN ?? 10),
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
  // Quest co-presence (#114): relay anonymous head poses between headsets over
  // /ws. Off unless PRESENCE_ENABLED=1 (awaiting headset validation). Memory
  // only; never touches the DB.
  presenceEnabled: process.env.PRESENCE_ENABLED === '1',
  // Most other visitors any one client is sent per presence frame.
  presenceMaxVisitors: Number(process.env.PRESENCE_MAX_VISITORS ?? 16),
  // Fixed seed for the first-boot Starburst root. Unset (or blank) = random per
  // fresh volume (the chosen seed is logged, so the root is reproducible after
  // the fact). Set an integer in [0, 2^32) to make the root identical across
  // boots — handy for golden-style testing or a branded default reef.
  treeRootSeed:
    (process.env.TREE_ROOT_SEED ?? '').trim() === ''
      ? undefined
      : Number(process.env.TREE_ROOT_SEED),
  // Number of reverse proxies in front of the server whose X-Forwarded-For
  // entry is trusted for req.ip (rate limits key on it). 0 = use the socket
  // address and ignore the header (local dev). 1 = behind Fly's proxy or a
  // cloudflared tunnel. See proxyTrust.ts for why this is not `trustProxy: true`.
  trustProxyHops: Number(process.env.TRUST_PROXY_HOPS ?? 0),
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

if (!Number.isInteger(config.undoRateLimitPerMin) || config.undoRateLimitPerMin < 0) {
  throw new Error(
    `UNDO_RATE_LIMIT_PER_MIN must be a non-negative integer (0 = off), ` +
      `got ${JSON.stringify(process.env.UNDO_RATE_LIMIT_PER_MIN)}`,
  );
}

if (!Number.isInteger(config.wsMaxClients) || config.wsMaxClients < 0) {
  throw new Error(
    `WS_MAX_CLIENTS must be a non-negative integer (0 = unlimited), ` +
      `got ${JSON.stringify(process.env.WS_MAX_CLIENTS)}`,
  );
}

if (!Number.isInteger(config.trustProxyHops) || config.trustProxyHops < 0) {
  throw new Error(
    `TRUST_PROXY_HOPS must be a non-negative integer (0 = no proxy), ` +
      `got ${JSON.stringify(process.env.TRUST_PROXY_HOPS)}`,
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

