import type { TreeDb } from './db.js';

// Avatar-aesthetic palette — matches the client-side tree material palette.
const ROOT_COLORS = ['neon-magenta', 'neon-cyan', 'neon-violet', 'neon-lime', 'neon-orange'];

export interface SeedResult {
  seeded: boolean;
}

/**
 * Ensures the tree is never empty. First boot (or first boot with a fresh
 * volume) drops in one Starburst at the pedestal origin so visitors always
 * have something to branch from.
 *
 * Idempotent — calling repeatedly is safe because of the hasAnyLive check.
 */
export function seedRootIfEmpty(tree: TreeDb): SeedResult {
  if (tree.hasAnyLive()) return { seeded: false };
  const seed = Math.floor(Math.random() * 0xffffffff);
  const colorKey = ROOT_COLORS[Math.floor(Math.random() * ROOT_COLORS.length)]!;
  tree.insertRoot({ variant: 'starburst', seed, colorKey });
  return { seeded: true };
}
