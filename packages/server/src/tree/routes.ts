import type { FastifyInstance } from 'fastify';
import { TreePolypInputSchema } from '@reef/shared';
import type { Hub } from '../hub.js';
import type { TreeDb } from './db.js';

export function registerTreeRoutes(app: FastifyInstance, tree: TreeDb, hub: Hub): void {
  app.get('/api/tree', async () => ({
    polyps: tree.listLive(),
    serverTime: Date.now(),
  }));

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
