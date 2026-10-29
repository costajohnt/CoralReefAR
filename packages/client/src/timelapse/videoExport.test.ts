import { describe, test, expect, vi, beforeEach } from 'vitest';
import type { SnapshotMeta } from './player.js';
import { wireVideoExport, videoFilename, type VideoExportDeps } from './videoExport.js';

function mount() {
  document.body.innerHTML = `
    <button id="rec">Record video</button>
    <select id="dur"><option value="10">10 s</option><option value="20" selected>20 s</option></select>
    <select id="fps"><option value="24">24</option><option value="30" selected>30</option></select>
    <p id="st"></p>`;
  return {
    recordBtn: document.getElementById('rec') as HTMLButtonElement,
    durationSel: document.getElementById('dur') as HTMLSelectElement,
    fpsSel: document.getElementById('fps') as HTMLSelectElement,
    statusEl: document.getElementById('st')!,
  };
}

const snaps: SnapshotMeta[] = [{ id: 1, takenAt: 0, polypCount: 1 }, { id: 2, takenAt: 1, polypCount: 2 }];

function setup(over: Partial<VideoExportDeps> = {}) {
  const dom = mount();
  const busy: boolean[] = [];
  const download = vi.fn();
  let resolveRecord!: (b: Blob) => void;
  let capturedSignal: AbortSignal | undefined;
  const record = vi.fn((opts: Parameters<VideoExportDeps['record']>[0]) => {
    capturedSignal = opts.signal;
    opts.onProgress(1, 4);
    return new Promise<Blob>((resolve, reject) => {
      resolveRecord = resolve;
      opts.signal.addEventListener('abort', () => reject(new DOMException('x', 'AbortError')));
    });
  });
  const deps: VideoExportDeps = {
    mimeType: () => 'video/mp4;codecs=avc1',
    getSnapshots: () => snaps,
    record,
    download,
    setBusy: (b) => busy.push(b),
    now: () => new Date('2026-10-29T10:00:00Z'),
    ...over,
  };
  wireVideoExport(dom, deps);
  return { dom, busy, download, record, finish: (b: Blob) => resolveRecord(b), signal: () => capturedSignal };
}

describe('wireVideoExport', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  test('idle button has an accessible name', () => {
    const { dom } = setup();
    expect(dom.recordBtn.getAttribute('aria-label')).toBe('Record the timelapse as a video');
    expect(dom.recordBtn.disabled).toBe(false);
  });

  test('unsupported browsers get a disabled button and an explanation', () => {
    const { dom } = setup({ mimeType: () => null });
    expect(dom.recordBtn.disabled).toBe(true);
    expect(dom.statusEl.textContent).toMatch(/isn.t supported/i);
  });

  test('records with the selected duration/fps, locks the player, reports progress, downloads', async () => {
    const { dom, busy, record, download, finish } = setup();
    dom.recordBtn.click();
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ durationS: 20, fps: 30, mimeType: 'video/mp4;codecs=avc1' }));
    expect(busy).toEqual([true]);
    expect(dom.recordBtn.textContent).toBe('Stop recording');
    expect(dom.recordBtn.getAttribute('aria-label')).toBe('Stop recording the video');
    expect(dom.durationSel.disabled).toBe(true);
    expect(dom.fpsSel.disabled).toBe(true);
    expect(dom.statusEl.textContent).toMatch(/25%/);
    finish(new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'video/mp4' }));
    await vi.waitFor(() => expect(download).toHaveBeenCalled());
    expect(download).toHaveBeenCalledWith(expect.any(Blob), 'reef-timelapse-2026-10-29.mp4');
    expect(dom.statusEl.textContent).toMatch(/reef-timelapse-2026-10-29\.mp4 \(2\.0 MB\)/);
    expect(busy).toEqual([true, false]);
    expect(dom.recordBtn.textContent).toBe('Record video');
    expect(dom.durationSel.disabled).toBe(false);
  });

  test('clicking again stops (cancels) the recording without downloading', async () => {
    const { dom, download, signal, busy } = setup();
    dom.recordBtn.click();
    dom.recordBtn.click();
    expect(signal()!.aborted).toBe(true);
    await vi.waitFor(() => expect(dom.statusEl.textContent).toMatch(/cancelled/i));
    expect(download).not.toHaveBeenCalled();
    expect(busy).toEqual([true, false]);
  });

  test('hiding the tab aborts (frames would stall in the background)', async () => {
    const { dom, signal } = setup();
    dom.recordBtn.click();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(signal()!.aborted).toBe(true);
    await vi.waitFor(() => expect(dom.statusEl.textContent).toMatch(/tab was hidden/i));
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  test('a recording failure is reported and the controls recover', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { dom, download } = setup({ record: async () => { throw new Error('encoder died'); } });
    dom.recordBtn.click();
    await vi.waitFor(() => expect(dom.statusEl.textContent).toMatch(/failed/i));
    expect(download).not.toHaveBeenCalled();
    expect(dom.recordBtn.disabled).toBe(false);
  });

  test('no snapshots: says so and does not record', () => {
    const { dom, record } = setup({ getSnapshots: () => [] });
    dom.recordBtn.click();
    expect(record).not.toHaveBeenCalled();
    expect(dom.statusEl.textContent).toMatch(/no snapshots/i);
  });
});

describe('videoFilename', () => {
  test('uses the container extension', () => {
    const d = new Date('2026-10-29T10:00:00Z');
    expect(videoFilename('video/mp4;codecs=avc1', d)).toBe('reef-timelapse-2026-10-29.mp4');
    expect(videoFilename('video/webm;codecs=vp9', d)).toBe('reef-timelapse-2026-10-29.webm');
  });
});
