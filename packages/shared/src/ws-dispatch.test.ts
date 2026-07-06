import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { dispatchMessage, dispatchTreeMessage } from './ws-dispatch.js';
import type { ServerMessage } from './ws.js';
import type { TreeServerMessage } from './tree/ws.js';

// Collect calls; optionally throw on a particular message type.
function recordingHandler(shouldThrow?: (m: ServerMessage) => boolean) {
  const calls: ServerMessage[] = [];
  const fn = (m: ServerMessage): void => {
    calls.push(m);
    if (shouldThrow?.(m)) throw new Error('handler boom');
  };
  return { fn, calls };
}

test('dispatchMessage: malformed JSON is reported to onParseError and handlers are not called', () => {
  const h = recordingHandler();
  const parseErrors: unknown[] = [];
  dispatchMessage('{not json', [h.fn], { onParseError: (e: unknown) => parseErrors.push(e) });
  assert.equal(h.calls.length, 0);
  assert.equal(parseErrors.length, 1);
});

test('dispatchMessage: a handler throw does not prevent later handlers from running', () => {
  const a = recordingHandler((m) => m.type === 'polyp_removed');
  const b = recordingHandler();
  const handlerErrors: unknown[] = [];
  dispatchMessage(
    JSON.stringify({ type: 'polyp_removed', id: 7 }),
    [a.fn, b.fn],
    { onHandlerError: (e: unknown) => handlerErrors.push(e) },
  );
  assert.equal(a.calls.length, 1);
  assert.equal(b.calls.length, 1, 'b should run despite a throwing');
  assert.equal(handlerErrors.length, 1);
});

test('dispatchMessage: valid JSON with well-formed type passes through to every handler in order', () => {
  const a = recordingHandler();
  const b = recordingHandler();
  dispatchMessage(
    JSON.stringify({ type: 'hello', polypCount: 3, serverTime: 1 }),
    [a.fn, b.fn],
  );
  assert.equal(a.calls.length, 1);
  assert.equal(b.calls.length, 1);
  assert.equal((a.calls[0] as { type: string }).type, 'hello');
});

test('dispatchMessage: valid JSON with a bad shape goes to onInvalidMessage, not handlers', () => {
  const h = recordingHandler();
  const invalid: string[] = [];
  const parseErrors: unknown[] = [];
  const cb = {
    onParseError: (e: unknown) => parseErrors.push(e),
    onInvalidMessage: (_e: unknown, raw: string) => invalid.push(raw),
  };
  // Unknown type, and a known type missing a required field — both rejected.
  dispatchMessage('{"type":"not_a_real_type"}', [h.fn], cb);
  dispatchMessage('{"type":"polyp_removed"}', [h.fn], cb);
  assert.equal(h.calls.length, 0);
  assert.equal(invalid.length, 2, 'schema mismatches route to onInvalidMessage with the raw frame');
  assert.equal(parseErrors.length, 0, 'a schema mismatch is not a JSON parse error');
});

test('dispatchMessage: schema mismatch falls back to onParseError when onInvalidMessage is absent', () => {
  const h = recordingHandler();
  const parseErrors: unknown[] = [];
  dispatchMessage('{"type":"polyp_removed"}', [h.fn], { onParseError: (e) => parseErrors.push(e) });
  assert.equal(h.calls.length, 0);
  assert.equal(parseErrors.length, 1);
});

test('dispatchTreeMessage: valid tree frame reaches handlers; garbage is rejected', () => {
  const calls: TreeServerMessage[] = [];
  const fn = (m: TreeServerMessage): void => { calls.push(m); };
  const invalid: unknown[] = [];
  const cb = { onInvalidMessage: (e: unknown) => invalid.push(e) };
  dispatchTreeMessage(JSON.stringify({ type: 'tree_reset' }), [fn], cb);
  dispatchTreeMessage('{"type":"tree_polyp_removed"}', [fn], cb);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.type, 'tree_reset');
  assert.equal(invalid.length, 1);
});
