import { describe, test, expect, beforeEach } from 'vitest';
import { TreePicker } from './treePicker.js';

function makeButton(id: string, text: string, disabled = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.id = id;
  b.textContent = text;
  b.disabled = disabled;
  return b;
}

function mountTreePickerDom(): HTMLElement {
  document.body.replaceChildren();
  const picker = document.createElement('div');
  picker.id = 'picker';

  const variantRow = document.createElement('div');
  variantRow.setAttribute('role', 'group');
  variantRow.setAttribute('aria-label', 'Variant');
  for (const v of ['forked', 'trident']) {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.variant = v;
    b.textContent = v;
    variantRow.appendChild(b);
  }
  picker.appendChild(variantRow);

  const colors = document.createElement('div');
  colors.id = 'colors';
  picker.appendChild(colors);

  picker.appendChild(makeButton('rerollBtn', 'Reroll', true));
  picker.appendChild(makeButton('cancelBtn', 'Cancel', true));
  picker.appendChild(makeButton('growBtn', 'Grow it', true));

  document.body.appendChild(picker);
  return picker;
}

describe('TreePicker submit/commit button state', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  test('setSubmitting(false) re-enables actions when committable (rejected-commit path)', () => {
    const p = new TreePicker(mountTreePickerDom());
    const grow = document.getElementById('growBtn') as HTMLButtonElement;
    const reroll = document.getElementById('rerollBtn') as HTMLButtonElement;
    const cancel = document.getElementById('cancelBtn') as HTMLButtonElement;
    p.setCommittable(true);
    p.setSubmitting(true);
    expect(grow.disabled).toBe(true);
    // Rejected commit unwinds via setSubmitting(false) with no following
    // setCommittable; the Grow button must become usable again.
    p.setSubmitting(false);
    expect(grow.disabled).toBe(false);
    expect(reroll.disabled).toBe(false);
    expect(cancel.disabled).toBe(false);
  });

  test('setSubmitting(false) keeps actions disabled when not committable', () => {
    const p = new TreePicker(mountTreePickerDom());
    const grow = document.getElementById('growBtn') as HTMLButtonElement;
    p.setCommittable(false);
    p.setSubmitting(true);
    p.setSubmitting(false);
    expect(grow.disabled).toBe(true);
  });

  test('setSubmitting(true) renames Grow and disables actions', () => {
    const p = new TreePicker(mountTreePickerDom());
    const grow = document.getElementById('growBtn') as HTMLButtonElement;
    p.setCommittable(true);
    p.setSubmitting(true);
    expect(grow.textContent).toBe('Growing…');
    expect(grow.disabled).toBe(true);
    p.setSubmitting(false);
    expect(grow.textContent).toBe('Grow it');
  });
});
