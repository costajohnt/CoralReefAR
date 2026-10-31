import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  OWNER_HEADER, PolypInputSchema, UNDO_WINDOW_MS, isOwnerToken,
  type Polyp, type ReefState,
} from '@reef/shared';
import { config } from '../config.js';
import type { ReefDb } from '../db.js';
import { toPublicPolyp } from '../db.js';
import type { Hub } from '../hub.js';
import { deviceHash, deviceHashesForCounting } from '../deviceHash.js';
import { perIpRateLimit, ttlCache, writeIpBackstop } from '../security.js';
import { counters } from '../metrics-registry.js';
import { ownerHash } from '../ownerHash.js';
import { stepEcosystem } from '../ecosystem.js';

const NUMERIC_ID_RE = /^\d+$/;
// Quest Browser identifies itself in the UA as "OculusBrowser/<version>". The
// `surface` body field is client-supplied, so the looser Quest bucket is only
// granted when the UA agrees. A UA is spoofable too, which is why the bucket
// is opt-in (QUEST_RATE_LIMIT_MAX defaults to 0); this check is defense in
// depth, not proof.
const QUEST_UA_RE = /\bOculusBrowser\/\d/;

// Owner token from the request header: absent → null, malformed → 'invalid'.
// The value is a credential for undo, so it is never logged or echoed back.
function readOwnerToken(req: FastifyRequest): string | null | 'invalid' {
  const raw = req.headers[OWNER_HEADER];
  if (raw === undefined) return null;
  return isOwnerToken(raw) ? raw : 'invalid';
}

const UNDO_STATUS: Record<string, { code: number; error: string }> = {
  not_found: { code: 404, error: 'not_found' },
  not_owner: { code: 403, error: 'not_owner' },
  not_latest: { code: 409, error: 'not_latest' },
  expired: { code: 409, error: 'undo_window_expired' },
};

export function registerReefRoutes(app: FastifyInstance, db: ReefDb, hub: Hub): void {
  // Reads are limited by the shared GET /api/* hook (installReadRateLimit).
  // Undo gets its own bucket so undo traffic can't starve reads (or vice versa).
  const undoLimit = config.undoRateLimitPerMin > 0
    ? perIpRateLimit({ tokensPerInterval: config.undoRateLimitPerMin, intervalMs: 60_000 })
    : null;

  // The polyps + sim scans (and the ecosystem aggregate before the first sim
  // tick) are the expensive part of GET /api/reef. Cache them for
  // READ_CACHE_TTL_MS so a burst of reads coalesces into one scan. The sim
  // payload is bounded to the retention window (0 = retention disabled → all).
  const buildSnapshot = (): Omit<ReefState, 'serverTime'> => {
    const now = Date.now();
    return {
      polyps: db.listPublicPolyps(),
      sim: config.simRetentionMs > 0 ? db.listSimSince(now - config.simRetentionMs) : db.listSim(),
      // Before the first sim tick there is no saved row; compute a starting
      // state (healthy, see stepEcosystem) rather than omit the field.
      ecosystem: db.getEcosystem() ?? stepEcosystem(null, db.ecosystemInputs(now)),
    };
  };
  // Per-IP backstop behind the per-visitor write limit (see writeIpBackstop).
  const ipBackstop = writeIpBackstop();

  const readSnapshot = config.readCacheTtlMs > 0
    ? ttlCache(buildSnapshot, config.readCacheTtlMs)
    : buildSnapshot;

  app.get('/api/reef', async () => {
    // serverTime is always fresh even when the scans are served from cache.
    const state: ReefState = { ...readSnapshot(), serverTime: Date.now() };
    return state;
  });

  // "My polyps": ids of the caller's live polyps, so the client can highlight
  // them. Uncached (per-owner) but a single indexed lookup.
  app.get('/api/reef/mine', async (req, reply) => {
    const token = readOwnerToken(req);
    if (token === null || token === 'invalid') {
      return reply.status(400).send({ error: 'invalid_owner' });
    }
    return { ids: db.listOwnedIds(ownerHash(token)) };
  });

  // Owner undo: the caller may soft-delete their own most recent polyp within
  // UNDO_WINDOW_MS of planting it. Not admin-gated: the owner token is the
  // authorization. All checks + the delete are one transaction (db.undoPolyp).
  app.post('/api/reef/polyp/:id/undo', async (req, reply) => {
    if (undoLimit) {
      const check = undoLimit(req.ip || 'unknown');
      if (!check.ok) {
        counters.inc('rate_limited');
        reply.header('Retry-After', Math.ceil(check.retryAfterMs / 1000));
        return reply.status(429).send({ error: 'rate_limited' });
      }
    }
    const { id: rawId } = req.params as { id: string };
    if (!NUMERIC_ID_RE.test(rawId)) return reply.status(400).send({ error: 'invalid_id' });
    const token = readOwnerToken(req);
    if (token === null || token === 'invalid') {
      return reply.status(400).send({ error: 'invalid_owner' });
    }
    const id = Number(rawId);
    const result = db.undoPolyp(id, ownerHash(token), Date.now(), UNDO_WINDOW_MS);
    if (result.status === 'undone') {
      try {
        hub.broadcast({ type: 'polyp_removed', id });
      } catch (err) {
        req.log.warn({ err, polypId: id }, 'hub broadcast failed after undo');
      }
      return { ok: true };
    }
    // Repeat undo of the same polyp: already gone, so report success without
    // a second broadcast.
    if (result.status === 'already_undone') return { ok: true };
    const { code, error } = UNDO_STATUS[result.status]!;
    return reply.status(code).send({ error });
  });

  app.post('/api/reef/polyp', async (req, reply) => {
    const parsed = PolypInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'invalid_input', issues: parsed.error.issues });
    }
    // Clients that predate #112 send no owner header and get an unowned polyp
    // (no highlight, no undo); only allowed while the write limit is off.
    const token = readOwnerToken(req);
    if (token === 'invalid') return reply.status(400).send({ error: 'invalid_owner' });
    // The write limit is keyed on the owner token, so a tokenless plant could
    // only be limited by the shared UA|IP hash, which is the venue collision
    // the token exists to avoid. With the limit on, require the token (every
    // shipped client sends one; see net/api.ts ownerHeaders).
    if (token === null && config.rateLimitMax > 0) {
      return reply.status(400).send({
        error: 'owner_required',
        message: `${OWNER_HEADER} header is required to plant while RATE_LIMIT_MAX is set`,
      });
    }

    const ua = String(req.headers['user-agent'] ?? 'unknown');
    const ip = req.ip || 'unknown';
    const dh = deviceHash(ua, ip, config.rateLimitWindowMs);

    const windowStart = Date.now() - config.rateLimitWindowMs;
    // The write limit is keyed on the owner token (random per browser, sent
    // on every plant) so visitors sharing venue wifi and a phone model are
    // limited independently. Only tokenless clients (limit off) are keyed on
    // the UA|IP device hash, and nothing is ever charged across the two keys:
    // a tokenless plant must not drain the budget of every same-UA visitor
    // behind the venue NAT. Device counts cover the current AND previous
    // window's hash so crossing a window boundary can't reset them (see
    // deviceHashesForCounting).
    const ownerKey = token ? ownerHash(token) : null;
    const countHashes = deviceHashesForCounting(ua, ip, config.rateLimitWindowMs);
    const visitor = ownerKey
      ? {
        count: db.countByOwnerSince(ownerKey, windowStart),
        oldest: () => [db.oldestOwnedSince(ownerKey, windowStart)],
      }
      : {
        count: countHashes.reduce((n, h) => n + db.countByDeviceSince(h, windowStart), 0),
        oldest: () => countHashes.map((h) => db.oldestPolypSince(h, windowStart)),
      };
    const limitMax = parsed.data.surface === 'quest' && QUEST_UA_RE.test(ua) && config.questRateLimitMax > 0
      ? config.questRateLimitMax
      : config.rateLimitMax;
    if (limitMax > 0 && visitor.count >= limitMax) {
      counters.inc('rate_limited');
      const oldests = visitor.oldest().filter((t): t is number => t !== null);
      const oldest = oldests.length ? Math.min(...oldests) : null;
      const retryAfterMs = oldest !== null
        ? Math.max(0, oldest + config.rateLimitWindowMs - Date.now())
        : config.rateLimitWindowMs;
      reply.header('Retry-After', Math.ceil(retryAfterMs / 1000));
      return reply.status(429).send({ error: 'rate_limited', retryAfterMs });
    }
    // Per-IP backstop, checked last because a check consumes a token.
    const backstop = ipBackstop?.(ip);
    if (backstop && !backstop.ok) {
      counters.inc('rate_limited');
      const retryAfterMs = Math.ceil(backstop.retryAfterMs);
      reply.header('Retry-After', Math.ceil(retryAfterMs / 1000));
      return reply.status(429).send({ error: 'rate_limited', retryAfterMs });
    }

    // `surface` is a transport-only field for routing rate-limit buckets;
    // strip before persisting so it never lands in the DB.
    const { surface: _surface, ...inputFields } = parsed.data;
    void _surface;
    const polyp: Omit<Polyp, 'id' | 'deleted'> = {
      ...inputFields,
      createdAt: Date.now(),
      deviceHash: dh,
    };
    const saved = db.insertPolyp(polyp, token ? ownerHash(token) : null);
    const pub = toPublicPolyp(saved);
    // Broadcast is a best-effort notification — a failure here must not turn
    // a successfully persisted polyp into a 500 the client would retry.
    try {
      hub.broadcast({ type: 'polyp_added', polyp: pub });
    } catch (err) {
      req.log.warn({ err, polypId: saved.id }, 'hub broadcast failed after insert');
    }
    return reply.status(201).send(pub);
  });
}
