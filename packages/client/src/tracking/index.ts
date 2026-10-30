import type { TrackingProvider } from '@reef/shared';
import { EightWallProvider } from './eightwall.js';
import { NoopProvider } from './noop.js';
import { startWebXRTracker, type WebXRHitTestProvider } from './webxrHitTest.js';

// 'webxr' is the opt-in markerless path (#116); the rest are the marker path.
export type TrackerName = 'eightwall' | 'noop' | 'webxr' | 'auto';

/** Marker-path selection. 'webxr' reaching here means WebXR was unavailable. */
export function selectProvider(preferred: TrackerName = 'auto'): TrackingProvider {
  if (preferred === 'eightwall') return new EightWallProvider();
  if (preferred === 'noop') return new NoopProvider();
  if (EightWallProvider.isAvailable()) return new EightWallProvider();
  // Noop gives a usable desktop/dev experience (fixed anchor in front of the
  // camera) when the 8th Wall engine isn't loaded.
  return new NoopProvider();
}

/**
 * Start the WebXR hit-test session only when `?tracker=webxr` asked for it.
 * Null means "use the marker path": flag off, or the device can't do it.
 */
export async function startWebXRIfRequested(
  preferred: TrackerName,
  xr: XRSystem | undefined,
  overlayRoot: Element | null,
): Promise<WebXRHitTestProvider | null> {
  if (preferred !== 'webxr') return null;
  return startWebXRTracker(xr, overlayRoot);
}

export function readTrackerFromUrl(): TrackerName {
  const p = new URLSearchParams(globalThis.location?.search ?? '');
  const v = p.get('tracker');
  if (v === 'eightwall' || v === 'noop' || v === 'webxr') return v;
  return 'auto';
}
