/** Identify exact scalp-marker vertices and every indexed triangle touching one. */
export function scalpMarkerPartition(alpha, indices, threshold = 0.5) {
  if (!alpha || !Number.isInteger(alpha.length) || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('Invalid scalp-marker alpha input');
  }
  if (!indices || indices.length % 3 !== 0) throw new Error('Scalp-marker partition requires triangle indices');
  const vertices = [];
  const marked = new Uint8Array(alpha.length);
  for (let vertex = 0; vertex < alpha.length; vertex++) {
    const value = Number(alpha[vertex]);
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Invalid alpha at vertex ${vertex}`);
    if (value > threshold) { marked[vertex] = 1; vertices.push(vertex); }
  }
  const triangleFlags = new Uint8Array(indices.length / 3);
  for (let offset = 0; offset < indices.length; offset += 3) {
    const a = Number(indices[offset]), b = Number(indices[offset + 1]), c = Number(indices[offset + 2]);
    if (![a, b, c].every((index) => Number.isInteger(index) && index >= 0 && index < alpha.length)) {
      throw new Error(`Invalid triangle index at offset ${offset}`);
    }
    triangleFlags[offset / 3] = marked[a] || marked[b] || marked[c] ? 1 : 0;
  }
  return { vertices, triangleFlags };
}
