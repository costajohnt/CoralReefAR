import type { SnapshotMeta } from './player.js';

export interface VideoExportDom {
  recordBtn: HTMLButtonElement;
  durationSel: HTMLSelectElement;
  fpsSel: HTMLSelectElement;
  /** role=status / aria-live region for progress and results. */
  statusEl: HTMLElement;
}

export interface VideoExportDeps {
  /** Best supported recording MIME type, or null if this browser can't record. */
  mimeType(): string | null;
  getSnapshots(): SnapshotMeta[];
  record(opts: {
    durationS: number;
    fps: number;
    mimeType: string;
    signal: AbortSignal;
    onProgress(done: number, total: number): void;
  }): Promise<Blob>;
  download(blob: Blob, filename: string): void;
  /** Lock/unlock the scrubber and Play while recording drives the scene. */
  setBusy(busy: boolean): void;
  now?(): Date;
}

export function videoFilename(mimeType: string, now = new Date()): string {
  const ext = mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
  return `reef-timelapse-${now.toISOString().slice(0, 10)}.${ext}`;
}

const IDLE_LABEL = 'Record the timelapse as a video';
const BUSY_LABEL = 'Stop recording the video';

/**
 * The "Record video" toggle. One button starts and stops; while recording the
 * duration/fps pickers and the player are locked, progress is announced via
 * the status region, and hiding the tab cancels (background tabs throttle
 * timers, which would stall the frame clock).
 */
export function wireVideoExport(dom: VideoExportDom, deps: VideoExportDeps): void {
  const { recordBtn, durationSel, fpsSel, statusEl } = dom;
  const idleText = recordBtn.textContent ?? 'Record video';
  recordBtn.setAttribute('aria-label', IDLE_LABEL);
  const mime = deps.mimeType();
  if (!mime) {
    recordBtn.disabled = true;
    durationSel.disabled = true;
    fpsSel.disabled = true;
    statusEl.textContent = 'Video export isn’t supported in this browser.';
    return;
  }

  let ac: AbortController | null = null;
  let stopReason = '';

  const onVisibility = (): void => {
    if (document.hidden && ac) {
      stopReason = 'Recording stopped because the tab was hidden.';
      ac.abort();
    }
  };

  const setRecording = (on: boolean): void => {
    recordBtn.textContent = on ? 'Stop recording' : idleText;
    recordBtn.setAttribute('aria-label', on ? BUSY_LABEL : IDLE_LABEL);
    durationSel.disabled = on;
    fpsSel.disabled = on;
    deps.setBusy(on);
    if (on) document.addEventListener('visibilitychange', onVisibility);
    else document.removeEventListener('visibilitychange', onVisibility);
  };

  recordBtn.addEventListener('click', () => {
    if (ac) {
      stopReason = 'Recording cancelled.';
      ac.abort();
      return;
    }
    const snapshots = deps.getSnapshots();
    if (snapshots.length === 0) {
      statusEl.textContent = 'No snapshots to record yet.';
      return;
    }
    const controller = new AbortController();
    ac = controller;
    stopReason = '';
    setRecording(true);
    statusEl.textContent = 'Recording… 0%';
    let lastPct = -1;
    void (async () => {
      try {
        const blob = await deps.record({
          durationS: Number(durationSel.value),
          fps: Number(fpsSel.value),
          mimeType: mime,
          signal: controller.signal,
          onProgress: (done, total) => {
            const pct = Math.floor((done / total) * 100);
            if (pct !== lastPct) { lastPct = pct; statusEl.textContent = `Recording… ${pct}%`; }
          },
        });
        const name = videoFilename(blob.type || mime, deps.now?.() ?? new Date());
        deps.download(blob, name);
        statusEl.textContent = `Saved ${name} (${(blob.size / (1024 * 1024)).toFixed(1)} MB).`;
      } catch (e) {
        if (controller.signal.aborted) {
          statusEl.textContent = stopReason || 'Recording cancelled.';
        } else {
          console.error(e);
          statusEl.textContent = `Recording failed: ${e instanceof Error ? e.message : String(e)}`;
        }
      } finally {
        ac = null;
        setRecording(false);
      }
    })();
  });
}
