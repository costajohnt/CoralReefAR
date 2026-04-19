import type { RNG } from '../rng.js';

export type Rgb = [number, number, number];

export function tintColor(rng: RNG, base: Rgb, jitter = 0.12): Rgb {
  return [
    clamp01(base[0] + (rng.next() - 0.5) * jitter),
    clamp01(base[1] + (rng.next() - 0.5) * jitter),
    clamp01(base[2] + (rng.next() - 0.5) * jitter),
  ];
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
