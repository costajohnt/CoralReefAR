import type { ServerMessage } from './ws.js';

export type MessageHandler = (msg: ServerMessage) => void;

export interface DispatchCallbacks {
  onParseError?: (err: unknown, raw: string) => void;
  onHandlerError?: (err: unknown, msg: ServerMessage) => void;
}

/**
 * Parse a raw WebSocket frame and dispatch to every handler.
 *
 * The split catch is deliberate: a malformed JSON frame is a framing problem
 * (log once, skip), while a handler throwing is an app bug that must not
 * prevent sibling handlers from running. Lumping both into one catch loses
 * that distinction and turns handler regressions into invisible "junk frames."
 */
export function dispatchMessage(
  raw: string,
  handlers: readonly MessageHandler[],
  cb?: DispatchCallbacks,
): void {
  let msg: ServerMessage;
  try {
    msg = JSON.parse(raw) as ServerMessage;
  } catch (err) {
    cb?.onParseError?.(err, raw);
    return;
  }
  for (const h of handlers) {
    try {
      h(msg);
    } catch (err) {
      cb?.onHandlerError?.(err, msg);
    }
  }
}
