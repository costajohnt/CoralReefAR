import { Mesh, MeshBasicMaterial, SphereGeometry, type Object3D } from 'three';

const HOTSPOT_RADIUS_METERS = 0.015;

const sharedGeometry = new SphereGeometry(HOTSPOT_RADIUS_METERS, 12, 8);
const dimMaterial = new MeshBasicMaterial({ color: 0x5dd8c9, transparent: true, opacity: 0.35 });
const litMaterial = new MeshBasicMaterial({ color: 0xb4ffe9, transparent: true, opacity: 0.95 });

/**
 * Build a visible sphere marker for a tip node. Tag it with `userData.hotspotId`
 * so `pickHotspot()` can identify it via raycast. The geometry and materials
 * are shared across all hotspots — they're tiny and identical so per-instance
 * allocation would be wasteful at the polyp counts we expect.
 */
export function createTipHotspot(hotspotId: number): Mesh {
  const mesh = new Mesh(sharedGeometry, dimMaterial);
  mesh.userData.hotspotId = hotspotId;
  return mesh;
}

export function setHotspotLit(hotspot: Object3D, lit: boolean): void {
  if ((hotspot as Mesh).isMesh) {
    (hotspot as Mesh).material = lit ? litMaterial : dimMaterial;
  }
}
