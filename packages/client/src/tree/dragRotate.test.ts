import { beforeEach, describe, expect, test, vi } from 'vitest';
import { installDragRotate, type DragRotateDeps } from './dragRotate.js';

// happy-dom doesn't implement pointer capture; stub it so the handlers that
// guard on hasPointerCapture exercise the same branch they would in a browser.
function makeCanvas(): HTMLElement {
  const el = document.createElement('div');
  const captured = new Set<number>();
  el.setPointerCapture = (id: number) => {
    captured.add(id);
  };
  el.releasePointerCapture = (id: number) => {
    captured.delete(id);
  };
  el.hasPointerCapture = (id: number) => captured.has(id);
  return el;
}

function pointer(type: string, clientX = 0, pointerId = 1): Event {
  const ev = new Event(type, { bubbles: true });
  Object.assign(ev, { clientX, pointerId });
  return ev;
}

function makeDeps(over: Partial<DragRotateDeps> = {}): DragRotateDeps {
  return {
    canRotate: () => true,
    keepControlsEnabled: false,
    setControlsEnabled: vi.fn(),
    onRotate: vi.fn(),
    onDragEnd: vi.fn(),
    ...over,
  };
}

describe('installDragRotate', () => {
  let canvas: HTMLElement;

  beforeEach(() => {
    canvas = makeCanvas();
  });

  test('does not engage when canRotate() is false', () => {
    const deps = makeDeps({ canRotate: () => false });
    installDragRotate(canvas, deps);
    canvas.dispatchEvent(pointer('pointerdown', 0));
    canvas.dispatchEvent(pointer('pointermove', 50));
    expect(deps.setControlsEnabled).not.toHaveBeenCalled();
    expect(deps.onRotate).not.toHaveBeenCalled();
    expect(canvas.hasPointerCapture(1)).toBe(false);
  });

  test('disables controls on down, rotates on move past threshold, re-enables and suppresses click on up', () => {
    const deps = makeDeps();
    installDragRotate(canvas, deps);
    canvas.dispatchEvent(pointer('pointerdown', 0));
    expect(deps.setControlsEnabled).toHaveBeenLastCalledWith(false);
    expect(canvas.hasPointerCapture(1)).toBe(true);

    canvas.dispatchEvent(pointer('pointermove', 1)); // under 3px threshold
    expect(deps.onRotate).not.toHaveBeenCalled();
    canvas.dispatchEvent(pointer('pointermove', 20)); // past threshold
    expect(deps.onRotate).toHaveBeenCalledTimes(1);

    canvas.dispatchEvent(pointer('pointerup', 20));
    expect(deps.setControlsEnabled).toHaveBeenLastCalledWith(true);
    expect(deps.onDragEnd).toHaveBeenCalledWith(true);
    expect(canvas.hasPointerCapture(1)).toBe(false);
  });

  test('a tap (no movement) ends with moved=false so the click is not suppressed', () => {
    const deps = makeDeps();
    installDragRotate(canvas, deps);
    canvas.dispatchEvent(pointer('pointerdown', 5));
    canvas.dispatchEvent(pointer('pointerup', 5));
    expect(deps.onDragEnd).toHaveBeenCalledWith(false);
  });

  test('pointercancel mid-drag releases capture, re-enables controls, and reports moved=false', () => {
    const deps = makeDeps();
    installDragRotate(canvas, deps);
    canvas.dispatchEvent(pointer('pointerdown', 0));
    canvas.dispatchEvent(pointer('pointermove', 40));
    expect(deps.onRotate).toHaveBeenCalled();

    // System gesture interrupts the drag: pointercancel, never pointerup.
    canvas.dispatchEvent(pointer('pointercancel', 40));
    expect(canvas.hasPointerCapture(1)).toBe(false);
    expect(deps.setControlsEnabled).toHaveBeenLastCalledWith(true);
    expect(deps.onDragEnd).toHaveBeenCalledWith(false);

    // Controls must not be wedged off: a fresh drag still works afterward.
    (deps.setControlsEnabled as ReturnType<typeof vi.fn>).mockClear();
    canvas.dispatchEvent(pointer('pointerdown', 0));
    expect(deps.setControlsEnabled).toHaveBeenLastCalledWith(false);
  });

  test('screen mode keeps controls enabled throughout the drag', () => {
    const deps = makeDeps({ keepControlsEnabled: true });
    installDragRotate(canvas, deps);
    canvas.dispatchEvent(pointer('pointerdown', 0));
    canvas.dispatchEvent(pointer('pointermove', 40));
    canvas.dispatchEvent(pointer('pointercancel', 40));
    expect(deps.setControlsEnabled).not.toHaveBeenCalled();
    expect(deps.onRotate).toHaveBeenCalled();
  });

  test('setPointerCapture throwing leaves controls untouched and lets the next drag arm', () => {
    const deps = makeDeps();
    canvas.setPointerCapture = () => {
      throw new DOMException('not active', 'InvalidStateError');
    };
    installDragRotate(canvas, deps);
    canvas.dispatchEvent(pointer('pointerdown', 0));
    // Controls must not be disabled for a drag that never armed.
    expect(deps.setControlsEnabled).not.toHaveBeenCalled();
    canvas.dispatchEvent(pointer('pointermove', 40));
    expect(deps.onRotate).not.toHaveBeenCalled();

    // Recover: capture works again, a normal drag arms.
    canvas = makeCanvas();
    const deps2 = makeDeps();
    installDragRotate(canvas, deps2);
    canvas.dispatchEvent(pointer('pointerdown', 0));
    expect(deps2.setControlsEnabled).toHaveBeenLastCalledWith(false);
  });

  test('a second pointer does not tear down the active drag', () => {
    const deps = makeDeps();
    installDragRotate(canvas, deps);
    canvas.dispatchEvent(pointer('pointerdown', 0, 1));
    // A different pointer releasing must not end the captured drag.
    canvas.dispatchEvent(pointer('pointerup', 5, 2));
    expect(deps.onDragEnd).not.toHaveBeenCalled();
    expect(canvas.hasPointerCapture(1)).toBe(true);
    // The captured pointer still rotates.
    canvas.dispatchEvent(pointer('pointermove', 40, 1));
    expect(deps.onRotate).toHaveBeenCalled();
  });

  test('disposer removes listeners', () => {
    const deps = makeDeps();
    const dispose = installDragRotate(canvas, deps);
    dispose();
    canvas.dispatchEvent(pointer('pointerdown', 0));
    expect(deps.setControlsEnabled).not.toHaveBeenCalled();
  });
});
