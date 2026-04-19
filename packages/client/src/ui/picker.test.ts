import { describe, test, expect, beforeEach } from 'vitest';
import { Picker } from './picker.js';

function makeButton(attrs: Record<string, string>, text?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'id') b.id = v;
    else if (k === 'class') b.className = v;
    else if (k === 'disabled') b.disabled = true;
    else b.setAttribute(k, v);
  }
  if (text !== undefined) b.textContent = text;
  return b;
}

function mountPickerDom(): HTMLElement {
  document.body.replaceChildren();
  const picker = document.createElement('div');
  picker.id = 'picker';

  const speciesRow = document.createElement('div');
  speciesRow.className = 'picker-row';
  speciesRow.setAttribute('role', 'group');
  speciesRow.setAttribute('aria-label', 'Species');
  speciesRow.appendChild(makeButton({ 'data-species': 'branching' }, 'Branching'));
  speciesRow.appendChild(makeButton({ 'data-species': 'fan' }, 'Fan'));
  picker.appendChild(speciesRow);

  const colors = document.createElement('div');
  colors.id = 'colors';
  colors.className = 'picker-row';
  picker.appendChild(colors);

  const actions = document.createElement('div');
  actions.className = 'picker-actions';
  actions.appendChild(makeButton({ id: 'rerollBtn', disabled: 'true' }, 'Reroll'));
  actions.appendChild(makeButton({ id: 'cancelBtn', disabled: 'true' }, 'Cancel'));
  picker.appendChild(actions);

  picker.appendChild(makeButton({ id: 'growBtn', disabled: 'true' }, 'Grow it'));

  const hint = document.createElement('p');
  hint.id = 'hint';
  hint.textContent = 'initial';
  picker.appendChild(hint);

  document.body.appendChild(picker);
  return picker;
}

describe('Picker', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  test('sets aria-pressed=true on the active species after construction', () => {
    const p = new Picker(mountPickerDom());
    const branching = document.querySelector<HTMLButtonElement>('[data-species="branching"]')!;
    const fan = document.querySelector<HTMLButtonElement>('[data-species="fan"]')!;
    expect(branching.getAttribute('aria-pressed')).toBe('true');
    expect(fan.getAttribute('aria-pressed')).toBe('false');
    expect(p.get().species).toBe('branching');
  });

  test('clicking a species button updates state and aria-pressed', () => {
    const p = new Picker(mountPickerDom());
    const fan = document.querySelector<HTMLButtonElement>('[data-species="fan"]')!;
    fan.click();
    expect(p.get().species).toBe('fan');
    expect(fan.getAttribute('aria-pressed')).toBe('true');
    const branching = document.querySelector<HTMLButtonElement>('[data-species="branching"]')!;
    expect(branching.getAttribute('aria-pressed')).toBe('false');
  });

  test('onChange fires for every species click', () => {
    const p = new Picker(mountPickerDom());
    const seen: string[] = [];
    p.onChange((s) => seen.push(s.species));
    document.querySelector<HTMLButtonElement>('[data-species="fan"]')!.click();
    document.querySelector<HTMLButtonElement>('[data-species="branching"]')!.click();
    expect(seen).toEqual(['fan', 'branching']);
  });

  test('setCommittable toggles grow/reroll/cancel together', () => {
    const p = new Picker(mountPickerDom());
    const grow = document.getElementById('growBtn') as HTMLButtonElement;
    const reroll = document.getElementById('rerollBtn') as HTMLButtonElement;
    const cancel = document.getElementById('cancelBtn') as HTMLButtonElement;
    p.setCommittable(true);
    expect(grow.disabled).toBe(false);
    expect(reroll.disabled).toBe(false);
    expect(cancel.disabled).toBe(false);
    p.setCommittable(false);
    expect(grow.disabled).toBe(true);
    expect(reroll.disabled).toBe(true);
    expect(cancel.disabled).toBe(true);
  });

  test('setSubmitting(true) renames Grow to Growing… and disables side actions', () => {
    const p = new Picker(mountPickerDom());
    p.setCommittable(true);
    p.setSubmitting(true);
    const grow = document.getElementById('growBtn') as HTMLButtonElement;
    const reroll = document.getElementById('rerollBtn') as HTMLButtonElement;
    expect(grow.textContent).toBe('Growing…');
    expect(grow.disabled).toBe(true);
    expect(reroll.disabled).toBe(true);
    p.setSubmitting(false);
    expect(grow.textContent).toBe('Grow it');
  });

  test('setHint updates the #hint text', () => {
    const p = new Picker(mountPickerDom());
    p.setHint('now with a longer message');
    expect(document.getElementById('hint')!.textContent).toBe('now with a longer message');
  });

  test('show/hide toggles the .hidden class on the root', () => {
    const root = mountPickerDom();
    const p = new Picker(root);
    p.hide();
    expect(root.classList.contains('hidden')).toBe(true);
    p.show();
    expect(root.classList.contains('hidden')).toBe(false);
  });
});
