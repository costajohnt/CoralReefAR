import type { PublicPolyp, SimDelta } from './types.js';
import type { EcosystemState } from './ecosystem.js';

export type ServerMessage =
  | { type: 'hello'; polypCount: number; serverTime: number }
  | { type: 'polyp_added'; polyp: PublicPolyp }
  | { type: 'polyp_removed'; id: number }
  | { type: 'sim_update'; updates: SimDelta[]; ecosystem?: EcosystemState }
  | { type: 'presence'; visitors: PresenceVisitor[] };

/**
 * Quest co-presence (#114). Another visitor's head pose in REEF-LOCAL
 * coordinates (relative to the shared reef origin), so each headset can place
 * it against its own anchor. `id` is an anonymous per-connection token.
 */
export interface PresenceVisitor {
  id: string;
  p: [number, number, number];
  q: [number, number, number, number];
}

/** Client sends at most this often; the server fans out on the same cadence (5 Hz). */
export const PRESENCE_INTERVAL_MS = 200;
/** Reef-local coordinates beyond this (metres) are rejected as nonsense. */
export const PRESENCE_MAX_COORD = 20;

export type ClientMessage =
  | { type: 'ping'; t: number }
  | { type: 'subscribe' }
  | { type: 'presence'; p: [number, number, number]; q: [number, number, number, number] };
