import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createTimelapsePlayer,
  type SnapshotBody,
  type SnapshotMeta,
} from './player.js';

function mountDom(): void {
  document.body.replaceChildren();
  const meta = document.createElement('div');
  meta.id = 'meta';
  const scrub = document.createElement('input');
  scrub.type = 'range';
  scrub.id = 'scrub';
  const time = document.createElement('div');
  time.id = 'time';
  const play = document.createElement('button');
  play.id = 'play';
  document.body.append(meta, scrub, time, play);
}

const dom = () => ({
  metaEl: document.getElementById('meta')!,
  scrubEl: document.getElementById('scrub') as HTMLInputElement,
  timeEl: document.getElementById('time')!,
  playBtn: document.getElementById('play') as HTMLButtonElement,
});

function meta(id: number, takenAt = id * 1000): SnapshotMeta {
  return { id, takenAt, polypCount: 0 };
}
const body = (id: number): SnapshotBody => ({ polyps: [{ id } as never] });

/** A loadSnapshot whose responses you resolve by hand, to drive out-of-order races. */
function deferredLoader() {
  const pending = new Map<number, (b: SnapshotBody) => void>();
  const loadSnapshot = (id: number): Promise<SnapshotBody> =>
    new Promise<SnapshotBody>((resolve) => pending.set(id, resolve));
  return {
    loadSnapshot,
    resolve(id: number): void {
      pending.get(id)!(body(id));
      pending.delete(id);
    },
  };
}

beforeEach(mountDom);
afterEach(() => vi.restoreAllMocks());

describe('createTimelapsePlayer — init', () => {
  test('loads the list, shows the count, and applies the most recent snapshot', async () => {
    const applySnapshot = vi.fn();
    const player = createTimelapsePlayer(dom(), {
      loadList: async () => [meta(10), meta(20), meta(30)],
      loadSnapshot: async (id) => body(id),
      applySnapshot,
    });
    await player.init();
    // Let the scrub handler's loadSnapshot microtask settle.
    await Promise.resolve();
    await Promise.resolve();

    const d = dom();
    expect(d.metaEl.textContent).toBe('3 snapshots');
    expect(d.scrubEl.max).toBe('2');
    expect(d.scrubEl.value).toBe('2'); // newest
    expect(applySnapshot).toHaveBeenLastCalledWith(body(30));
    player.dispose();
  });

  test('singular label for one snapshot', async () => {
    const player = createTimelapsePlayer(dom(), {
      loadList: async () => [meta(10)],
      loadSnapshot: async (id) => body(id),
      applySnapshot: vi.fn(),
    });
    await player.init();
    expect(dom().metaEl.textContent).toBe('1 snapshot');
    player.dispose();
  });

  test('empty list disables play and shows the empty message', async () => {
    const player = createTimelapsePlayer(dom(), {
      loadList: async () => [],
      loadSnapshot: async (id) => body(id),
      applySnapshot: vi.fn(),
    });
    await player.init();
    const d = dom();
    expect(d.metaEl.textContent).toContain('No snapshots yet');
    expect(d.playBtn.disabled).toBe(true);
    player.dispose();
  });

  test('a failed list load surfaces an error and does not throw', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const player = createTimelapsePlayer(dom(), {
      loadList: async () => {
        throw new Error('boom');
      },
      loadSnapshot: async (id) => body(id),
      applySnapshot: vi.fn(),
    });
    await expect(player.init()).resolves.toBeUndefined();
    expect(dom().metaEl.textContent).toBe('Failed to load snapshots.');
    player.dispose();
  });
});

describe('createTimelapsePlayer — scrub', () => {
  test('dropping out-of-order responses: only the latest requested snapshot is applied', async () => {
    const applySnapshot = vi.fn();
    const loader = deferredLoader();
    const player = createTimelapsePlayer(dom(), {
      loadList: async () => [meta(10), meta(20), meta(30)],
      loadSnapshot: loader.loadSnapshot,
      applySnapshot,
    });
    // init applies the newest (id 30) — resolve it so it doesn't interfere.
    await player.init();
    loader.resolve(30);
    await Promise.resolve();
    applySnapshot.mockClear();

    const d = dom();
    // Scrub to idx 0 (id 10), then quickly to idx 1 (id 20) before either resolves.
    d.scrubEl.value = '0';
    d.scrubEl.dispatchEvent(new Event('input'));
    d.scrubEl.value = '1';
    d.scrubEl.dispatchEvent(new Event('input'));

    // Resolve the STALE request (id 10) last. Its token is no longer current,
    // so it must be discarded.
    loader.resolve(20);
    await Promise.resolve();
    loader.resolve(10);
    await Promise.resolve();
    await Promise.resolve();

    expect(applySnapshot).toHaveBeenCalledTimes(1);
    expect(applySnapshot).toHaveBeenCalledWith(body(20));
    player.dispose();
  });

  test('a failed snapshot load shows the per-snapshot error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const player = createTimelapsePlayer(dom(), {
      loadList: async () => [meta(10), meta(20)],
      loadSnapshot: async () => {
        throw new Error('nope');
      },
      applySnapshot: vi.fn(),
    });
    await player.init();
    await Promise.resolve();
    await Promise.resolve();
    expect(dom().metaEl.textContent).toBe('Failed to load that snapshot; try another.');
    player.dispose();
  });
});

describe('createTimelapsePlayer — playback', () => {
  test('play toggles the button label and advances the scrub; pause stops it', async () => {
    const player = createTimelapsePlayer(dom(), {
      loadList: async () => [meta(10), meta(20), meta(30)],
      loadSnapshot: async (id) => body(id),
      applySnapshot: vi.fn(),
      // Long frame delay so the loop sets the first frame synchronously and
      // then suspends on the timer for the rest of the test — no real-timer
      // race, and the pending timer never re-dispatches before dispose().
      frameDelayMs: 100_000,
    });
    await player.init(); // value = '2'
    const d = dom();

    // click() runs onPlay → tick(), which advances the scrub synchronously
    // (value set before the first await), so no waiting is needed.
    d.playBtn.click();
    expect(d.playBtn.textContent).toBe('Pause');
    expect(d.scrubEl.value).toBe('0'); // 2 → (2+1)%3 = 0

    d.playBtn.click();
    expect(d.playBtn.textContent).toBe('Play');
    player.dispose(); // disposed → the suspended loop exits at its next check, no dispatch
  });

  test('dispose() removes the listeners — a later scrub is a no-op', async () => {
    const applySnapshot = vi.fn();
    const player = createTimelapsePlayer(dom(), {
      loadList: async () => [meta(10), meta(20)],
      loadSnapshot: async (id) => body(id),
      applySnapshot,
    });
    await player.init();
    await Promise.resolve();
    await Promise.resolve();
    applySnapshot.mockClear();

    player.dispose();
    const d = dom();
    d.scrubEl.value = '0';
    d.scrubEl.dispatchEvent(new Event('input'));
    await Promise.resolve();
    await Promise.resolve();
    expect(applySnapshot).not.toHaveBeenCalled();
  });
});
