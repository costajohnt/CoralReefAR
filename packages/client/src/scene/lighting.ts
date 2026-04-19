import {
  AmbientLight, Color, DirectionalLight, Fog, HemisphereLight, Scene,
} from 'three';

/**
 * Reef-ish lighting: a hemispheric base plus a warm directional "sun"
 * simulating light through water, and a subtle blue fog.
 */
export function installLighting(scene: Scene): void {
  scene.background = null; // AR passthrough
  scene.fog = new Fog(new Color(0x0b243a), 0.5, 3.5);
  scene.add(new AmbientLight(0x1b3348, 0.4));
  scene.add(new HemisphereLight(0x87b7ff, 0x14263a, 0.6));
  const dir = new DirectionalLight(0xfff0d0, 1.0);
  dir.position.set(0.3, 1.0, 0.2);
  scene.add(dir);
}
