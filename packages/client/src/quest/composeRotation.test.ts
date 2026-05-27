import { describe, it, expect } from 'vitest';
import { Euler, Quaternion } from 'three';

/**
 * The compose-rotation flow inside questApp.ts is a tight loop:
 *   - capture initial yaw from the wrist quaternion at pinch start
 *   - on each frame, compute current yaw - initial yaw, wrapped to (-π, π]
 *   - on pinch end, build a Y-axis quaternion from that delta and POST it
 *
 * These tests pin down the math used in that loop without standing up an
 * XRSession. The functions are inlined here as pure helpers so we can
 * verify behavior independently — they mirror the private methods inside
 * QuestApp.
 */

function yawFromQuaternion(q: Quaternion): number {
  return new Euler().setFromQuaternion(q, 'YXZ').y;
}

function shortestAngleDelta(current: number, initial: number): number {
  let d = current - initial;
  if (d > Math.PI) d -= 2 * Math.PI;
  else if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

describe('compose rotation math', () => {
  it('yaw is 0 for identity quaternion', () => {
    expect(yawFromQuaternion(new Quaternion(0, 0, 0, 1))).toBeCloseTo(0, 6);
  });

  it('yaw is +π/2 for a 90° rotation around world Y', () => {
    const q = new Quaternion().setFromEuler(new Euler(0, Math.PI / 2, 0, 'YXZ'));
    expect(yawFromQuaternion(q)).toBeCloseTo(Math.PI / 2, 6);
  });

  it('shortestAngleDelta returns simple difference within (-π, π]', () => {
    expect(shortestAngleDelta(0.5, 0.2)).toBeCloseTo(0.3, 6);
    expect(shortestAngleDelta(0.2, 0.5)).toBeCloseTo(-0.3, 6);
  });

  it('shortestAngleDelta wraps when current passes the +π boundary going forward', () => {
    // current=170°, initial=-170° → naive 340°, wrapped to -20°.
    const current = (170 * Math.PI) / 180;
    const initial = (-170 * Math.PI) / 180;
    const delta = shortestAngleDelta(current, initial);
    expect(delta).toBeCloseTo((-20 * Math.PI) / 180, 6);
  });

  it('shortestAngleDelta wraps when current passes the -π boundary going backward', () => {
    // current=-170°, initial=170° → naive -340°, wrapped to +20°.
    const current = (-170 * Math.PI) / 180;
    const initial = (170 * Math.PI) / 180;
    const delta = shortestAngleDelta(current, initial);
    expect(delta).toBeCloseTo((20 * Math.PI) / 180, 6);
  });

  it('round trip: wrist yaw delta → Y-axis quaternion → recovered yaw', () => {
    const delta = (45 * Math.PI) / 180;
    const q = new Quaternion().setFromEuler(new Euler(0, delta, 0, 'YXZ'));
    const recovered = yawFromQuaternion(q);
    expect(recovered).toBeCloseTo(delta, 6);
  });
});
