import { describe, test, expect, afterEach, vi } from 'vitest';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { Mesh, MeshStandardMaterial, Object3D } from 'three';
import type { PublicPolyp, SimDelta } from '@reef/shared';
import { generatePolyp } from '@reef/generator';
import { Reef } from '../scene/reef.js';
import { buildGlb, describeReef, parseGlbHeader, type PolypExportDesc } from './glb.js';
import { exportReefGlb, downloadGlb, glbFilename } from './exportReef.js';

function polyp(id: number, over: Partial<PublicPolyp> = {}): PublicPolyp {
  return {
    id, species: 'branching', seed: id * 7, colorKey: 'coral-pink',
    position: [0.1 * id, 0, -0.05], orientation: [0, 0, 0, 1], scale: 1.5, createdAt: 0,
    ...over,
  };
}

function reefOf(polyps: PublicPolyp[], animate = false): Reef {
  const reef = new Reef();
  for (const p of polyps) reef.addPolyp(p, animate);
  return reef;
}

async function load(buf: ArrayBuffer) {
  return new GLTFLoader().parseAsync(buf, '');
}

function polypNodes(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => { if (/^polyp-\d+$/.test(o.name)) out.push(o as Mesh); });
  return out;
}

describe('parseGlbHeader', () => {
  test('rejects a buffer that is not GLB', () => {
    expect(() => parseGlbHeader(new ArrayBuffer(4))).toThrow();
    expect(() => parseGlbHeader(new Uint8Array(20).buffer)).toThrow(/magic/);
  });
});

describe('describeReef', () => {
  test('captures the target (not mid-grow) scale and the polyp identity', () => {
    const reef = reefOf([polyp(1)], true); // grow-in starts at scale 0.001
    const [d] = describeReef(reef.all());
    expect(d!.id).toBe(1);
    expect(d!.scale).toBe(1.5);
    expect(d!.species).toBe('branching');
    expect(d!.position).toEqual([0.1, 0, -0.05]);
  });

  test('captures sim tint and barnacles, ignores the "mine" ring', () => {
    const reef = reefOf([polyp(1)]);
    const algae: SimDelta = { polypId: 1, kind: 'algae', params: { u: 0, v: 0, coverage: 0.2 }, createdAt: 0 };
    const barnacle: SimDelta = { polypId: 1, kind: 'barnacle', params: { u: 0.25, v: 0.5, size: 0.8 }, createdAt: 0 };
    reef.applySim(algae);
    reef.applySim(barnacle);
    reef.markMine(1);
    const [d] = describeReef(reef.all());
    expect(d!.tint).not.toEqual([1, 1, 1]);
    expect(d!.barnacles).toHaveLength(1);
    expect(d!.barnacles[0]!.radius).toBeCloseTo(0.004);
  });
});

describe('buildGlb', () => {
  test('empty reef still yields a valid GLB', async () => {
    const buf = await buildGlb([]);
    const h = parseGlbHeader(buf);
    expect(h.version).toBe(2);
    expect(h.length).toBe(buf.byteLength);
    const gltf = await load(buf);
    expect(polypNodes(gltf.scene)).toHaveLength(0);
  });

  test('valid GLB 2.0 with one named node per polyp', async () => {
    const species = ['branching', 'bulbous', 'fan', 'tube', 'encrusting'] as const;
    const reef = reefOf(species.map((sp, i) => polyp(i + 1, { species: sp })));
    const buf = await buildGlb(describeReef(reef.all()));
    const h = parseGlbHeader(buf);
    expect(h.magic).toBe('glTF');
    expect(h.version).toBe(2);
    expect(h.length).toBe(buf.byteLength);
    expect(h.json.asset.version).toBe('2.0');
    expect(h.json.nodes.filter((n: { name?: string }) => /^polyp-\d+$/.test(n.name ?? ''))).toHaveLength(5);
  });

  test('round-trips through GLTFLoader with the rendered geometry, transforms and vertex colours', async () => {
    const p = polyp(3, { species: 'fan', orientation: [0, Math.sin(0.3), 0, Math.cos(0.3)] });
    const buf = await buildGlb(describeReef(reefOf([p]).all()));
    const gltf = await load(buf);
    const [node] = polypNodes(gltf.scene);
    expect(node!.name).toBe('polyp-3');
    const expected = generatePolyp({ species: p.species, seed: p.seed, colorKey: p.colorKey }).mesh;
    const geo = node!.geometry;
    expect(geo.attributes.position!.count).toBe(expected.positions.length / 3);
    expect(geo.index!.count).toBe(expected.indices.length);
    expect(Array.from((geo.attributes.position!.array as Float32Array).slice(0, 9)))
      .toEqual(Array.from(expected.positions.slice(0, 9)));
    expect(geo.attributes.color).toBeDefined();
    expect(node!.position.x).toBeCloseTo(0.3);
    expect(node!.position.z).toBeCloseTo(-0.05);
    expect(node!.quaternion.y).toBeCloseTo(Math.sin(0.3));
    expect(node!.scale.x).toBeCloseTo(1.5);
    const mat = node!.material as MeshStandardMaterial;
    expect(mat.vertexColors).toBe(true);
    expect(mat.transparent).toBe(false);
    expect(mat.emissive.getHex()).toBe(0x000000);
  });

  test('sim tint becomes the material colour; barnacles export as child meshes', async () => {
    const d: PolypExportDesc = {
      id: 9, species: 'bulbous', seed: 1, colorKey: 'coral-pink',
      position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: 1,
      tint: [0.5, 0.75, 0.5],
      barnacles: [{ position: [0.02, 0.01, 0], radius: 0.004 }],
    };
    const gltf = await load(await buildGlb([d]));
    const [node] = polypNodes(gltf.scene);
    const mat = node!.material as MeshStandardMaterial;
    expect(mat.color.r).toBeCloseTo(0.5, 2);
    expect(mat.color.g).toBeCloseTo(0.75, 2);
    const barnacles = node!.children.filter((c) => c.name === 'barnacle');
    expect(barnacles).toHaveLength(1);
    expect(barnacles[0]!.position.x).toBeCloseTo(0.02);
  });

  test('polyps with the same tint share one material', async () => {
    const reef = reefOf([polyp(1), polyp(2), polyp(3)]);
    const h = parseGlbHeader(await buildGlb(describeReef(reef.all())));
    expect(h.json.materials).toHaveLength(1);
  });
});

describe('exportReefGlb', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  test('falls back to the main thread when Worker is unavailable', async () => {
    vi.stubGlobal('Worker', undefined);
    const buf = await exportReefGlb(reefOf([polyp(1), polyp(2)]));
    expect(parseGlbHeader(buf).json.nodes.filter((n: { name?: string }) => n.name?.startsWith('polyp-'))).toHaveLength(2);
  });

  test('falls back to the main thread when the worker errors', async () => {
    class BrokenWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      postMessage(): void { queueMicrotask(() => this.onerror?.(new ErrorEvent('error', { message: 'boom' }))); }
      terminate(): void {}
    }
    vi.stubGlobal('Worker', BrokenWorker);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const buf = await exportReefGlb(reefOf([polyp(1)]));
    expect(parseGlbHeader(buf).magic).toBe('glTF');
  });

  test('uses the worker result when the worker succeeds', async () => {
    const fake = await buildGlb([]);
    let posted: unknown;
    class OkWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: ((e: ErrorEvent) => void) | null = null;
      postMessage(msg: unknown): void {
        posted = msg;
        queueMicrotask(() => this.onmessage?.(new MessageEvent('message', { data: { ok: true, glb: fake } })));
      }
      terminate(): void {}
    }
    vi.stubGlobal('Worker', OkWorker);
    const buf = await exportReefGlb(reefOf([polyp(1)]));
    expect(buf).toBe(fake);
    expect((posted as { polyps: PolypExportDesc[] }).polyps).toHaveLength(1);
  });
});

describe('downloadGlb', () => {
  test('clicks a temporary download link and revokes the object URL', () => {
    const create = vi.fn(() => 'blob:fake');
    const revoke = vi.fn();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
    const clicked: HTMLAnchorElement[] = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this); });
    vi.useFakeTimers();
    downloadGlb(new ArrayBuffer(8), 'reef.glb');
    expect(clicked[0]!.download).toBe('reef.glb');
    expect(clicked[0]!.href).toBe('blob:fake');
    expect(clicked[0]!.isConnected).toBe(false);
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:fake');
    vi.useRealTimers();
    spy.mockRestore();
  });

  test('glbFilename is date-stamped', () => {
    expect(glbFilename(new Date('2026-10-29T12:00:00Z'))).toBe('coral-reef-2026-10-29.glb');
  });
});
