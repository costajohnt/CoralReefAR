import { z } from 'zod';
import { REEF_PALETTE } from './palette.js';
import { SPECIES } from './types.js';

const finite = z.number().finite();

// Pedestal-local coordinates. ±1m covers any reasonable pedestal and keeps
// malformed submissions from landing a polyp on the other side of the room.
const COORD_MAX = 1.0;
const coord = finite.min(-COORD_MAX).max(COORD_MAX);

const vec3 = z.tuple([coord, coord, coord]);
const unit = finite.min(-1).max(1);
const quat = z.tuple([unit, unit, unit, unit]).refine(
  (q) => {
    const len = Math.hypot(q[0], q[1], q[2], q[3]);
    return len > 0.9 && len < 1.1;
  },
  { message: 'quaternion must be unit length' },
);

const colorKeys = REEF_PALETTE.map((p) => p.key) as [string, ...string[]];

export const PolypInputSchema = z.object({
  species: z.enum(SPECIES),
  seed: finite.int().nonnegative().max(0xffffffff),
  colorKey: z.enum(colorKeys),
  position: vec3,
  orientation: quat,
  scale: finite.positive().max(3),
});

export type PolypInputPayload = z.infer<typeof PolypInputSchema>;
