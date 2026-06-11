import type { FastifyInstance } from 'fastify';
import { TreePolypInputSchema } from '@reef/shared';
import type { Hub } from '../hub.js';
import type { TreeDb } from './db.js';
import { seedRootIfEmpty } from './seed.js';
import { enforceAdminIfConfigured } from '../auth.js';

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
    hub.broadcast({ type: 'tree_reset' } as never);
    if (polyps[0]) {
      hub.broadcast({ type: 'tree_polyp_added', polyp: polyps[0] } as never);
    }
    return { polyps };
  });

  app.post('/api/tree/polyp', async (req, reply) => {
    const parsed = TreePolypInputSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: 'invalid payload', issues: parsed.error.issues };
    }
    const input = parsed.data;
    try {
      const polyp = input.parentId === null
        ? tree.insertRoot({ variant: input.variant, seed: input.seed, colorKey: input.colorKey })
        : tree.insertChild({
            variant: input.variant,
            seed: input.seed,
            colorKey: input.colorKey,
            parentId: input.parentId,
            attachIndex: input.attachIndex,
            attachYaw: input.attachYaw,
          });
      hub.broadcast({ type: 'tree_polyp_added', polyp } as never);
      return polyp;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/parent not found/i.test(msg)) { reply.code(404); return { error: msg }; }
      if (/already claim/i.test(msg))    { reply.code(409); return { error: msg }; }
      reply.code(500);
      return { error: msg };
    }
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
    hub.broadcast({ type: 'tree_polyp_removed', id } as never);
    return { ok: true };
  });
}
