import { createHash, createHmac, randomBytes } from 'node:crypto';

// Per-process secret. Each window's salt is derived from it via HMAC, so any
// bucket's salt is reconstructible on demand — needed to count a device under
// the PREVIOUS window's hash without retaining mutable salt state. The secret
// is fresh per process, so a device hash is still not a durable cross-restart
// identifier (restarting resets rate-limit state, same as before).
const SERVER_SECRET = randomBytes(32);

function saltForBucket(bucket: number): string {
  return createHmac('sha256', SERVER_SECRET).update(String(bucket)).digest('hex');
}

function hashFor(userAgent: string, ip: string, bucket: number): string {
  const salt = saltForBucket(bucket);
  return createHash('sha256').update(`${userAgent}|${ip}|${salt}`).digest('hex');
}

/**
 * Device fingerprint for the CURRENT window. Used when STORING a polyp's
 * device_hash. The per-window salt means the hash isn't a durable identifier.
 */
export function deviceHash(userAgent: string, ip: string, windowMs: number): string {
  return hashFor(userAgent, ip, Math.floor(Date.now() / windowMs));
}

/**
 * The device's hashes for the CURRENT and PREVIOUS window. Used when COUNTING
 * so a device can't reset its rate-limit count by crossing a window boundary:
 * a polyp stored last window (under the previous salt) is still attributed to
 * the same device this window. Sum the per-hash counts — a polyp has exactly
 * one device_hash, and the two hashes always differ, so nothing is counted
 * twice.
 */
export function deviceHashesForCounting(
  userAgent: string,
  ip: string,
  windowMs: number,
): string[] {
  const bucket = Math.floor(Date.now() / windowMs);
  return [hashFor(userAgent, ip, bucket), hashFor(userAgent, ip, bucket - 1)];
}
