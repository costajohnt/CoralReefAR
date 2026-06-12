import { z } from 'zod';

// Runtime validation for inbound WebSocket frames. Deliberately structural and
// version-skew tolerant: species / variant / colorKey are validated as strings
// (not enums) so a newer server adding a value doesn't fail an older client's
// envelope check. The goal is to reject malformed / missing-field frames, not
// well-formed frames carrying an unknown-but-valid value.

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const quat = z.tuple([z.number(), z.number(), z.number(), z.number()]);

// The reef polyp shape as it crosses the wire — embedded in `polyp_added`
// frames and returned verbatim by GET /api/reef and POST /api/reef/polyp.
// Exported so a test (or any caller) can validate a live HTTP response against
// the same contract the WS layer enforces, instead of blind-casting r.json().
export const PublicPolypSchema = z.object({
  id: z.number(),
  species: z.string(),
  seed: z.number(),
  colorKey: z.string(),
  position: vec3,
  orientation: quat,
  scale: z.number(),
  createdAt: z.number(),
});

const simDelta = z.object({
  polypId: z.number(),
  kind: z.string(),
  params: z.record(z.union([z.number(), z.string()])),
  createdAt: z.number(),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), polypCount: z.number(), serverTime: z.number() }),
  z.object({ type: z.literal('polyp_added'), polyp: PublicPolypSchema }),
  z.object({ type: z.literal('polyp_removed'), id: z.number() }),
  z.object({ type: z.literal('sim_update'), updates: z.array(simDelta) }),
]);

// The tree polyp shape as it crosses the wire — embedded in `tree_polyp_added`
// frames and returned verbatim by GET /api/tree and POST /api/tree/polyp.
// Exported for the same reason as PublicPolypSchema.
export const PublicTreePolypSchema = z.object({
  id: z.number(),
  variant: z.string(),
  seed: z.number(),
  colorKey: z.string(),
  parentId: z.number().nullable(),
  attachIndex: z.number(),
  attachYaw: z.number(),
  createdAt: z.number(),
});

export const TreeServerMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('tree_hello'), polypCount: z.number(), serverTime: z.number() }),
  z.object({ type: z.literal('tree_polyp_added'), polyp: PublicTreePolypSchema }),
  z.object({ type: z.literal('tree_polyp_removed'), id: z.number() }),
  z.object({ type: z.literal('tree_reset') }),
]);
