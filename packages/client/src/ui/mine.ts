import { UNDO_WINDOW_MS } from '@reef/shared';
import { UndoError, fetchMyPolypIds, undoPolyp } from '../net/api.js';

// Hide the button a little before the server's window closes so a tap at the
// last second doesn't race the deadline and come back "too late".
const CLIENT_MARGIN_MS = 2_000;

/**
 * The "Undo" button for the polyp just planted from this device. Visible
 * text shows a countdown; the accessible name stays fixed ("Undo your last
 * polyp") so screen readers aren't re-announced every second.
 */
export class UndoControl {
  private pendingId: number | null = null;
  private expiresAt = 0;
  private tick: ReturnType<typeof setInterval> | undefined;
  private handler: ((id: number) => void) | null = null;

  constructor(private readonly btn: HTMLButtonElement) {
    btn.hidden = true;
    btn.setAttribute('aria-label', 'Undo your last polyp');
    btn.addEventListener('click', () => {
      if (this.pendingId !== null && !btn.disabled) this.handler?.(this.pendingId);
    });
  }

  onUndo(cb: (id: number) => void): void { this.handler = cb; }

  pending(): number | null { return this.pendingId; }

  offer(id: number, windowMs = UNDO_WINDOW_MS): void {
    this.clear();
    this.pendingId = id;
    this.expiresAt = Date.now() + windowMs - CLIENT_MARGIN_MS;
    this.btn.hidden = false;
    this.setBusy(false);
    this.render();
    this.tick = setInterval(() => this.render(), 1_000);
  }

  setBusy(busy: boolean): void {
    this.btn.disabled = busy;
    if (busy) this.btn.setAttribute('aria-busy', 'true');
    else this.btn.removeAttribute('aria-busy');
  }

  clear(): void {
    if (this.tick !== undefined) clearInterval(this.tick);
    this.tick = undefined;
    this.pendingId = null;
    this.btn.hidden = true;
  }

  private render(): void {
    const left = Math.ceil((this.expiresAt - Date.now()) / 1000);
    if (left <= 0) { this.clear(); return; }
    this.btn.textContent = `Undo (${left}s)`;
  }
}

export function mineNoteText(n: number): string {
  if (n <= 0) return '';
  return `You planted ${n} ${n === 1 ? 'coral' : 'corals'} here (ringed in aqua).`;
}

/** The slice of Reef that MyPolyps drives. */
export interface MineReef {
  markMine(id: number): void;
  unmarkMine(id: number): void;
  removePolyp(id: number): void;
  mineCount(): number;
}

export interface MyPolypsDeps {
  reef: MineReef;
  undoBtn: HTMLButtonElement;
  noteEl: HTMLElement | null;
  setHint(text: string): void;
  /** Called after a successful undo, e.g. to lift a client-side plant cooldown. */
  onUndone?(): void;
  api?: { fetchMyPolypIds(): Promise<number[]>; undoPolyp(id: number): Promise<void> };
}

// Server refusals that won't change on retry: drop the offer.
const FINAL_UNDO_ERRORS = new Set([
  'undo_window_expired', 'not_latest', 'not_owner', 'not_found', 'no_owner',
]);

/** "My polyps" highlight + undo-last, shared by the AR app and the playground. */
export class MyPolyps {
  private readonly undo: UndoControl;
  private readonly api: NonNullable<MyPolypsDeps['api']>;

  constructor(private readonly deps: MyPolypsDeps) {
    this.api = deps.api ?? { fetchMyPolypIds, undoPolyp };
    this.undo = new UndoControl(deps.undoBtn);
    this.undo.onUndo((id) => { void this.doUndo(id); });
  }

  async load(): Promise<void> {
    try {
      for (const id of await this.api.fetchMyPolypIds()) this.deps.reef.markMine(id);
    } catch (e) {
      // Highlighting is a nicety; never block the reef on it.
      console.warn('could not load my polyps', e);
    }
    this.renderNote();
  }

  planted(id: number): void {
    this.deps.reef.markMine(id);
    this.undo.offer(id);
    this.renderNote();
  }

  /** A polyp_removed arrived (admin delete, or our own undo echoed back). */
  removed(id: number): void {
    if (this.undo.pending() === id) this.undo.clear();
    this.renderNote();
  }

  private async doUndo(id: number): Promise<void> {
    this.undo.setBusy(true);
    try {
      await this.api.undoPolyp(id);
      this.deps.reef.removePolyp(id);
      this.deps.reef.unmarkMine(id);
      this.undo.clear();
      this.renderNote();
      this.deps.setHint('Undone. Pick a spot to plant again.');
      this.deps.onUndone?.();
    } catch (e) {
      if (e instanceof UndoError && FINAL_UNDO_ERRORS.has(e.code)) {
        this.undo.clear();
        this.deps.setHint('Too late to undo that one. It’s part of the reef now.');
      } else {
        this.undo.setBusy(false);
        this.deps.setHint('Couldn’t undo. Check your connection and try again.');
        console.error(e);
      }
    }
  }

  private renderNote(): void {
    if (this.deps.noteEl) this.deps.noteEl.textContent = mineNoteText(this.deps.reef.mineCount());
  }
}
