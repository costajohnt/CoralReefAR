import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { computeGestureFrame, type TouchPair } from './gestures.js';

// Helper: make two 2-D touch points.
function pair(ax: number, ay: number, bx: number, by: number): TouchPair {
  return { a: { x: ax, y: ay }, b: { x: bx, y: by } };
}

test('gestures: same pair emits zero rotation and 1.0 scale ratio', () => {
  const prev = pair(0, 0, 10, 0);
  const curr = pair(0, 0, 10, 0);
  const out = computeGestureFrame(prev, curr);
  assert.equal(out.rotateRadians, 0);
  assert.equal(out.scaleFactor, 1);
});

test('gestures: twisting touches 90° clockwise returns +π/2 rotation', () => {
  const prev = pair(0, 0, 10, 0);    // angle 0
  const curr = pair(0, 0, 0, 10);    // angle +π/2
  const out = computeGestureFrame(prev, curr);
  assert.ok(Math.abs(out.rotateRadians - Math.PI / 2) < 1e-9, `got ${out.rotateRadians}`);
  assert.ok(Math.abs(out.scaleFactor - 1) < 1e-9);
});

test('gestures: doubling the distance returns scaleFactor 2', () => {
  const prev = pair(0, 0, 10, 0);    // d=10
  const curr = pair(0, 0, 20, 0);    // d=20
  const out = computeGestureFrame(prev, curr);
  assert.equal(out.scaleFactor, 2);
  assert.equal(out.rotateRadians, 0);
});

test('gestures: rotation wraps to shortest arc (never > π in magnitude)', () => {
  // Near-full-circle twist: prev at 0°, curr at ~350° — should report -10°, not +350°.
  const prev = pair(0, 0, 10, 0);
  const curr = pair(0, 0, Math.cos(-Math.PI / 18) * 10, Math.sin(-Math.PI / 18) * 10);
  const out = computeGestureFrame(prev, curr);
  assert.ok(Math.abs(out.rotateRadians) <= Math.PI);
  assert.ok(Math.abs(out.rotateRadians - -Math.PI / 18) < 1e-9, `got ${out.rotateRadians}`);
});

test('gestures: zero-distance prev pair emits zero rotation and scale 1 (safe guard)', () => {
  const prev = pair(5, 5, 5, 5);
  const curr = pair(0, 0, 10, 0);
  const out = computeGestureFrame(prev, curr);
  assert.equal(out.rotateRadians, 0);
  assert.equal(out.scaleFactor, 1);
});

test('gestures: zero-distance CURR pair also emits identity (no phantom twist)', () => {
  // If only the current frame is coincident (pinch to a point), atan2(0,0)=0
  // would otherwise produce a spurious rotation of -angle(prev) and a
  // scaleFactor of 0 clamped to MIN. The guard covers both endpoints.
  const prev = pair(0, 0, 10, 0);      // angle 0
  const curr = pair(7, 7, 7, 7);       // coincident
  const out = computeGestureFrame(prev, curr);
  assert.equal(out.rotateRadians, 0);
  assert.equal(out.scaleFactor, 1);
});

test('gestures: bounds clamp scaleFactor to [0.5, 2] per frame', () => {
  // 4x jump in one frame clamps to 2x
  const prev = pair(0, 0, 10, 0);
  const curr = pair(0, 0, 40, 0);
  const out = computeGestureFrame(prev, curr);
  assert.equal(out.scaleFactor, 2);
  // Opposite: 0.1x jump clamps to 0.5x
  const curr2 = pair(0, 0, 1, 0);
  const out2 = computeGestureFrame(prev, curr2);
  assert.equal(out2.scaleFactor, 0.5);
});
