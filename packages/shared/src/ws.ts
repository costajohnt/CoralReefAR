import type { PublicPolyp, SimDelta } from './types.js';

export type ServerMessage =
  | { type: 'hello'; polypCount: number; serverTime: number }
  | { type: 'polyp_added'; polyp: PublicPolyp }
  | { type: 'polyp_removed'; id: number }
  | { type: 'sim_update'; updates: SimDelta[] };

export type ClientMessage =
  | { type: 'ping'; t: number }
  | { type: 'subscribe' };
