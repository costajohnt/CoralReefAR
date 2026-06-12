/**
 * Canonical Mulberry32. Given the same seed, emits the same sequence across
 * client + server — plenty for procedural art. Every step is bitwise or
 * `Math.imul`, so how the accumulator is stored (signed `| 0` vs unsigned
 * `>>> 0`) never changes the stream; the streams only ever diverged on seed 0,
 * which callers that care guard explicitly (see RNG below).
 *
 * Single source of truth for the algorithm. `seededRand` in the tree generator
 * re-exports this; do not fork a second copy.
 */
export function mulberry32(seed: number): () => number {
  let state = (seed | 0) >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

/**
 * Deterministic PRNG with sampling helpers (range/int/pick/chance) over the
 * canonical {@link mulberry32} stream. Maps seed 0 → 1 so a 0 seed doesn't pin
 * the stream to its fixed point.
 */
export class RNG {
  private readonly _next: () => number;

  constructor(seed: number) {
    this._next = mulberry32((seed | 0) || 1);
  }

  next(): number {
    return this._next();
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick from empty');
    return items[Math.floor(this.next() * items.length)]!;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}
