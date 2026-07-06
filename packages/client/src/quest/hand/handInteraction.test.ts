import { describe, it, expect } from 'vitest';
import { Vector3, Mesh, BoxGeometry, MeshBasicMaterial, Object3D } from 'three';
import {
  isPinching,
  pickHotspot,
  pickPokedButton,
  POKE_RADIUS_METERS,
  PINCH_THRESHOLD_METERS,
  PINCH_RELEASE_THRESHOLD_METERS,
} from './handInteraction.js';

describe('isPinching', () => {
  it('reports a pinch when thumb and index tips are within threshold', () => {
    const thumb = new Vector3(0, 0, 0);
    const index = new Vector3(PINCH_THRESHOLD_METERS * 0.5, 0, 0);
    expect(isPinching(thumb, index)).toBe(true);
  });

  it('does not report a pinch when tips are above threshold', () => {
    const thumb = new Vector3(0, 0, 0);
    const index = new Vector3(PINCH_THRESHOLD_METERS * 1.5, 0, 0);
    expect(isPinching(thumb, index)).toBe(false);
  });

  it('hysteresis: stays pinching while above start threshold but below release', () => {
    const thumb = new Vector3(0, 0, 0);
    // Between PINCH_THRESHOLD and PINCH_RELEASE_THRESHOLD
    const mid = (PINCH_THRESHOLD_METERS + PINCH_RELEASE_THRESHOLD_METERS) / 2;
    const index = new Vector3(mid, 0, 0);
    expect(isPinching(thumb, index, true)).toBe(true);
    expect(isPinching(thumb, index, false)).toBe(false);
  });

  it('hysteresis: clearly above release threshold ends the pinch', () => {
    const thumb = new Vector3(0, 0, 0);
    const index = new Vector3(PINCH_RELEASE_THRESHOLD_METERS * 1.5, 0, 0);
    expect(isPinching(thumb, index, true)).toBe(false);
  });
});

describe('pickHotspot', () => {
  function makeHotspot(id: number | undefined, position: Vector3): Mesh {
    const mesh = new Mesh(new BoxGeometry(0.1, 0.1, 0.1), new MeshBasicMaterial());
    mesh.position.copy(position);
    mesh.updateMatrixWorld(true);
    if (typeof id === 'number') mesh.userData.hotspotId = id;
    return mesh;
  }

  it('returns null when no hotspots are hit', () => {
    const a = makeHotspot(1, new Vector3(5, 0, 0));
    const hit = pickHotspot(new Vector3(0, 0, 0), new Vector3(0, 0, -1), [a]);
    expect(hit).toBeNull();
  });

  it('returns the closest hotspot when multiple are along the ray', () => {
    const near = makeHotspot(1, new Vector3(0, 0, -2));
    const far = makeHotspot(2, new Vector3(0, 0, -5));
    const hit = pickHotspot(new Vector3(0, 0, 0), new Vector3(0, 0, -1), [near, far]);
    expect(hit).not.toBeNull();
    expect(hit?.hotspotId).toBe(1);
  });

  it('skips objects without a hotspotId tag', () => {
    const tagged = makeHotspot(7, new Vector3(0, 0, -5));
    const untagged = makeHotspot(undefined, new Vector3(0, 0, -2));
    const hit = pickHotspot(new Vector3(0, 0, 0), new Vector3(0, 0, -1), [tagged, untagged]);
    expect(hit?.hotspotId).toBe(7);
  });
});

describe('pickPokedButton', () => {
  function makeButton(userData: Record<string, unknown>, position: Vector3): Object3D {
    const o = new Object3D();
    Object.assign(o.userData, userData);
    o.position.copy(position);
    o.updateMatrixWorld(true);
    return o;
  }

  it('returns the closest in-range button tagged with shapeIndex', () => {
    const a = makeButton({ shapeIndex: 0 }, new Vector3(0.1, 0, 0));
    const b = makeButton({ shapeIndex: 1 }, new Vector3(0.02, 0, 0));
    const hit = pickPokedButton(new Vector3(0, 0, 0), [a, b]);
    expect(hit).toBe(b);
  });

  it('also picks colorIndex-tagged buttons', () => {
    const swatch = makeButton({ colorIndex: 2 }, new Vector3(0.01, 0, 0));
    const hit = pickPokedButton(new Vector3(0, 0, 0), [swatch]);
    expect(hit).toBe(swatch);
  });

  it('also picks the move action button', () => {
    const moveBtn = makeButton({ action: 'move' }, new Vector3(0.01, 0, 0));
    const hit = pickPokedButton(new Vector3(0, 0, 0), [moveBtn]);
    expect(hit).toBe(moveBtn);
  });

  it('skips buttons without any recognized userData (backing plane, etc.)', () => {
    const backing = makeButton({}, new Vector3(0, 0, 0));
    const hit = pickPokedButton(new Vector3(0, 0, 0), [backing]);
    expect(hit).toBeNull();
  });

  it('returns null when nothing is within the poke radius', () => {
    const far = makeButton({ shapeIndex: 0 }, new Vector3(POKE_RADIUS_METERS * 2, 0, 0));
    const hit = pickPokedButton(new Vector3(0, 0, 0), [far]);
    expect(hit).toBeNull();
  });

  it('honors a custom radius override', () => {
    const far = makeButton({ shapeIndex: 0 }, new Vector3(0.1, 0, 0));
    const hit = pickPokedButton(new Vector3(0, 0, 0), [far], 0.2);
    expect(hit).toBe(far);
  });
});
