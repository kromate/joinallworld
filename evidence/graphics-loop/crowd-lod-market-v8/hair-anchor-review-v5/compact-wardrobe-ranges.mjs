/** Build exact item ranges for a concatenated compact wardrobe index/vertex stream. */
export function compactWardrobeRanges(maps) {
  const ranges = {};
  let vertexStart = 0;
  let indexStart = 0;
  for (const map of maps) {
    if (!map || typeof map.id !== 'string' || !map.id || Object.hasOwn(ranges, map.id)) {
      throw new Error('Compact wardrobe item IDs must be unique nonempty strings');
    }
    if (!Array.isArray(map.sourceVertex) || !Array.isArray(map.index)
      || map.sourceVertex.some((value) => !Number.isInteger(value) || value < 0)
      || map.index.some((value) => !Number.isInteger(value) || value < 0)) {
      throw new Error(`Invalid compact wardrobe map: ${map.id}`);
    }
    if (!map.index.length) continue;
    if (map.index.length % 3 || map.index.some((value) => value >= map.sourceVertex.length)) {
      throw new Error(`Invalid compact wardrobe triangle indices: ${map.id}`);
    }
    ranges[map.id] = {
      vertexStart,
      vertexCount: map.sourceVertex.length,
      indexStart,
      indexCount: map.index.length,
    };
    vertexStart += map.sourceVertex.length;
    indexStart += map.index.length;
  }
  return { ranges, vertexCount: vertexStart, indexCount: indexStart };
}
