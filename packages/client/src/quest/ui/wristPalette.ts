import { Mesh, MeshBasicMaterial, PlaneGeometry, Group, type Object3D, type Vector3 } from 'three';
import { SPECIES, REEF_PALETTE, type Species } from '@reef/shared';

const BUTTON_SIZE_METERS = 0.025;
const BUTTON_SPACING_METERS = 0.005;
const ROW_SPACING_METERS = 0.006;

const backingMaterial = new MeshBasicMaterial({ color: 0x07151c, transparent: true, opacity: 0.85 });
const selectedMaterial = new MeshBasicMaterial({ color: 0x5dd8c9 });
const idleMaterial = new MeshBasicMaterial({ color: 0x4a6b78 });
const moveButtonMaterial = new MeshBasicMaterial({ color: 0xf0a8a8 });

/**
 * Two-row UI palette pinned to the user's left wrist. Top row cycles
 * shape (5 species), bottom row picks color (5 palette swatches). The
 * right hand pokes buttons via direct-touch raycast (see Task 12 wiring).
 *
 * Buttons are flat Three.js planes; their `userData.shapeIndex` /
 * `userData.colorIndex` is read by `poke()` to detect which one was hit.
 * This avoids needing per-button event listeners — the render loop calls
 * `poke` whenever the pinch gesture lands on a button.
 */
export class WristPalette {
  readonly object3d: Group = new Group();
  private shapeButtons: Mesh[] = [];
  private colorButtons: Mesh[] = [];
  private _selectedShapeIndex = 0;
  private _selectedColorIndex = 0;
  private shapeListeners: ((species: Species) => void)[] = [];
  private colorListeners: ((colorKey: string) => void)[] = [];
  private moveListeners: (() => void)[] = [];

  constructor() {
    const rowWidth = (n: number) => n * BUTTON_SIZE_METERS + (n - 1) * BUTTON_SPACING_METERS;
    const shapeRowWidth = rowWidth(SPECIES.length);
    const colorRowWidth = rowWidth(REEF_PALETTE.length);
    const totalWidth = Math.max(shapeRowWidth, colorRowWidth);
    const totalHeight = 2 * BUTTON_SIZE_METERS + ROW_SPACING_METERS;
    const backing = new Mesh(
      new PlaneGeometry(totalWidth + 0.01, totalHeight + 0.01),
      backingMaterial,
    );
    this.object3d.add(backing);

    const shapeY = (BUTTON_SIZE_METERS + ROW_SPACING_METERS) / 2;
    const colorY = -(BUTTON_SIZE_METERS + ROW_SPACING_METERS) / 2;

    const shapeStart = -shapeRowWidth / 2 + BUTTON_SIZE_METERS / 2;
    SPECIES.forEach((species, i) => {
      const btn = new Mesh(
        new PlaneGeometry(BUTTON_SIZE_METERS, BUTTON_SIZE_METERS),
        i === 0 ? selectedMaterial : idleMaterial,
      );
      btn.position.set(shapeStart + i * (BUTTON_SIZE_METERS + BUTTON_SPACING_METERS), shapeY, 0.001);
      btn.userData.shapeIndex = i;
      btn.userData.species = species;
      this.shapeButtons.push(btn);
      this.object3d.add(btn);
    });

    const colorStart = -colorRowWidth / 2 + BUTTON_SIZE_METERS / 2;
    REEF_PALETTE.forEach((entry, i) => {
      const swatchMat = new MeshBasicMaterial({ color: entry.hex });
      const btn = new Mesh(new PlaneGeometry(BUTTON_SIZE_METERS, BUTTON_SIZE_METERS), swatchMat);
      btn.position.set(colorStart + i * (BUTTON_SIZE_METERS + BUTTON_SPACING_METERS), colorY, 0.001);
      btn.userData.colorIndex = i;
      btn.userData.colorKey = entry.key;
      // The first color is selected by default → scaled up so the user
      // can see which swatch is "live" without needing a separate
      // indicator mesh. Swatch material carries the color itself so
      // material-swap (used for shape buttons) isn't an option.
      if (i === 0) btn.scale.setScalar(1.3);
      this.colorButtons.push(btn);
      this.object3d.add(btn);
    });

    // Move-reef button sits to the right of the rows; same height as the
    // backing, slightly wider so it reads as a distinct action.
    const moveBtn = new Mesh(
      new PlaneGeometry(BUTTON_SIZE_METERS * 1.4, BUTTON_SIZE_METERS),
      moveButtonMaterial,
    );
    moveBtn.position.set(totalWidth / 2 + BUTTON_SIZE_METERS, 0, 0.001);
    moveBtn.userData.action = 'move';
    this.object3d.add(moveBtn);
  }

  get selectedSpecies(): Species {
    return SPECIES[this._selectedShapeIndex]!;
  }

  get selectedColorKey(): string {
    return REEF_PALETTE[this._selectedColorIndex]!.key;
  }

  poke(target: Object3D): void {
    const shapeIdx = target.userData.shapeIndex;
    if (typeof shapeIdx === 'number' && shapeIdx !== this._selectedShapeIndex) {
      this.shapeButtons[this._selectedShapeIndex]!.material = idleMaterial;
      this.shapeButtons[shapeIdx]!.material = selectedMaterial;
      this._selectedShapeIndex = shapeIdx;
      for (const cb of this.shapeListeners) cb(SPECIES[shapeIdx]!);
      return;
    }
    const colorIdx = target.userData.colorIndex;
    if (typeof colorIdx === 'number' && colorIdx !== this._selectedColorIndex) {
      this.colorButtons[this._selectedColorIndex]!.scale.setScalar(1);
      this.colorButtons[colorIdx]!.scale.setScalar(1.3);
      this._selectedColorIndex = colorIdx;
      for (const cb of this.colorListeners) cb(REEF_PALETTE[colorIdx]!.key);
      return;
    }
    if (target.userData.action === 'move') {
      for (const cb of this.moveListeners) cb();
    }
  }

  onShapeSelect(cb: (species: Species) => void): void {
    this.shapeListeners.push(cb);
  }

  onColorSelect(cb: (colorKey: string) => void): void {
    this.colorListeners.push(cb);
  }

  onMoveReef(cb: () => void): void {
    this.moveListeners.push(cb);
  }

  updatePose(wristPosition: Vector3, faceCamera: Vector3): void {
    this.object3d.position.copy(wristPosition);
    this.object3d.lookAt(faceCamera);
  }
}
