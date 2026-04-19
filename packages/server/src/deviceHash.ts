import { createHash, randomBytes } from 'node:crypto';

let currentSalt = '';
let currentBucket = -1;

// Salt turns over on the same cadence as the rate-limit window so the
// device-hash key stays stable for the whole window. A calendar-day rotation
// creates a hole at midnight: a device limited at 23:59 would get a new hash
// at 00:00 and escape the counter.
function rollSalt(windowMs: number): string {
  const bucket = Math.floor(Date.now() / windowMs);
  if (bucket !== currentBucket) {
    currentSalt = randomBytes(16).toString('hex');
    currentBucket = bucket;
  }
  return currentSalt;
}

export function deviceHash(userAgent: string, ip: string, windowMs: number): string {
  const salt = rollSalt(windowMs);
  return createHash('sha256').update(`${userAgent}|${ip}|${salt}`).digest('hex');
}
