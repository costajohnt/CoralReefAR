// Tiny in-memory counter registry for Prometheus. Single process only —
// if the server ever horizontally scales, scrape each instance and let
// Prometheus sum, or move to a real client library.

export interface CounterSnapshot {
  readonly name: string;
  readonly value: number;
}

class Counters {
  private readonly values = new Map<string, number>();

  inc(name: string, amount = 1): void {
    this.values.set(name, (this.values.get(name) ?? 0) + amount);
  }

  get(name: string): number {
    return this.values.get(name) ?? 0;
  }

  // Exposed for tests: zero a counter so bumps in earlier tests don't
  // leak into later ones. Production code never calls this.
  reset(name: string): void {
    this.values.set(name, 0);
  }

  snapshot(): CounterSnapshot[] {
    return Array.from(this.values, ([name, value]) => ({ name, value }));
  }
}

// Module-level singleton so route handlers can `inc` without plumbing an
// instance through every route. Explicit state, no magic.
export const counters = new Counters();
