import { hexToRgb, paletteByKey, type Species } from '@reef/shared';
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

export interface GeneratedPolyp {
  mesh: MeshData;
  boundingRadius: number;
  approxHeight: number;
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
  const color = hexToRgb(paletteByKey(opts.colorKey).hex);
  return BUILDERS[opts.species]!(rng, color);
}
