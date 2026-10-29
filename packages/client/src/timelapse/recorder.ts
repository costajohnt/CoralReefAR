import type { SnapshotBody, SnapshotMeta } from './player.js';

/** Longest video we'll record. Bounds wall time and memory (≈ length × bitrate). */
export const MAX_DURATION_S = 30;

export interface RecordPlan {
  fps: number;
  totalFrames: number;
  /** Frames to hold each snapshot for, in order. */
  framesPerSnapshot: number[];
}

/**
 * Spread `durationS × fps` frames across the snapshots as evenly as possible
 * (counts differ by at most one). Every snapshot gets at least one frame, so a
 * very long history at a short duration just runs a little longer.
 */
export function planRecording(snapshotCount: number, durationS: number, fps: number): RecordPlan {
  if (!Number.isInteger(snapshotCount) || snapshotCount < 1) throw new Error('need at least one snapshot');
  if (!(fps > 0) || !(durationS > 0)) throw new Error('fps and duration must be positive');
  const target = Math.round(Math.min(durationS, MAX_DURATION_S) * fps);
  const total = Math.max(target, snapshotCount);
  const framesPerSnapshot: number[] = [];
  let given = 0;
  for (let k = 0; k < snapshotCount; k++) {
    const upTo = Math.round(((k + 1) * total) / snapshotCount);
    framesPerSnapshot.push(upTo - given);
    given = upTo;
  }
  return { fps, totalFrames: total, framesPerSnapshot };
}

// MP4/H.264 first: it plays everywhere social media and phones care about,
// and Chrome 126+ and Safari record it natively. Otherwise WebM.
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1',
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function pickMimeType(isTypeSupported: (t: string) => boolean): string | null {
  return MIME_CANDIDATES.find((t) => { try { return isTypeSupported(t); } catch { return false; } }) ?? null;
}

export interface OutputSize {
  /** Output (video) size, even numbers. */
  w: number; h: number;
  /** Source crop rectangle in the GL canvas. */
  sx: number; sy: number; sw: number; sh: number;
}

/**
 * Centre-crop the GL canvas to the output aspect (16:9 by default) and scale
 * to fit maxW×maxH without upscaling. Encoders want even dimensions.
 */
export function outputSize(srcW: number, srcH: number, maxW = 1280, maxH = 720): OutputSize {
  const aspect = maxW / maxH;
  let sw = srcW;
  let sh = srcW / aspect;
  if (sh > srcH) { sh = srcH; sw = srcH * aspect; }
  const scale = Math.min(1, maxW / sw);
  const even = (n: number): number => Math.max(2, Math.floor(n / 2) * 2);
  return {
    w: even(sw * scale), h: even(sh * scale),
    sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh,
  };
}

/** The subset of MediaRecorder we drive (injectable for tests). */
export interface RecorderLike {
  readonly state: 'inactive' | 'recording' | 'paused';
  readonly mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  start(timesliceMs?: number): void;
  pause(): void;
  resume(): void;
  stop(): void;
}

export interface RecordDeps {
  snapshots: SnapshotMeta[];
  durationS: number;
  fps: number;
  loadSnapshot(id: number): Promise<SnapshotBody>;
  applySnapshot(body: SnapshotBody): void;
  /** Render frame `i` (of `total`) of snapshot `snap` into the captured canvas. */
  drawFrame(i: number, total: number, snap: SnapshotMeta): void;
  /** Recorder over a canvas stream; requestFrame pushes the current canvas as one frame. */
  createRecorder(): { recorder: RecorderLike; requestFrame: () => void };
  /** Resolve at (or after) wall-clock time `t` ms. */
  waitUntil(t: number): Promise<void>;
  now(): number;
  signal?: AbortSignal;
  onProgress?(done: number, total: number): void;
}

function abortError(): Error {
  return new DOMException('Recording cancelled', 'AbortError');
}

/**
 * Replay the snapshots into the canvas and record them.
 *
 * MediaRecorder timestamps frames with wall-clock time, so frames are pushed
 * on an fps clock. The recorder is paused while each next snapshot is
 * fetched and applied, so network or generation stalls never show up as
 * frozen frames in the video. Only the current snapshot body and one
 * prefetched one are held at a time.
 */
export async function recordTimelapse(d: RecordDeps): Promise<Blob> {
  const plan = planRecording(d.snapshots.length, d.durationS, d.fps);
  const { recorder, requestFrame } = d.createRecorder();
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
  // Set once the recorder reports an error; checked every frame so the loop
  // stops immediately instead of drawing frames nobody is encoding.
  let failure: { error: unknown } | null = null;
  const finished = new Promise<void>((resolve, reject) => {
    recorder.onstop = () => resolve();
    recorder.onerror = (e) => {
      failure = { error: (e as { error?: unknown }).error ?? e };
      reject(failure.error);
    };
  });
  // Keep the rejection observed even if we bail out before awaiting it.
  finished.catch(() => {});

  const stop = (): void => { if (recorder.state !== 'inactive') recorder.stop(); };
  const checkAbort = (): void => {
    if (failure) throw failure.error;
    if (d.signal?.aborted) throw abortError();
  };
  const frameMs = 1000 / plan.fps;

  recorder.start(1000);
  recorder.pause();
  try {
    let next: Promise<SnapshotBody> | null = d.loadSnapshot(d.snapshots[0]!.id);
    let done = 0;
    for (let k = 0; k < d.snapshots.length; k++) {
      const body: SnapshotBody = await next!;
      checkAbort();
      // Start the next fetch now so it overlaps this snapshot's frames.
      next = k + 1 < d.snapshots.length ? d.loadSnapshot(d.snapshots[k + 1]!.id) : null;
      next?.catch(() => {});
      d.applySnapshot(body);
      recorder.resume();
      let deadline = d.now();
      for (let f = 0; f < plan.framesPerSnapshot[k]!; f++) {
        checkAbort();
        d.drawFrame(done, plan.totalFrames, d.snapshots[k]!);
        requestFrame();
        done++;
        d.onProgress?.(done, plan.totalFrames);
        deadline += frameMs;
        // After a stall (GC, slow frame, throttling) the next deadline is
        // already in the past; re-anchor on now so the remaining frames keep
        // their spacing instead of firing back-to-back to catch up.
        const now = d.now();
        if (deadline < now) deadline = now + frameMs;
        await d.waitUntil(deadline);
      }
      recorder.pause();
    }
  } catch (err) {
    stop();
    throw err;
  }
  stop();
  await finished;
  return new Blob(chunks, { type: recorder.mimeType });
}
