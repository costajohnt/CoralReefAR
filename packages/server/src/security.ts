import type { FastifyInstance } from 'fastify';

const HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' blob: data:; connect-src 'self' ws: wss:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'",
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
 */
export function perIpRateLimit(opts: { tokensPerInterval: number; intervalMs: number }) {
  const state = new Map<string, { tokens: number; last: number }>();
  const { tokensPerInterval, intervalMs } = opts;

  return (ip: string): { ok: boolean; retryAfterMs: number } => {
    const now = Date.now();
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
