import type { FastifyInstance } from 'fastify';
import type { ReefDb } from '../db.js';

export function registerSnapshotRoutes(app: FastifyInstance, db: ReefDb): void {
  app.get('/api/snapshots', async () => db.listSnapshots());

  app.get<{ Params: { id: string } }>('/api/snapshots/:id', async (req, reply) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return reply.status(400).send({ error: 'invalid_id' });
    const snap = db.getSnapshot(id);
    if (!snap) return reply.status(404).send({ error: 'not_found' });
    return snap;
  });
}
