import {
  CylinderGeometry,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Vector2,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const PEDESTAL_RADIUS = 0.15;
const PEDESTAL_HEIGHT = 0.04;

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
    1.2,  // strength
    0.6,  // radius
    0.4,  // threshold
  );
  composer.addPass(bloomPass);
  return {
    composer,
    bloomPass,
    render: (): void => { composer.render(); },
  };
}
