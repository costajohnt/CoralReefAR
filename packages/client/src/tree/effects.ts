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

export function createEffects(_deps: EffectsDeps): Effects {
  return {
    apply(_prev: TreeState, _next: TreeState, _action: TreeAction): void {
      // Filled in by subsequent tasks.
    },
  };
}
