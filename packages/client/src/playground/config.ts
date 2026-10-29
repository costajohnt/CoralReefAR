export type PlaygroundMode = 'interactive' | 'screen';

export interface PlaygroundConfig {
  mode: PlaygroundMode;
  readonly: boolean;
  /** Empty string = same origin. Otherwise a URL like `http://localhost:8787`. */
  apiBase: string;
  /** Where the gallery QR code sends visitors to plant (screen mode). */
  plantUrl: string;
}

/**
 * Resolve ?plant= against this page's origin and accept it only if it stays
 * on that origin (a path, or an absolute URL to the same origin). A gallery
 * link shared around shouldn't be able to put a QR code to another site, or a
 * javascript:/data: URL, on a public screen.
 */
function sameOriginUrl(raw: string | null, origin: string): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw, `${origin}/`);
  } catch {
    console.warn('ignoring invalid ?plant= URL');
    return null;
  }
  if (u.origin !== origin) {
    console.warn(`ignoring ?plant= URL on another origin (${u.origin}); using ${origin}/`);
    return null;
  }
  return u.href;
}

export function readPlaygroundConfig(): PlaygroundConfig {
  const params = new URLSearchParams(globalThis.location?.search ?? '');
  const rawMode = params.get('mode');
  // `gallery` is the name the wall-display feature (#110) goes by; it's the
  // same surface as `screen`.
  const mode: PlaygroundMode = rawMode === 'screen' || rawMode === 'gallery' ? 'screen' : 'interactive';
  const readonly = params.get('readonly') === '1';
  const apiBase = params.get('api') ?? '';
  // Default: the AR planting app at this origin's root. ?plant= may point it
  // elsewhere on the same origin (e.g. /quest.html).
  const origin = globalThis.location?.origin ?? '';
  const plantUrl = sameOriginUrl(params.get('plant'), origin) ?? `${origin}/`;
  return { mode, readonly, apiBase, plantUrl };
}
