import { describe, it, expect, vi } from 'vitest';
import { WristPalette } from './wristPalette.js';
import { SPECIES, REEF_PALETTE } from '@reef/shared';

describe('WristPalette', () => {
  it('defaults to first species and first palette color', () => {
    const p = new WristPalette();
    expect(p.selectedSpecies).toBe(SPECIES[0]);
    expect(p.selectedColorKey).toBe(REEF_PALETTE[0]!.key);
  });

  it('poke on a shape button updates selectedSpecies and fires listeners', () => {
    const p = new WristPalette();
    const onShape = vi.fn();
    p.onShapeSelect(onShape);
    // Find the button with shapeIndex 2 in the scene
    const btn = p.object3d.children.find((c) => c.userData.shapeIndex === 2);
    expect(btn).toBeDefined();
    p.poke(btn!);
    expect(p.selectedSpecies).toBe(SPECIES[2]);
    expect(onShape).toHaveBeenCalledWith(SPECIES[2]);
  });

  it('poke on a color swatch updates selectedColorKey and fires listeners', () => {
    const p = new WristPalette();
    const onColor = vi.fn();
    p.onColorSelect(onColor);
    const btn = p.object3d.children.find((c) => c.userData.colorIndex === 1);
    expect(btn).toBeDefined();
    p.poke(btn!);
    expect(p.selectedColorKey).toBe(REEF_PALETTE[1]!.key);
    expect(onColor).toHaveBeenCalledWith(REEF_PALETTE[1]!.key);
  });

  it('poking the already-selected shape is a no-op', () => {
    const p = new WristPalette();
    const onShape = vi.fn();
    p.onShapeSelect(onShape);
    const first = p.object3d.children.find((c) => c.userData.shapeIndex === 0);
    p.poke(first!);
    expect(onShape).not.toHaveBeenCalled();
  });

  it('poking a non-button object3d is a safe no-op', () => {
    const p = new WristPalette();
    const onShape = vi.fn();
    const onColor = vi.fn();
    p.onShapeSelect(onShape);
    p.onColorSelect(onColor);
    // The backing plane has neither shapeIndex nor colorIndex
    const backing = p.object3d.children[0]!;
    p.poke(backing);
    expect(onShape).not.toHaveBeenCalled();
    expect(onColor).not.toHaveBeenCalled();
  });

  it('poking the move button fires the move-reef listeners', () => {
    const p = new WristPalette();
    const onMove = vi.fn();
    p.onMoveReef(onMove);
    const moveBtn = p.object3d.children.find((c) => c.userData.action === 'move');
    expect(moveBtn).toBeDefined();
    p.poke(moveBtn!);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('the default color swatch (index 0) is visually enlarged to mark selection', () => {
    const p = new WristPalette();
    const firstSwatch = p.object3d.children.find((c) => c.userData.colorIndex === 0);
    expect(firstSwatch).toBeDefined();
    // Selected swatch is scaled up 1.3x; unselected swatches stay at 1.0.
    expect(firstSwatch!.scale.x).toBeCloseTo(1.3, 5);
  });

  it('poking a new color swatch enlarges it and shrinks the previously selected one', () => {
    const p = new WristPalette();
    const a = p.object3d.children.find((c) => c.userData.colorIndex === 0)!;
    const b = p.object3d.children.find((c) => c.userData.colorIndex === 2)!;
    expect(a.scale.x).toBeCloseTo(1.3, 5);
    expect(b.scale.x).toBeCloseTo(1, 5);
    p.poke(b);
    expect(a.scale.x).toBeCloseTo(1, 5);
    expect(b.scale.x).toBeCloseTo(1.3, 5);
  });
});
