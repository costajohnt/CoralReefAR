import type { Polyp, ReefState } from '@reef/shared';
import type { PolypInputPayload } from '@reef/shared';
import { OWNER_HEADER } from '@reef/shared';
import { getOwnerToken } from './owner.js';

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export async function fetchReef(): Promise<ReefState> {
  const r = await fetch(`${BASE}/api/reef`);
  if (!r.ok) throw new Error(`fetchReef ${r.status}`);
  return r.json() as Promise<ReefState>;
}

async function ownerHeaders(): Promise<Record<string, string>> {
  const token = await getOwnerToken();
  return token ? { [OWNER_HEADER]: token } : {};
}

export async function submitPolyp(input: PolypInputPayload): Promise<Polyp> {
  const r = await fetch(`${BASE}/api/reef/polyp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(await ownerHeaders()) },
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

/** Ids of this device's live polyps; [] when there is no owner token. */
export async function fetchMyPolypIds(): Promise<number[]> {
  const headers = await ownerHeaders();
  if (!headers[OWNER_HEADER]) return [];
  const r = await fetch(`${BASE}/api/reef/mine`, { headers });
  if (!r.ok) throw new Error(`fetchMyPolypIds ${r.status}`);
  return ((await r.json()) as { ids: number[] }).ids;
}

/**
 * Undo this device's most recent polyp. Resolves on success (including a
 * repeat undo); rejects with UndoError carrying the server's error code.
 */
export async function undoPolyp(id: number): Promise<void> {
  const headers = await ownerHeaders();
  if (!headers[OWNER_HEADER]) throw new UndoError('no_owner');
  const r = await fetch(`${BASE}/api/reef/polyp/${id}/undo`, { method: 'POST', headers });
  if (r.ok) return;
  const body = (await r.json().catch(() => ({}))) as { error?: string };
  throw new UndoError(body.error ?? `http_${r.status}`);
}

export class UndoError extends Error {
  constructor(readonly code: string) {
    super(`undo failed: ${code}`);
    this.name = 'UndoError';
  }
}
