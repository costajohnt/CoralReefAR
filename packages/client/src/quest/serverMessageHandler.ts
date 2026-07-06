import type { ServerMessage } from '@reef/shared';
import type { Reef } from '../scene/reef.js';

/**
 * Apply a single server-side reef message to the local Reef scene. Lives
 * outside QuestApp so it can be unit-tested directly without standing up
 * an XRSession or a renderer.
 *
 * `hello` is currently a no-op — the bootstrap fetches reef state via
 * `/api/reef` before subscribing, and we don't yet act on the polypCount
 * snapshot. If duplicate-detection becomes a problem we'd reconcile here.
 */
export function applyServerMessage(reef: Reef, msg: ServerMessage): void {
  switch (msg.type) {
    case 'polyp_added':
      if (!reef.hasPolyp(msg.polyp.id)) reef.addPolyp(msg.polyp);
      break;
    case 'polyp_removed':
      reef.removePolyp(msg.id);
      break;
    case 'sim_update':
      for (const delta of msg.updates) reef.applySim(delta);
      break;
    case 'hello':
      break;
  }
}
