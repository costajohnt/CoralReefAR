import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { InstructionOverlay } from './instructionOverlay.js';

describe('InstructionOverlay', () => {
  it('starts visible with empty text', () => {
    const o = new InstructionOverlay();
    expect(o.visible).toBe(true);
    expect(o.text).toBe('');
  });

  it('setText updates the stored text and is a no-op for identical input', () => {
    const o = new InstructionOverlay();
    o.setText('Pinch the floor.');
    expect(o.text).toBe('Pinch the floor.');
    // Setting the same text twice does not crash and remains stable.
    o.setText('Pinch the floor.');
    expect(o.text).toBe('Pinch the floor.');
  });

  it('hide() and show() toggle the visible flag without throwing', () => {
    const o = new InstructionOverlay();
    o.hide();
    expect(o.visible).toBe(false);
    o.show();
    expect(o.visible).toBe(true);
  });

  it('updatePose positions the group 0.7m in front of the head, dropped 0.15m', () => {
    const o = new InstructionOverlay();
    const head = new Vector3(0, 1.6, 0);
    const forward = new Vector3(0, 0, -1);
    o.updatePose(head, forward);
    // 0.7m forward along -Z, 0.15m below the head's Y.
    expect(o.object3d.position.z).toBeCloseTo(-0.7, 3);
    expect(o.object3d.position.y).toBeCloseTo(1.45, 3);
    expect(o.object3d.position.x).toBeCloseTo(0, 3);
  });

  it('#97: updatePose does not mutate the caller-supplied headForward vector', () => {
    // The scratch-based implementation writes into _scratchTarget, not into
    // the argument. Callers (QuestApp.lastHeadForward) reuse their Vector3s
    // across frames, so mutation would corrupt subsequent reads.
    const o = new InstructionOverlay();
    const head = new Vector3(1, 1.6, 2);
    const forward = new Vector3(0, 0, -1);
    const forwardBefore = forward.clone();
    o.updatePose(head, forward);
    expect(forward.equals(forwardBefore)).toBe(true);
  });

  it('#97: updatePose is correct with a non-axis-aligned forward', () => {
    const o = new InstructionOverlay();
    const head = new Vector3(1, 1.6, 2);
    const forward = new Vector3(1, 0, 0); // pointing +X
    o.updatePose(head, forward);
    // Panel should be 0.7m in the +X direction from head, 0.15m below.
    expect(o.object3d.position.x).toBeCloseTo(1.7, 3);
    expect(o.object3d.position.y).toBeCloseTo(1.45, 3);
    expect(o.object3d.position.z).toBeCloseTo(2, 3);
  });
});
