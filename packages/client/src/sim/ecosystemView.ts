import { MAX_BLEACHING, type EcosystemPhase, type EcosystemState } from '@reef/shared';

export interface EcosystemViewDeps {
  fish?: { setPopulation(n: number): void };
  /** The shared uniform installSway reads (see scene/currentSway.ts). */
  bleach: { value: number };
  /** Optional role=status line that explains the reef's state in words. */
  statusEl?: HTMLElement | null;
}

const PHASE_TEXT: Record<string, string> = {
  stressed: 'The reef is getting stressed. New corals help it.',
  bleaching: 'The reef is bleaching. Plant a coral to help it recover.',
  recovering: 'The reef is recovering.',
};

// Seconds for the colour grade to cover ~63% of a change. Server states
// arrive at most hourly, so a slow ease reads as the reef changing, not a pop.
const EASE_SEC = 3;

/** Applies server ecosystem state (#117) to the client's fish and colour grade. */
export class EcosystemView {
  private target = 0;
  private lastPhase: EcosystemPhase | null = null;

  constructor(private readonly deps: EcosystemViewDeps) {}

  apply(state: EcosystemState | undefined, opts: { immediate?: boolean } = {}): void {
    if (!state) return;
    if (Number.isFinite(state.fishCount)) this.deps.fish?.setPopulation(state.fishCount);
    if (Number.isFinite(state.bleaching)) {
      this.target = Math.min(MAX_BLEACHING, Math.max(0, state.bleaching));
      if (opts.immediate) this.deps.bleach.value = this.target;
    }
    this.lastPhase = state.phase;
    if (this.deps.statusEl) {
      const text = PHASE_TEXT[state.phase] ?? '';
      if (this.deps.statusEl.textContent !== text) this.deps.statusEl.textContent = text;
    }
  }

  update(dtSec: number): void {
    const b = this.deps.bleach;
    if (b.value === this.target) return;
    const k = 1 - Math.exp(-Math.max(0, dtSec) / EASE_SEC);
    b.value += (this.target - b.value) * k;
    if (Math.abs(this.target - b.value) < 1e-3) b.value = this.target; // imperceptible
  }

  phase(): EcosystemPhase | null { return this.lastPhase; }
}
