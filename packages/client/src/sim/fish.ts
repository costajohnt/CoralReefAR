import {
  BufferAttribute, BufferGeometry, Color, Points, PointsMaterial,
} from 'three';

/**
 * Tiny flocking school. Keeps all agents in a bounded sphere around the reef,
 * updates positions in-place each frame. Pure client, no state.
 */
export class FishSchool {
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  readonly points: Points;
  private readonly attrPos: BufferAttribute;
  // Elapsed animation time drives a slowly rotating ambient current so the
  // school drifts as a group — without it each fish's motion looks
  // individually wiggly instead of in-an-ocean.
  private elapsed = 0;

  constructor(count = 60, readonly radius = 0.6) {
    this.positions = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      this.positions[i * 3] = (Math.random() - 0.5) * radius;
      this.positions[i * 3 + 1] = Math.random() * radius * 0.6 + 0.05;
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * radius;
      this.velocities[i * 3] = (Math.random() - 0.5) * 0.05;
      this.velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.02;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    }
    const g = new BufferGeometry();
    this.attrPos = new BufferAttribute(this.positions, 3);
    g.setAttribute('position', this.attrPos);
    const m = new PointsMaterial({
      size: 0.015,
      color: new Color(0xffe9a8),
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true,
    });
    this.points = new Points(g, m);
  }

  update(dt: number): void {
    this.elapsed += dt;
    // Ambient current vector rotates on a ~90s period in the XZ plane with a
    // small vertical sway. Strength is tiny so individual motion still reads.
    const currentAngle = this.elapsed * ((Math.PI * 2) / 90);
    const cx = Math.cos(currentAngle) * 0.04;
    const cz = Math.sin(currentAngle) * 0.04;
    const cy = Math.sin(this.elapsed * 0.3) * 0.01;

    const count = this.positions.length / 3;
    for (let i = 0; i < count; i++) {
      const px = this.positions[i * 3]!;
      const py = this.positions[i * 3 + 1]!;
      const pz = this.positions[i * 3 + 2]!;
      let vx = this.velocities[i * 3]!;
      let vy = this.velocities[i * 3 + 1]!;
      let vz = this.velocities[i * 3 + 2]!;

      // ambient current nudge (applies equally to every fish — the flock drifts)
      vx += cx * dt;
      vy += cy * dt;
      vz += cz * dt;

      // gentle pull to center, pushing away from outside radius
      const r = Math.hypot(px, py - 0.2, pz);
      if (r > this.radius) {
        vx -= (px / r) * 0.08 * dt;
        vz -= (pz / r) * 0.08 * dt;
        vy -= ((py - 0.2) / r) * 0.08 * dt;
      }

      // cohesion pulse
      vx += Math.sin(px * 5 + py * 3) * 0.02 * dt;
      vz += Math.cos(pz * 4 + py * 3) * 0.02 * dt;

      // clamp
      const sp = Math.hypot(vx, vy, vz);
      const maxSp = 0.25;
      if (sp > maxSp) {
        vx = (vx / sp) * maxSp;
        vy = (vy / sp) * maxSp;
        vz = (vz / sp) * maxSp;
      }

      this.positions[i * 3] = px + vx * dt;
      this.positions[i * 3 + 1] = py + vy * dt;
      this.positions[i * 3 + 2] = pz + vz * dt;
      this.velocities[i * 3] = vx;
      this.velocities[i * 3 + 1] = vy;
      this.velocities[i * 3 + 2] = vz;
    }
    this.attrPos.needsUpdate = true;
  }
}
