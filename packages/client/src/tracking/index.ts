import type { TrackingProvider } from '@reef/shared';
import { EightWallProvider } from './eightwall.js';
import { MindARProvider } from './mindar.js';
import { NoopProvider } from './noop.js';

export type TrackerName = 'eightwall' | 'mindar' | 'noop' | 'auto';

export function selectProvider(preferred: TrackerName = 'auto'): TrackingProvider {
  if (preferred === 'eightwall') return new EightWallProvider();
  if (preferred === 'mindar') return new MindARProvider();
  if (preferred === 'noop') return new NoopProvider();
  if (EightWallProvider.isAvailable()) return new EightWallProvider();
  // MindARProvider is currently a stub; Noop gives a usable desktop/dev
  // experience (fixed anchor in front of the camera). Swap the fallback
  // once MindAR is actually wired.
  return new NoopProvider();
}

export function readTrackerFromUrl(): TrackerName {
  const p = new URLSearchParams(globalThis.location?.search ?? '');
  const v = p.get('tracker');
  if (v === 'eightwall' || v === 'mindar' || v === 'noop') return v;
  return 'auto';
}
