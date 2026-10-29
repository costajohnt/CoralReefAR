import {
  AdditiveBlending, DoubleSide, Mesh, MeshBasicMaterial, RingGeometry, type Object3D,
} from 'three';
import qrcode from 'qrcode-generator';

// --- Recent-polyp highlight -----------------------------------------------

/** How long a newly planted polyp stays highlighted on the gallery display. */
export const ARRIVAL_HIGHLIGHT_SEC = 8;
/** Bound the per-frame work if many polyps land at once (e.g. a class visit). */
export const MAX_ACTIVE_HIGHLIGHTS = 12;
const PULSE_PERIOD_SEC = 1.2;
/**
 * Polyps are 5-10 cm wide on a reef ~25 cm across, so a footprint-sized ring
 * would circle half the reef. The ring is a small base marker; the main cue is
 * the polyp's own glow (arrivalBoost).
 */
export const MAX_RING_RADIUS = 0.035;
const MAX_BOOST = 1.2;
const RING_NAME = 'arrival-ring';

/** Ring scale/opacity `elapsedSec` after arrival, or null once it's over. */
export function arrivalGlow(
  elapsedSec: number,
  reducedMotion: boolean,
): { scale: number; opacity: number; boost: number } | null {
  if (elapsedSec < 0 || elapsedSec > ARRIVAL_HIGHLIGHT_SEC) return null;
  const envelope = Math.pow(1 - elapsedSec / ARRIVAL_HIGHLIGHT_SEC, 1.5);
  const scale = reducedMotion
    ? 1
    : 1 + 0.35 * (0.5 - 0.5 * Math.cos((2 * Math.PI * elapsedSec) / PULSE_PERIOD_SEC));
  return { scale, opacity: 0.9 * envelope, boost: MAX_BOOST * envelope };
}

function makeRing(node: Object3D): Mesh {
  const geom = (node as Mesh).geometry;
  let r = 0.025;
  if (geom) {
    if (!geom.boundingBox) geom.computeBoundingBox();
    const b = geom.boundingBox;
    if (b) r = Math.max(Math.abs(b.min.x), b.max.x, Math.abs(b.min.z), b.max.z) * 0.9;
  }
  r = Math.min(MAX_RING_RADIUS, Math.max(0.012, r));
  const ring = new Mesh(
    new RingGeometry(r * 0.8, r, 48),
    new MeshBasicMaterial({
      color: 0xffe58a, transparent: true, opacity: 0.9, side: DoubleSide,
      depthWrite: false, blending: AdditiveBlending,
    }),
  );
  ring.name = RING_NAME;
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.001;
  return ring;
}

/**
 * Pulsing golden ring under polyps that just arrived over the WS feed.
 * Rings are children of the polyp node, so they follow it and are disposed
 * with it if the polyp is removed mid-highlight.
 */
export class ArrivalHighlights {
  private readonly items = new Map<number, { node: Object3D; ring: Mesh; start: number }>();

  constructor(private readonly reducedMotion: boolean) {}

  add(id: number, node: Object3D, nowSec: number): void {
    const existing = this.items.get(id);
    if (existing) {
      this.items.delete(id); // re-insert so it counts as newest
      this.items.set(id, { node: existing.node, ring: existing.ring, start: nowSec });
      return;
    }
    while (this.items.size >= MAX_ACTIVE_HIGHLIGHTS) {
      const oldest = this.items.keys().next().value as number;
      this.forget(oldest);
    }
    const ring = makeRing(node);
    node.add(ring);
    this.items.set(id, { node, ring, start: nowSec });
  }

  update(nowSec: number): void {
    for (const [id, item] of this.items) {
      const g = arrivalGlow(nowSec - item.start, this.reducedMotion);
      if (!g) { this.forget(id); continue; }
      item.ring.scale.setScalar(g.scale);
      (item.ring.material as MeshBasicMaterial).opacity = g.opacity;
      item.node.userData.arrivalBoost = g.boost;
    }
  }

  forget(id: number): void {
    const item = this.items.get(id);
    if (!item) return;
    delete item.node.userData.arrivalBoost;
    item.ring.removeFromParent();
    item.ring.geometry.dispose();
    (item.ring.material as MeshBasicMaterial).dispose();
    this.items.delete(id);
  }

  active(): number { return this.items.size; }
}

// --- Counter overlay ------------------------------------------------------

export interface GalleryStats { total: number; contributors: number }

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export function counterText(s: GalleryStats): string {
  if (s.total <= 0) return 'No corals yet';
  const corals = plural(s.total, 'coral', 'corals');
  return s.contributors > 0 ? `${corals} planted by ${plural(s.contributors, 'visitor', 'visitors')}` : corals;
}

// --- QR code ----------------------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';
const QR_MARGIN = 4; // the quiet zone the QR spec requires

/** Scalable SVG QR code built from the encoder's modules (no HTML strings). */
export function qrSvg(text: string, label: string): SVGSVGElement {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const size = n + QR_MARGIN * 2;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  svg.setAttribute('shape-rendering', 'crispEdges');
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', String(size));
  bg.setAttribute('height', String(size));
  bg.setAttribute('fill', '#fff');
  const parts: string[] = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) parts.push(`M${c + QR_MARGIN} ${r + QR_MARGIN}h1v1h-1z`);
    }
  }
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', parts.join(''));
  path.setAttribute('fill', '#02111d');
  svg.append(bg, path);
  return svg;
}

function displayUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

// --- Overlay ----------------------------------------------------------------

export interface GalleryDom {
  root: HTMLElement;
  countEl: HTMLElement;
  /** role=status live region for arrival announcements. */
  newsEl: HTMLElement;
  qrEl: HTMLElement;
  qrUrlEl: HTMLElement;
}

export interface GalleryOptions {
  fetchStats(): Promise<GalleryStats>;
  plantUrl: string;
  /** Re-sync the counter with the server this often (WS deltas fill the gaps). */
  refreshMs?: number;
}

export class GalleryOverlay {
  private stats: GalleryStats | null = null;
  private delta = 0;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly dom: GalleryDom, private readonly opts: GalleryOptions) {}

  async start(): Promise<void> {
    this.dom.root.hidden = false;
    this.dom.qrEl.replaceChildren(qrSvg(this.opts.plantUrl, `QR code: scan to plant a coral at ${displayUrl(this.opts.plantUrl)}`));
    this.dom.qrUrlEl.textContent = displayUrl(this.opts.plantUrl);
    await this.refresh();
    this.timer = setInterval(() => { void this.refresh(); }, this.opts.refreshMs ?? 60_000);
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer);
    this.timer = undefined;
  }

  polypAdded(): void {
    this.delta++;
    this.render();
    const n = this.total();
    this.dom.newsEl.textContent = n === null
      ? 'A new coral was just planted.'
      : `A new coral was just planted. The reef now has ${plural(n, 'coral', 'corals')}.`;
  }

  polypRemoved(): void {
    this.delta--;
    this.render();
  }

  private total(): number | null {
    return this.stats ? Math.max(0, this.stats.total + this.delta) : null;
  }

  private async refresh(): Promise<void> {
    try {
      this.stats = await this.opts.fetchStats();
      this.delta = 0;
      this.render();
    } catch (e) {
      console.warn('gallery stats refresh failed', e);
    }
  }

  private render(): void {
    const total = this.total();
    if (total === null || !this.stats) return;
    this.dom.countEl.textContent = counterText({ total, contributors: this.stats.contributors });
  }
}
