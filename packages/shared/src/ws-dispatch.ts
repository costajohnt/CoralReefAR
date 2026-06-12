import type { ZodType } from 'zod';
import type { ServerMessage } from './ws.js';
import type { TreeServerMessage } from './tree/ws.js';
import { ServerMessageSchema, TreeServerMessageSchema } from './ws-schema.js';

export type MessageHandler = (msg: ServerMessage) => void;
export type TreeMessageHandler = (msg: TreeServerMessage) => void;

export interface DispatchCallbacks<M = ServerMessage> {
  /** Frame wasn't valid JSON (transport noise). */
  onParseError?: (err: unknown, raw: string) => void;
  /**
   * Frame was valid JSON but didn't match the schema — a structurally invalid
   * or version-skewed frame (the server sent a shape this client doesn't
   * recognize). Distinct from onParseError because a skew is a real protocol
   * problem worth surfacing loudly with the raw frame; falls back to
   * onParseError when not provided.
   */
  onInvalidMessage?: (err: unknown, raw: string) => void;
  onHandlerError?: (err: unknown, msg: M) => void;
}

/**
 * Parse + validate a raw WebSocket frame, then dispatch to every handler.
 *
 * Three distinct failure modes, kept separate on purpose:
 * - Not valid JSON → onParseError (transport noise).
 * - Valid JSON, fails the schema → onInvalidMessage (protocol skew). Either way
 *   the frame is dropped — handlers never see a half-formed message with
 *   `undefined` fields.
 * - A handler throwing is an app bug routed to onHandlerError; it must not
 *   prevent sibling handlers from running.
 */
function dispatch<M>(
  raw: string,
  schema: ZodType<M>,
  handlers: readonly ((msg: M) => void)[],
  cb?: DispatchCallbacks<M>,
): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    cb?.onParseError?.(err, raw);
    return;
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    (cb?.onInvalidMessage ?? cb?.onParseError)?.(result.error, raw);
    return;
  }
  const msg = result.data;
  for (const h of handlers) {
    try {
      h(msg);
    } catch (err) {
      cb?.onHandlerError?.(err, msg);
    }
  }
}

/** Dispatch a reef (`/ws`) frame, validated against ServerMessageSchema. */
export function dispatchMessage(
  raw: string,
  handlers: readonly MessageHandler[],
  cb?: DispatchCallbacks<ServerMessage>,
): void {
  dispatch(raw, ServerMessageSchema as ZodType<ServerMessage>, handlers, cb);
}

/** Dispatch a tree (`/ws/tree`) frame, validated against TreeServerMessageSchema. */
export function dispatchTreeMessage(
  raw: string,
  handlers: readonly TreeMessageHandler[],
  cb?: DispatchCallbacks<TreeServerMessage>,
): void {
  dispatch(raw, TreeServerMessageSchema as ZodType<TreeServerMessage>, handlers, cb);
}
