import type { TreeVariant } from '@reef/shared';

export interface PickerSelection {
  variant: TreeVariant;
  colorKey: string;
}

export type TreeState =
  | { kind: 'idle'; picker: PickerSelection }
  | {
      kind: 'placing';
      picker: PickerSelection;
      parentId: number;
      attachIndex: number;
      seed: number;
      blocked: boolean;
    }
  | {
      kind: 'submitting';
      picker: PickerSelection;
      parentId: number;
      attachIndex: number;
      seed: number;
    }
  | { kind: 'resetting'; picker: PickerSelection };

export type TreeAction =
  | { type: 'VARIANT_CHOSEN'; variant: TreeVariant; seed: number }
  | { type: 'COLOR_CHOSEN'; colorKey: string }
  | { type: 'ATTACH_CLICKED'; parentId: number; attachIndex: number; seed: number }
  | { type: 'REROLL_CLICKED'; variant: TreeVariant; seed: number }
  | { type: 'PLACEMENT_BLOCKED' }
  | { type: 'PLACEMENT_OK' }
  | { type: 'CANCEL_CLICKED' }
  | { type: 'GROW_CLICKED' }
  | { type: 'COMMIT_RESOLVED' }
  | { type: 'COMMIT_REJECTED'; error: string }
  | { type: 'CLEAR_CLICKED' }
  | { type: 'RESET_RESOLVED' }
  | { type: 'RESET_REJECTED'; error: string }
  | { type: 'TREE_RESET_EXTERNAL' };

export function initialState(picker: PickerSelection): TreeState {
  return { kind: 'idle', picker };
}

export function reduce(state: TreeState, _action: TreeAction): TreeState {
  return state;
}
