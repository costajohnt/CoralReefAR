import type { TreeVariant } from '@reef/shared';

export interface PickerSelection {
  variant: TreeVariant;
  colorKey: string;
}

export type TreeState =
  | { kind: 'idle'; picker: PickerSelection; lastCommittedId: number | null }
  | {
      kind: 'placing';
      picker: PickerSelection;
      parentId: number;
      attachIndex: number;
      seed: number;
      yawRad: number;
      blocked: boolean;
      lastCommittedId: number | null;
    }
  | {
      kind: 'submitting';
      picker: PickerSelection;
      parentId: number;
      attachIndex: number;
      seed: number;
      yawRad: number;
      lastCommittedId: number | null;
    }
  | { kind: 'resetting'; picker: PickerSelection; lastCommittedId: number | null }
  | { kind: 'undoing'; picker: PickerSelection; polypId: number };

export type TreeAction =
  | { type: 'VARIANT_CHOSEN'; variant: TreeVariant; seed: number }
  | { type: 'COLOR_CHOSEN'; colorKey: string }
  | { type: 'ATTACH_CLICKED'; parentId: number; attachIndex: number; seed: number }
  | { type: 'REROLL_CLICKED'; variant: TreeVariant; seed: number }
  | { type: 'PLACEMENT_BLOCKED' }
  | { type: 'PLACEMENT_OK' }
  | { type: 'CANCEL_CLICKED' }
  | { type: 'GROW_CLICKED' }
  | { type: 'COMMIT_RESOLVED'; polypId: number }
  | { type: 'COMMIT_REJECTED'; error: string }
  | { type: 'CLEAR_CLICKED' }
  | { type: 'RESET_RESOLVED' }
  | { type: 'RESET_REJECTED'; error: string }
  | { type: 'TREE_RESET_EXTERNAL' }
  | { type: 'UNDO_CLICKED' }
  | { type: 'UNDO_RESOLVED' }
  | { type: 'UNDO_REJECTED'; error: string }
  | { type: 'TREE_POLYP_REMOVED_EXTERNAL'; id: number }
  | { type: 'LAST_COMMITTED_INVALIDATED' }
  | { type: 'GHOST_ROTATED'; deltaRad: number };

export function initialState(picker: PickerSelection): TreeState {
  return { kind: 'idle', picker, lastCommittedId: null };
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
        case 'undoing':   return { ...state, picker };
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
          yawRad: 0,
          blocked: false,
          lastCommittedId: state.lastCommittedId,
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
    case 'GHOST_ROTATED': {
      if (state.kind !== 'placing') return state;
      return { ...state, yawRad: state.yawRad + action.deltaRad };
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
      return { kind: 'idle', picker: state.picker, lastCommittedId: state.lastCommittedId };
    }
    case 'GROW_CLICKED': {
      if (state.kind !== 'placing' || state.blocked) return state;
      return {
        kind: 'submitting',
        picker: state.picker,
        parentId: state.parentId,
        attachIndex: state.attachIndex,
        seed: state.seed,
        yawRad: state.yawRad,
        lastCommittedId: state.lastCommittedId,
      };
    }
    case 'COMMIT_RESOLVED': {
      if (state.kind !== 'submitting') return state;
      return { kind: 'idle', picker: state.picker, lastCommittedId: action.polypId };
    }
    case 'COMMIT_REJECTED': {
      if (state.kind !== 'submitting') return state;
      return {
        kind: 'placing',
        picker: state.picker,
        parentId: state.parentId,
        attachIndex: state.attachIndex,
        seed: state.seed,
        yawRad: state.yawRad,
        blocked: false,
        lastCommittedId: state.lastCommittedId,
      };
    }
    case 'CLEAR_CLICKED': {
      if (state.kind === 'resetting' || state.kind === 'undoing') return state;
      return { kind: 'resetting', picker: state.picker, lastCommittedId: null };
    }
    case 'RESET_RESOLVED':
    case 'RESET_REJECTED': {
      if (state.kind !== 'resetting') return state;
      return { kind: 'idle', picker: state.picker, lastCommittedId: null };
    }
    case 'TREE_RESET_EXTERNAL':
      return { kind: 'idle', picker: state.picker, lastCommittedId: null };
    case 'UNDO_CLICKED': {
      if (state.kind !== 'idle' || state.lastCommittedId === null) return state;
      return { kind: 'undoing', picker: state.picker, polypId: state.lastCommittedId };
    }
    case 'UNDO_RESOLVED': {
      if (state.kind !== 'undoing') return state;
      return { kind: 'idle', picker: state.picker, lastCommittedId: null };
    }
    case 'UNDO_REJECTED': {
      if (state.kind !== 'undoing') return state;
      return { kind: 'idle', picker: state.picker, lastCommittedId: state.polypId };
    }
    case 'TREE_POLYP_REMOVED_EXTERNAL': {
      if (state.kind === 'undoing') return state;
      if ('lastCommittedId' in state && state.lastCommittedId === action.id) {
        return { ...state, lastCommittedId: null };
      }
      return state;
    }
    case 'LAST_COMMITTED_INVALIDATED': {
      if (state.kind === 'undoing') return state;
      if ('lastCommittedId' in state && state.lastCommittedId !== null) {
        return { ...state, lastCommittedId: null };
      }
      return state;
    }
    default:
      return state;
  }
}
