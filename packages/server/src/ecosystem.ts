import {
  MAX_BLEACHING, MAX_FISH, type EcosystemPhase, type EcosystemState,
} from '@reef/shared';

/**
 * Reef-wide population dynamics (#117). Pure and deterministic: the next
 * state depends only on the previous state and these aggregate inputs, with
 * no randomness, so a tick can be replayed exactly and tested.
 *
 * Product choices (conservative by design; see the PR for the list):
 * - Nothing here removes, hides or edits a polyp. "Stress" shows as a
 *   reef-wide, reversible colour grade (bleaching, capped at MAX_BLEACHING so
 *   every coral keeps its colour) and as fewer fish.
 * - Bleaching only starts after GRACE_DAYS with no new planting and takes
 *   days to build; any new planting starts recovery, which is 3x faster than
 *   decline, so a returning visitor sees the reef respond.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Days without planting before any bleaching. */
export const GRACE_DAYS = 3;
/** Days without planting at which the bleaching target reaches the cap. */
export const FULL_BLEACH_DAYS = 14;
/** Max change in bleaching per hour of sim time, rising and falling. */
export const BLEACH_UP_PER_HOUR = 0.01;   // 0 → cap in 60 h
export const BLEACH_DOWN_PER_HOUR = 0.03; // cap → 0 in 20 h
/** Server downtime counts for at most this much catch-up in one tick. */
export const MAX_CATCHUP_HOURS = 24;
const MIN_FISH = 8;
/** At or above this much bleaching the phase reads "bleaching". */
const BLEACHING_PHASE_AT = 0.3;

export interface EcosystemInputs {
  now: number;
  polypCount: number;
  /** created_at of the newest live polyp, or null for an empty reef. */
  lastPlantedAt: number | null;
  plantedLast7d: number;
}

/** Fish grow with the square root of reef size; bleaching drives up to half away. */
export function fishCountFor(polypCount: number, bleaching: number): number {
  const base = MIN_FISH + 4 * Math.sqrt(Math.max(0, polypCount));
  const stress = 1 - 0.5 * Math.min(1, Math.max(0, bleaching) / MAX_BLEACHING);
  return Math.min(MAX_FISH, Math.max(MIN_FISH, Math.round(base * stress)));
}

/** Where bleaching is heading, given how long the reef has gone unplanted. */
export function bleachingTarget(daysSinceLastPlant: number | null): number {
  if (daysSinceLastPlant === null) return 0;
  const t = (daysSinceLastPlant - GRACE_DAYS) / (FULL_BLEACH_DAYS - GRACE_DAYS);
  return Math.min(1, Math.max(0, t)) * MAX_BLEACHING;
}

function phaseFor(bleaching: number, target: number): EcosystemPhase {
  if (bleaching > target + 1e-9) return 'recovering';
  if (bleaching >= BLEACHING_PHASE_AT) return 'bleaching';
  if (target > 0 || bleaching > 0) return 'stressed';
  return 'thriving';
}

export function stepEcosystem(prev: EcosystemState | null, i: EcosystemInputs): EcosystemState {
  const days = i.lastPlantedAt === null ? null : Math.max(0, (i.now - i.lastPlantedAt) / DAY);
  const target = bleachingTarget(days);
  let bleaching = 0; // a first-ever state starts healthy: no jump on deploy
  if (prev) {
    const dtH = Math.min(MAX_CATCHUP_HOURS, Math.max(0, (i.now - prev.computedAt) / HOUR));
    bleaching = target > prev.bleaching
      ? Math.min(target, prev.bleaching + BLEACH_UP_PER_HOUR * dtH)
      : Math.max(target, prev.bleaching - BLEACH_DOWN_PER_HOUR * dtH);
  }
  return {
    version: 1,
    computedAt: i.now,
    polypCount: i.polypCount,
    plantedLast7d: i.plantedLast7d,
    daysSinceLastPlant: days === null ? null : Math.floor(days),
    bleaching,
    fishCount: fishCountFor(i.polypCount, bleaching),
    phase: phaseFor(bleaching, target),
  };
}
