/**
 * "My polyps" provenance + landscape undo (issue #112).
 *
 * Each browser keeps a random owner ID in localStorage. The raw ID never
 * leaves the device: the client sends SHA-256(ID) as a hex token in the
 * OWNER_HEADER request header, and the server hashes that token again
 * before storing it (see packages/server/src/ownerHash.ts). No accounts.
 */

/** Request header carrying the client's owner token. */
export const OWNER_HEADER = 'x-reef-owner';

/** An owner token is a lowercase hex SHA-256 digest. */
export const OWNER_TOKEN_RE = /^[0-9a-f]{64}$/;

/**
 * How long after planting a polyp its owner may undo it.
 *
 * 60s covers the "oops, wrong spot / wrong colour" moment right after the
 * grow animation, while keeping undo from becoming a general "delete my
 * history" tool: by the time anyone else has looked at, photographed, or
 * planted around a polyp it should be permanent, and older polyps belong
 * to snapshots and the sim. Removing older polyps stays an admin action.
 */
export const UNDO_WINDOW_MS = 60_000;

export function isOwnerToken(v: unknown): v is string {
  return typeof v === 'string' && OWNER_TOKEN_RE.test(v);
}
