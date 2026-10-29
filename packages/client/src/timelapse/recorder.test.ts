import { describe, test, expect, vi } from 'vitest';
import type { SnapshotBody, SnapshotMeta } from './player.js';
import {
  MAX_DURATION_S, outputSize, pickMimeType, planRecording, recordTimelapse,
  type RecorderLike, type RecordDeps,
} from './recorder.js';

describe('planRecording', () => {
  test('spreads frames evenly across snapshots, totalling duration × fps', () => {
    const plan = planRecording(4, 10, 30);
    expect(plan.totalFrames).toBe(300);
    expect(plan.framesPerSnapshot).toEqual([75, 75, 75, 75]);
  });

  test('uneven splits differ by at most one frame', () => {
    const plan = planRecording(7, 10, 24);
    expect(plan.framesPerSnapshot.reduce((a, b) => a + b, 0)).toBe(240);
    expect(Math.max(...plan.framesPerSnapshot) - Math.min(...plan.framesPerSnapshot)).toBeLessThanOrEqual(1);
  });

  test('every snapshot gets at least one frame even when there are more snapshots than frames', () => {
    const plan = planRecording(90, 1, 24);
    expect(plan.framesPerSnapshot.every((f) => f >= 1)).toBe(true);
    expect(plan.totalFrames).toBe(90);
  });

  test('duration is clamped to the maximum', () => {
    expect(planRecording(1, 999, 30).totalFrames).toBe(MAX_DURATION_S * 30);
  });

  test('rejects bad input', () => {
    expect(() => planRecording(0, 10, 30)).toThrow();
    expect(() => planRecording(3, 10, 0)).toThrow();
  });
});

describe('pickMimeType', () => {
  test('prefers MP4/H.264, then WebM VP9, VP8, plain WebM', () => {
    expect(pickMimeType(() => true)).toMatch(/^video\/mp4/);
    expect(pickMimeType((t) => t.startsWith('video/webm'))).toBe('video/webm;codecs=vp9');
    expect(pickMimeType((t) => t === 'video/webm')).toBe('video/webm');
    expect(pickMimeType(() => false)).toBeNull();
  });
});

describe('outputSize', () => {
  test('crops a wide desktop canvas to 16:9 and caps at the max size, even dims', () => {
    const o = outputSize(2912, 1400, 1280, 720);
    expect(o.w).toBe(1280);
    expect(o.h).toBe(720);
    expect(o.sh).toBe(1400);
    expect(o.sw).toBeCloseTo(1400 * 16 / 9, 0);
    expect(o.sx).toBeCloseTo((2912 - o.sw) / 2, 0);
  });

  test('a portrait phone canvas is cropped vertically and never upscaled', () => {
    const o = outputSize(780, 1300, 854, 480);
    expect(o.sw).toBe(780);
    expect(o.sh).toBeCloseTo(780 * 9 / 16, 0);
    expect(o.w).toBeLessThanOrEqual(780);
    expect(o.w % 2).toBe(0);
    expect(o.h % 2).toBe(0);
  });
});

class FakeRecorder implements RecorderLike {
  state: 'inactive' | 'recording' | 'paused' = 'inactive';
  mimeType = 'video/webm';
  log: string[] = [];
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  start(): void { this.state = 'recording'; this.log.push('start'); }
  pause(): void { this.state = 'paused'; this.log.push('pause'); }
  resume(): void { this.state = 'recording'; this.log.push('resume'); }
  stop(): void {
    this.state = 'inactive';
    this.log.push('stop');
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(['abc']) });
      this.ondataavailable?.({ data: new Blob([]) });
      this.onstop?.();
    });
  }
}

const snaps = (n: number): SnapshotMeta[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, takenAt: i * 86_400_000, polypCount: i }));

function deps(over: Partial<RecordDeps> = {}) {
  const rec = new FakeRecorder();
  const frames: Array<{ i: number; snapId: number; state: string }> = [];
  const applied: number[] = [];
  const requests: number[] = [];
  const d: RecordDeps = {
    snapshots: snaps(3),
    durationS: 1,
    fps: 6,
    loadSnapshot: async (id) => ({ polyps: [{ id } as never] }),
    applySnapshot: (b: SnapshotBody) => { applied.push((b.polyps[0] as unknown as { id: number }).id); },
    drawFrame: (i, _total, snap) => { frames.push({ i, snapId: snap.id, state: rec.state }); },
    createRecorder: () => ({ recorder: rec, requestFrame: () => { requests.push(frames.length); } }),
    waitUntil: async () => {},
    now: () => 0,
    ...over,
  };
  return { d, rec, frames, applied, requests };
}

describe('recordTimelapse', () => {
  test('draws every planned frame, in snapshot order, only while recording', async () => {
    const { d, rec, frames, applied, requests } = deps();
    const blob = await recordTimelapse(d);
    expect(frames).toHaveLength(6);
    expect(frames.map((f) => f.snapId)).toEqual([1, 1, 2, 2, 3, 3]);
    expect(frames.every((f) => f.state === 'recording')).toBe(true);
    expect(requests).toHaveLength(6);
    expect(applied).toEqual([1, 2, 3]);
    expect(rec.log[0]).toBe('start');
    expect(rec.log.at(-1)).toBe('stop');
    expect(blob.type).toBe('video/webm');
    expect(blob.size).toBe(3);
  });

  test('pauses the recorder while the next snapshot loads, so stalls are not in the video', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const states: string[] = [];
    const { d, rec } = deps({
      loadSnapshot: async (id) => {
        if (id === 2) { states.push(rec.state); await gate; }
        return { polyps: [{ id } as never] };
      },
    });
    const p = recordTimelapse(d);
    await vi.waitFor(() => expect(states).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(rec.state).toBe('paused');
    release();
    await p;
  });

  test('holds at most the current and one prefetched snapshot body', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const { d } = deps({
      snapshots: snaps(6),
      loadSnapshot: async (id) => {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return { polyps: [{ id } as never] };
      },
    });
    await recordTimelapse(d);
    expect(maxInFlight).toBeLessThanOrEqual(1);
  });

  test('paces frames on the fps clock', async () => {
    const deadlines: number[] = [];
    const { d } = deps({ waitUntil: async (t) => { deadlines.push(t); }, now: () => 1000 });
    await recordTimelapse(d);
    expect(deadlines[1]! - deadlines[0]!).toBeCloseTo(1000 / 6);
  });

  test('reports progress', async () => {
    const progress: number[] = [];
    const { d } = deps({ onProgress: (done, total) => progress.push(done / total) });
    await recordTimelapse(d);
    expect(progress.at(-1)).toBe(1);
  });

  test('abort stops the recorder and rejects with AbortError', async () => {
    const ac = new AbortController();
    const { d, rec, frames } = deps({
      signal: ac.signal,
      drawFrame: (i) => { if (i === 2) ac.abort(); frames.push({ i, snapId: 0, state: '' }); },
    });
    await expect(recordTimelapse(d)).rejects.toMatchObject({ name: 'AbortError' });
    expect(rec.log).toContain('stop');
    expect(frames.length).toBeLessThan(6);
  });

  test('a snapshot that fails to load stops the recording with an error', async () => {
    const { d, rec } = deps({ loadSnapshot: async (id) => { if (id === 2) throw new Error('500'); return { polyps: [{ id } as never] }; } });
    await expect(recordTimelapse(d)).rejects.toThrow('500');
    expect(rec.log).toContain('stop');
  });

  test('a recorder error rejects', async () => {
    const { d, rec } = deps();
    rec.stop = function (this: FakeRecorder) {
      this.state = 'inactive';
      queueMicrotask(() => this.onerror?.(new Error('encoder died')));
    };
    await expect(recordTimelapse(d)).rejects.toThrow(/encoder died/);
  });
});
