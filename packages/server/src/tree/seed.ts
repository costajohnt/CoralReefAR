import type { TreeDb } from './db.js';

// Avatar-aesthetic palette — matches the client-side tree material palette.
const ROOT_COLORS = ['neon-magenta', 'neon-cyan', 'neon-violet', 'neon-lime', 'neon-orange'];

export interface SeedOptions {
  /**
   * Fixed root seed. Set this (e.g. from config) to make the first-boot root
   * reproducible across fresh volumes — useful for golden-style testing. When
   * omitted, a random seed is chosen and returned in {@link SeedResult} so the
   * caller can log it and reproduce the root after the fact.
   */
  seed?: number | undefined;
  /** Fixed root colorKey; same determinism trade-off as {@link SeedOptions.seed}. */
  colorKey?: string | undefined;
}

export interface SeedResult {
  seeded: boolean;
  /** The seed actually used (random or supplied) — only present when seeded. */
  seed?: number;
  /** The colorKey actually used (random or supplied) — only present when seeded. */
  colorKey?: string;
}

/**
 * Ensures the tree is never empty. First boot (or first boot with a fresh
 * volume) drops in one Starburst at the pedestal origin so visitors always
 * have something to branch from.
 *
 * The root seed/colorKey are random by default but overridable via `opts` for
 * deterministic boots; either way the chosen values come back in the result so
 * the caller can log them (the random root is then reproducible after the fact).
 *
 * Idempotent — calling repeatedly is safe because of the hasAnyLive check.
 */
export function seedRootIfEmpty(tree: TreeDb, opts: SeedOptions = {}): SeedResult {
  if (tree.hasAnyLive()) return { seeded: false };
  const seed = opts.seed ?? Math.floor(Math.random() * 0xffffffff);
  const colorKey = opts.colorKey ?? ROOT_COLORS[Math.floor(Math.random() * ROOT_COLORS.length)]!;
  tree.insertRoot({ variant: 'starburst', seed, colorKey });
  return { seeded: true, seed, colorKey };
}
