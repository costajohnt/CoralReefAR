/**
 * Pure gesture math for two-finger twist + pinch. No DOM, no Three.js.
 * The client wires DOM touch events to these functions and applies the
 * returned deltas to its scene graph.
 */

export interface Point2 { readonly x: number; readonly y: number }
export interface TouchPair { readonly a: Point2; readonly b: Point2 }

export interface GestureFrame {
  /** Signed radians to rotate by this frame, wrapped to (-π, π]. */
  readonly rotateRadians: number;
  /** Ratio of current distance to previous distance, clamped to [0.5, 2]. */
  readonly scaleFactor: number;
}

const MIN_DISTANCE = 1e-6;
const MIN_SCALE_STEP = 0.5;
const MAX_SCALE_STEP = 2;

function distance(p: TouchPair): number {
  const dx = p.b.x - p.a.x;
  const dy = p.b.y - p.a.y;
  return Math.hypot(dx, dy);
}

function angle(p: TouchPair): number {
  return Math.atan2(p.b.y - p.a.y, p.b.x - p.a.x);
}

function wrapAngle(delta: number): number {
  // Map to (-π, π] so rotating past 180° takes the short way round.
  let d = delta % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export function computeGestureFrame(prev: TouchPair, curr: TouchPair): GestureFrame {
  const prevDist = distance(prev);
  const currDist = distance(curr);
  // Either degenerate pair means we can't derive a meaningful angle or ratio —
  // atan2(0,0) = 0 would synthesize a twist equal to -angle(prev), a phantom
  // rotation on any pinch-to-a-point. Return identity and let the next
  // touchmove start a fresh non-degenerate frame.
  if (prevDist < MIN_DISTANCE || currDist < MIN_DISTANCE) {
    return { rotateRadians: 0, scaleFactor: 1 };
  }
  const rawScale = currDist / prevDist;
  const scaleFactor = Math.min(MAX_SCALE_STEP, Math.max(MIN_SCALE_STEP, rawScale));

  const rotateRadians = wrapAngle(angle(curr) - angle(prev));

  return { rotateRadians, scaleFactor };
}
