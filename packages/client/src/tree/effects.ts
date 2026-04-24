// packages/client/src/tree/effects.ts
import type { TreeReef } from './reef.js';
import type { TreePlacement } from './placement.js';
import type { AttachIndicators } from './indicators.js';
import type { TreePicker } from '../ui/treePicker.js';
import type { TreeState, TreeAction } from './state.js';
import { fetchTree, resetTree, submitTreePolyp, deleteTreePolyp } from './api.js';

export interface EffectsDeps {
  placement: TreePlacement;
  treeReef: TreeReef;
  indicators: AttachIndicators;
  picker: TreePicker;
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

      // Grow: placing → submitting. Fire the POST and wire its resolution.
      if (prev.kind === 'placing' && next.kind === 'submitting') {
        deps.picker.setSubmitting(true);
        submitTreePolyp(
          {
            variant: next.picker.variant,
            seed: next.seed,
            colorKey: next.picker.colorKey,
            parentId: next.parentId,
            attachIndex: next.attachIndex,
          },
          deps.apiBase,
        ).then(
          (polyp) => deps.dispatch({ type: 'COMMIT_RESOLVED', polypId: polyp.id }),
          (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            deps.hintEl.textContent = `Grow failed: ${msg}`;
            deps.dispatch({ type: 'COMMIT_REJECTED', error: msg });
          },
        );
        return;
      }

      // Commit resolved: submitting → idle via COMMIT_RESOLVED.
      // (submitting → idle can also happen via TREE_RESET_EXTERNAL; that case
      // is handled by the external-reset branch in Task 11.)
      if (
        prev.kind === 'submitting' && next.kind === 'idle' &&
        action.type === 'COMMIT_RESOLVED'
      ) {
        deps.placement.reset();
        deps.picker.setSubmitting(false);
        deps.picker.setCommittable(false);
        deps.hintEl.textContent = 'Grown! Click another dot to plant again.';
        return;
      }

      // Commit rejected: submitting → placing. Hint was set by the reject
      // callback above; just unwind the submitting UI.
      if (
        prev.kind === 'submitting' && next.kind === 'placing' &&
        action.type === 'COMMIT_REJECTED'
      ) {
        deps.picker.setSubmitting(false);
        return;
      }

      // Undo clicked: idle → undoing. Fire DELETE and wire resolution.
      if (prev.kind === 'idle' && next.kind === 'undoing') {
        deps.hintEl.textContent = 'Undoing…';
        deleteTreePolyp(next.polypId, deps.apiBase).then(
          () => deps.dispatch({ type: 'UNDO_RESOLVED' }),
          (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            deps.hintEl.textContent = `Undo failed: ${msg}`;
            deps.dispatch({ type: 'UNDO_REJECTED', error: msg });
          },
        );
        return;
      }

      // Undo resolved: undoing → idle. Show success hint.
      if (prev.kind === 'undoing' && next.kind === 'idle' && action.type === 'UNDO_RESOLVED') {
        deps.hintEl.textContent = 'Undone. Click a glowing dot to plant again.';
        return;
      }

      // Undo rejected: undoing → idle. Error hint already set by reject callback.
      if (prev.kind === 'undoing' && next.kind === 'idle' && action.type === 'UNDO_REJECTED') {
        return;
      }

      // Clear: any → resetting. Wipe the ghost immediately, fire the API.
      if (prev.kind !== 'resetting' && next.kind === 'resetting') {
        deps.placement.reset();
        deps.picker.setCommittable(false);
        deps.hintEl.textContent = 'Clearing…';
        resetTree(deps.apiBase).then(
          async () => {
            // Clear local reef, then re-fetch authoritative state.
            deps.treeReef.clear();
            deps.indicators.refresh([]);
            try {
              const { polyps } = await fetchTree(deps.apiBase);
              deps.addPiecesAndRefresh(polyps);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              deps.hintEl.textContent = `Clear: re-fetch failed — ${msg}`;
            }
            deps.dispatch({ type: 'RESET_RESOLVED' });
          },
          (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            deps.hintEl.textContent = `Clear failed: ${msg}`;
            deps.dispatch({ type: 'RESET_REJECTED', error: msg });
          },
        );
        return;
      }

      // Resetting → idle via RESET_RESOLVED. Success hint.
      if (
        prev.kind === 'resetting' && next.kind === 'idle' &&
        action.type === 'RESET_RESOLVED'
      ) {
        deps.hintEl.textContent = 'Cleared. Click a glowing dot to start growing.';
        return;
      }

      // Resetting → idle via RESET_REJECTED. Error hint was already written
      // by the reject callback above; no further work.
      if (
        prev.kind === 'resetting' && next.kind === 'idle' &&
        action.type === 'RESET_REJECTED'
      ) {
        return;
      }

      // TREE_RESET_EXTERNAL: any → idle. The socket handler in tree.ts
      // already called treeReef.clear() and indicators.refresh(); here we
      // just drop any pending ghost and unwind submit UI if applicable.
      //
      // Four cases depending on `prev.kind`:
      //   - placing/submitting: a remote user reset while we were interacting.
      //   - resetting: our own local clear — the server's tree_reset echo
      //     arrived before our HTTP resolve. Success hint.
      //   - idle: nothing to do (no ghost, no UI to unwind).
      if (next.kind === 'idle' && action.type === 'TREE_RESET_EXTERNAL') {
        if (prev.kind === 'placing') {
          deps.placement.reset();
          deps.picker.setCommittable(false);
          deps.hintEl.textContent = 'Tree was reset by another user.';
        } else if (prev.kind === 'submitting') {
          deps.placement.reset();
          deps.picker.setSubmitting(false);
          deps.picker.setCommittable(false);
          deps.hintEl.textContent = 'Tree was reset by another user.';
        } else if (prev.kind === 'resetting') {
          deps.hintEl.textContent = 'Cleared. Click a glowing dot to start growing.';
        }
        // prev === 'idle': no-op.
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
