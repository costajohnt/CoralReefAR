import type { TrackingProvider } from '@reef/shared';
import { EightWallProvider } from './eightwall.js';
import { NoopProvider } from './noop.js';

export type TrackerName = 'eightwall' | 'noop' | 'auto';

export function selectProvider(preferred: TrackerName = 'auto'): TrackingProvider {
  if (preferred === 'eightwall') return new EightWallProvider();
  if (preferred === 'noop') return new NoopProvider();
  if (EightWallProvider.isAvailable()) return new EightWallProvider();
  // Noop gives a usable desktop/dev experience (fixed anchor in front of the
  // camera) when the 8th Wall engine isn't loaded.
  return new NoopProvider();
}

export function readTrackerFromUrl(): TrackerName {
  const p = new URLSearchParams(globalThis.location?.search ?? '');
  const v = p.get('tracker');
  if (v === 'eightwall' || v === 'noop') return v;
  return 'auto';
}
