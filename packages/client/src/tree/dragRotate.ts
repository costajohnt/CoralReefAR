// Pointer-drag-to-rotate: while a ghost piece is pending, horizontal drags
// rotate it in place instead of orbiting the camera. Extracted from tree.ts so
// the pointer lifecycle (including pointercancel) is unit-testable.

export interface DragRotateDeps {
  /** True when a ghost is pending and drag-to-rotate should engage. */
  canRotate: () => boolean;
  /** When true (screen mode) OrbitControls stays enabled during the drag. */
  keepControlsEnabled: boolean;
  setControlsEnabled: (enabled: boolean) => void;
  onRotate: (deltaRad: number) => void;
  /**
   * Called once when a drag ends. `moved` is true when the pointer passed the
   * drag threshold, so the synthetic click that follows a pointerup should be
   * suppressed. A pointercancel always reports `moved: false` because no click
   * follows an aborted gesture.
   */
  onDragEnd: (moved: boolean) => void;
}

const DRAG_THRESHOLD_PX = 3;
const ROT_SENSITIVITY = 0.0055;

/**
 * Wires pointer-drag-to-rotate onto `canvas`. Returns a disposer that removes
 * the listeners. Handles pointerup AND pointercancel so a system gesture that
 * aborts a drag mid-flight (notification, back-swipe) still releases pointer
 * capture and re-enables OrbitControls instead of wedging them off.
 */
export function installDragRotate(canvas: HTMLElement, deps: DragRotateDeps): () => void {
  let dragState: { pointerId: number; lastX: number; moved: boolean } | null = null;

  const onDown = (ev: PointerEvent) => {
    if (!deps.canRotate()) return;
    // Capture first: setPointerCapture throws InvalidStateError for a pointer
    // that isn't in the active-buttons state. Committing the controls toggle
    // and dragState only after it succeeds guarantees we never disable
    // OrbitControls for a drag that never armed.
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch {
      return;
    }
    if (!deps.keepControlsEnabled) deps.setControlsEnabled(false);
    dragState = { pointerId: ev.pointerId, lastX: ev.clientX, moved: false };
  };

  const onMove = (ev: PointerEvent) => {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    const dx = ev.clientX - dragState.lastX;
    if (!dragState.moved && Math.abs(dx) > DRAG_THRESHOLD_PX) dragState.moved = true;
    if (dragState.moved) {
      deps.onRotate(dx * ROT_SENSITIVITY);
      dragState.lastX = ev.clientX;
    }
  };

  const endDrag = (ev: PointerEvent, moved: boolean) => {
    if (!dragState || ev.pointerId !== dragState.pointerId) return;
    if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
    dragState = null;
    if (!deps.keepControlsEnabled) deps.setControlsEnabled(true);
    deps.onDragEnd(moved);
  };

  const onUp = (ev: PointerEvent) => endDrag(ev, dragState?.moved ?? false);
  const onCancel = (ev: PointerEvent) => endDrag(ev, false);

  canvas.addEventListener('pointerdown', onDown, { capture: true });
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);

  return () => {
    canvas.removeEventListener('pointerdown', onDown, { capture: true });
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onCancel);
  };
}
