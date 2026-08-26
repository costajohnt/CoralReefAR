/**
 * Vitest global setup for the client package.
 *
 * Node 22+ ships an experimental `localStorage` that is a non-configurable
 * getter on `globalThis` returning `undefined` (it requires --localstorage-file
 * to be usable). In Node 26 this property shadows happy-dom's own Storage
 * implementation, leaving `window.localStorage` as `undefined` in tests.
 *
 * This file runs inside the happy-dom environment (after vitest patches globals)
 * and force-installs a real in-memory Storage when the slot is still empty.
 */
if (typeof window !== 'undefined' && window.localStorage == null) {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string): string | null => map.get(k) ?? null,
    setItem: (k: string, v: string): void => { map.set(k, String(v)); },
    removeItem: (k: string): void => { map.delete(k); },
    clear: (): void => { map.clear(); },
    get length(): number { return map.size; },
    key: (i: number): string | null => [...map.keys()][i] ?? null,
  };
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    enumerable: true,
    get: () => storage,
  });
}
