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

export function reduce(state: TreeState, action: TreeAction): TreeState {
  switch (action.type) {
    case 'VARIANT_CHOSEN': {
      const picker = { ...state.picker, variant: action.variant };
      switch (state.kind) {
        case 'idle':      return { ...state, picker };
        case 'placing':   return { ...state, picker, seed: action.seed };
        case 'submitting':return { ...state, picker, seed: action.seed };
        case 'resetting': return { ...state, picker };
      }
    }
    case 'COLOR_CHOSEN': {
      const picker = { ...state.picker, colorKey: action.colorKey };
      return { ...state, picker };
    }
    case 'ATTACH_CLICKED': {
      if (state.kind === 'idle' || state.kind === 'placing') {
        return {
          kind: 'placing',
          picker: state.picker,
          parentId: action.parentId,
          attachIndex: action.attachIndex,
          seed: action.seed,
          blocked: false,
        };
      }
      return state;
    }
    case 'REROLL_CLICKED': {
      if (state.kind !== 'placing') return state;
      return {
        ...state,
        picker: { ...state.picker, variant: action.variant },
        seed: action.seed,
        blocked: false,
      };
    }
    case 'PLACEMENT_BLOCKED': {
      if (state.kind !== 'placing') return state;
      return { ...state, blocked: true };
    }
    case 'PLACEMENT_OK': {
      if (state.kind !== 'placing') return state;
      return { ...state, blocked: false };
    }
    case 'CANCEL_CLICKED': {
      if (state.kind !== 'placing') return state;
      return { kind: 'idle', picker: state.picker };
    }
    case 'GROW_CLICKED': {
      if (state.kind !== 'placing' || state.blocked) return state;
      return {
        kind: 'submitting',
        picker: state.picker,
        parentId: state.parentId,
        attachIndex: state.attachIndex,
        seed: state.seed,
      };
    }
    case 'COMMIT_RESOLVED': {
      if (state.kind !== 'submitting') return state;
      return { kind: 'idle', picker: state.picker };
    }
    case 'COMMIT_REJECTED': {
      if (state.kind !== 'submitting') return state;
      return {
        kind: 'placing',
        picker: state.picker,
        parentId: state.parentId,
        attachIndex: state.attachIndex,
        seed: state.seed,
        blocked: false,
      };
    }
    case 'CLEAR_CLICKED': {
      if (state.kind === 'resetting') return state;
      return { kind: 'resetting', picker: state.picker };
    }
    case 'RESET_RESOLVED':
    case 'RESET_REJECTED': {
      if (state.kind !== 'resetting') return state;
      return { kind: 'idle', picker: state.picker };
    }
    case 'TREE_RESET_EXTERNAL':
      return { kind: 'idle', picker: state.picker };
    default:
      return state;
  }
}
