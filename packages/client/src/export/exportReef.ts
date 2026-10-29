import type { Object3D } from 'three';
import { buildGlb, describeReef, type PolypExportDesc } from './glb.js';

type WorkerReply = { ok: true; glb: ArrayBuffer } | { ok: false; error: string };

function inWorker(polyps: PolypExportDesc[]): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./glb.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerReply>) => {
      w.terminate();
      if (e.data.ok) resolve(e.data.glb);
      else reject(new Error(e.data.error));
    };
    w.onerror = (e: ErrorEvent) => {
      w.terminate();
      reject(new Error(e.message || 'GLB worker failed'));
    };
    w.postMessage({ polyps });
  });
}

/**
 * Export the rendered reef as GLB. The main thread only walks the scene graph
 * (describeReef); generation + serialisation run in a module worker. Falls
 * back to the main thread when workers are unavailable or the worker fails,
 * so the button still works (at the cost of a pause on huge reefs).
 */
export async function exportReefGlb(reef: { all(): Iterable<Object3D> }): Promise<ArrayBuffer> {
  const polyps = describeReef(reef.all());
  if (typeof Worker === 'function') {
    try {
      return await inWorker(polyps);
    } catch (err) {
      console.warn('GLB worker failed; exporting on the main thread', err);
    }
  }
  return buildGlb(polyps);
}

export function glbFilename(now = new Date()): string {
  return `coral-reef-${now.toISOString().slice(0, 10)}.glb`;
}

/** Hand the GLB to the browser as a file download. */
export function downloadGlb(glb: ArrayBuffer, filename: string): void {
  const url = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on a later tick: some browsers start the download asynchronously.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
