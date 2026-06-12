import { describe, test, expect, beforeEach, vi } from 'vitest';
import { REEF_PALETTE } from '@reef/shared';
import { TREE_VARIANTS, TreePicker } from './treePicker.js';

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

// Full variant/color/listener surface, mounted with all five variants + the
// #colors container the picker renders swatches into.
function mountFullPicker(): HTMLElement {
  document.body.replaceChildren();
  const root = document.createElement('div');
  root.id = 'picker';
  root.innerHTML = `
    <div role="group" aria-label="Variant">
      ${TREE_VARIANTS.map((v) => `<button type="button" data-variant="${v}">${v}</button>`).join('')}
    </div>
    <div id="colors"></div>
    <button type="button" id="rerollBtn">Reroll</button>
    <button type="button" id="cancelBtn">Cancel</button>
    <button type="button" id="growBtn">Grow it</button>
  `;
  document.body.appendChild(root);
  return root;
}

const variantBtn = (root: HTMLElement, v: string) =>
  root.querySelector<HTMLButtonElement>(`[data-variant="${v}"]`)!;

describe('TreePicker variant + color selection', () => {
  let root: HTMLElement;
  beforeEach(() => {
    root = mountFullPicker();
  });

  test('defaults to forked + first palette color, with one swatch per palette entry', () => {
    const picker = new TreePicker(root);
    expect(picker.get()).toEqual({ variant: 'forked', colorKey: REEF_PALETTE[0]!.key });
    expect(root.querySelectorAll('.swatch')).toHaveLength(REEF_PALETTE.length);
    expect(variantBtn(root, 'forked').getAttribute('aria-pressed')).toBe('true');
  });

  test('clicking a variant button updates state + highlight and notifies listeners', () => {
    const picker = new TreePicker(root);
    const seen: string[] = [];
    picker.onChange((s) => seen.push(s.variant));

    variantBtn(root, 'starburst').click();

    expect(picker.get().variant).toBe('starburst');
    expect(variantBtn(root, 'starburst').getAttribute('aria-pressed')).toBe('true');
    expect(variantBtn(root, 'forked').getAttribute('aria-pressed')).toBe('false');
    expect(seen).toEqual(['starburst']);
  });

  test('clicking a color swatch updates the colorKey and notifies listeners', () => {
    const picker = new TreePicker(root);
    const listener = vi.fn();
    picker.onChange(listener);

    const target = REEF_PALETTE[2]!.key;
    root.querySelector<HTMLButtonElement>(`.swatch[data-color="${target}"]`)!.click();

    expect(picker.get().colorKey).toBe(target);
    expect(listener).toHaveBeenCalledWith({ variant: 'forked', colorKey: target });
  });

  test('setVariant ignores unknown and no-op variants, emits on a real change', () => {
    const picker = new TreePicker(root);
    const listener = vi.fn();
    picker.onChange(listener);

    picker.setVariant('forked'); // already the default → no emit
    picker.setVariant('not-a-variant' as never); // unknown → ignored
    expect(listener).not.toHaveBeenCalled();

    picker.setVariant('claw');
    expect(picker.get().variant).toBe('claw');
    expect(variantBtn(root, 'claw').getAttribute('aria-pressed')).toBe('true');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('onCommit/onReroll/onCancel wire their respective buttons', () => {
    const picker = new TreePicker(root);
    const onCommit = vi.fn();
    const onReroll = vi.fn();
    const onCancel = vi.fn();
    picker.onCommit(onCommit);
    picker.onReroll(onReroll);
    picker.onCancel(onCancel);

    root.querySelector<HTMLButtonElement>('#growBtn')!.click();
    root.querySelector<HTMLButtonElement>('#rerollBtn')!.click();
    root.querySelector<HTMLButtonElement>('#cancelBtn')!.click();

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onReroll).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test('show/hide toggle the root hidden class', () => {
    const picker = new TreePicker(root);
    picker.hide();
    expect(root.classList.contains('hidden')).toBe(true);
    picker.show();
    expect(root.classList.contains('hidden')).toBe(false);
  });
});
