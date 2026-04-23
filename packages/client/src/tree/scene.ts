import {
  AmbientLight,
  CanvasTexture,
  CylinderGeometry,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Scene,
  SRGBColorSpace,
  Vector2,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const PEDESTAL_RADIUS = 0.15;
const PEDESTAL_HEIGHT = 0.04;

/**
 * Vertical-gradient background simulating a water column — a faint teal glow
 * up top (closer to the surface) fading to near-black at the seafloor. Gives
 * the coral a sense of depth and context without needing a skybox.
 */
export function createUnderwaterBackground(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0.0, '#0b1f2c');
  grad.addColorStop(0.45, '#03101a');
  grad.addColorStop(1.0, '#01060d');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/**
 * Underwater-mood lighting: dim teal ambient + cool hemisphere for
 * bounce, plus a cooler key light from above simulating dappled sunlight
 * filtered through water. Replaces the default landscape lighting so the
 * tree reads as submerged rather than on a dry pedestal.
 */
export function installUnderwaterLighting(scene: Scene): void {
  scene.add(new AmbientLight(0x1a3c52, 0.45));
  scene.add(new HemisphereLight(0x4ab0d8, 0x081220, 0.7));
  const key = new DirectionalLight(0xbfe4ff, 1.0);
  key.position.set(0.2, 1.0, 0.3);
  scene.add(key);
}

/**
 * Exponential fog tuned for the tree's small world scale (pieces ~0.1m,
 * pedestal at ~0.3m radius). A bit of fog at close range softens the
 * pieces into the background; density is deliberately mild so the coral
 * doesn't disappear at the intended viewing distance.
 */
export function createUnderwaterFog(): FogExp2 {
  return new FogExp2(0x02101c, 1.6);
}

export function createTreePedestal(): Mesh {
  const geom = new CylinderGeometry(PEDESTAL_RADIUS, PEDESTAL_RADIUS, PEDESTAL_HEIGHT, 64);
  const mat = new MeshStandardMaterial({ color: 0x0a0f18, roughness: 0.95, metalness: 0.0 });
  const mesh = new Mesh(geom, mat);
  mesh.position.y = -PEDESTAL_HEIGHT / 2;
  return mesh;
}

export interface BloomSetup {
  composer: EffectComposer;
  bloomPass: UnrealBloomPass;
  render: () => void;
}

export function createBloomComposer(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
): BloomSetup {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new Vector2(renderer.domElement.width, renderer.domElement.height),
    // Low threshold so mid-pulse pieces reliably halo (the persistent "slight
    // glow" around branches). Strength stays modest so the glow doesn't
    // overpower the surface color. Raise threshold if pieces look washed-out;
    // lower strength if the glow feels too strong.
    0.55, // strength
    0.5,  // radius
    0.3,  // threshold
  );
  composer.addPass(bloomPass);
  return {
    composer,
    bloomPass,
    render: (): void => { composer.render(); },
  };
}
