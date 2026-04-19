import type { Polyp, ReefState } from '@reef/shared';
import type { PolypInputPayload } from '@reef/shared';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export async function fetchReef(): Promise<ReefState> {
  const r = await fetch(`${BASE}/api/reef`);
  if (!r.ok) throw new Error(`fetchReef ${r.status}`);
  return r.json() as Promise<ReefState>;
}

export async function submitPolyp(input: PolypInputPayload): Promise<Polyp> {
  const r = await fetch(`${BASE}/api/reef/polyp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (r.status === 429) {
    const body = (await r.json().catch(() => ({ retryAfterMs: 3_600_000 }))) as { retryAfterMs?: number };
    throw new RateLimitError(body.retryAfterMs ?? 3_600_000);
  }
  if (!r.ok) throw new Error(`submitPolyp ${r.status}`);
  return r.json() as Promise<Polyp>;
}

export class RateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`rate_limited; retry in ${retryAfterMs}ms`);
    this.name = 'RateLimitError';
  }
}
