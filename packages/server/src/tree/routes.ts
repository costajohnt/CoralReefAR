import type { FastifyInstance } from 'fastify';
import { TreePolypInputSchema } from '@reef/shared';
import type { Hub } from '../hub.js';
import type { TreeDb } from './db.js';
import { seedRootIfEmpty } from './seed.js';

export function registerTreeRoutes(app: FastifyInstance, tree: TreeDb, hub: Hub): void {
  app.get('/api/tree', async () => ({
    polyps: tree.listLive(),
    serverTime: Date.now(),
  }));

  // Reset: soft-delete every live polyp, then seed a fresh Starburst root so
  // the tree never boots into a "no attach point" state. Clients re-fetch
  // after the call (see packages/client/src/tree/api.ts).
  app.post('/api/tree/reset', async () => {
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
}
