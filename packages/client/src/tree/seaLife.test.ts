import { beforeEach, describe, expect, test } from 'vitest';
import { Group } from 'three';
import { installSeaLife, type CreatureType } from './seaLife.js';

const TYPES: CreatureType[] = ['shark', 'clownfish', 'jellyfish', 'seaTurtle'];
const cap = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);

function mountPanelDom(): void {
  document.body.replaceChildren();
  const panel = document.createElement('div');
  panel.id = 'sea-life-panel';
  document.body.appendChild(panel);

  const seaLifeBtn = document.createElement('button');
  seaLifeBtn.id = 'seaLifeBtn';
  document.body.appendChild(seaLifeBtn);

  const closeBtn = document.createElement('button');
  closeBtn.id = 'sea-life-close-btn';
  panel.appendChild(closeBtn);

  for (const t of TYPES) {
    for (const verb of ['add', 'remove']) {
      const b = document.createElement('button');
      b.id = `${verb}${cap(t)}Btn`;
      panel.appendChild(b);
    }
    const count = document.createElement('span');
    count.id = `count-${t}`;
    panel.appendChild(count);
  }
}

const $ = (id: string): HTMLElement => document.getElementById(id)!;

describe('installSeaLife', () => {
  let anchor: Group;

  beforeEach(() => {
    mountPanelDom();
    anchor = new Group();
  });

  test('add button spawns a creature into the anchor and updates the count + remove button', () => {
    installSeaLife(anchor);
    const removeBtn = $('removeSharkBtn') as HTMLButtonElement;
    expect(removeBtn.disabled).toBe(false); // refresh only runs after a click

    ($('addSharkBtn') as HTMLButtonElement).click();
    expect(anchor.children.length).toBe(1);
    expect($('count-shark').textContent).toBe('1');
    expect(removeBtn.disabled).toBe(false);
  });

  test('remove button despawns the creature and disables when none remain', () => {
    installSeaLife(anchor);
    ($('addSharkBtn') as HTMLButtonElement).click();
    ($('removeSharkBtn') as HTMLButtonElement).click();
    expect(anchor.children.length).toBe(0);
    expect($('count-shark').textContent).toBe('0');
    expect(($('removeSharkBtn') as HTMLButtonElement).disabled).toBe(true);
  });

  test('each creature type spawns independently', () => {
    installSeaLife(anchor);
    for (const t of TYPES) ($(`add${cap(t)}Btn`) as HTMLButtonElement).click();
    expect(anchor.children.length).toBe(4);
    for (const t of TYPES) expect($(`count-${t}`).textContent).toBe('1');
  });

  test('update() advances without throwing when creatures exist', () => {
    const ctrl = installSeaLife(anchor);
    ($('addJellyfishBtn') as HTMLButtonElement).click();
    expect(() => ctrl.update(1.5)).not.toThrow();
  });

  test('panel toggles open/closed via the toggle and close buttons', () => {
    installSeaLife(anchor);
    const panel = $('sea-life-panel');
    ($('seaLifeBtn') as HTMLButtonElement).click();
    expect(panel.classList.contains('open')).toBe(true);
    ($('sea-life-close-btn') as HTMLButtonElement).click();
    expect(panel.classList.contains('open')).toBe(false);
  });

  test('Escape closes the panel, but not after dispose() removes the listener', () => {
    const ctrl = installSeaLife(anchor);
    const panel = $('sea-life-panel');
    ($('seaLifeBtn') as HTMLButtonElement).click();
    expect(panel.classList.contains('open')).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.classList.contains('open')).toBe(false);

    // Re-open, dispose, then Escape must no longer close it (listener gone).
    ($('seaLifeBtn') as HTMLButtonElement).click();
    ctrl.dispose();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel.classList.contains('open')).toBe(true);
  });
});
