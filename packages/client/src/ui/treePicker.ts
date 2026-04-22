import { REEF_PALETTE, type TreeVariant } from '@reef/shared';

export const TREE_VARIANTS: TreeVariant[] = [
  'forked',
  'trident',
  'starburst',
  'claw',
  'wishbone',
];

export interface TreePickerState {
  variant: TreeVariant;
  colorKey: string;
}

export type TreePickerListener = (s: TreePickerState) => void;

/**
 * Picker adapted for the tree mode. Works identically to the landscape Picker
 * but selects TreeVariant ('forked' | 'trident' | 'starburst' | 'claw' |
 * 'wishbone') via [data-variant] buttons instead of [data-species] buttons.
 */
export class TreePicker {
  private state: TreePickerState;
  private listeners: TreePickerListener[] = [];
  private readonly root: HTMLElement;
  private readonly growBtn: HTMLButtonElement;
  private readonly rerollBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.growBtn = root.querySelector<HTMLButtonElement>('#growBtn')!;
    this.rerollBtn = root.querySelector<HTMLButtonElement>('#rerollBtn')!;
    this.cancelBtn = root.querySelector<HTMLButtonElement>('#cancelBtn')!;
    this.state = { variant: 'forked', colorKey: REEF_PALETTE[0]!.key };
    this.wireVariants();
    this.renderColors();
    this.highlight();
  }

  onChange(l: TreePickerListener): void { this.listeners.push(l); }
  get(): TreePickerState { return this.state; }

  setCommittable(ok: boolean): void {
    this.growBtn.disabled = !ok;
    this.rerollBtn.disabled = !ok;
    this.cancelBtn.disabled = !ok;
  }

  setSubmitting(inFlight: boolean): void {
    this.growBtn.disabled = inFlight || this.growBtn.disabled;
    this.growBtn.textContent = inFlight ? 'Growing…' : 'Grow it';
    this.rerollBtn.disabled = inFlight;
    this.cancelBtn.disabled = inFlight;
  }

  onCommit(cb: () => void): void { this.growBtn.addEventListener('click', cb); }
  onReroll(cb: () => void): void { this.rerollBtn.addEventListener('click', cb); }
  onCancel(cb: () => void): void { this.cancelBtn.addEventListener('click', cb); }

  show(): void { this.root.classList.remove('hidden'); }
  hide(): void { this.root.classList.add('hidden'); }

  private wireVariants(): void {
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('[data-variant]')) {
      btn.addEventListener('click', () => {
        const v = btn.dataset.variant as TreeVariant;
        if (!TREE_VARIANTS.includes(v)) return;
        this.state = { ...this.state, variant: v };
        this.highlight();
        this.emit();
      });
    }
  }

  private renderColors(): void {
    const colors = this.root.querySelector('#colors');
    if (!colors) return;
    for (const entry of REEF_PALETTE) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'swatch';
      b.dataset.color = entry.key;
      b.style.backgroundColor = entry.hex;
      b.title = entry.name;
      b.setAttribute('aria-label', entry.name);
      b.addEventListener('click', () => {
        this.state = { ...this.state, colorKey: entry.key };
        this.highlight();
        this.emit();
      });
      colors.appendChild(b);
    }
  }

  private highlight(): void {
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('[data-variant]')) {
      const active = btn.dataset.variant === this.state.variant;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('.swatch')) {
      const active = btn.dataset.color === this.state.colorKey;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
  }

  private emit(): void {
    for (const l of this.listeners) l(this.state);
  }
}
