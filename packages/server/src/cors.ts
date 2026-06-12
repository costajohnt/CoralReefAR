function cleanOrigins(origins: string[]): string[] {
  return origins.map((o) => o.trim()).filter(Boolean);
}

/**
 * Resolve configured CORS origins into a @fastify/cors `origin` value.
 * `*` (wide open) → `true`; otherwise the cleaned allowlist. Empty/whitespace
 * entries are dropped, so an empty result denies all cross-origin requests
 * (fail-closed).
 */
export function resolveCorsOrigin(origins: string[]): boolean | string[] {
  const cleaned = cleanOrigins(origins);
  if (cleaned.includes('*')) return true;
  return cleaned;
}

/** True when the configured origins are wide-open (`*`) or effectively empty. */
export function corsIsWideOpenOrEmpty(origins: string[]): boolean {
  const cleaned = cleanOrigins(origins);
  return cleaned.length === 0 || cleaned.includes('*');
}

/**
 * Fail closed in production: a real-visitor deploy must pin explicit origins so
 * arbitrary sites can't drive writes from a visitor's browser. Wide-open (`*`)
 * or empty `CORS_ORIGINS` under `NODE_ENV=production` is a fatal misconfig and
 * refuses to start. Non-production keeps `*` for testing convenience.
 */
export function assertProductionCorsSafe(origins: string[], nodeEnv: string | undefined): void {
  if (nodeEnv === 'production' && corsIsWideOpenOrEmpty(origins)) {
    const reason = cleanOrigins(origins).includes('*') ? 'wide-open "*"' : 'empty';
    throw new Error(
      `CORS_ORIGINS must be explicit origin(s) in production (got ${reason}). ` +
        `Set e.g. CORS_ORIGINS=https://reef.example.com.`,
    );
  }
}
