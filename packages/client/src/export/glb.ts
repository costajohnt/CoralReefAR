/**
 * GLB export of the landscape reef (#115).
 *
 * Split in two so the heavy part can run in a worker:
 *  - describeReef() runs on the main thread and only reads the rendered scene
 *    graph into small serialisable descriptors (cheap: no geometry copied).
 *  - buildGlb() regenerates each polyp from (species, seed, colorKey) with the
 *    deterministic generator (the same call Reef.addPolyp makes, so geometry
 *    matches what's rendered) and runs three's GLTFExporter. It has no DOM
 *    dependency, so it runs unchanged in a worker or on the main thread.
 *
 * What's exported vs rendered:
 *  - geometry, vertex colours, pose, final (not mid-grow-in) scale: as rendered
 *  - sim decorations: algae/weather tint (material colour, which multiplies
 *    vertex colour in both three and glTF) and barnacle meshes
 *  - dropped: in-app effects that standard viewers can't reproduce or that
 *    wash out without bloom: the emissive "breathing" pulse, the 0.85
 *    translucency, the shader sway, and the "mine" highlight ring.
 */
import {
  BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial,
  SphereGeometry, type Object3D,
} from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { generatePolyp, type MeshData } from '@reef/generator';
import type { PublicPolyp, Species } from '@reef/shared';

type Vec3 = [number, number, number];

export const GLB_MIME = 'model/gltf-binary';

export interface PolypExportDesc {
  id: number;
  species: Species;
  seed: number;
  colorKey: string;
  position: Vec3;
  quaternion: [number, number, number, number];
  scale: number;
  /** Linear RGB material colour after sim tints; [1,1,1] = untinted. */
  tint: Vec3;
  barnacles: Array<{ position: Vec3; radius: number }>;
}

// Must match scene/simDecor.ts addBarnacle().
const BARNACLE_COLOR = 0xefeadd;
// Must match scene/meshAdapter.ts polypMesh().
const POLYP_ROUGHNESS = 0.7;
const POLYP_METALNESS = 0.05;

/** Read the rendered reef nodes (Reef.all()) into export descriptors. */
export function describeReef(nodes: Iterable<Object3D>): PolypExportDesc[] {
  const out: PolypExportDesc[] = [];
  for (const node of nodes) {
    const p = node.userData.polyp as PublicPolyp | undefined;
    if (!p) continue;
    const mat = (node as Mesh).material as MeshStandardMaterial | undefined;
    const tint: Vec3 = mat?.color ? [mat.color.r, mat.color.g, mat.color.b] : [1, 1, 1];
    const barnacles: PolypExportDesc['barnacles'] = [];
    for (const child of node.children) {
      if (!child.userData.sim) continue;
      const g = (child as Mesh).geometry as SphereGeometry | undefined;
      const radius = g?.parameters?.radius;
      if (typeof radius !== 'number') continue;
      barnacles.push({ position: [child.position.x, child.position.y, child.position.z], radius });
    }
    out.push({
      id: p.id,
      species: p.species,
      seed: p.seed,
      colorKey: p.colorKey,
      position: [node.position.x, node.position.y, node.position.z],
      quaternion: [node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w],
      // Freshly planted polyps animate up from 0.001; export the final size.
      scale: (node.userData.targetScale as number | undefined) ?? node.scale.x,
      tint,
      barnacles,
    });
  }
  return out;
}

function toGeometry(mesh: MeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  g.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  g.setAttribute('color', new BufferAttribute(mesh.colors, 3));
  g.setIndex(new BufferAttribute(mesh.indices, 1));
  return g;
}

/** Build the export scene graph: one `polyp-<id>` node per polyp. */
export function buildExportScene(polyps: readonly PolypExportDesc[]): Group {
  const root = new Group();
  root.name = 'reef';
  const materials = new Map<string, MeshStandardMaterial>();
  const materialFor = (tint: Vec3): MeshStandardMaterial => {
    const key = tint.map((c) => c.toFixed(4)).join(',');
    let m = materials.get(key);
    if (!m) {
      m = new MeshStandardMaterial({
        name: materials.size === 0 ? 'coral' : `coral-${materials.size}`,
        vertexColors: true,
        color: new Color(tint[0], tint[1], tint[2]),
        roughness: POLYP_ROUGHNESS,
        metalness: POLYP_METALNESS,
      });
      materials.set(key, m);
    }
    return m;
  };
  let barnacleMat: MeshStandardMaterial | null = null;
  // Barnacle sizes come from a handful of sim rolls; share geometry per radius
  // so the exporter writes each sphere's buffers once.
  const barnacleGeoms = new Map<number, SphereGeometry>();
  const barnacleGeom = (radius: number): SphereGeometry => {
    let g = barnacleGeoms.get(radius);
    if (!g) { g = new SphereGeometry(radius, 6, 4); barnacleGeoms.set(radius, g); }
    return g;
  };

  for (const d of polyps) {
    const { mesh } = generatePolyp({ species: d.species, seed: d.seed, colorKey: d.colorKey });
    const node = new Mesh(toGeometry(mesh), materialFor(d.tint));
    node.name = `polyp-${d.id}`;
    node.position.fromArray(d.position);
    node.quaternion.fromArray(d.quaternion);
    node.scale.setScalar(d.scale);
    node.userData = { id: d.id, species: d.species, seed: d.seed, colorKey: d.colorKey };
    for (const b of d.barnacles) {
      barnacleMat ??= new MeshStandardMaterial({ name: 'barnacle', color: BARNACLE_COLOR, roughness: 0.9 });
      const s = new Mesh(barnacleGeom(b.radius), barnacleMat);
      s.name = 'barnacle';
      s.position.fromArray(b.position);
      node.add(s);
    }
    root.add(node);
  }
  return root;
}

/** Serialise polyps to a binary glTF 2.0 (GLB) buffer. */
export async function buildGlb(polyps: readonly PolypExportDesc[]): Promise<ArrayBuffer> {
  const scene = buildExportScene(polyps);
  try {
    const out = await new GLTFExporter().parseAsync(scene, { binary: true });
    if (!(out instanceof ArrayBuffer)) throw new Error('GLTFExporter did not return binary output');
    return out;
  } finally {
    scene.traverse((o) => { (o as Mesh).geometry?.dispose(); });
  }
}

export interface GlbHeader {
  magic: 'glTF';
  version: number;
  length: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
}

/** Validate the GLB container header and decode its JSON chunk. */
export function parseGlbHeader(buf: ArrayBuffer): GlbHeader {
  if (buf.byteLength < 20) throw new Error('GLB too short');
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('GLB magic mismatch');
  const version = dv.getUint32(4, true);
  const length = dv.getUint32(8, true);
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a) throw new Error('first GLB chunk is not JSON');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen)));
  return { magic: 'glTF', version, length, json };
}
