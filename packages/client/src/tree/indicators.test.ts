import { describe, expect, test, beforeEach } from 'vitest';
import { Vector3, Mesh } from 'three';
import { AttachIndicators } from './indicators.js';

describe('AttachIndicators', () => {
  let indicators: AttachIndicators;

  beforeEach(() => {
    indicators = new AttachIndicators();
  });

  test('refresh with 3 slots creates 3 indicators', () => {
    const slots = [
      { parentId: 1, index: 0, worldPos: new Vector3(0, 0, 0), worldNormal: new Vector3(0, 1, 0) },
      { parentId: 1, index: 1, worldPos: new Vector3(0.1, 0.1, 0), worldNormal: new Vector3(0, 1, 0) },
      { parentId: 2, index: 0, worldPos: new Vector3(0.2, 0.2, 0), worldNormal: new Vector3(0, 1, 0) },
    ];

    indicators.refresh(slots);

    expect(indicators.group.children).toHaveLength(3);
    expect(indicators.meshAt(1, 0)).toBeInstanceOf(Mesh);
    expect(indicators.meshAt(1, 1)).toBeInstanceOf(Mesh);
    expect(indicators.meshAt(2, 0)).toBeInstanceOf(Mesh);
  });

  test('refreshing with fewer slots removes the missing ones', () => {
    const slots3 = [
      { parentId: 1, index: 0, worldPos: new Vector3(0, 0, 0), worldNormal: new Vector3(0, 1, 0) },
      { parentId: 1, index: 1, worldPos: new Vector3(0.1, 0.1, 0), worldNormal: new Vector3(0, 1, 0) },
      { parentId: 2, index: 0, worldPos: new Vector3(0.2, 0.2, 0), worldNormal: new Vector3(0, 1, 0) },
    ];

    indicators.refresh(slots3);
    expect(indicators.group.children).toHaveLength(3);

    // Refresh with only 2 slots (removing parentId 1, index 1)
    const slots2 = [
      { parentId: 1, index: 0, worldPos: new Vector3(0, 0, 0), worldNormal: new Vector3(0, 1, 0) },
      { parentId: 2, index: 0, worldPos: new Vector3(0.2, 0.2, 0), worldNormal: new Vector3(0, 1, 0) },
    ];

    indicators.refresh(slots2);

    expect(indicators.group.children).toHaveLength(2);
    expect(indicators.meshAt(1, 0)).toBeInstanceOf(Mesh);
    expect(indicators.meshAt(1, 1)).toBeUndefined();
    expect(indicators.meshAt(2, 0)).toBeInstanceOf(Mesh);
  });

  test('indicators are positioned at the slot world position', () => {
    const worldPos = new Vector3(0.1, 0.2, 0.3);
    const slots = [
      { parentId: 1, index: 0, worldPos, worldNormal: new Vector3(0, 1, 0) },
    ];

    indicators.refresh(slots);

    const mesh = indicators.meshAt(1, 0)!;
    expect(mesh.position.x).toBeCloseTo(0.1, 5);
    expect(mesh.position.y).toBeCloseTo(0.2, 5);
    expect(mesh.position.z).toBeCloseTo(0.3, 5);
  });

  test('all() yields every registered indicator', () => {
    const slots = [
      { parentId: 1, index: 0, worldPos: new Vector3(0, 0, 0), worldNormal: new Vector3(0, 1, 0) },
      { parentId: 2, index: 0, worldPos: new Vector3(0.2, 0.2, 0), worldNormal: new Vector3(0, 1, 0) },
    ];

    indicators.refresh(slots);

    const items = Array.from(indicators.all());
    expect(items).toHaveLength(2);

    const item1 = items.find((i) => i.parentId === 1 && i.index === 0);
    const item2 = items.find((i) => i.parentId === 2 && i.index === 0);

    expect(item1).toBeDefined();
    expect(item1!.mesh).toBeInstanceOf(Mesh);
    expect(item2).toBeDefined();
    expect(item2!.mesh).toBeInstanceOf(Mesh);
  });
});
