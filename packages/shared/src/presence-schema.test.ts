import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PresenceClientMessageSchema, ServerMessageSchema } from './ws-schema.js';

const ok = { type: 'presence', p: [0.1, 1.6, -0.4], q: [0, 0, 0, 1] };

test('presence: a well-formed client head pose parses', () => {
  assert.ok(PresenceClientMessageSchema.safeParse(ok).success);
});

test('presence: out-of-range, non-finite, extra fields and wrong arity are rejected', () => {
  for (const bad of [
    { ...ok, p: [999, 0, 0] },
    { ...ok, p: [Number.NaN, 0, 0] },
    { ...ok, q: [0, 0, 2, 1] },
    { ...ok, p: [0, 0] },
    { ...ok, name: 'alice' },
    { type: 'presence' },
  ]) {
    assert.equal(PresenceClientMessageSchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

test('presence: the server fan-out frame validates on the client', () => {
  const frame = { type: 'presence', visitors: [{ id: 'a1b2c3d4', p: [0, 1, 0], q: [0, 0, 0, 1] }] };
  assert.ok(ServerMessageSchema.safeParse(frame).success);
});
