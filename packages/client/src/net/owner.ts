/**
 * Device-local owner identity for "my polyps" (#112).
 *
 * A random 256-bit ID lives in localStorage. Only SHA-256(ID) is ever sent to
 * the server (as the owner token header); the raw ID never leaves the device,
 * and there is no account. If localStorage is unavailable (private mode,
 * blocked storage) the ID lives in memory for this page session only, so undo
 * still works but highlights are forgotten on reload. If WebCrypto is
 * unavailable (insecure context) there is no token and the client behaves
 * like a pre-#112 client: polyps are unowned, no highlight, no undo.
 */

export const OWNER_STORAGE_KEY = 'reef.ownerId';
const ID_RE = /^[0-9a-f]{64}$/;

let memoryId: string | null = null;
let tokenPromise: Promise<string | null> | null = null;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function loadOrCreateOwnerId(): string {
  try {
    const stored = window.localStorage.getItem(OWNER_STORAGE_KEY);
    if (stored && ID_RE.test(stored)) return stored;
  } catch {
    // Storage blocked (private mode / SecurityError): fall through to memory.
  }
  if (memoryId) return memoryId;
  const id = toHex(crypto.getRandomValues(new Uint8Array(32)));
  memoryId = id;
  try {
    window.localStorage.setItem(OWNER_STORAGE_KEY, id);
  } catch {
    // Quota / private mode: the in-memory ID still covers this session.
  }
  return id;
}

/** Hex SHA-256 of this device's owner ID, or null if it can't be computed. */
export function getOwnerToken(): Promise<string | null> {
  tokenPromise ??= (async () => {
    try {
      const id = loadOrCreateOwnerId();
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
      return toHex(new Uint8Array(digest));
    } catch {
      return null;
    }
  })();
  return tokenPromise;
}

/** Test hook: forget the memoised token (and, by default, the in-memory ID). */
export function __resetOwnerForTests(opts: { keepMemoryId?: boolean } = {}): void {
  tokenPromise = null;
  if (!opts.keepMemoryId) memoryId = null;
}
