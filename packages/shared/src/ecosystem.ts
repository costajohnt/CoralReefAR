/**
 * Reef-wide ecosystem state (#117), derived on the server each sim tick from
 * polyp counts and ages, and broadcast with sim_update.
 *
 * Deliberately global and cosmetic: it never removes, hides or mutates a
 * visitor's polyp. Bleaching is a reversible colour grade (capped so corals
 * keep their colour), and fish numbers scale with the reef.
 */
export type EcosystemPhase = 'thriving' | 'stressed' | 'bleaching' | 'recovering';

export interface EcosystemState {
  version: 1;
  /** Server time this state was computed for. */
  computedAt: number;
  polypCount: number;
  plantedLast7d: number;
  /** Whole days since the newest live polyp; null for an empty reef. */
  daysSinceLastPlant: number | null;
  /** 0 = healthy colour … MAX_BLEACHING = palest. */
  bleaching: number;
  fishCount: number;
  phase: EcosystemPhase;
}

/** Bleaching never goes past this, so polyps stay recognisably theirs. */
export const MAX_BLEACHING = 0.6;
/** Upper bound on fish clients should render. */
export const MAX_FISH = 160;
