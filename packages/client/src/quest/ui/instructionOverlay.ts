import {
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Vector3,
} from 'three';

const CANVAS_WIDTH = 512;
const CANVAS_HEIGHT = 128;
const PANEL_WIDTH_METERS = 0.6;
const PANEL_HEIGHT_METERS = PANEL_WIDTH_METERS * (CANVAS_HEIGHT / CANVAS_WIDTH);

/**
 * A small floating panel rendered inside the XR scene with instructional
 * text. The 2D status div on the wrapper page is invisible once an
 * immersive session starts, so any MR-time text needs to be a real mesh.
 *
 * The panel is positioned each frame relative to the user's head, slightly
 * below their gaze line, billboarded toward the camera. Calling `setText`
 * redraws the texture; calling `hide()` removes it from the scene graph
 * until the next `show()`.
 */
export class InstructionOverlay {
  readonly object3d = new Group();
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly texture: CanvasTexture;
  private readonly mesh: Mesh;
  private _visible = true;
  private currentText = '';

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CANVAS_WIDTH;
    this.canvas.height = CANVAS_HEIGHT;
    this.ctx = this.canvas.getContext('2d');
    this.texture = new CanvasTexture(this.canvas);
    const material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      // Double-sided so the panel is readable regardless of which way
      // lookAt() ends up orienting it (Three.js's mesh-lookAt
      // convention puts +Z toward target, but rendering both sides
      // is a cheap insurance policy against tilts and edge cases).
      side: DoubleSide,
    });
    this.mesh = new Mesh(new PlaneGeometry(PANEL_WIDTH_METERS, PANEL_HEIGHT_METERS), material);
    // Render after the world so the panel is always on top.
    this.mesh.renderOrder = 999;
    this.object3d.add(this.mesh);
    this.draw('');
  }

  get text(): string {
    return this.currentText;
  }

  get visible(): boolean {
    return this._visible;
  }

  setText(text: string): void {
    if (text === this.currentText) return;
    this.currentText = text;
    this.draw(text);
  }

  show(): void {
    if (this._visible) return;
    this._visible = true;
    this.mesh.visible = true;
  }

  hide(): void {
    if (!this._visible) return;
    this._visible = false;
    this.mesh.visible = false;
  }

  /**
   * Position the overlay roughly 0.7m in front of the head pose, dropped
   * 0.15m so it sits below the gaze center. Caller supplies the head's
   * world position and forward vector each frame.
   */
  updatePose(headPosition: Vector3, headForward: Vector3): void {
    const target = headPosition.clone().add(headForward.clone().multiplyScalar(0.7));
    target.y -= 0.15;
    this.object3d.position.copy(target);
    this.object3d.lookAt(headPosition);
  }

  private draw(text: string): void {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    if (!text) {
      this.texture.needsUpdate = true;
      return;
    }
    this.ctx.fillStyle = 'rgba(7, 21, 28, 0.85)';
    this.roundRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT, 24);
    this.ctx.fill();
    this.ctx.fillStyle = '#e8f4fa';
    this.ctx.textAlign = 'center';
    this.ctx.textBaseline = 'middle';
    this.ctx.font = '32px system-ui, sans-serif';
    this.wrapText(text, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2, CANVAS_WIDTH - 48, 40);
    this.texture.needsUpdate = true;
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    if (!this.ctx) return;
    this.ctx.beginPath();
    this.ctx.moveTo(x + r, y);
    this.ctx.lineTo(x + w - r, y);
    this.ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    this.ctx.lineTo(x + w, y + h - r);
    this.ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    this.ctx.lineTo(x + r, y + h);
    this.ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    this.ctx.lineTo(x, y + r);
    this.ctx.quadraticCurveTo(x, y, x + r, y);
    this.ctx.closePath();
  }

  private wrapText(text: string, x: number, y: number, maxWidth: number, lineHeight: number): void {
    if (!this.ctx) return;
    const words = text.split(' ');
    const lines: string[] = [];
    let current = '';
    for (const w of words) {
      const test = current ? `${current} ${w}` : w;
      if (this.ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = w;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
    const startY = y - ((lines.length - 1) * lineHeight) / 2;
    for (let i = 0; i < lines.length; i++) {
      this.ctx.fillText(lines[i]!, x, startY + i * lineHeight);
    }
  }
}
