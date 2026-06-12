import { describe, it, expect, vi } from 'vitest';
import { Matrix4 } from 'three';
import { ReefAnchor } from './reefAnchor.js';

function makeAnchor(deleteSpy: () => void): XRAnchor {
  return {
    anchorSpace: {} as XRSpace,
    delete: deleteSpy,
  } as unknown as XRAnchor;
}

function makeFrame(pose: XRPose | null): XRFrame {
  return {
    getPose: () => pose,
  } as unknown as XRFrame;
}

function poseWithMatrix(matrix: Float32Array): XRPose {
  return { transform: { matrix } } as unknown as XRPose;
}

describe('ReefAnchor', () => {
  it('object3d.matrixAutoUpdate is disabled so per-frame updates aren\'t clobbered', () => {
    const a = new ReefAnchor(makeAnchor(() => {}));
    expect(a.object3d.matrixAutoUpdate).toBe(false);
  });

  it('update returns true and copies the pose matrix when the anchor is tracked', () => {
    const m = new Matrix4().makeTranslation(1, 2, 3);
    const a = new ReefAnchor(makeAnchor(() => {}));
    const tracked = a.update(makeFrame(poseWithMatrix(m.elements as unknown as Float32Array)), {} as XRReferenceSpace);
    expect(tracked).toBe(true);
    // Verify the translation was applied.
    expect(a.object3d.matrix.elements[12]).toBe(1);
    expect(a.object3d.matrix.elements[13]).toBe(2);
    expect(a.object3d.matrix.elements[14]).toBe(3);
  });

  it('update returns false when pose is null (tracking lost) and leaves previous matrix in place', () => {
    const m1 = new Matrix4().makeTranslation(5, 6, 7);
    const a = new ReefAnchor(makeAnchor(() => {}));
    a.update(makeFrame(poseWithMatrix(m1.elements as unknown as Float32Array)), {} as XRReferenceSpace);
    const before = a.object3d.matrix.elements[14];
    const tracked = a.update(makeFrame(null), {} as XRReferenceSpace);
    expect(tracked).toBe(false);
    expect(a.object3d.matrix.elements[14]).toBe(before);
  });

  it('delete() delegates to the underlying XRAnchor', () => {
    const del = vi.fn();
    const a = new ReefAnchor(makeAnchor(del));
    a.delete();
    expect(del).toHaveBeenCalledTimes(1);
  });
});
