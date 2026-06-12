import type { FastifyInstance } from 'fastify';
import { TreePolypInputSchema } from '@reef/shared';
import type { Hub } from '../hub.js';
import type { TreeDb } from './db.js';
import { seedRootIfEmpty } from './seed.js';
import { enforceAdminIfConfigured } from '../auth.js';
import { deviceHash, deviceHashesForCounting } from '../deviceHash.js';
import { config } from '../config.js';
import { counters } from '../metrics-registry.js';

const NUMERIC_ID_RE = /^\d+$/;

export function registerTreeRoutes(app: FastifyInstance, tree: TreeDb, hub: Hub): void {
  app.get('/api/tree', async () => ({
    polyps: tree.listLive(),
    serverTime: Date.now(),
  }));

  // Reset: soft-delete every live polyp, then seed a fresh Starburst root so
  // the tree never boots into a "no attach point" state. Clients re-fetch
  // after the call (see packages/client/src/tree/api.ts).
  // Destructive (wipes the whole shared tree): gated behind the admin token
  // whenever one is configured, so a public deploy can't be wiped by anyone.
  app.post('/api/tree/reset', async (req, reply) => {
    if (!enforceAdminIfConfigured(req, reply)) return reply;
    tree.deleteAll();
    seedRootIfEmpty(tree);
    const polyps = tree.listLive();
    hub.broadcast({ type: 'tree_reset' });
    if (polyps[0]) {
      hub.broadcast({ type: 'tree_polyp_added', polyp: polyps[0] });
    }
    return { polyps };
  });

  app.post('/api/tree/polyp', async (req, reply) => {
    const parsed = TreePolypInputSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid payload', issues: parsed.error.issues };
    }

    // Per-device write limit, mirroring the reef route. Off by default
    // (RATE_LIMIT_MAX=0); counts this device's live tree pieces in the window.
    const ua = req.headers['user-agent'] ?? 'unknown';
    const ip = req.ip || req.headers['x-forwarded-for']?.toString() || 'unknown';
    const dh = deviceHash(String(ua), String(ip), config.rateLimitWindowMs);
    const windowStart = Date.now() - config.rateLimitWindowMs;
    // Count under the current AND previous window's hash so crossing a window
    // boundary can't reset the count (see deviceHashesForCounting).
    const countHashes = deviceHashesForCounting(String(ua), String(ip), config.rateLimitWindowMs);
    const already = countHashes.reduce((n, h) => n + tree.countByDeviceSince(h, windowStart), 0);
    if (config.rateLimitMax > 0 && already >= config.rateLimitMax) {
      counters.inc('rate_limited');
      const oldests = countHashes
        .map((h) => tree.oldestByDeviceSince(h, windowStart))
        .filter((t): t is number => t !== null);
      const oldest = oldests.length ? Math.min(...oldests) : null;
      const retryAfterMs = oldest !== null
        ? Math.max(0, oldest + config.rateLimitWindowMs - Date.now())
        : config.rateLimitWindowMs;
      reply.header('Retry-After', Math.ceil(retryAfterMs / 1000));
      reply.code(429);
      return { error: 'rate_limited', retryAfterMs };
    }

    const input = parsed.data;
    let polyp;
    try {
      polyp = input.parentId === null
        ? tree.insertRoot({ variant: input.variant, seed: input.seed, colorKey: input.colorKey, deviceHash: dh })
        : tree.insertChild({
            variant: input.variant,
            seed: input.seed,
            colorKey: input.colorKey,
            parentId: input.parentId,
            attachIndex: input.attachIndex,
            attachYaw: input.attachYaw,
            deviceHash: dh,
          });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/parent not found/i.test(msg)) { reply.code(404); return { error: msg }; }
      if (/already claim/i.test(msg))    { reply.code(409); return { error: msg }; }
      reply.code(500);
      return { error: msg };
    }
    // Best-effort notification: a broadcast failure must not turn a
    // successfully persisted polyp into a 500 the client would retry — a retry
    // would re-insert and inflate the device's rate-limit count. Mirrors reef.
    try {
      hub.broadcast({ type: 'tree_polyp_added', polyp });
    } catch (err) {
      req.log.warn({ err, polypId: polyp.id }, 'tree hub broadcast failed after insert');
    }
    return polyp;
  });

  app.delete('/api/tree/polyp/:id', async (req, reply) => {
    // Deleting a leaf is also gated once an admin token is configured: in a
    // public deploy, removing shared pieces is an operator action, not a
    // visitor one. Without a token (single-install / testing) Undo stays open.
    if (!enforceAdminIfConfigured(req, reply)) return reply;
    const { id: rawId } = req.params as { id: string };
    if (!NUMERIC_ID_RE.test(rawId)) {
      reply.code(400);
      return { error: 'id must be a positive integer' };
    }
    const id = Number(rawId);
    const result = tree.softDelete(id);
    if (!result.ok) {
      if (result.reason === 'not_found') {
        reply.code(404);
        return { error: 'polyp not found' };
      }
      reply.code(409);
      return { error: result.reason ?? 'cannot delete' };
    }
    hub.broadcast({ type: 'tree_polyp_removed', id });
    return { ok: true };
  });
}
