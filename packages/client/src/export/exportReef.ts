import type { Object3D } from 'three';
import { GLB_MIME, buildGlb, describeReef, type PolypExportDesc } from './glb.js';

/**
 * Largest reef we'll build on the main thread when the worker is missing or
 * failed. Measured inline: ~381ms of main-thread block for 1000 polyps on a
 * MacBook Air, and phones run several times slower. At 300 that's roughly
 * 100ms desktop / a few hundred ms on a phone: a visible hitch, not a freeze.
 */
export const INLINE_FALLBACK_MAX_POLYPS = 300;

// Worker liveness: an OOM-killed worker may never fire onerror, so give up
// after a budget that scales with the work (generation + serialisation are
// both linear in polyp count; 1000 polyps measured ~0.6s on desktop).
const WORKER_BASE_TIMEOUT_MS = 15_000;
const WORKER_PER_POLYP_MS = 25;

export function workerTimeoutMs(polypCount: number): number {
  return WORKER_BASE_TIMEOUT_MS + polypCount * WORKER_PER_POLYP_MS;
}

/**
 * How long a download's object URL stays alive. iOS Safari can read the blob
 * well after the click returns, so revoking on the next tick can cancel it.
 */
export const BLOB_URL_REVOKE_MS = 60_000;

/** The reef is too big to build inline and the worker path is unavailable. */
export class ExportTooLargeError extends Error {
  constructor(readonly polypCount: number, readonly limit: number) {
    super(`reef has ${polypCount} polyps; inline export is capped at ${limit}`);
    this.name = 'ExportTooLargeError';
  }
}

type WorkerReply = { ok: true; glb: Blob } | { ok: false; error: string };

function inWorker(polyps: PolypExportDesc[], timeoutMs: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./glb.worker.ts', import.meta.url), { type: 'module' });
    let settled = false;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      w.terminate();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`GLB worker did not answer within ${timeoutMs}ms`))),
      timeoutMs,
    );
    w.onmessage = (e: MessageEvent<WorkerReply>) => finish(() => {
      if (e.data.ok) resolve(e.data.glb);
      else reject(new Error(e.data.error));
    });
    w.onerror = (e: ErrorEvent) => finish(() => reject(new Error(e.message || 'GLB worker failed')));
    w.postMessage({ polyps });
  });
}

export interface ExportOptions {
  /** Override INLINE_FALLBACK_MAX_POLYPS (tests). */
  inlineMaxPolyps?: number;
  /** Override workerTimeoutMs(n) (tests). */
  timeoutMs?: number;
}

/**
 * Export the rendered reef as a GLB Blob. The main thread only walks the
 * scene graph (describeReef); generation, serialisation and the Blob itself
 * are made in a module worker, so the main thread never holds the bytes as
 * an ArrayBuffer. If the worker is unavailable, errors, or goes silent, small
 * reefs are built inline; larger ones reject with ExportTooLargeError rather
 * than freezing the page.
 */
export async function exportReefGlb(
  reef: { all(): Iterable<Object3D> },
  opts: ExportOptions = {},
): Promise<Blob> {
  const polyps = describeReef(reef.all());
  if (typeof Worker === 'function') {
    try {
      return await inWorker(polyps, opts.timeoutMs ?? workerTimeoutMs(polyps.length));
    } catch (err) {
      console.warn('GLB worker failed', err);
    }
  }
  const limit = opts.inlineMaxPolyps ?? INLINE_FALLBACK_MAX_POLYPS;
  if (polyps.length > limit) throw new ExportTooLargeError(polyps.length, limit);
  return new Blob([await buildGlb(polyps)], { type: GLB_MIME });
}

export function glbFilename(now = new Date()): string {
  return `coral-reef-${now.toISOString().slice(0, 10)}.glb`;
}

/** Hand the GLB to the browser as a file download. */
export function downloadGlb(glb: Blob, filename: string): void {
  const url = URL.createObjectURL(glb);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), BLOB_URL_REVOKE_MS);
}
