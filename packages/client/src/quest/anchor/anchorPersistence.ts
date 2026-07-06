/**
 * Cross-session anchor persistence.
 *
 * WebXR's Anchors module supports `requestPersistentHandle()` on Quest:
 * an anchor can yield a UUID that survives session restarts. On the next
 * session, `XRSession.restorePersistentAnchor(uuid)` returns an XRAnchor
 * at the original world location (modulo the Quest's stored room
 * geometry being recognizable).
 *
 * We gate this behind a URL flag (`?persist=1`) so the default UX stays
 * session-scoped — users opting in are saying "I plan to leave the reef
 * in this spot for a while." If the room geometry changes or the user
 * deletes the saved handle, we fall through to placement state.
 */

const STORAGE_KEY = 'reef.questAnchorHandle';

export function persistFlagEnabled(search = window.location.search): boolean {
  return new URLSearchParams(search).get('persist') === '1';
}

export function loadAnchorHandle(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveAnchorHandle(handle: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, handle);
  } catch {
    // localStorage can throw in private-browsing mode or when quota is
    // exceeded. Persistence is opt-in convenience, not correctness —
    // swallow.
  }
}

export function clearAnchorHandle(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // see saveAnchorHandle
  }
}

/**
 * Typed view onto the WebXR Anchors persistent-anchor extensions.
 * @types/webxr doesn't include these yet, but Quest Browser implements
 * the spec. Cast to this shape at the call site.
 */
export interface PersistentAnchorAPI {
  requestPersistentHandle?: () => Promise<string>;
}

export interface PersistentAnchorSession {
  restorePersistentAnchor?: (uuid: string) => Promise<XRAnchor>;
  deletePersistentAnchor?: (uuid: string) => Promise<void>;
}
