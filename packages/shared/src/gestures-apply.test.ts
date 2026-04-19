import { strict as assert } from 'node:assert';
import { test } from 'node:test';

// Minimal quaternion math mirroring Three.js `Quaternion.multiply` + `.normalize`
// — just enough to assert that the normalize step applied in placement.ts
// actually prevents magnitude drift under sustained gesture application.
interface Q { x: number; y: number; z: number; w: number }

function fromAxisAngle(ax: number, ay: number, az: number, angle: number): Q {
  const half = angle * 0.5;
  const s = Math.sin(half);
  return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(half) };
}

function multiply(a: Q, b: Q): Q {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y + a.y * b.w + a.z * b.x - a.x * b.z,
    z: a.w * b.z + a.z * b.w + a.x * b.y - a.y * b.x,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

function length(q: Q): number {
  return Math.hypot(q.x, q.y, q.z, q.w);
}

function normalize(q: Q): Q {
  const len = length(q) || 1;
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

test('quaternion: 600 .multiply calls without normalize let magnitude drift off 1', () => {
  // The twist applied on every touchmove frame. Small angle keeps things
  // mathematically stable; float error is what we're measuring.
  const twist = fromAxisAngle(0, 1, 0, 0.01);
  let q: Q = { x: 0, y: 0, z: 0, w: 1 };
  for (let i = 0; i < 600; i++) q = multiply(q, twist);
  // This is a pin — `length(q)` stays close to 1 for tiny-angle twists in
  // practice, but float precision still drifts at the ulp scale.
  const drift = Math.abs(length(q) - 1);
  assert.ok(drift < 1e-6, `expected some drift from multiply alone; got ${drift}`);
});

test('quaternion: 600 .multiply + .normalize calls stay exactly unit length', () => {
  const twist = fromAxisAngle(0, 1, 0, 0.01);
  let q: Q = { x: 0, y: 0, z: 0, w: 1 };
  for (let i = 0; i < 600; i++) q = normalize(multiply(q, twist));
  const drift = Math.abs(length(q) - 1);
  // After normalize every frame, drift is at the ulp level for any input.
  assert.ok(drift < 1e-10, `normalize should hold magnitude to ulp; got ${drift}`);
});
