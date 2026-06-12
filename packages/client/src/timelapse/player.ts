import type { PublicPolyp } from '@reef/shared';

export interface SnapshotMeta {
  id: number;
  takenAt: number;
  polypCount: number;
}
export interface SnapshotBody {
  polyps: PublicPolyp[];
}

/** The DOM controls the player drives. */
export interface TimelapseDom {
  metaEl: HTMLElement;
  scrubEl: HTMLInputElement;
  timeEl: HTMLElement;
  playBtn: HTMLButtonElement;
}

/** Side-effecting dependencies, injected so the player is testable without WebGL. */
export interface TimelapseDeps {
  /** Fetch the snapshot list (newest last). */
  loadList: () => Promise<SnapshotMeta[]>;
  /** Fetch + parse one snapshot's polyp body. */
  loadSnapshot: (id: number) => Promise<SnapshotBody>;
  /** Render a snapshot body into the scene. */
  applySnapshot: (body: SnapshotBody) => void;
  /** Autoplay frame delay in ms (default 400). */
  frameDelayMs?: number;
}

export interface TimelapsePlayer {
  /** Load the snapshot list and show the most recent one. */
  init: () => Promise<void>;
  /** Stop playback and drop the DOM listeners. */
  dispose: () => void;
}

/**
 * The timelapse scrub + autoplay state machine, extracted from the timelapse.ts
 * entry so it can be tested without a live WebGLRenderer. The entry wires the
 * real fetch/render dependencies in; tests inject fakes.
 *
 * The load-token guard is the load-bearing bit: rapid scrubbing stacks
 * `loadSnapshot` fetches, and only the most recently requested one may be
 * applied — out-of-order responses are dropped so the scene never shows a
 * stale snapshot.
 */
export function createTimelapsePlayer(dom: TimelapseDom, deps: TimelapseDeps): TimelapsePlayer {
  const frameDelay = deps.frameDelayMs ?? 400;
  let snapshots: SnapshotMeta[] = [];
  let playing = false;
  let scrubToken = 0;
  let disposed = false;

  const fmt = (ms: number): string => new Date(ms).toISOString().replace('T', ' ').slice(0, 16);

  const onScrub = async (): Promise<void> => {
    const token = ++scrubToken;
    const idx = Number(dom.scrubEl.value);
    const snap = snapshots[idx];
    if (!snap) return;
    dom.timeEl.textContent = fmt(snap.takenAt);
    try {
      const body = await deps.loadSnapshot(snap.id);
      // Discard responses that arrive out of order so we only apply the most
      // recently requested snapshot.
      if (token !== scrubToken) return;
      deps.applySnapshot(body);
    } catch (e) {
      if (token !== scrubToken) return;
      console.error('Failed to load snapshot', e);
      dom.metaEl.textContent = 'Failed to load that snapshot; try another.';
    }
  };

  const onPlay = (): void => {
    playing = !playing;
    dom.playBtn.textContent = playing ? 'Pause' : 'Play';
    if (playing) void tick();
  };

  async function tick(): Promise<void> {
    while (playing && !disposed) {
      // A fast tap could enter tick() before snapshots arrive. Bail instead of
      // dividing by zero and cycling NaN through the scrub handler.
      if (snapshots.length === 0) {
        playing = false;
        dom.playBtn.textContent = 'Play';
        return;
      }
      const cur = Number(dom.scrubEl.value);
      const next = (cur + 1) % snapshots.length;
      dom.scrubEl.value = String(next);
      dom.scrubEl.dispatchEvent(new Event('input'));
      await new Promise((r) => setTimeout(r, frameDelay));
    }
  }

  dom.scrubEl.addEventListener('input', onScrub);
  dom.playBtn.addEventListener('click', onPlay);

  return {
    async init(): Promise<void> {
      try {
        snapshots = await deps.loadList();
      } catch (e) {
        dom.metaEl.textContent = 'Failed to load snapshots.';
        console.error(e);
        return;
      }
      if (snapshots.length === 0) {
        dom.metaEl.textContent = 'No snapshots yet. The server writes one per day.';
        dom.playBtn.disabled = true;
        return;
      }
      dom.metaEl.textContent = `${snapshots.length} snapshot${snapshots.length === 1 ? '' : 's'}`;
      dom.scrubEl.max = String(snapshots.length - 1);
      dom.scrubEl.value = String(snapshots.length - 1);
      dom.scrubEl.dispatchEvent(new Event('input'));
    },
    dispose(): void {
      disposed = true;
      playing = false;
      dom.scrubEl.removeEventListener('input', onScrub);
      dom.playBtn.removeEventListener('click', onPlay);
    },
  };
}
