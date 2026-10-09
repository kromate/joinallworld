/** Preserve a single authored wardrobe item's exact indexed triangles and local vertex attributes in a gathered compact mesh. */
export function exactHairItemMap(index, vertexStart, vertexCount) {
  if (!index || typeof index.length !== 'number' || index.length === 0 || index.length % 3 !== 0
    || !Number.isInteger(vertexStart) || vertexStart < 0 || !Number.isInteger(vertexCount) || vertexCount < 1) {
    throw new Error('Hair identity map requires a nonempty triangle index range and valid item vertex range');
  }
  const end = vertexStart + vertexCount;
  const localIndex = Array.from(index, value => {
    if (!Number.isInteger(value) || value < vertexStart || value >= end) throw new Error(`Hair index ${value} escapes authored item range`);
    return value - vertexStart;
  });
  const sourceVertex = Array.from({ length: vertexCount }, (_, i) => vertexStart + i);
  const triangles = localIndex.length / 3;
  return {
    index: localIndex,
    sourceVertex,
    metrics: {
      sourceTriangles: triangles, outputTriangles: triangles,
      sourceVertices: vertexCount, outputVertices: vertexCount,
      exactHairIdentity: true, simplifierInvoked: false,
    },
  };
}
