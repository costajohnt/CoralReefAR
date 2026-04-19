import type { SimDelta } from '@reef/shared';
import type { ReefDb } from './db.js';
import type { Hub } from './hub.js';

/**
 * Hourly background growth tick. Applies probabilistic rules to aged polyps:
 * - Polyps older than 30 days have a small chance per tick of gaining a barnacle
 * - Polyps older than 60 days have a smaller chance of gaining algae
 * Broadcasts sim updates to connected clients.
 */
export class SimWorker {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly db: ReefDb,
    private readonly hub: Hub,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  tick(): SimDelta[] {
    const now = Date.now();
    const polyps = this.db.listPublicPolyps();
    const updates: SimDelta[] = [];

    for (const p of polyps) {
      const ageDays = (now - p.createdAt) / 86_400_000;

      if (ageDays > 30 && Math.random() < 0.02) {
        updates.push({
          polypId: p.id, kind: 'barnacle', createdAt: now,
          params: { u: Math.random(), v: Math.random(), size: 0.3 + Math.random() * 0.7 },
        });
      }
      if (ageDays > 60 && Math.random() < 0.01) {
        updates.push({
          polypId: p.id, kind: 'algae', createdAt: now,
          params: { u: Math.random(), v: Math.random(), coverage: 0.1 + Math.random() * 0.3 },
        });
      }
      if (ageDays > 90 && Math.random() < 0.005) {
        updates.push({
          polypId: p.id, kind: 'weather', createdAt: now,
          params: { variance: 0.1 + Math.random() * 0.2 },
        });
      }
    }

    if (updates.length > 0) {
      this.db.transaction(() => {
        for (const u of updates) this.db.insertSim(u);
      });
      this.hub.broadcast({ type: 'sim_update', updates });
    }
    return updates;
  }
}

export class SnapshotWorker {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly db: ReefDb,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    this.timer = setInterval(() => this.take(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  take(): number {
    const polyps = this.db.listPublicPolyps();
    const sim = this.db.listSim();
    const stateJson = JSON.stringify({ polyps, sim });
    return this.db.insertSnapshot(polyps.length, stateJson);
  }
}
