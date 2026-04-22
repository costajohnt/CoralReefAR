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
});

export type TreePolypInput = z.infer<typeof TreePolypInputSchema>;
