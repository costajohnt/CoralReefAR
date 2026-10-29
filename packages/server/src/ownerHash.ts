import { createHash, createHmac } from 'node:crypto';
import { config } from './config.js';

// Domain-separation label, also the salt when no secret is configured.
const SALT = 'coralreefar/owner/v1';

/**
 * Hash a client owner token for storage in polyps.owner_hash.
 *
 * The token is already SHA-256(random 256-bit ID) computed on the device, so
 * it is not guessable; this second hash keeps the stored value from being a
 * bearer credential if the DB leaks. With OWNER_HASH_SECRET set it is an HMAC
 * keyed by that secret; otherwise a salted SHA-256.
 *
 * Unlike deviceHash (per-process secret, rotating window) this must be stable
 * across restarts, or "my polyps" would be forgotten on every deploy. Changing
 * OWNER_HASH_SECRET orphans existing ownership, which is safe (old polyps just
 * stop highlighting) but not reversible.
 *
 * Never log the token or this hash.
 */
export function ownerHash(token: string, secret: string = config.ownerHashSecret): string {
  const input = `${SALT}|${token}`;
  return secret
    ? createHmac('sha256', secret).update(input).digest('hex')
    : createHash('sha256').update(input).digest('hex');
}
