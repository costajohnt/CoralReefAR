import type { Object3D } from 'three';
import { downloadGlb, exportReefGlb, glbFilename } from '../export/exportReef.js';

export interface ExportButtonDeps {
  exportReefGlb(reef: { all(): Iterable<Object3D> }): Promise<ArrayBuffer>;
  downloadGlb(glb: ArrayBuffer, filename: string): void;
  filename(): string;
}

const DEFAULT_DEPS: ExportButtonDeps = { exportReefGlb, downloadGlb, filename: () => glbFilename() };

/**
 * Wire a "Download 3D model" button. Progress and results go to `setStatus`
 * (an aria-live region on both pages), and the button is aria-busy while the
 * export runs.
 */
export function wireExportButton(
  btn: HTMLButtonElement,
  reef: { all(): Iterable<Object3D> },
  setStatus: (text: string) => void,
  deps: ExportButtonDeps = DEFAULT_DEPS,
): void {
  btn.setAttribute('aria-label', 'Download the reef as a 3D model (GLB file)');
  const label = btn.textContent;
  let busy = false;

  btn.addEventListener('click', () => {
    if (busy) return;
    let count = 0;
    for (const _ of reef.all()) count++;
    if (count === 0) {
      setStatus('The reef is empty, so there is nothing to export yet.');
      return;
    }
    busy = true;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Preparing…';
    setStatus(`Preparing a 3D model of ${count} ${count === 1 ? 'coral' : 'corals'}…`);
    void (async () => {
      try {
        const glb = await deps.exportReefGlb(reef);
        const name = deps.filename();
        deps.downloadGlb(glb, name);
        setStatus(`Downloaded ${name} (${(glb.byteLength / (1024 * 1024)).toFixed(1)} MB).`);
      } catch (e) {
        console.error(e);
        setStatus('Couldn’t export the reef. Please try again.');
      } finally {
        busy = false;
        btn.disabled = false;
        btn.removeAttribute('aria-busy');
        btn.textContent = label;
      }
    })();
  });
}
