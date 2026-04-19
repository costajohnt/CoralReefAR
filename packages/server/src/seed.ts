import { ReefDb } from './db.js';
import { SPECIES, REEF_PALETTE, type Species } from '@reef/shared';
import { config } from './config.js';

/**
 * Hand-place ~50 polyps so the first visitor sees a living structure, not
 * an empty pedestal. Uses deterministic pseudo-random placement within
 * pedestal bounds (anchor-local) and cycles through species + palette.
 *
 * Run: pnpm --filter @reef/server exec node dist/seed.js
 */
function seed(): void {
  const db = new ReefDb(config.dbPath);
  const existing = db.listPublicPolyps().length;
  if (existing > 0) {
    console.log(`reef already has ${existing} polyps; skipping seed`);
    return;
  }
  const now = Date.now();
  let s = 1;
  for (let i = 0; i < 50; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const u = (s & 0xffff) / 0xffff;
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const v = (s & 0xffff) / 0xffff;
    const theta = u * Math.PI * 2;
    const r = 0.04 + v * 0.12;
    const species: Species = SPECIES[i % SPECIES.length]!;
    const color = REEF_PALETTE[(i * 7) % REEF_PALETTE.length]!;
    db.insertPolyp({
      species,
      seed: i * 0x9e3779b9 >>> 0,
      colorKey: color.key,
      position: [Math.cos(theta) * r, 0, Math.sin(theta) * r],
      orientation: [0, 0, 0, 1],
      scale: 0.7 + v * 0.5,
      createdAt: now - (50 - i) * 86_400_000,
      deviceHash: 'seed',
    });
  }
  console.log('seeded 50 polyps');
}

seed();
