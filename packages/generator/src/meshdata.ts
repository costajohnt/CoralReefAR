/**
 * Framework-agnostic mesh data. The generator emits this; the client adapts
 * it into a Three.js BufferGeometry. Keeps the generator importable from the
 * server (where Three isn't available) for seed-reef baking.
 */
export interface MeshData {
  positions: Float32Array;   // xyz triplets
  normals: Float32Array;     // xyz triplets
  colors: Float32Array;      // rgb triplets
  indices: Uint32Array;
}

export function emptyMesh(): MeshData {
  return {
    positions: new Float32Array(0),
    normals: new Float32Array(0),
    colors: new Float32Array(0),
    indices: new Uint32Array(0),
  };
}

export function mergeMeshes(meshes: MeshData[]): MeshData {
  const posLen = meshes.reduce((n, m) => n + m.positions.length, 0);
  const idxLen = meshes.reduce((n, m) => n + m.indices.length, 0);
  const out: MeshData = {
    positions: new Float32Array(posLen),
    normals: new Float32Array(posLen),
    colors: new Float32Array(posLen),
    indices: new Uint32Array(idxLen),
  };
  let posCursor = 0;
  let idxCursor = 0;
  let vertexOffset = 0;
  for (const m of meshes) {
    out.positions.set(m.positions, posCursor);
    out.normals.set(m.normals, posCursor);
    out.colors.set(m.colors, posCursor);
    posCursor += m.positions.length;
    for (let i = 0; i < m.indices.length; i++) {
      out.indices[idxCursor + i] = m.indices[i]! + vertexOffset;
    }
    idxCursor += m.indices.length;
    vertexOffset += m.positions.length / 3;
  }
  return out;
}
