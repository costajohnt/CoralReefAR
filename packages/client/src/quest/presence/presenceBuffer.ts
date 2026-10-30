import { Quaternion, Vector3 } from 'three';
import { PRESENCE_INTERVAL_MS, type PresenceVisitor } from '@reef/shared';

/**
 * Render other visitors this far in the past so there is almost always a
 * sample on each side to interpolate between. Two server intervals tolerate
 * one late or lost frame. Tune on the headset (smoothness vs. lag).
 */
export const PRESENCE_RENDER_DELAY_MS = PRESENCE_INTERVAL_MS * 2;
/** A visitor with no new sample for this long is culled (left, or capped out). */
export const PRESENCE_STALE_MS = 2000;
const MAX_SAMPLES = 4;

interface Sample { t: number; p: Vector3; q: Quaternion }

/**
 * Snapshot interpolation for remote head poses (#114). Pure: no scene, no
 * clock; callers pass `now` (ms) so tests drive it with fake poses.
 */
export class PresenceBuffer {
  private readonly samples = new Map<string, Sample[]>();
  private readonly outP = new Vector3();
  private readonly outQ = new Quaternion();

  constructor(
    private readonly delayMs = PRESENCE_RENDER_DELAY_MS,
    private readonly staleMs = PRESENCE_STALE_MS,
  ) {}

  push(visitors: readonly PresenceVisitor[], receivedAt: number): void {
    for (const v of visitors) {
      let list = this.samples.get(v.id);
      if (!list) this.samples.set(v.id, (list = []));
      list.push({
        t: receivedAt,
        p: new Vector3(...v.p),
        q: new Quaternion(...v.q).normalize(),
      });
      if (list.length > MAX_SAMPLES) list.shift();
    }
  }

  /** Drop visitors with nothing newer than staleMs; returns their ids. */
  cull(now: number): string[] {
    const gone: string[] = [];
    for (const [id, list] of this.samples) {
      const last = list[list.length - 1];
      if (!last || now - last.t > this.staleMs) {
        this.samples.delete(id);
        gone.push(id);
      }
    }
    return gone;
  }

  /**
   * Calls `apply` once per visitor with its pose at `now - delay`: interpolated
   * between the samples around that time, held at the newest sample when the
   * stream runs dry (no extrapolation), or the oldest before the first.
   * `p` and `q` are scratch objects reused across calls; copy, don't retain.
   */
  sample(now: number, apply: (id: string, p: Vector3, q: Quaternion) => void): void {
    const t = now - this.delayMs;
    for (const [id, list] of this.samples) {
      const first = list[0];
      const last = list[list.length - 1];
      if (!first || !last) continue;
      if (t <= first.t) {
        apply(id, this.outP.copy(first.p), this.outQ.copy(first.q));
        continue;
      }
      if (t >= last.t) {
        apply(id, this.outP.copy(last.p), this.outQ.copy(last.q));
        continue;
      }
      let i = 1;
      while (i < list.length - 1 && (list[i] as Sample).t < t) i++;
      const a = list[i - 1] as Sample;
      const b = list[i] as Sample;
      const alpha = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      apply(id, this.outP.lerpVectors(a.p, b.p, alpha), this.outQ.slerpQuaternions(a.q, b.q, alpha));
    }
  }

  size(): number {
    return this.samples.size;
  }

  clear(): void {
    this.samples.clear();
  }
}

/** `?presence=1` opts this headset into co-presence (#114). Off by default. */
export function presenceFlagEnabled(search = window.location.search): boolean {
  return new URLSearchParams(search).get('presence') === '1';
}
