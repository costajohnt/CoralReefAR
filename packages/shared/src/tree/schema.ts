import { z } from 'zod';

export const TreeVariantSchema = z.enum([
  'forked', 'trident', 'starburst', 'claw', 'wishbone',
]);

export const TreePolypInputSchema = z.object({
  variant: TreeVariantSchema,
  seed: z.number().int().nonnegative().max(0xffffffff),
  colorKey: z.string().min(1).max(32),
  parentId: z.number().int().positive().nullable(),
  attachIndex: z.number().int().min(0).max(3),  // max 4 tips (starburst) = indices 0-3
  // Radians around the parent attach-point normal. Optional for backwards
  // compatibility with older clients; defaults to 0 (canonical orientation).
  attachYaw: z.number().finite().optional().default(0),
});

// z.input — the shape clients construct before parse. attachYaw is optional
// here (defaults to 0 post-parse on the server side).
export type TreePolypInput = z.input<typeof TreePolypInputSchema>;
