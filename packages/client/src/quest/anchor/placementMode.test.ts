import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

interface MutableTransform {
  matrix: Float32Array;
  position: { x: number; y: number; z: number; w: number };
  orientation: { x: number; y: number; z: number; w: number };
}

function makePoseWithRigidTransform(p: { x: number; y: number; z: number }): {
  pose: XRPose;
  transform: MutableTransform;
} {
  const transform: MutableTransform = {
    matrix: new Float32Array(16),
    position: { x: p.x, y: p.y, z: p.z, w: 1 },
    orientation: { x: 0, y: 0, z: 0, w: 1 },
  };
  return { pose: { transform } as unknown as XRPose, transform };
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

  describe('rigid-transform snapshot semantics', () => {
    const realXRRigidTransform = (globalThis as { XRRigidTransform?: unknown })
      .XRRigidTransform;

    beforeEach(() => {
      // Mock XRRigidTransform constructor so PlacementMode takes its
      // primitive-snapshot path even under happy-dom.
      (globalThis as { XRRigidTransform?: unknown }).XRRigidTransform = class {
        position: { x: number; y: number; z: number; w: number };
        orientation: { x: number; y: number; z: number; w: number };
        matrix: Float32Array;
        constructor(
          pos: { x: number; y: number; z: number; w: number },
          ori: { x: number; y: number; z: number; w: number },
        ) {
          this.position = { ...pos };
          this.orientation = { ...ori };
          this.matrix = new Float32Array(16);
        }
      };
    });

    afterEach(() => {
      if (realXRRigidTransform === undefined) {
        delete (globalThis as { XRRigidTransform?: unknown }).XRRigidTransform;
      } else {
        (globalThis as { XRRigidTransform?: unknown }).XRRigidTransform =
          realXRRigidTransform;
      }
    });

    it('captured transform is independent of subsequent source mutation', () => {
      const pm = new PlacementMode();
      const { pose, transform } = makePoseWithRigidTransform({ x: 1, y: 2, z: 3 });
      pm.handleSelectStart(makeInputSource('right'), pose);
      // Mutate the source after capture; should NOT bleed into the snapshot.
      transform.position.x = 999;
      transform.position.y = 999;
      transform.position.z = 999;
      expect(pm.anchorPose?.transform.position.x).toBe(1);
      expect(pm.anchorPose?.transform.position.y).toBe(2);
      expect(pm.anchorPose?.transform.position.z).toBe(3);
    });

    it('captured transform is not the same identity as source.transform', () => {
      const pm = new PlacementMode();
      const { pose, transform } = makePoseWithRigidTransform({ x: 0, y: 0, z: 0 });
      pm.handleSelectStart(makeInputSource('right'), pose);
      expect(pm.anchorPose?.transform).not.toBe(transform);
    });
  });
});
