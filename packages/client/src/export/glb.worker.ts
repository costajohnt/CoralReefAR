/// <reference lib="webworker" />
// Builds the GLB off the main thread: mesh generation + GLTFExporter on a
// large reef is a multi-hundred-ms synchronous block (see glb.ts). The Blob
// is made here and posted (shared by reference), so the main thread never
// copies the bytes.
import { GLB_MIME, buildGlb, type PolypExportDesc } from './glb.js';

self.onmessage = async (e: MessageEvent<{ polyps: PolypExportDesc[] }>) => {
  try {
    const glb = new Blob([await buildGlb(e.data.polyps)], { type: GLB_MIME });
    self.postMessage({ ok: true, glb });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
