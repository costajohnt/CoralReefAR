export const SPECIES = ['branching', 'bulbous', 'fan', 'tube', 'encrusting'] as const;
export type Species = (typeof SPECIES)[number];

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

export interface Polyp {
  id: number;
  species: Species;
  seed: number;
  colorKey: string;
  position: Vec3;
  orientation: Quat;
  scale: number;
  createdAt: number;
  deviceHash: string;
  deleted: boolean;
}

/** Server-authoritative polyp with PII (device_hash) stripped. */
export type PublicPolyp = Omit<Polyp, 'deviceHash' | 'deleted'>;

export type PolypInput = Omit<Polyp, 'id' | 'createdAt' | 'deviceHash' | 'deleted'>;

export type SimKind = 'algae' | 'barnacle' | 'weather';

export interface SimDelta {
  polypId: number;
  kind: SimKind;
  params: Record<string, number | string>;
  createdAt: number;
}

export interface ReefState {
  polyps: PublicPolyp[];
  sim: SimDelta[];
  serverTime: number;
}
