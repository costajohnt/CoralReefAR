import { describe, test, expect } from 'vitest';
import { Group, Matrix4, Quaternion, Vector3 } from 'three';
import { applyAnchorPose } from './anchor.js';

function identityElements(): number[] {
  return new Matrix4().identity().elements.slice();
}

function translationElements(x: number, y: number, z: number): number[] {
  return new Matrix4().makeTranslation(x, y, z).elements.slice();
}

describe('applyAnchorPose', () => {
  test('identity pose, no scaleMultiplier → position (0,0,0), quaternion identity, scale (1,1,1)', () => {
    const anchor = new Group();
    applyAnchorPose(anchor, identityElements());
    expect(anchor.position.x).toBeCloseTo(0);
    expect(anchor.position.y).toBeCloseTo(0);
    expect(anchor.position.z).toBeCloseTo(0);
    const q = new Quaternion();
    expect(anchor.quaternion.angleTo(q)).toBeCloseTo(0);
    expect(anchor.scale.x).toBeCloseTo(1);
    expect(anchor.scale.y).toBeCloseTo(1);
    expect(anchor.scale.z).toBeCloseTo(1);
  });

  test('identity pose with scaleMultiplier=5 → scale (5,5,5)', () => {
    const anchor = new Group();
    applyAnchorPose(anchor, identityElements(), 5);
    expect(anchor.scale.x).toBeCloseTo(5);
    expect(anchor.scale.y).toBeCloseTo(5);
    expect(anchor.scale.z).toBeCloseTo(5);
  });

  test('translation (1,2,3) pose → position applied, scaleMultiplier=2 multiplies decomposed scale', () => {
    const anchor = new Group();
    applyAnchorPose(anchor, translationElements(1, 2, 3), 2);
    expect(anchor.position.x).toBeCloseTo(1);
    expect(anchor.position.y).toBeCloseTo(2);
    expect(anchor.position.z).toBeCloseTo(3);
    expect(anchor.scale.x).toBeCloseTo(2);
    expect(anchor.scale.y).toBeCloseTo(2);
    expect(anchor.scale.z).toBeCloseTo(2);
  });

  test('empty array input → no-op (anchor unchanged)', () => {
    const anchor = new Group();
    anchor.position.set(9, 9, 9);
    applyAnchorPose(anchor, []);
    expect(anchor.position.x).toBeCloseTo(9);
  });

  test('non-16-length array input → no-op (anchor unchanged)', () => {
    const anchor = new Group();
    anchor.position.set(7, 7, 7);
    applyAnchorPose(anchor, [1, 2, 3, 4, 5]);
    expect(anchor.position.x).toBeCloseTo(7);
  });

  test('scale (1,1,1) in matrix with scaleMultiplier=1 → Vector3 magnitude consistent', () => {
    const anchor = new Group();
    const elements = new Matrix4()
      .compose(new Vector3(0.1, 0.2, 0.3), new Quaternion(), new Vector3(1, 1, 1))
      .elements.slice();
    applyAnchorPose(anchor, elements, 1);
    expect(anchor.scale.x).toBeCloseTo(1);
    expect(anchor.scale.y).toBeCloseTo(1);
    expect(anchor.scale.z).toBeCloseTo(1);
  });
});
