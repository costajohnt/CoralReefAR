import { describe, test, expect, vi } from 'vitest';
import type { Object3D } from 'three';
import { wireExportButton } from './exportButton.js';

function setup(opts: { polyps?: number; exportImpl?: () => Promise<ArrayBuffer> } = {}) {
  document.body.innerHTML = '';
  const btn = document.createElement('button');
  btn.textContent = 'Download 3D model';
  document.body.appendChild(btn);
  const nodes = Array.from({ length: opts.polyps ?? 2 }, () => ({}) as Object3D);
  const reef = { all: () => nodes };
  const status: string[] = [];
  const download = vi.fn();
  const exportReefGlb = vi.fn(opts.exportImpl ?? (async () => new ArrayBuffer(3 * 1024 * 1024)));
  wireExportButton(btn, reef, (t) => status.push(t), {
    exportReefGlb, downloadGlb: download, filename: () => 'coral-reef-2026-10-29.glb',
  });
  return { btn, status, download, exportReefGlb };
}

describe('wireExportButton', () => {
  test('gives the button an accessible name', () => {
    const { btn } = setup();
    expect(btn.getAttribute('aria-label')).toBe('Download the reef as a 3D model (GLB file)');
  });

  test('exports, downloads, reports the size, and restores the button', async () => {
    const { btn, status, download } = setup();
    btn.click();
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(status[0]).toMatch(/Preparing/);
    await vi.waitFor(() => expect(download).toHaveBeenCalled());
    expect(download).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'coral-reef-2026-10-29.glb');
    expect(status.at(-1)).toMatch(/coral-reef-2026-10-29\.glb \(3\.0 MB\)/);
    expect(btn.disabled).toBe(false);
    expect(btn.hasAttribute('aria-busy')).toBe(false);
    expect(btn.textContent).toBe('Download 3D model');
  });

  test('ignores clicks while an export is in flight', async () => {
    let release!: (b: ArrayBuffer) => void;
    const { btn, exportReefGlb } = setup({ exportImpl: () => new Promise((r) => { release = r; }) });
    btn.click();
    btn.dispatchEvent(new MouseEvent('click'));
    expect(exportReefGlb).toHaveBeenCalledTimes(1);
    release(new ArrayBuffer(1));
  });

  test('an empty reef says so instead of downloading an empty file', () => {
    const { btn, status, exportReefGlb } = setup({ polyps: 0 });
    btn.click();
    expect(exportReefGlb).not.toHaveBeenCalled();
    expect(status.at(-1)).toMatch(/nothing to export/i);
  });

  test('a failure is reported and the button recovers', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { btn, status, download } = setup({ exportImpl: async () => { throw new Error('boom'); } });
    btn.click();
    await vi.waitFor(() => expect(status.at(-1)).toMatch(/couldn.t export/i));
    expect(download).not.toHaveBeenCalled();
    expect(btn.disabled).toBe(false);
  });
});
