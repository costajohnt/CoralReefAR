import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { dispatchMessage } from './ws-dispatch.js';
import type { ServerMessage } from './ws.js';

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
