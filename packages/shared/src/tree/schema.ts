import { z } from 'zod';
import { REEF_PALETTE } from '../palette.js';
import type { TreeVariant } from './types.js';

export const TreeVariantSchema = z.enum([
  'forked', 'trident', 'starburst', 'claw', 'wishbone',
]);

/**
 * Number of attach points (tips a child can grow from) each variant exposes.
 * The generator's variant builders are the source of truth for the geometry;
 * a generator test asserts each builder's `attachPoints.length` matches this
 * map, so adding a tip without updating this (and the schema bound below) fails
 * CI rather than silently 400-ing valid placements.
 */
export const TREE_VARIANT_ATTACH_COUNTS: Record<TreeVariant, number> = {
  forked: 2,
  trident: 3,
  starburst: 4,
  claw: 2,
  wishbone: 2,
};

/** Highest valid attachIndex across all variants (starburst's 4 tips → 0..3). */
export const MAX_TREE_ATTACH_INDEX =
  Math.max(...Object.values(TREE_VARIANT_ATTACH_COUNTS)) - 1;

const treeColorKeys = REEF_PALETTE.map((p) => p.key) as [string, ...string[]];

export const TreePolypInputSchema = z.object({
  variant: TreeVariantSchema,
  seed: z.number().int().nonnegative().max(0xffffffff),
  colorKey: z.enum(treeColorKeys),
  parentId: z.number().int().positive().nullable(),
  attachIndex: z.number().int().min(0).max(MAX_TREE_ATTACH_INDEX),
  // Radians around the parent attach-point normal. Optional for backwards
  // compatibility with older clients; defaults to 0 (canonical orientation).
  attachYaw: z.number().finite().optional().default(0),
});

// z.input — the shape clients construct before parse. attachYaw is optional
// here (defaults to 0 post-parse on the server side).
export type TreePolypInput = z.input<typeof TreePolypInputSchema>;
