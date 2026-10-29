export type PlaygroundMode = 'interactive' | 'screen';

export interface PlaygroundConfig {
  mode: PlaygroundMode;
  readonly: boolean;
  /** Empty string = same origin. Otherwise a URL like `http://localhost:8787`. */
  apiBase: string;
  /** Where the gallery QR code sends visitors to plant (screen mode). */
  plantUrl: string;
}

function httpUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch {
    return null;
  }
}

export function readPlaygroundConfig(): PlaygroundConfig {
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  const rawMode = params.get('mode');
  // `gallery` is the name the wall-display feature (#110) goes by; it's the
  // same surface as `screen`.
  const mode: PlaygroundMode = rawMode === 'screen' || rawMode === 'gallery' ? 'screen' : 'interactive';
  const readonly = params.get('readonly') === '1';
  const apiBase = params.get('api') ?? '';
  // Default: the AR planting app at this origin's root. ?plant= overrides it
  // (e.g. a short link), but only for http(s) so a crafted link can't turn
  // the QR code into a javascript:/data: payload.
  const plantUrl = httpUrl(params.get('plant')) ?? `${globalThis.location?.origin ?? ''}/`;
  return { mode, readonly, apiBase, plantUrl };
}
