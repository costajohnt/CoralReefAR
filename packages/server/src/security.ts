import type { FastifyInstance } from 'fastify';
import { config } from './config.js';
import { counters } from './metrics-registry.js';

// The 8th Wall engine (packages/client/index.html, treeAr.html) is loaded
// from this exact package path on the CDN with an SRI hash. The path is part
// of the source expression on purpose: a bare origin would make every npm
// package on the CDN a script gadget. The engine then fetches its SLAM chunks,
// wasm and tflite models from the same path (connect-src), runs them from
// blob: workers (worker-src) and compiles wasm ('wasm-unsafe-eval'). Without
// these the browser blocks xr.js wherever the server hosts the client bundle
// (CLIENT_DIST_DIR) and AR silently falls back to the Noop provider. Bump the
// version here and in both HTML entry pages together; the boot smoke test
// checks they agree.
export const ENGINE_CDN_PATH = 'https://cdn.jsdelivr.net/npm/@8thwall/engine-binary@1.0.0/';

// script-src has NO 'unsafe-inline' — inline scripts are blocked globally.
// style-src keeps 'unsafe-inline' for now (runtime-set styles); tightening
// it is a follow-up.
function buildCsp(scriptSrc: string, connectSrc: string, workerSrc: string, imgSrc: string): string {
  return [
    "default-src 'self'",
    imgSrc,
    connectSrc,
    "media-src 'self' blob:",
    workerSrc,
    "style-src 'self' 'unsafe-inline'",
    scriptSrc,
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/** Policy for the client bundle and API responses: engine CDN path allowed. */
const PAGE_CSP = buildCsp(
  `script-src 'self' ${ENGINE_CDN_PATH} 'wasm-unsafe-eval'`,
  `connect-src 'self' ws: wss: ${ENGINE_CDN_PATH}`,
  "worker-src 'self' blob:",
  // xr.js injects its powered-by badge as <img> from the same path.
  `img-src 'self' blob: data: ${ENGINE_CDN_PATH}`,
);

/**
 * Strict CSP for the server-rendered admin panel: one inline script tagged
 * with `nonce`, no CDN, no wasm, no blob workers. The admin page never loads
 * the AR engine, so it gets none of the engine allowances.
 */
export function cspWithScriptNonce(nonce: string): string {
  return buildCsp(
    `script-src 'self' 'nonce-${nonce}'`,
    "connect-src 'self' ws: wss:",
    "worker-src 'self'",
    "img-src 'self' blob: data:",
  );
}

const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': PAGE_CSP,
};

export function installSecurityHeaders(app: FastifyInstance): void {
  app.addHook('onSend', async (_req, reply) => {
    for (const [k, v] of Object.entries(HEADERS)) {
      if (!reply.getHeader(k)) reply.header(k, v);
    }
  });
}

/**
 * Simple per-IP token bucket on a route. Keeps a map of IP → { tokens, last }.
 * Deliberately in-memory and per-process: the installation is single-box, and
 * we'd rather drop requests under abuse than add a Redis dependency.
 *
 * The map is bounded: a varied-IP attack (or legitimate traffic surge) can't
 * balloon it unbounded. When the cap is hit, stale entries (fully refilled
 * back to budget) are dropped — they'd recreate the identical state on their
 * next call anyway. If the GC sweep doesn't free space, the map is cleared
 * wholesale, which briefly resets rate-limit state but never OOMs.
 */
const MAX_IPS = 5000;
const GC_STALENESS_FACTOR = 2;

export function perIpRateLimit(opts: { tokensPerInterval: number; intervalMs: number }) {
  const state = new Map<string, { tokens: number; last: number }>();
  const { tokensPerInterval, intervalMs } = opts;

  return (ip: string): { ok: boolean; retryAfterMs: number } => {
    const now = Date.now();

    if (state.size >= MAX_IPS) {
      const stale = now - intervalMs * GC_STALENESS_FACTOR;
      for (const [k, v] of state) {
        if (v.last < stale) state.delete(k);
      }
      if (state.size >= MAX_IPS) state.clear();
    }

    const rec = state.get(ip) ?? { tokens: tokensPerInterval, last: now };
    const elapsed = now - rec.last;
    const refill = (elapsed / intervalMs) * tokensPerInterval;
    rec.tokens = Math.min(tokensPerInterval, rec.tokens + refill);
    rec.last = now;
    if (rec.tokens >= 1) {
      rec.tokens -= 1;
      state.set(ip, rec);
      return { ok: true, retryAfterMs: 0 };
    }
    state.set(ip, rec);
    const needed = 1 - rec.tokens;
    const retryAfterMs = (needed / tokensPerInterval) * intervalMs;
    return { ok: false, retryAfterMs };
  };
}

/**
 * One per-IP read limiter for every GET under /api/ (reef, mine, stats,
 * snapshots, tree), so no read path sits outside it. Off when
 * READ_RATE_LIMIT_PER_MIN is 0. Write and undo paths keep their own buckets.
 */
export function installReadRateLimit(app: FastifyInstance): void {
  if (config.readRateLimitPerMin <= 0) return;
  const limit = perIpRateLimit({ tokensPerInterval: config.readRateLimitPerMin, intervalMs: 60_000 });
  app.addHook('onRequest', async (req, reply) => {
    // Decide on the matched route pattern, not the raw URL: the router
    // normalises and decodes before matching, so a raw-prefix check can be
    // sidestepped (/%61pi/, //api/). HEAD is auto-exposed for every GET and
    // shares its budget.
    // Unmatched URLs have no route pattern; fall back to the raw URL so 404
    // probing under /api/ still draws from the bucket.
    const route = req.routeOptions.url ?? req.url;
    if ((req.method !== 'GET' && req.method !== 'HEAD') || !route.startsWith('/api/')) return;
    const check = limit(req.ip || 'unknown');
    if (check.ok) return;
    counters.inc('rate_limited');
    reply.header('Retry-After', Math.ceil(check.retryAfterMs / 1000));
    return reply.status(429).send({ error: 'rate_limited' });
  });
}

/**
 * Coarse per-IP backstop for write routes: RATE_LIMIT_IP_MAX successful plants
 * per IP per RATE_LIMIT_WINDOW_MS, whatever UA or owner token they carry, so
 * one address cannot dodge the per-visitor limit by minting tokens or rotating
 * its UA. In-memory token bucket (restarts reset it; a venue behind one NAT
 * shares it, so keep the value well above RATE_LIMIT_MAX). null when off.
 * Call it only for a plant that passed the per-visitor check, since checking
 * consumes a token.
 */
export function writeIpBackstop(): ((ip: string) => { ok: boolean; retryAfterMs: number }) | null {
  return config.rateLimitIpMax > 0
    ? perIpRateLimit({ tokensPerInterval: config.rateLimitIpMax, intervalMs: config.rateLimitWindowMs })
    : null;
}

/**
 * Wrap an expensive read so repeated calls within `ttlMs` share one result.
 * Coalesces a burst of identical reads (e.g. many clients loading /api/reef at
 * once) into a single DB scan per window. Bounded staleness only — there is no
 * invalidation, so keep `ttlMs` small. Single-threaded event loop, so no lock
 * needed: a value computed mid-window is simply reused until it expires.
 *
 * The same object reference is returned to every caller within the window, so
 * callers MUST treat the result as read-only — mutating it corrupts the cached
 * value for every subsequent request until the TTL expires.
 */
export function ttlCache<T>(produce: () => T, ttlMs: number): () => T {
  let cached: { value: T; at: number } | null = null;
  return () => {
    const now = Date.now();
    if (cached && now - cached.at < ttlMs) return cached.value;
    const value = produce();
    cached = { value, at: now };
    return value;
  };
}
