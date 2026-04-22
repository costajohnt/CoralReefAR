import type { TreeVariant } from '@reef/shared';
import type { VariantOutput } from './variant.js';
import { generateForked } from './variants/forked.js';
import { generateTrident } from './variants/trident.js';
import { generateStarburst } from './variants/starburst.js';
import { generateClaw } from './variants/claw.js';
import { generateWishbone } from './variants/wishbone.js';

export interface GenerateInput {
  variant: TreeVariant;
  seed: number;
  colorKey: string;
}

export function generateTreeVariant(input: GenerateInput): VariantOutput {
  switch (input.variant) {
    case 'forked':    return generateForked(input);
    case 'trident':   return generateTrident(input);
    case 'starburst': return generateStarburst(input);
    case 'claw':      return generateClaw(input);
    case 'wishbone':  return generateWishbone(input);
    default: {
      const _exhaustive: never = input.variant;
      throw new Error(`unknown tree variant: ${_exhaustive as string}`);
    }
  }
}

export { tipAttachPoint } from './variant.js';
export type { VariantOutput, VariantGenerateInput } from './variant.js';
