import { REEF_PALETTE, SPECIES, type Species } from '@reef/shared';

export interface PickerState {
  species: Species;
  colorKey: string;
}

export type PickerListener = (s: PickerState) => void;

export class Picker {
  private state: PickerState;
  private listeners: PickerListener[] = [];
  private readonly root: HTMLElement;
  private readonly growBtn: HTMLButtonElement;
  private readonly rerollBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.growBtn = root.querySelector<HTMLButtonElement>('#growBtn')!;
    this.rerollBtn = root.querySelector<HTMLButtonElement>('#rerollBtn')!;
    this.cancelBtn = root.querySelector<HTMLButtonElement>('#cancelBtn')!;
    this.state = { species: 'branching', colorKey: REEF_PALETTE[0]!.key };
    this.wireSpecies();
    this.renderColors();
    this.highlight();
  }

  onChange(l: PickerListener): void { this.listeners.push(l); }
  get(): PickerState { return this.state; }

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

  setHint(text: string): void {
    const hint = this.root.querySelector('#hint');
    if (hint) hint.textContent = text;
  }

  private wireSpecies(): void {
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('[data-species]')) {
      btn.addEventListener('click', () => {
        const s = btn.dataset.species as Species;
        if (!SPECIES.includes(s)) return;
        this.state = { ...this.state, species: s };
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
    for (const btn of this.root.querySelectorAll<HTMLButtonElement>('[data-species]')) {
      const active = btn.dataset.species === this.state.species;
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
