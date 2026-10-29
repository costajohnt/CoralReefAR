import { describe, test, expect, vi, beforeEach } from 'vitest';
import { BoxGeometry, Mesh, MeshStandardMaterial, Object3D } from 'three';
import qrcode from 'qrcode-generator';
import {
  ARRIVAL_HIGHLIGHT_SEC, ArrivalHighlights, GalleryOverlay, MAX_ACTIVE_HIGHLIGHTS,
  MAX_RING_RADIUS, arrivalGlow, counterText, qrSvg,
} from './gallery.js';

function polypNode(): Mesh {
  return new Mesh(new BoxGeometry(0.04, 0.06, 0.04), new MeshStandardMaterial());
}
const ring = (o: Object3D) => o.getObjectByName('arrival-ring') as Mesh | undefined;

describe('arrivalGlow', () => {
  test('starts strong, fades out, and ends after the highlight window', () => {
    const start = arrivalGlow(0, false)!;
    const late = arrivalGlow(ARRIVAL_HIGHLIGHT_SEC * 0.9, false)!;
    expect(start.opacity).toBeGreaterThan(late.opacity);
    expect(arrivalGlow(ARRIVAL_HIGHLIGHT_SEC + 0.01, false)).toBeNull();
    expect(arrivalGlow(-1, false)).toBeNull();
  });

  test('the polyp glow boost starts high and decays to zero', () => {
    expect(arrivalGlow(0, false)!.boost).toBeGreaterThan(0.8);
    expect(arrivalGlow(ARRIVAL_HIGHLIGHT_SEC * 0.95, false)!.boost).toBeLessThan(0.1);
    expect(arrivalGlow(0, true)!.boost).toBeGreaterThan(0.8);
  });

  test('pulses (scale varies) normally; reduced motion keeps scale fixed', () => {
    const scales = [0.1, 0.6, 1.1, 1.6].map((t) => arrivalGlow(t, false)!.scale);
    expect(new Set(scales.map((s) => s.toFixed(3))).size).toBeGreaterThan(1);
    for (const t of [0.1, 0.6, 1.1, 1.6]) expect(arrivalGlow(t, true)!.scale).toBe(1);
  });
});

describe('ArrivalHighlights', () => {
  test('adds a ring to the arriving polyp and removes it after the window', () => {
    const h = new ArrivalHighlights(false);
    const node = polypNode();
    h.add(1, node, 0);
    expect(ring(node)).toBeDefined();
    h.update(1);
    expect((ring(node)!.material as MeshStandardMaterial).opacity).toBeGreaterThan(0);
    h.update(ARRIVAL_HIGHLIGHT_SEC + 1);
    expect(ring(node)).toBeUndefined();
    expect(h.active()).toBe(0);
  });

  test('makes the polyp itself glow while highlighted, and clears it after', () => {
    const h = new ArrivalHighlights(false);
    const node = polypNode();
    h.add(1, node, 0);
    h.update(0.5);
    expect(node.userData.arrivalBoost).toBeGreaterThan(0.5);
    h.update(ARRIVAL_HIGHLIGHT_SEC + 1);
    expect(node.userData.arrivalBoost).toBeUndefined();
  });

  test('the ring stays small even for a wide polyp (it marks one coral, not the reef)', () => {
    const h = new ArrivalHighlights(false);
    const wide = new Mesh(new BoxGeometry(0.4, 0.05, 0.4), new MeshStandardMaterial());
    h.add(1, wide, 0);
    const g = ring(wide)!.geometry as unknown as { parameters: { outerRadius: number } };
    expect(g.parameters.outerRadius).toBeLessThanOrEqual(MAX_RING_RADIUS);
  });

  test('re-arriving id restarts its highlight without stacking rings', () => {
    const h = new ArrivalHighlights(false);
    const node = polypNode();
    h.add(1, node, 0);
    h.add(1, node, 5);
    expect(node.children.filter((c) => c.name === 'arrival-ring')).toHaveLength(1);
    h.update(ARRIVAL_HIGHLIGHT_SEC + 1); // 5s after restart → still on
    expect(ring(node)).toBeDefined();
  });

  test('forget() drops a highlight for a removed polyp', () => {
    const h = new ArrivalHighlights(false);
    const node = polypNode();
    h.add(1, node, 0);
    h.forget(1);
    expect(ring(node)).toBeUndefined();
    expect(h.active()).toBe(0);
  });

  test('a burst of arrivals is capped (oldest highlight retired first)', () => {
    const h = new ArrivalHighlights(false);
    const nodes = Array.from({ length: MAX_ACTIVE_HIGHLIGHTS + 3 }, polypNode);
    nodes.forEach((n, i) => h.add(i, n, i * 0.01));
    expect(h.active()).toBe(MAX_ACTIVE_HIGHLIGHTS);
    expect(ring(nodes[0]!)).toBeUndefined();
    expect(ring(nodes.at(-1)!)).toBeDefined();
  });
});

describe('counterText', () => {
  test('total plus contributors, pluralised', () => {
    expect(counterText({ total: 128, contributors: 37 })).toBe('128 corals planted by 37 visitors');
    expect(counterText({ total: 1, contributors: 1 })).toBe('1 coral planted by 1 visitor');
  });
  test('omits contributors when unknown (legacy reef)', () => {
    expect(counterText({ total: 5, contributors: 0 })).toBe('5 corals');
    expect(counterText({ total: 0, contributors: 0 })).toBe('No corals yet');
  });
});

describe('qrSvg', () => {
  test('draws the same modules the encoder produces, with an accessible name', () => {
    const url = 'https://reef.example/';
    const svg = qrSvg(url, 'Scan to plant a coral');
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Scan to plant a coral');
    expect(svg.getAttribute('viewBox')).toBe(`0 0 ${n + 8} ${n + 8}`);
    let dark = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) dark++;
    const d = svg.querySelector('path')!.getAttribute('d')!;
    expect(d.match(/M/g)).toHaveLength(dark);
  });
});

describe('GalleryOverlay', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="gallery" hidden>
        <p id="galleryCount"></p>
        <p id="galleryNews" role="status" aria-live="polite"></p>
        <figure id="galleryQr"><div id="galleryQrCode"></div><figcaption id="galleryQrUrl"></figcaption></figure>
      </div>`;
  });

  function make(stats: () => Promise<{ total: number; contributors: number; asOf?: number }>) {
    return new GalleryOverlay({
      root: document.getElementById('gallery')!,
      countEl: document.getElementById('galleryCount')!,
      newsEl: document.getElementById('galleryNews')!,
      qrEl: document.getElementById('galleryQrCode')!,
      qrUrlEl: document.getElementById('galleryQrUrl')!,
    }, { fetchStats: stats, plantUrl: 'https://reef.example/' });
  }
  const count = () => document.getElementById('galleryCount')!.textContent;

  test('shows the overlay, the QR code and its URL, and the counter from stats', async () => {
    const o = make(async () => ({ total: 10, contributors: 4, asOf: 1000 }));
    await o.start();
    expect(document.getElementById('gallery')!.hidden).toBe(false);
    expect(document.querySelector('#galleryQrCode svg')).not.toBeNull();
    expect(document.getElementById('galleryQrUrl')!.textContent).toBe('reef.example');
    expect(count()).toBe('10 corals planted by 4 visitors');
    o.stop();
  });

  test('live arrivals/removals adjust the total between refreshes and announce arrivals', async () => {
    const o = make(async () => ({ total: 10, contributors: 4, asOf: 1000 }));
    await o.start();
    o.polypAdded({ id: 11, createdAt: 2000 });
    o.polypAdded({ id: 12, createdAt: 2001 });
    o.polypRemoved(3);
    expect(count()).toBe('11 corals planted by 4 visitors');
    expect(document.getElementById('galleryNews')!.textContent).toMatch(/new coral/i);
    o.stop();
  });

  test('a duplicate arrival for the same id counts once', async () => {
    const o = make(async () => ({ total: 10, contributors: 4, asOf: 1000 }));
    await o.start();
    o.polypAdded({ id: 11, createdAt: 2000 });
    o.polypAdded({ id: 11, createdAt: 2000 });
    expect(count()).toBe('11 corals planted by 4 visitors');
    o.stop();
  });

  test('an arrival that is then undone nets to zero', async () => {
    const o = make(async () => ({ total: 10, contributors: 4, asOf: 1000 }));
    await o.start();
    o.polypAdded({ id: 11, createdAt: 2000 });
    o.polypRemoved(11);
    expect(count()).toBe('10 corals planted by 4 visitors');
    o.stop();
  });

  test('refresh race: arrivals after the stats snapshot survive, ones it already counted are dropped', async () => {
    let call = 0;
    let release!: () => void;
    const o = make(async () => {
      call++;
      if (call === 1) return { total: 10, contributors: 4, asOf: 1000 };
      await new Promise<void>((r) => { release = r; });
      // Server computed stats at t=3000: it already includes #11 (2000) but not #12 (4000).
      return { total: 11, contributors: 5, asOf: 3000 };
    });
    await o.start();
    o.polypAdded({ id: 11, createdAt: 2000 });
    const refreshing = o.refreshNow();
    o.polypAdded({ id: 12, createdAt: 4000 }); // lands while the fetch is in flight
    release();
    await refreshing;
    expect(count()).toBe('12 corals planted by 5 visitors');
    o.stop();
  });

  test('removals seen before a refresh was sent are dropped; ones during/after are kept', async () => {
    let call = 0;
    let release!: () => void;
    const o = make(async () => {
      call++;
      if (call === 1) return { total: 10, contributors: 4, asOf: 1000 };
      await new Promise<void>((r) => { release = r; });
      return { total: 9, contributors: 4, asOf: 3000 }; // reflects removal of #3
    });
    await o.start();
    o.polypRemoved(3);
    const refreshing = o.refreshNow();
    o.polypRemoved(4); // after the request went out
    release();
    await refreshing;
    expect(count()).toBe('8 corals planted by 4 visitors');
    o.stop();
  });

  test('refreshes stats periodically and stops on stop()', async () => {
    vi.useFakeTimers();
    let total = 1;
    const fetchStats = vi.fn(async () => ({ total: total++, contributors: 1, asOf: 0 }));
    const o = make(fetchStats);
    await o.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchStats).toHaveBeenCalledTimes(2);
    o.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchStats).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  test('a stats failure keeps the overlay up with whatever count it had', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const o = make(async () => { throw new Error('offline'); });
    await o.start();
    expect(document.getElementById('gallery')!.hidden).toBe(false);
    expect(document.getElementById('galleryCount')!.textContent).toBe('');
    o.stop();
  });
});
