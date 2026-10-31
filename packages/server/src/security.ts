import type { FastifyInstance } from 'fastify';
import { config } from './config.js';
import { counters } from './metrics-registry.js';

// The 8th Wall engine (packages/client/index.html, treeAr.html) is loaded
// from this CDN origin with an SRI hash; the engine then fetches its SLAM
// chunks, wasm and tflite models from the same origin (connect-src), runs them
// from blob: workers (worker-src) and compiles wasm ('wasm-unsafe-eval').
// Without these the browser blocks xr.js wherever the server hosts the client
// bundle (CLIENT_DIST_DIR) and AR silently falls back to the Noop provider.
export const ENGINE_CDN_ORIGIN = 'https://cdn.jsdelivr.net';

// script-src has NO 'unsafe-inline' — inline scripts are blocked globally.
// The only server-rendered page with an inline script (the admin panel) sets
// its own per-response CSP with a nonce. style-src keeps 'unsafe-inline' for
// now (runtime-set styles); tightening it is a follow-up.
function buildCsp(scriptNonce?: string): string {
  const nonce = scriptNonce ? ` 'nonce-${scriptNonce}'` : '';
  const scriptSrc = `script-src 'self'${nonce} ${ENGINE_CDN_ORIGIN} 'wasm-unsafe-eval'`;
  return [
    "default-src 'self'",
    "img-src 'self' blob: data:",
    `connect-src 'self' ws: wss: ${ENGINE_CDN_ORIGIN}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    scriptSrc,
    "frame-ancestors 'none'",
    "base-uri 'none'",
  ].join('; ');
}

/** CSP that allows one inline script tagged with `nonce`. Used by /admin. */
export function cspWithScriptNonce(nonce: string): string {
  return buildCsp(nonce);
}

const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': buildCsp(),
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
    if (req.method !== 'GET' || !req.url.startsWith('/api/')) return;
    const check = limit(req.ip || 'unknown');
    if (check.ok) return;
    counters.inc('rate_limited');
    reply.header('Retry-After', Math.ceil(check.retryAfterMs / 1000));
    return reply.status(429).send({ error: 'rate_limited' });
  });
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
