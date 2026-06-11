import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

export function requireAdmin(token: string | undefined): boolean {
  if (!token || !config.adminToken) return false;
  // Hash both to fixed-size 32-byte digests before timingSafeEqual so the
  // comparison runs in constant time regardless of the submitted token's
  // length. Raw-buffer compare leaks length through an early-return branch.
  const a = createHash('sha256').update(token).digest();
  const b = createHash('sha256').update(config.adminToken).digest();
  return timingSafeEqual(a, b);
}

function bearerToken(req: FastifyRequest): string | undefined {
  const auth = req.headers['authorization'];
  return auth?.toString().replace(/^Bearer\s+/i, '');
}

/**
 * Require a valid admin token. Returns true on success; on failure writes a 401
 * response and returns false — callers should return immediately. Use for
 * unconditionally admin-only routes (e.g. the reef admin panel).
 */
export function checkAdminAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!requireAdmin(bearerToken(req))) {
    void reply.status(401).send({ error: 'unauthorized' });
    return false;
  }
  return true;
}

/**
 * Gate a destructive route behind the admin token ONLY when one is configured.
 * With no `ADMIN_TOKEN` set (the single-installation / testing default) the
 * route stays open so user-facing actions like tree Clear/Undo keep working.
 * Once an operator sets `ADMIN_TOKEN` for a public deploy, the route requires
 * it — random visitors can no longer wipe or delete shared state. Mirrors the
 * "secure-by-config, open-while-testing" posture of the rate limits.
 *
 * Returns true to proceed; on failure writes 401 and returns false.
 */
export function enforceAdminIfConfigured(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!config.adminToken) return true;
  return checkAdminAuth(req, reply);
}
