import { describe, it, expect, vi } from 'vitest';
import { PlacementMode } from './placementMode.js';

function makeInputSource(handedness: 'left' | 'right' | 'none'): XRInputSource {
  return {
    handedness,
    targetRayMode: 'tracked-pointer',
    targetRaySpace: {} as XRSpace,
    profiles: [],
  } as unknown as XRInputSource;
}

function makePose(): XRPose {
  return {
    transform: { matrix: new Float32Array(16) },
  } as unknown as XRPose;
}

describe('PlacementMode', () => {
  it('reports no anchor before any pinch', () => {
    const pm = new PlacementMode();
    expect(pm.anchorPose).toBeNull();
  });

  it('captures pose on right-hand selectstart', () => {
    const pm = new PlacementMode();
    const callback = vi.fn();
    pm.onAnchor(callback);
    pm.handleSelectStart(makeInputSource('right'), makePose());
    expect(callback).toHaveBeenCalledTimes(1);
    expect(pm.anchorPose).not.toBeNull();
  });

  it('ignores left-hand pinches', () => {
    const pm = new PlacementMode();
    const callback = vi.fn();
    pm.onAnchor(callback);
    pm.handleSelectStart(makeInputSource('left'), makePose());
    expect(callback).not.toHaveBeenCalled();
    expect(pm.anchorPose).toBeNull();
  });

  it('ignores subsequent pinches once an anchor is set', () => {
    const pm = new PlacementMode();
    const callback = vi.fn();
    pm.onAnchor(callback);
    pm.handleSelectStart(makeInputSource('right'), makePose());
    pm.handleSelectStart(makeInputSource('right'), makePose());
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('reset() clears anchor and allows new placement', () => {
    const pm = new PlacementMode();
    const callback = vi.fn();
    pm.onAnchor(callback);
    pm.handleSelectStart(makeInputSource('right'), makePose());
    pm.reset();
    expect(pm.anchorPose).toBeNull();
    pm.handleSelectStart(makeInputSource('right'), makePose());
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
