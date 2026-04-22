import type { PublicTreePolyp } from './types.js';

export type TreeServerMessage =
  | { type: 'tree_hello'; polypCount: number; serverTime: number }
  | { type: 'tree_polyp_added'; polyp: PublicTreePolyp }
  | { type: 'tree_polyp_removed'; id: number };
