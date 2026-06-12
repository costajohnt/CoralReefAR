import { hexToRgb, paletteByKeyOrDefault, type Species } from '@reef/shared';
import { RNG } from './rng.js';
import type { MeshData } from './meshdata.js';
import { generateBranching } from './species/branching.js';
import { generateBulbous } from './species/bulbous.js';
import { generateFan } from './species/fan.js';
import { generateTube } from './species/tube.js';
import { generateEncrusting } from './species/encrusting.js';

export interface GenerateOptions {
  species: Species;
  seed: number;
  colorKey: string;
}

/**
 * A point on a polyp where new growth can attach. Position is in the
 * polyp's local mesh space; normal points outward from the surface
 * (i.e. the direction a new branch would naturally extend).
 */
export interface TipNode {
  position: readonly [number, number, number];
  normal: readonly [number, number, number];
}

export interface GeneratedPolyp {
  mesh: MeshData;
  boundingRadius: number;
  approxHeight: number;
  /** Where new growth can attach. May be empty (e.g. encrusting species). */
  tips?: TipNode[];
}

type Builder = (rng: RNG, color: [number, number, number]) => GeneratedPolyp;

const BUILDERS: Record<Species, Builder> = {
  branching: generateBranching,
  bulbous: generateBulbous,
  fan: generateFan,
  tube: generateTube,
  encrusting: generateEncrusting,
};

export function generatePolyp(opts: GenerateOptions): GeneratedPolyp {
  const rng = new RNG(opts.seed);
  // Tolerant resolve: an unknown colorKey (only reachable from a stale row
  // predating the schema enum) renders with the fallback colour instead of
  // throwing and blanking the whole reef. The write path validates via zod.
  const color = hexToRgb(paletteByKeyOrDefault(opts.colorKey).hex);
  return BUILDERS[opts.species]!(rng, color);
}
