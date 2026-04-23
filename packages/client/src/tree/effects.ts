// packages/client/src/tree/effects.ts
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { TreeReef } from './reef.js';
import type { TreePlacement } from './placement.js';
import type { AttachIndicators } from './indicators.js';
import type { TreePicker } from '../ui/treePicker.js';
import type { TreeState, TreeAction } from './state.js';

export interface EffectsDeps {
  placement: TreePlacement;
  treeReef: TreeReef;
  indicators: AttachIndicators;
  picker: TreePicker;
  controls: OrbitControls;
  hintEl: HTMLElement;
  apiBase: string;
  /** Called by async callbacks inside effects to drive state transitions. */
  dispatch: (action: TreeAction) => void;
  /** Factory for adding a fetched polyp set back into the reef. Called after
   *  a successful reset so the re-seeded root renders. */
  addPiecesAndRefresh: (polyps: import('@reef/shared').PublicTreePolyp[]) => void;
}

export interface Effects {
  /**
   * Fire side effects for a state transition. `action` is included because
   * some transitions (notably `submitting → idle` and `resetting → idle`) can
   * arrive via different actions and need different UI behavior:
   *   - submitting → idle via COMMIT_RESOLVED: success hint
   *   - submitting → idle via TREE_RESET_EXTERNAL: reset hint
   *   - resetting → idle via RESET_RESOLVED: success hint
   *   - resetting → idle via RESET_REJECTED: error hint (already set in reject callback)
   */
  apply(prev: TreeState, next: TreeState, action: TreeAction): void;
}

export function createEffects(deps: EffectsDeps): Effects {
  return {
    apply(prev: TreeState, next: TreeState, action: TreeAction): void {
      // Entering placing from elsewhere, or changing slot/variant/seed/color
      // within placing → re-show the ghost and refresh indicators hint.
      if (
        next.kind === 'placing' &&
        (prev.kind !== 'placing' || hasPlacingIdentityChanged(prev, next))
      ) {
        const { variant, colorKey } = next.picker;
        const ghost = deps.placement.showGhost(
          variant,
          next.seed,
          colorKey,
          next.parentId,
          next.attachIndex,
        );
        if (ghost) {
          deps.dispatch({ type: 'PLACEMENT_OK' });
          deps.picker.setCommittable(true);
          deps.hintEl.textContent = 'Happy with it? Click Grow.';
        } else {
          deps.dispatch({ type: 'PLACEMENT_BLOCKED' });
          deps.picker.setCommittable(false);
          deps.hintEl.textContent = 'That spot is blocked. Try another dot or reroll.';
        }
        return;
      }

      // Pure blocked flip within placing (triggered by PLACEMENT_BLOCKED/OK
      // dispatched after showGhost — which already ran above).
      if (
        next.kind === 'placing' && prev.kind === 'placing' &&
        !hasPlacingIdentityChanged(prev, next) &&
        prev.blocked !== next.blocked
      ) {
        deps.picker.setCommittable(!next.blocked);
        return;
      }

      // Leaving placing for idle (cancel).
      if (prev.kind === 'placing' && next.kind === 'idle' && action.type === 'CANCEL_CLICKED') {
        deps.placement.reset();
        deps.picker.setCommittable(false);
        deps.hintEl.textContent = 'Cancelled. Click a glowing dot to try again.';
        return;
      }
    },
  };
}

/** True when the placing-state identity fields (slot + variant + seed + color)
 *  changed between prev and next. Used to decide whether to re-show the ghost
 *  vs. only updating the commit button for a pure blocked flip. */
function hasPlacingIdentityChanged(
  prev: TreeState & { kind: 'placing' },
  next: TreeState & { kind: 'placing' },
): boolean {
  return (
    prev.parentId !== next.parentId ||
    prev.attachIndex !== next.attachIndex ||
    prev.seed !== next.seed ||
    prev.picker.variant !== next.picker.variant ||
    prev.picker.colorKey !== next.picker.colorKey
  );
}
