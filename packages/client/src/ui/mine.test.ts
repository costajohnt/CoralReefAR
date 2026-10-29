import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { UNDO_WINDOW_MS } from '@reef/shared';
import { UndoError } from '../net/api.js';
import { MyPolyps, UndoControl, mineNoteText, type MineReef } from './mine.js';

function makeBtn(): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  document.body.appendChild(b);
  return b;
}

describe('UndoControl', () => {
  beforeEach(() => { vi.useFakeTimers(); document.body.innerHTML = ''; });
  afterEach(() => { vi.useRealTimers(); });

  test('starts hidden; offer() reveals an accessible, enabled button with a countdown', () => {
    const btn = makeBtn();
    const u = new UndoControl(btn);
    expect(btn.hidden).toBe(true);
    u.offer(5);
    expect(btn.hidden).toBe(false);
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-label')).toBe('Undo your last polyp');
    expect(btn.textContent).toMatch(/^Undo \(\d+s\)$/);
    expect(u.pending()).toBe(5);
  });

  test('hides itself before the server window closes', () => {
    const btn = makeBtn();
    const u = new UndoControl(btn);
    u.offer(5);
    vi.advanceTimersByTime(UNDO_WINDOW_MS - 1000);
    expect(btn.hidden).toBe(true);
    expect(u.pending()).toBeNull();
  });

  test('click invokes the handler with the pending id; ignored once cleared', () => {
    const btn = makeBtn();
    const u = new UndoControl(btn);
    const onUndo = vi.fn();
    u.onUndo(onUndo);
    u.offer(8);
    btn.click();
    expect(onUndo).toHaveBeenCalledWith(8);
    u.clear();
    btn.click();
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  test('setBusy disables and marks aria-busy', () => {
    const btn = makeBtn();
    const u = new UndoControl(btn);
    u.offer(1);
    u.setBusy(true);
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    u.setBusy(false);
    expect(btn.disabled).toBe(false);
    expect(btn.hasAttribute('aria-busy')).toBe(false);
  });
});

describe('mineNoteText', () => {
  test('pluralises and is empty for zero', () => {
    expect(mineNoteText(0)).toBe('');
    expect(mineNoteText(1)).toMatch(/1 coral here/);
    expect(mineNoteText(3)).toMatch(/3 corals here/);
  });
});

function fakeReef(): MineReef & { mine: Set<number>; removed: number[] } {
  const mine = new Set<number>();
  const removed: number[] = [];
  return {
    mine, removed,
    markMine: (id) => { mine.add(id); },
    unmarkMine: (id) => { mine.delete(id); },
    removePolyp: (id) => { removed.push(id); },
    mineCount: () => mine.size,
  };
}

function setup(api: { fetchMyPolypIds?: () => Promise<number[]>; undoPolyp?: (id: number) => Promise<void> } = {}) {
  document.body.innerHTML = '';
  const reef = fakeReef();
  const btn = makeBtn();
  const note = document.createElement('p');
  const hints: string[] = [];
  const onUndone = vi.fn();
  const mp = new MyPolyps({
    reef, undoBtn: btn, noteEl: note,
    setHint: (t) => hints.push(t),
    onUndone,
    api: {
      fetchMyPolypIds: api.fetchMyPolypIds ?? (async () => []),
      undoPolyp: api.undoPolyp ?? (async () => {}),
    },
  });
  return { mp, reef, btn, note, hints, onUndone };
}

describe('MyPolyps', () => {
  afterEach(() => { vi.useRealTimers(); });

  test('load() highlights the ids the server says are mine', async () => {
    const { mp, reef, note } = setup({ fetchMyPolypIds: async () => [2, 4] });
    await mp.load();
    expect([...reef.mine]).toEqual([2, 4]);
    expect(note.textContent).toMatch(/2 corals/);
  });

  test('load() failure is non-fatal', async () => {
    const { mp, reef } = setup({ fetchMyPolypIds: async () => { throw new Error('offline'); } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(mp.load()).resolves.toBeUndefined();
    expect(reef.mine.size).toBe(0);
  });

  test('planted() marks the polyp and offers undo', () => {
    const { mp, reef, btn } = setup();
    mp.planted(7);
    expect(reef.mine.has(7)).toBe(true);
    expect(btn.hidden).toBe(false);
  });

  test('undo click removes the polyp, unmarks it, hides the button, and reports', async () => {
    const undo = vi.fn(async () => {});
    const { mp, reef, btn, hints, onUndone } = setup({ undoPolyp: undo });
    mp.planted(7);
    btn.click();
    await vi.waitFor(() => expect(onUndone).toHaveBeenCalled());
    expect(undo).toHaveBeenCalledWith(7);
    expect(reef.removed).toEqual([7]);
    expect(reef.mine.has(7)).toBe(false);
    expect(btn.hidden).toBe(true);
    expect(hints.at(-1)).toMatch(/Undone/);
  });

  test('a definitive refusal (window expired) hides undo and keeps the polyp', async () => {
    const { mp, reef, btn, hints } = setup({
      undoPolyp: async () => { throw new UndoError('undo_window_expired'); },
    });
    mp.planted(7);
    btn.click();
    await vi.waitFor(() => expect(btn.hidden).toBe(true));
    expect(reef.removed).toEqual([]);
    expect(reef.mine.has(7)).toBe(true);
    expect(hints.at(-1)).toMatch(/too late/i);
  });

  test('a transient failure keeps the button available for a retry', async () => {
    const { mp, btn, hints } = setup({ undoPolyp: async () => { throw new Error('network'); } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mp.planted(7);
    btn.click();
    await vi.waitFor(() => expect(hints.at(-1)).toMatch(/try again/i));
    expect(btn.hidden).toBe(false);
    expect(btn.disabled).toBe(false);
  });

  test('a remote removal of the pending polyp withdraws the undo offer', () => {
    const { mp, btn } = setup();
    mp.planted(7);
    mp.removed(7);
    expect(btn.hidden).toBe(true);
  });

  test('a remote removal of some other polyp leaves the offer alone', () => {
    const { mp, btn } = setup();
    mp.planted(7);
    mp.removed(3);
    expect(btn.hidden).toBe(false);
  });
});
