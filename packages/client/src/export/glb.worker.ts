/// <reference lib="webworker" />
// Builds the GLB off the main thread: mesh generation + GLTFExporter on a
// large reef is a multi-hundred-ms synchronous block (see glb.ts).
import { buildGlb, type PolypExportDesc } from './glb.js';

self.onmessage = async (e: MessageEvent<{ polyps: PolypExportDesc[] }>) => {
  try {
    const glb = await buildGlb(e.data.polyps);
    (self as unknown as DedicatedWorkerGlobalScope).postMessage({ ok: true, glb }, [glb]);
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
