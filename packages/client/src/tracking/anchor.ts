import { Group, Matrix4, Quaternion, Vector3 } from 'three';

export function applyAnchorPose(
  anchor: Group,
  poseMatrixElements: ArrayLike<number>,
  scaleMultiplier = 1,
): void {
  if (poseMatrixElements.length !== 16) return;
  const m = new Matrix4();
  const te = m.elements;
  for (let i = 0; i < 16; i++) te[i] = poseMatrixElements[i] ?? 0;
  const pos = new Vector3();
  const quat = new Quaternion();
  const scl = new Vector3();
  m.decompose(pos, quat, scl);
  anchor.position.copy(pos);
  anchor.quaternion.copy(quat);
  anchor.scale.copy(scl.multiplyScalar(scaleMultiplier));
  anchor.matrix.copy(m);
}
