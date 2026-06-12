import type { Group, Material, Mesh } from 'three';
import { Shark } from './shark.js';
import { Clownfish } from './clownfish.js';
import { Jellyfish } from './jellyfish.js';
import { SeaTurtle } from './seaTurtle.js';

export type CreatureType = 'shark' | 'clownfish' | 'jellyfish' | 'seaTurtle';

interface SwimmingCreature {
  readonly group: Group;
  update: (clockSec: number) => void;
}

interface OrbitOptions {
  orbitRadius: number;
  orbitHeight: number;
  orbitPeriodSec: number;
  phaseRad: number;
  direction: 1 | -1;
}

// [base, span] for `base + Math.random() * span` — preserves the exact random
// distribution the inline tree.ts / treeApp.ts spawners used.
const SPECS: Record<
  CreatureType,
  {
    make: (o: OrbitOptions) => SwimmingCreature;
    radius: [number, number];
    height: [number, number];
    period: [number, number];
  }
> = {
  shark: { make: (o) => new Shark(o), radius: [0.25, 0.15], height: [0.05, 0.2], period: [14, 10] },
  clownfish: { make: (o) => new Clownfish(o), radius: [0.15, 0.15], height: [0.04, 0.2], period: [5, 6] },
  jellyfish: { make: (o) => new Jellyfish(o), radius: [0.18, 0.14], height: [0.1, 0.2], period: [20, 12] },
  seaTurtle: { make: (o) => new SeaTurtle(o), radius: [0.28, 0.12], height: [0.04, 0.12], period: [28, 12] },
};

const ORDER: readonly CreatureType[] = ['shark', 'clownfish', 'jellyfish', 'seaTurtle'];

export interface SeaLifeController {
  /** Advance every creature's animation. Call once per render frame. */
  update(clockSec: number): void;
  /** Remove the document-level panel listeners (Escape / click-outside). */
  dispose(): void;
}

/**
 * Wire the sea-life subsystem — the spawnable orbiting creatures plus the
 * sea-life panel UI. Extracted from the tree.ts and treeApp.ts entries, which
 * each carried a verbatim copy. `anchor` is the group creatures are parented to
 * (treeReef.anchor). Returns a controller with `update` (drive the animation
 * each frame) and `dispose` (drop document listeners, for the AR entry that has
 * a teardown path).
 */
export function installSeaLife(anchor: Group): SeaLifeController {
  interface Tracked {
    type: CreatureType;
    instance: SwimmingCreature;
    group: Group;
  }
  const creatures: Tracked[] = [];

  const span = ([base, s]: [number, number]): number => base + Math.random() * s;

  const spawn = (type: CreatureType): void => {
    const spec = SPECS[type];
    const instance = spec.make({
      orbitRadius: span(spec.radius),
      orbitHeight: span(spec.height),
      orbitPeriodSec: span(spec.period),
      phaseRad: Math.random() * Math.PI * 2,
      direction: Math.random() < 0.5 ? 1 : -1,
    });
    anchor.add(instance.group);
    creatures.push({ type, instance, group: instance.group });
  };

  const removeOne = (type: CreatureType): boolean => {
    // Remove the most recently added creature of this type.
    const idx =
      [...creatures]
        .map((c, i) => ({ c, i }))
        .reverse()
        .find(({ c }) => c.type === type)?.i ?? -1;
    if (idx === -1) return false;
    const [removed] = creatures.splice(idx, 1);
    if (!removed) return false;
    anchor.remove(removed.group);
    removed.group.traverse((obj) => {
      const mesh = obj as Mesh;
      if (mesh.isMesh) {
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) {
          for (const m of mesh.material) (m as Material).dispose();
        } else {
          (mesh.material as Material | undefined)?.dispose();
        }
      }
    });
    return true;
  };

  const count = (type: CreatureType): number => creatures.filter((c) => c.type === type).length;

  const byId = <T extends HTMLElement>(id: string): T | null =>
    document.getElementById(id) as T | null;
  const cap = (t: CreatureType): string => t.charAt(0).toUpperCase() + t.slice(1);

  const seaLifeBtn = byId<HTMLButtonElement>('seaLifeBtn');
  const seaLifePanel = byId<HTMLElement>('sea-life-panel');
  const seaLifeCloseBtn = byId<HTMLButtonElement>('sea-life-close-btn');

  const setPanelOpen = (open: boolean): void => {
    if (!seaLifePanel || !seaLifeBtn) return;
    if (open) {
      seaLifePanel.classList.add('open');
      seaLifeBtn.setAttribute('aria-expanded', 'true');
      seaLifeBtn.setAttribute('aria-pressed', 'true');
    } else {
      seaLifePanel.classList.remove('open');
      seaLifeBtn.setAttribute('aria-expanded', 'false');
      seaLifeBtn.removeAttribute('aria-pressed');
    }
  };

  seaLifeBtn?.addEventListener('click', () => {
    setPanelOpen(!(seaLifePanel?.classList.contains('open') ?? false));
  });
  seaLifeCloseBtn?.addEventListener('click', () => setPanelOpen(false));

  const onKeydown = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape') setPanelOpen(false);
  };
  const onDocClick = (ev: MouseEvent): void => {
    if (!seaLifePanel?.classList.contains('open')) return;
    const target = ev.target as Node;
    if (!seaLifePanel.contains(target) && target !== seaLifeBtn && !seaLifeBtn?.contains(target)) {
      setPanelOpen(false);
    }
  };
  document.addEventListener('keydown', onKeydown);
  document.addEventListener('click', onDocClick);

  const refreshPanel = (): void => {
    for (const type of ORDER) {
      const n = count(type);
      const countEl = document.getElementById(`count-${type}`);
      if (countEl) countEl.textContent = String(n);
      const removeBtn = byId<HTMLButtonElement>(`remove${cap(type)}Btn`);
      if (removeBtn) removeBtn.disabled = n === 0;
    }
  };

  for (const type of ORDER) {
    byId<HTMLButtonElement>(`add${cap(type)}Btn`)?.addEventListener('click', () => {
      spawn(type);
      refreshPanel();
    });
    byId<HTMLButtonElement>(`remove${cap(type)}Btn`)?.addEventListener('click', () => {
      removeOne(type);
      refreshPanel();
    });
  }

  return {
    update(clockSec: number): void {
      for (const c of creatures) c.instance.update(clockSec);
    },
    dispose(): void {
      document.removeEventListener('keydown', onKeydown);
      document.removeEventListener('click', onDocClick);
    },
  };
}
