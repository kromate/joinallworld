import type * as THREE from 'three';

export interface NeckSkinSemanticReport {
  readonly candidateVertexIds: readonly number[];
  readonly changedVertexIds: readonly number[];
  readonly changedVertices: number;
  readonly visibleCandidateVertices: number;
  readonly excludedNotVisible: number;
  readonly excludedWrongRegion: number;
  readonly exposedNeckSeedVertices: number;
  readonly candidateYMetres: readonly [number, number] | null;
  readonly colorBytesBeforeSha256: string;
  readonly colorBytesAfterSha256: string;
  readonly unchangedGeometryBytesSha256: string;
  readonly changedColorByteCount: number;
  readonly colorAttributeStorageBytes: number;
  readonly complementColorBeforeSha256: string | null;
  readonly complementColorAfterSha256: string | null;
  readonly complementColorChangedVertices: number;
  readonly complementColorMaxBarycentricError: number | null;
  readonly complementGeometryBytesUnchangedSha256: string | null;
  readonly attributeLayoutUnchanged: true;
  readonly unrelatedColorBytesUnchanged: true;
  readonly operation: 'move-top-channel-to-skin-channel-on-visible-spine03-neck-one-ring';
}

type Attr = THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
type Hash = (bytes: Uint8Array) => Promise<string>;

function dominantBoneNames(mesh: THREE.SkinnedMesh, skinIndex: Attr, skinWeight: Attr): string[] {
  const result = new Array<string>(skinIndex.count);
  for (let vertex = 0; vertex < skinIndex.count; vertex++) {
    let bestName = '', bestWeight = -1;
    const totals = new Map<string, number>();
    for (let component = 0; component < Math.min(4, skinIndex.itemSize, skinWeight.itemSize); component++) {
      const index = skinIndex.getComponent(vertex, component), weight = skinWeight.getComponent(vertex, component);
      const name = mesh.skeleton.bones[index]?.name;
      if (name && Number.isFinite(weight) && weight > 0) totals.set(name, (totals.get(name) ?? 0) + weight);
    }
    for (const [name, weight] of totals) if (weight > bestWeight) { bestName = name; bestWeight = weight; }
    result[vertex] = bestName;
  }
  return result;
}

async function unchangedGeometryHash(geometry: THREE.BufferGeometry, sha256: Hash): Promise<string> {
  const parts: Uint8Array[] = [];
  for (const name of ['position', 'normal', 'skinIndex', 'skinWeight']) {
    const attribute = geometry.getAttribute(name) as Attr | undefined;
    if (!attribute) throw new Error(`Missing ${name} for geometry immutability witness`);
    const array = attribute.array as unknown as ArrayBufferView;
    parts.push(new TextEncoder().encode(name), new Uint8Array(array.buffer, array.byteOffset, array.byteLength));
  }
  if (!geometry.index) throw new Error('Missing source index for geometry immutability witness');
  const index = geometry.index.array as unknown as ArrayBufferView;
  parts.push(new TextEncoder().encode('index'), new Uint8Array(index.buffer, index.byteOffset, index.byteLength));
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0), merged = new Uint8Array(length);
  let offset = 0; for (const part of parts) { merged.set(part, offset); offset += part.byteLength; }
  return sha256(merged);
}

/**
 * Reclassify only the visible source-top ring immediately adjacent to the authored neck bone.
 * The rule is topological (one source-triangle ring), semantic (spine_03 next to neck_01), and
 * constrained by the actual production body index. It cannot recolor the shirt shell or any
 * vertex outside the displayed base mesh.
 */
export async function reclassifyExposedNeckRing(
  displayedBody: THREE.SkinnedMesh,
  fullSource: THREE.SkinnedMesh,
  restPoints: readonly THREE.Vector3[],
  sha256: Hash,
  complement?: { readonly geometry: THREE.BufferGeometry; readonly sourceFaceIds: readonly number[]; readonly sourceBindings: readonly { readonly vertices: readonly [number, number, number]; readonly barycentric: readonly [number, number, number] }[] },
): Promise<NeckSkinSemanticReport> {
  const displayedGeometry = displayedBody.geometry, sourceGeometry = fullSource.geometry;
  const visibleIndex = displayedGeometry.index, sourceIndex = sourceGeometry.index;
  const visibleColor = displayedGeometry.getAttribute('color') as Attr | undefined;
  const sourceColor = sourceGeometry.getAttribute('color') as Attr | undefined;
  const sourceSkinIndex = sourceGeometry.getAttribute('skinIndex') as Attr | undefined;
  const sourceSkinWeight = sourceGeometry.getAttribute('skinWeight') as Attr | undefined;
  const position = sourceGeometry.getAttribute('position') as Attr | undefined;
  if (!visibleIndex || !sourceIndex || !visibleColor || !sourceColor || !sourceSkinIndex || !sourceSkinWeight || !position || visibleColor.itemSize < 4 || sourceColor.itemSize < 4) throw new Error('Neck semantic pass requires indexed displayed/full source position, vec4 color, and skin attributes');
  const visibleCount = displayedGeometry.drawRange.count === Infinity ? visibleIndex.count : displayedGeometry.drawRange.count;
  if (displayedGeometry.drawRange.start !== 0 || !Number.isInteger(visibleCount) || visibleCount < 0 || visibleCount > visibleIndex.count || visibleCount % 3 !== 0 || visibleColor.count !== position.count || sourceColor.count !== position.count) throw new Error('Neck semantic pass received incompatible displayed/source topology');
  for (const name of ['color', 'skinIndex', 'skinWeight', 'position']) {
    const displayed = displayedGeometry.getAttribute(name) as Attr | undefined, source = sourceGeometry.getAttribute(name) as Attr | undefined;
    if (!displayed || !source || displayed.count !== source.count || displayed.itemSize !== source.itemSize) throw new Error(`Displayed/source ${name} layout differs`);
  }

  const visibleVertices = new Set<number>();
  for (let at = 0; at < visibleCount; at++) visibleVertices.add(visibleIndex.getX(at));
  const dominant = dominantBoneNames(fullSource, sourceSkinIndex, sourceSkinWeight);
  const neckSeeds = new Set<number>();
  for (let vertex = 0; vertex < dominant.length; vertex++) if (dominant[vertex] === 'neck_01') neckSeeds.add(vertex);
  if (neckSeeds.size === 0) throw new Error('No neck_01 source vertices found for exposed-skin classification');

  const adjacentSpine03 = new Set<number>();
  const complementFaces = new Set(complement?.sourceFaceIds ?? []);
  const complementSupportVertices = new Set<number>();
  for (let at = 0; at < sourceIndex.count; at += 3) {
    const ids = [sourceIndex.getX(at), sourceIndex.getX(at + 1), sourceIndex.getX(at + 2)];
    const face = at / 3;
    if (complementFaces.has(face)) for (const id of ids) complementSupportVertices.add(id);
    const hasNeck = ids.some(id => neckSeeds.has(id));
    if (!hasNeck || !ids.every(id => dominant[id] === 'neck_01' || dominant[id] === 'spine_03' || dominant[id] === 'spine_02')) continue;
    if (!ids.some(id => visibleVertices.has(id) || complementFaces.has(face))) continue;
    for (const id of ids) if (dominant[id] === 'spine_03' && (visibleVertices.has(id) || complementSupportVertices.has(id) || complementFaces.has(face))) adjacentSpine03.add(id);
  }
  const candidateVertexIds = [...adjacentSpine03].sort((a, b) => a - b);
  const visibleCandidates = candidateVertexIds.filter(vertex => visibleVertices.has(vertex));
  const changedVertexIds: number[] = [];
  const originalSkinChannels = new Map<number, readonly [number, number]>();
  const original = new Uint8Array((visibleColor.array as ArrayBufferView).buffer, (visibleColor.array as ArrayBufferView).byteOffset, (visibleColor.array as ArrayBufferView).byteLength).slice();
  const sourceOriginal = new Uint8Array((sourceColor.array as ArrayBufferView).buffer, (sourceColor.array as ArrayBufferView).byteOffset, (sourceColor.array as ArrayBufferView).byteLength).slice();
  if (visibleColor.array.constructor !== sourceColor.array.constructor || visibleColor.itemSize !== sourceColor.itemSize || visibleColor.normalized !== sourceColor.normalized || original.length !== sourceOriginal.length || original.some((byte, index) => byte !== sourceOriginal[index])) throw new Error('Displayed/full source COLOR_0 differs before semantic patch');
  const geometryHashBefore = await unchangedGeometryHash(displayedGeometry, sha256);

  let minY = Infinity, maxY = -Infinity, excludedWrongRegion = 0;
  for (const vertex of candidateVertexIds) {
    const r = sourceColor.getX(vertex), g = sourceColor.getY(vertex);
    if (!visibleVertices.has(vertex)) continue;
    // Keep existing mixed skin pixels and every non-top region untouched. Only transfer an
    // existing top contribution when it is the dominant region on the one-ring source boundary.
    if (!(g > r && g >= 0.25) || sourceColor.itemSize < 4 || sourceColor.getW(vertex) > 0.2) { excludedWrongRegion++; continue; }
    const x = sourceColor.getX(vertex) + sourceColor.getY(vertex);
    if (!Number.isFinite(x) || x > 1 + 1e-6) throw new Error(`Neck semantic transfer would overflow COLOR_0 at vertex ${vertex}`);
    originalSkinChannels.set(vertex, [r, g]);
    visibleColor.setXY(vertex, x, 0);
    sourceColor.setXY(vertex, x, 0);
    changedVertexIds.push(vertex);
    const y = restPoints[vertex]?.y;
    if (!Number.isFinite(y)) throw new Error(`Missing metre-space rest point for neck semantic vertex ${vertex}`);
    minY = Math.min(minY, y!); maxY = Math.max(maxY, y!);
  }
  if (changedVertexIds.length === 0) throw new Error('No visible top-colored spine_03 neck-adjacent vertices qualified');
  visibleColor.needsUpdate = true; sourceColor.needsUpdate = true;
  const after = new Uint8Array((visibleColor.array as ArrayBufferView).buffer, (visibleColor.array as ArrayBufferView).byteOffset, (visibleColor.array as ArrayBufferView).byteLength);
  const sourceAfter = new Uint8Array((sourceColor.array as ArrayBufferView).buffer, (sourceColor.array as ArrayBufferView).byteOffset, (sourceColor.array as ArrayBufferView).byteLength);
  const changedByteSet = new Set<number>();
  for (let i = 0; i < original.length; i++) if (original[i] !== after[i]) changedByteSet.add(i);
  const expectedByteSet = new Set<number>();
  const bytesPerComponent = (sourceColor.array as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT;
  if (!Number.isInteger(bytesPerComponent) || bytesPerComponent < 1) throw new Error('Unsupported COLOR_0 typed-array component width');
  for (const vertex of changedVertexIds) for (const channel of [0, 1]) for (let byte = 0; byte < bytesPerComponent; byte++) expectedByteSet.add((vertex * visibleColor.itemSize + channel) * bytesPerComponent + byte);
  if (changedByteSet.size === 0 || [...changedByteSet].some(byte => !expectedByteSet.has(byte)) || sourceAfter.some((byte, index) => byte !== after[index])) throw new Error('Neck semantic patch changed COLOR_0 outside selected red/green channels or changed no color bytes');
  for (const vertex of changedVertexIds) {
    const [oldSkin, oldTop] = originalSkinChannels.get(vertex)!;
    const tolerance = sourceColor.normalized ? 1 / 255 : 1e-6;
    if (Math.abs(sourceColor.getX(vertex) - oldSkin - oldTop) > tolerance || Math.abs(sourceColor.getY(vertex)) > tolerance) throw new Error(`Neck semantic transfer did not conserve red+green and clear the top channel at vertex ${vertex}`);
  }
  const layoutUnchanged = visibleColor.itemSize === sourceColor.itemSize && visibleColor.count === sourceColor.count && visibleColor.normalized === sourceColor.normalized && visibleColor.array.constructor === sourceColor.array.constructor;
  if (!layoutUnchanged) throw new Error('Neck semantic patch changed COLOR_0 storage layout');
  const geometryHashAfter = await unchangedGeometryHash(displayedGeometry, sha256);
  if (geometryHashAfter !== geometryHashBefore) throw new Error('Neck semantic patch changed positions, normals, skin fields, or topology');
  let complementColorBeforeSha256: string | null = null, complementColorAfterSha256: string | null = null, complementColorChangedVertices = 0, complementColorMaxBarycentricError: number | null = null, complementGeometryBytesUnchangedSha256: string | null = null;
  if (complement) {
    const targetColor = complement.geometry.getAttribute('color') as Attr | undefined;
    if (!targetColor || complement.sourceBindings.length !== targetColor.count) throw new Error('Complement lacks one source binding per color vertex');
    const targetArray = targetColor.array as unknown as ArrayBufferView;
    const targetBefore = new Uint8Array(targetArray.buffer, targetArray.byteOffset, targetArray.byteLength).slice();
    complementColorBeforeSha256 = await sha256(targetBefore);
    complementGeometryBytesUnchangedSha256 = await unchangedGeometryHash(complement.geometry, sha256);
    const tolerance = targetColor.normalized ? 2 / (((targetColor.array as unknown as { BYTES_PER_ELEMENT: number }).BYTES_PER_ELEMENT === 1) ? 255 : 65535) : 2e-6;
    let maxError = 0;
    for (let vertex = 0; vertex < complement.sourceBindings.length; vertex++) {
      const binding = complement.sourceBindings[vertex]!;
      let changed = false;
      for (let channel = 0; channel < targetColor.itemSize; channel++) {
        let expected = 0;
        for (let corner = 0; corner < 3; corner++) expected += sourceColor.getComponent(binding.vertices[corner]!, channel) * binding.barycentric[corner]!;
        const prior = targetColor.getComponent(vertex, channel);
        if (Math.abs(prior - expected) > tolerance) targetColor.setComponent(vertex, channel, expected);
        if (Math.abs(prior - expected) > tolerance) changed = true;
        const error = Math.abs(targetColor.getComponent(vertex, channel) - expected);
        maxError = Math.max(maxError, error);
      }
      if (changed) complementColorChangedVertices++;
    }
    targetColor.needsUpdate = true;
    const targetAfter = new Uint8Array((targetColor.array as unknown as ArrayBufferView).buffer, (targetColor.array as unknown as ArrayBufferView).byteOffset, (targetColor.array as unknown as ArrayBufferView).byteLength);
    complementColorAfterSha256 = await sha256(targetAfter.slice()); complementColorMaxBarycentricError = maxError;
    if (maxError > tolerance || complementColorAfterSha256 === complementColorBeforeSha256 || await unchangedGeometryHash(complement.geometry, sha256) !== complementGeometryBytesUnchangedSha256) throw new Error(`Complement skin semantics failed barycentric/geometry guard: ${JSON.stringify({ maxError, tolerance, changedVertices: complementColorChangedVertices })}`);
  }
  return {
    candidateVertexIds, changedVertexIds, changedVertices: changedVertexIds.length,
    visibleCandidateVertices: visibleCandidates.length, excludedNotVisible: candidateVertexIds.length - visibleCandidates.length,
    excludedWrongRegion, exposedNeckSeedVertices: neckSeeds.size,
    candidateYMetres: Number.isFinite(minY) ? [minY, maxY] : null,
    colorBytesBeforeSha256: await sha256(original), colorBytesAfterSha256: await sha256(after.slice()),
    unchangedGeometryBytesSha256: geometryHashBefore, changedColorByteCount: changedByteSet.size,
    colorAttributeStorageBytes: after.byteLength,
    complementColorBeforeSha256, complementColorAfterSha256, complementColorChangedVertices,
    complementColorMaxBarycentricError, complementGeometryBytesUnchangedSha256,
    attributeLayoutUnchanged: true, unrelatedColorBytesUnchanged: true,
    operation: 'move-top-channel-to-skin-channel-on-visible-spine03-neck-one-ring',
  };
}
