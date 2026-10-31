import type { SimDelta } from '@reef/shared';
import { stepEcosystem } from './ecosystem.js';
import type { ReefDb } from './db.js';
import type { Hub } from './hub.js';
import { counters } from './metrics-registry.js';

/**
 * Hourly background growth tick. Applies probabilistic rules to aged polyps:
 * - Polyps older than 30 days have a small chance per tick of gaining a barnacle
 * - Polyps older than 60 days have a smaller chance of gaining algae
 * Broadcasts sim updates to connected clients.
 */
// better-sqlite3 throws synchronously on SQLITE_FULL / BUSY / IOERR. Inside a
// timer callback that is an uncaughtException and the process dies, so both
// workers run their body through this boundary and report instead of crash.
function guarded(name: string, body: () => void, onError: (err: unknown) => void): void {
  try {
    body();
  } catch (err) {
    counters.inc(`${name}_errors`);
    onError(err);
  }
}

export class SimWorker {
  private timer: NodeJS.Timeout | undefined;
  /** Called when a scheduled tick throws. Default logs; index.ts wires app.log. */
  onError: (err: unknown) => void = (err) => console.error('sim tick failed', err);

  constructor(
    private readonly db: ReefDb,
    private readonly hub: Hub,
    private readonly intervalMs: number,
    // Sim deltas older than this are pruned each tick. 0 disables pruning.
    private readonly retentionMs = 0,
    // Source of randomness for the probabilistic growth rolls. Defaults to
    // Math.random in production; tests inject a deterministic stream so the
    // tick outcome is exact rather than "passes with very high probability".
    private readonly rng: () => number = Math.random,
    // Injectable clock so ecosystem steps are exact in tests.
    private readonly clock: () => number = Date.now,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.safeTick(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** tick() behind the error boundary; what the timer runs. */
  safeTick(): void {
    guarded('sim_tick', () => { this.tick(); }, this.onError);
  }

  tick(): SimDelta[] {
    const now = this.clock();
    const polyps = this.db.listPublicPolyps();
    const updates: SimDelta[] = [];

    for (const p of polyps) {
      const ageDays = (now - p.createdAt) / 86_400_000;

      if (ageDays > 30 && this.rng() < 0.02) {
        updates.push({
          polypId: p.id, kind: 'barnacle', createdAt: now,
          params: { u: this.rng(), v: this.rng(), size: 0.3 + this.rng() * 0.7 },
        });
      }
      if (ageDays > 60 && this.rng() < 0.01) {
        updates.push({
          polypId: p.id, kind: 'algae', createdAt: now,
          params: { u: this.rng(), v: this.rng(), coverage: 0.1 + this.rng() * 0.3 },
        });
      }
      if (ageDays > 90 && this.rng() < 0.005) {
        updates.push({
          polypId: p.id, kind: 'weather', createdAt: now,
          params: { variance: 0.1 + this.rng() * 0.2 },
        });
      }
    }

    // Ecosystem (#117): one indexed aggregate plus a single-row upsert, so it
    // adds O(1) work on top of the per-polyp decoration pass above. Saved in
    // the same transaction as the deltas.
    const ecosystem = stepEcosystem(this.db.getEcosystem(), this.db.ecosystemInputs(now));
    this.db.transaction(() => {
      for (const u of updates) this.db.insertSim(u);
      this.db.saveEcosystem(ecosystem);
    });
    // Broadcast every tick (not only when decorations grew) so clients pick
    // up fish/bleaching changes. Older clients ignore the extra field.
    this.hub.broadcast({ type: 'sim_update', updates, ecosystem });

    // Prune aged deltas every tick (even when nothing grew) so sim_state stays
    // bounded by the retention window rather than growing forever.
    if (this.retentionMs > 0) {
      this.db.pruneSimBefore(now - this.retentionMs);
    }
    return updates;
  }
}

export class SnapshotWorker {
  private timer: NodeJS.Timeout | undefined;
  /** Called when a scheduled snapshot throws. Default logs; index.ts wires app.log. */
  onError: (err: unknown) => void = (err) => console.error('snapshot failed', err);

  constructor(
    private readonly db: ReefDb,
    private readonly intervalMs: number,
    // Keep at most this many recent snapshots; older ones are pruned after each
    // new one. 0 disables pruning (keep all).
    private readonly retentionCount = 0,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.safeTake(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** take() behind the error boundary; what the timer runs. */
  safeTake(): void {
    guarded('snapshot', () => { this.take(); }, this.onError);
  }

  take(): number {
    const polyps = this.db.listPublicPolyps();
    const sim = this.db.listSim();
    const ecosystem = this.db.getEcosystem();
    const stateJson = JSON.stringify(ecosystem ? { polyps, sim, ecosystem } : { polyps, sim });
    const id = this.db.insertSnapshot(polyps.length, stateJson);
    if (this.retentionCount > 0) {
      this.db.pruneOldSnapshots(this.retentionCount);
    }
    return id;
  }
}
