import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MeshoptSimplifier } from 'meshoptimizer';

// Standalone, source-index-preserving reduction for the two authored facial
// surfaces. Eyes and all other meshes/materials are carried through unchanged.
const here = path.dirname(fileURLToPath(import.meta.url));
const generated = path.resolve(process.argv[2] ?? path.join(here, 'generated'));
const inputPath = path.join(generated, 'expressive-head.glb');
const outputPath = path.join(generated, 'expressive-head-lod.glb');
const reportPath = path.join(generated, 'expressive-head-lod.report.json');
const targetsByMaterial = new Map([
  ['VitSkin', { triangles: 8000 }],
  ['VitMouth', { triangles: 2000 }],
]);
const maxRelativeError = 0.005;
const morphPositionWeight = 4;
const baseNormalWeight = 1;
const uvWeight = 1;
MeshoptSimplifier.useExperimentalFeatures = true;
await MeshoptSimplifier.ready;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseGlb(bytes) {
  invariant(bytes.readUInt32LE(0) === 0x46546c67, 'Input is not a GLB');
  invariant(bytes.readUInt32LE(4) === 2, 'Only GLB version 2 is supported');
  invariant(bytes.readUInt32LE(8) === bytes.length, 'GLB declared length mismatch');
  let cursor = 12;
  let json = null;
  let binary = null;
  while (cursor < bytes.length) {
    const length = bytes.readUInt32LE(cursor);
    const type = bytes.readUInt32LE(cursor + 4);
    const chunk = bytes.subarray(cursor + 8, cursor + 8 + length);
    invariant(cursor + 8 + length <= bytes.length, 'GLB chunk exceeds file length');
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8').trimEnd());
    else if (type === 0x004e4942) binary = chunk;
    cursor += 8 + length;
  }
  invariant(json && binary, 'GLB must contain JSON and BIN chunks');
  invariant(json.buffers?.length === 1 && (json.buffers[0].uri === undefined), 'Expected one embedded buffer');
  invariant(!json.extensionsRequired?.includes('EXT_meshopt_compression'), 'Compressed source GLB is unsupported');
  return { json, binary };
}

const COMPONENT_BYTES = new Map([[5121, 1], [5123, 2], [5125, 4], [5126, 4]]);
const TYPE_COMPONENTS = new Map([['SCALAR', 1], ['VEC2', 2], ['VEC3', 3], ['VEC4', 4], ['MAT4', 16]]);

function accessorView(json, bin, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  invariant(accessor && (Number.isInteger(accessor.bufferView) || accessor.bufferView === undefined || accessor.sparse),
    `Unsupported accessor ${accessorIndex}: ${JSON.stringify(accessor)}`);
  const componentBytes = COMPONENT_BYTES.get(accessor.componentType);
  const components = TYPE_COMPONENTS.get(accessor.type);
  invariant(componentBytes && components, `Unsupported accessor type at ${accessorIndex}`);
  const elementBytes = componentBytes * components;
  let stride = elementBytes;
  let start = 0;
  if (Number.isInteger(accessor.bufferView)) {
    const view = json.bufferViews[accessor.bufferView];
    invariant(view && view.buffer === 0, `Accessor ${accessorIndex} must use buffer 0`);
    stride = view.byteStride ?? elementBytes;
    invariant(stride >= elementBytes && stride % componentBytes === 0, `Invalid byte stride for accessor ${accessorIndex}`);
    const viewStart = view.byteOffset ?? 0;
    start = viewStart + (accessor.byteOffset ?? 0);
    const end = accessor.count === 0 ? start : start + (accessor.count - 1) * stride + elementBytes;
    invariant(end <= viewStart + view.byteLength && end <= bin.length, `Accessor ${accessorIndex} exceeds its bufferView`);
  } else {
    invariant(accessor.byteOffset === undefined, `Sparse-only accessor ${accessorIndex} cannot have byteOffset`);
  }
  if (accessor.sparse) {
    invariant(accessor.sparse.count <= accessor.count, `Sparse accessor ${accessorIndex} has too many entries`);
    for (const part of [accessor.sparse.indices, accessor.sparse.values]) {
      const view = json.bufferViews[part.bufferView];
      invariant(view && view.buffer === 0, `Sparse accessor ${accessorIndex} must use buffer 0`);
    }
    const sparseIndices = readSparseIndices(json, bin, {
      bufferView: accessor.sparse.indices.bufferView,
      byteOffset: accessor.sparse.indices.byteOffset,
      componentType: accessor.sparse.indices.componentType,
      count: accessor.sparse.count,
      type: 'SCALAR',
    });
    let previous = -1;
    for (const sparseIndex of sparseIndices) {
      invariant(sparseIndex < accessor.count && sparseIndex > previous,
        `Sparse indices for accessor ${accessorIndex} must be in-range and strictly increasing`);
      previous = sparseIndex;
    }
    const valuesView = json.bufferViews[accessor.sparse.values.bufferView];
    const valuesStart = (valuesView.byteOffset ?? 0) + (accessor.sparse.values.byteOffset ?? 0);
    invariant(valuesStart + accessor.sparse.count * elementBytes <= (valuesView.byteOffset ?? 0) + valuesView.byteLength,
      `Sparse values for accessor ${accessorIndex} exceed their bufferView`);
  }
  return { accessor, componentBytes, components, elementBytes, stride, start };
}

function readFloatAccessor(json, bin, accessorIndex, expectedComponents) {
  const info = accessorView(json, bin, accessorIndex);
  invariant(info.accessor.componentType === 5126, `Accessor ${accessorIndex} is not FLOAT`);
  invariant(info.components === expectedComponents, `Accessor ${accessorIndex} has unexpected component count`);
  const result = new Float32Array(info.accessor.count * info.components);
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  if (Number.isInteger(info.accessor.bufferView)) {
    for (let vertex = 0; vertex < info.accessor.count; vertex++) {
      for (let component = 0; component < info.components; component++) {
        const at = info.start + vertex * info.stride + component * 4;
        result[vertex * info.components + component] = data.getFloat32(at, true);
      }
    }
  }
  if (info.accessor.sparse) {
    const sparse = info.accessor.sparse;
    const indexAccessor = {
      bufferView: sparse.indices.bufferView,
      componentType: sparse.indices.componentType,
      count: sparse.count,
      type: 'SCALAR',
    };
    const indices = readSparseIndices(json, bin, indexAccessor);
    const sparseView = json.bufferViews[sparse.values.bufferView];
    const sparseStart = (sparseView.byteOffset ?? 0) + (sparse.values.byteOffset ?? 0);
    const sparseBytes = info.elementBytes;
    invariant(sparseStart + sparse.count * sparseBytes <= (sparseView.byteOffset ?? 0) + sparseView.byteLength,
      `Sparse values exceed accessor ${accessorIndex} bufferView`);
    for (let entry = 0; entry < sparse.count; entry++) {
      const vertex = indices[entry];
      invariant(vertex < info.accessor.count, `Sparse index ${vertex} exceeds accessor ${accessorIndex}`);
      for (let component = 0; component < info.components; component++) {
        const at = sparseStart + entry * sparseBytes + component * 4;
        result[vertex * info.components + component] = data.getFloat32(at, true);
      }
    }
  }
  return result;
}

function readSparseIndices(json, bin, accessor) {
  const view = json.bufferViews[accessor.bufferView];
  const componentBytes = COMPONENT_BYTES.get(accessor.componentType);
  invariant(view && componentBytes && [5121, 5123, 5125].includes(accessor.componentType), 'Invalid sparse index encoding');
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  invariant(start + accessor.count * componentBytes <= (view.byteOffset ?? 0) + view.byteLength, 'Sparse indices exceed bufferView');
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const indices = new Uint32Array(accessor.count);
  for (let i = 0; i < accessor.count; i++) {
    const at = start + i * componentBytes;
    indices[i] = accessor.componentType === 5121 ? data.getUint8(at)
      : accessor.componentType === 5123 ? data.getUint16(at, true)
        : data.getUint32(at, true);
  }
  return indices;
}

function storedAccessorPayloadBytes(json, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const componentBytes = COMPONENT_BYTES.get(accessor.componentType);
  const components = TYPE_COMPONENTS.get(accessor.type);
  invariant(componentBytes && components, `Unsupported storage size for accessor ${accessorIndex}`);
  let bytes = Number.isInteger(accessor.bufferView) ? accessor.count * componentBytes * components : 0;
  if (accessor.sparse) {
    bytes += accessor.sparse.count * COMPONENT_BYTES.get(accessor.sparse.indices.componentType);
    bytes += accessor.sparse.count * componentBytes * components;
  }
  return bytes;
}

function readIndices(json, bin, accessorIndex) {
  const info = accessorView(json, bin, accessorIndex);
  invariant(info.accessor.type === 'SCALAR', 'Index accessor must be SCALAR');
  invariant(info.accessor.componentType === 5121 || info.accessor.componentType === 5123 || info.accessor.componentType === 5125,
    'Index accessor must use an unsigned integer component type');
  const result = new Uint32Array(info.accessor.count);
  const data = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  for (let i = 0; i < result.length; i++) {
    const at = info.start + i * info.stride;
    result[i] = info.accessor.componentType === 5121 ? data.getUint8(at)
      : info.accessor.componentType === 5123 ? data.getUint16(at, true)
        : data.getUint32(at, true);
  }
  return result;
}

function edgeLocks(indices, vertexCount) {
  const edges = new Map();
  for (let i = 0; i < indices.length; i += 3) {
    const triangle = [indices[i], indices[i + 1], indices[i + 2]];
    for (let e = 0; e < 3; e++) {
      const a = triangle[e];
      const b = triangle[(e + 1) % 3];
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      const key = `${lo}:${hi}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  const lock = new Uint8Array(vertexCount);
  let boundaryEdges = 0;
  for (const [key, count] of edges) {
    if (count !== 1) continue;
    boundaryEdges++;
    const [a, b] = key.split(':').map(Number);
    lock[a] = 1;
    lock[b] = 1;
  }
  invariant(boundaryEdges > 0, 'Expected open boundary edges, including the neck boundary');
  return { lock, boundaryEdges, lockedVertices: lock.reduce((sum, value) => sum + value, 0) };
}

function compactIndices(indices, sourceVertexCount) {
  const sourceToCompact = new Int32Array(sourceVertexCount);
  sourceToCompact.fill(-1);
  const compactToSource = [];
  const compact = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const source = indices[i];
    invariant(Number.isInteger(source) && source >= 0 && source < sourceVertexCount, `Output index ${source} is invalid`);
    let mapped = sourceToCompact[source];
    if (mapped < 0) {
      mapped = compactToSource.length;
      sourceToCompact[source] = mapped;
      compactToSource.push(source);
    }
    compact[i] = mapped;
  }
  const remap = Uint32Array.from(compactToSource);
  const typedIndices = remap.length <= 65535 ? Uint16Array.from(compact) : compact;
  return { indices: typedIndices, remap, sourceToCompact };
}

function gather(source, components, remap) {
  const result = new Float32Array(remap.length * components);
  for (let dst = 0; dst < remap.length; dst++) {
    const src = remap[dst];
    for (let component = 0; component < components; component++) {
      result[dst * components + component] = source[src * components + component];
    }
  }
  return result;
}

function minMax(values, components) {
  const min = Array(components).fill(Infinity);
  const max = Array(components).fill(-Infinity);
  for (let i = 0; i < values.length; i++) {
    const component = i % components;
    min[component] = Math.min(min[component], values[i]);
    max[component] = Math.max(max[component], values[i]);
  }
  return { min, max };
}

function triangleCount(indices) {
  invariant(indices.length % 3 === 0, 'Triangle index count is not divisible by three');
  return indices.length / 3;
}

const inputBytes = readFileSync(inputPath);
const { json, binary } = parseGlb(inputBytes);
const mesh = json.meshes?.find((candidate) => candidate.name === 'cm_vitruvian');
invariant(mesh && Array.isArray(mesh.primitives), 'Could not locate cm_vitruvian mesh');
const morphNames = mesh.extras?.targetNames;
invariant(Array.isArray(morphNames) && morphNames.length === 6,
  'Expected the six authored face targets from the pinned source');
invariant(!json.skins?.length && !json.animations?.length, 'Expected static head geometry without skins or clips');

const replacements = [];
for (const [materialName, settings] of targetsByMaterial) {
  const primitive = mesh.primitives.find((candidate) => json.materials?.[candidate.material]?.name === materialName);
  invariant(primitive, `Missing authored facial primitive using ${materialName}`);
  invariant(primitive.mode === undefined || primitive.mode === 4, `${materialName} must be triangle geometry`);
  const indices = readIndices(json, binary, primitive.indices);
  const sourceAccessorIds = [
    ...Object.values(primitive.attributes),
    primitive.indices,
    ...primitive.targets.flatMap((target) => Object.values(target)),
  ];
  const sourceStoredAccessorPayloadBytes = sourceAccessorIds.reduce((sum, id) => sum + storedAccessorPayloadBytes(json, id), 0);
  const sourcePositions = readFloatAccessor(json, binary, primitive.attributes.POSITION, 3);
  const sourceNormals = readFloatAccessor(json, binary, primitive.attributes.NORMAL, 3);
  const sourceUv = readFloatAccessor(json, binary, primitive.attributes.TEXCOORD_0, 2);
  const vertexCount = sourcePositions.length / 3;
  invariant(sourceNormals.length === vertexCount * 3 && sourceUv.length === vertexCount * 2, `${materialName} base attribute counts mismatch`);
  invariant(indices.length % 3 === 0 && indices.every((index) => index < vertexCount), `${materialName} source indices are invalid`);
  invariant(Array.isArray(primitive.targets) && primitive.targets.length === morphNames.length,
    `${materialName} morph target count mismatch`);

  const morphPositionArrays = [];
  const morphNormalArrays = [];
  for (let target = 0; target < morphNames.length; target++) {
    const morph = primitive.targets[target];
    invariant(Number.isInteger(morph?.POSITION) && Number.isInteger(morph?.NORMAL),
      `${materialName} morph ${morphNames[target]} must have POSITION and NORMAL data`);
    const position = readFloatAccessor(json, binary, morph.POSITION, 3);
    const normal = readFloatAccessor(json, binary, morph.NORMAL, 3);
    invariant(position.length === vertexCount * 3 && normal.length === vertexCount * 3,
      `${materialName} morph ${morphNames[target]} vertex count mismatch`);
    morphPositionArrays.push(position);
    morphNormalArrays.push(normal);
  }

  const boundary = edgeLocks(indices, vertexCount);
  const attributeStride = 2 + 3 + morphPositionArrays.length * 3;
  invariant(attributeStride <= 32, `Facial attribute metric (${attributeStride}) exceeds meshoptimizer's 32-channel limit`);
  const attributes = new Float32Array(vertexCount * attributeStride);
  for (let vertex = 0; vertex < vertexCount; vertex++) {
    const base = vertex * attributeStride;
    attributes[base] = sourceUv[vertex * 2];
    attributes[base + 1] = sourceUv[vertex * 2 + 1];
    attributes.set(sourceNormals.subarray(vertex * 3, vertex * 3 + 3), base + 2);
    for (let target = 0; target < morphPositionArrays.length; target++) {
      attributes.set(morphPositionArrays[target].subarray(vertex * 3, vertex * 3 + 3), base + 5 + target * 3);
    }
  }
  const attributeWeights = [uvWeight, uvWeight, baseNormalWeight, baseNormalWeight, baseNormalWeight];
  for (let target = 0; target < morphPositionArrays.length; target++) {
    attributeWeights.push(morphPositionWeight, morphPositionWeight, morphPositionWeight);
  }
  invariant(attributeWeights.length === attributeStride && attributeWeights.length <= 32,
    'Meshopt attribute weights must match the channel stride and stay within 32 channels');

  const startedAt = performance.now();
  const requestedIndexCount = settings.triangles * 3;
  const [simplifiedIndices, relativeError] = MeshoptSimplifier.simplifyWithAttributes(
    indices,
    sourcePositions,
    3,
    attributes,
    attributeStride,
    attributeWeights,
    boundary.lock,
    requestedIndexCount,
    maxRelativeError,
    ['LockBorder'],
  );
  const simplifyMs = performance.now() - startedAt;
  invariant(simplifiedIndices.length >= 3, `${materialName} simplifier returned no surface`);
  const compact = compactIndices(simplifiedIndices, vertexCount);
  const retainedLockedVertices = boundary.lock.reduce((sum, locked, sourceVertex) =>
    sum + (locked && compact.sourceToCompact[sourceVertex] >= 0 ? 1 : 0), 0);
  invariant(retainedLockedVertices === boundary.lockedVertices,
    `${materialName} lost ${boundary.lockedVertices - retainedLockedVertices} boundary vertices`);

  replacements.push({
    materialName,
    primitive,
    settings,
    sourceVertexCount: vertexCount,
    sourceIndices: indices,
    sourceStoredAccessorPayloadBytes,
    sourcePositions,
    sourceNormals,
    sourceUv,
    morphPositionArrays,
    morphNormalArrays,
    indices: compact.indices,
    remap: compact.remap,
    triangles: triangleCount(simplifiedIndices),
    relativeError,
    boundary,
    retainedLockedVertices,
    simplifyMs,
  });
}

// Prepare replacement accessors and pack only data still reachable by the GLB.
const replacementOldAccessorIds = new Set();
for (const item of replacements) {
  for (const id of Object.values(item.primitive.attributes)) replacementOldAccessorIds.add(id);
  replacementOldAccessorIds.add(item.primitive.indices);
  for (const target of item.primitive.targets) for (const id of Object.values(target)) replacementOldAccessorIds.add(id);
}

function collectAccessorReferences() {
  const refs = new Set();
  for (const candidateMesh of json.meshes ?? []) {
    for (const primitive of candidateMesh.primitives ?? []) {
      for (const id of Object.values(primitive.attributes ?? {})) refs.add(id);
      if (Number.isInteger(primitive.indices)) refs.add(primitive.indices);
      for (const target of primitive.targets ?? []) for (const id of Object.values(target)) refs.add(id);
    }
  }
  for (const skin of json.skins ?? []) if (Number.isInteger(skin.inverseBindMatrices)) refs.add(skin.inverseBindMatrices);
  for (const animation of json.animations ?? []) {
    for (const sampler of animation.samplers ?? []) {
      refs.add(sampler.input);
      refs.add(sampler.output);
    }
  }
  return refs;
}

const replacingPrimitives = new Set(replacements.map(item => item.primitive));
const untouchedAccessorIds = new Set();
for (const candidateMesh of json.meshes) for (const primitive of candidateMesh.primitives) {
  if (replacingPrimitives.has(primitive)) continue;
  for (const id of Object.values(primitive.attributes)) untouchedAccessorIds.add(id);
  untouchedAccessorIds.add(primitive.indices);
  for (const target of primitive.targets ?? []) for (const id of Object.values(target)) untouchedAccessorIds.add(id);
}
for (const id of replacementOldAccessorIds) invariant(!untouchedAccessorIds.has(id), `Target accessor ${id} is shared with untouched geometry`);

const retainedAccessorMap = new Map();
const newAccessors = [];
for (let oldId = 0; oldId < json.accessors.length; oldId++) {
  if (replacementOldAccessorIds.has(oldId)) continue;
  retainedAccessorMap.set(oldId, newAccessors.length);
  newAccessors.push(json.accessors[oldId]);
}

const retainedViews = new Set();
for (const oldId of retainedAccessorMap.keys()) {
  const accessor = json.accessors[oldId];
  if (Number.isInteger(accessor.bufferView)) retainedViews.add(accessor.bufferView);
  if (accessor.sparse) {
    retainedViews.add(accessor.sparse.indices.bufferView);
    retainedViews.add(accessor.sparse.values.bufferView);
  }
}
for (const image of json.images ?? []) if (Number.isInteger(image.bufferView)) retainedViews.add(image.bufferView);

const newBufferViews = [];
const binaryChunks = [];
let binaryLength = 0;
function appendBinary(bytes, metadata = {}) {
  const padding = (4 - binaryLength % 4) % 4;
  if (padding) {
    binaryChunks.push(Buffer.alloc(padding));
    binaryLength += padding;
  }
  const offset = binaryLength;
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  binaryChunks.push(buffer);
  binaryLength += buffer.length;
  const viewId = newBufferViews.length;
  newBufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buffer.length, ...metadata });
  return viewId;
}

const oldViewMap = new Map();
for (let oldViewId = 0; oldViewId < json.bufferViews.length; oldViewId++) {
  if (!retainedViews.has(oldViewId)) continue;
  const oldView = json.bufferViews[oldViewId];
  invariant(oldView.buffer === 0, `BufferView ${oldViewId} references a nonzero buffer`);
  const offset = oldView.byteOffset ?? 0;
  const bytes = binary.subarray(offset, offset + oldView.byteLength);
  invariant(bytes.length === oldView.byteLength, `BufferView ${oldViewId} exceeds source buffer`);
  const copiedId = appendBinary(bytes, Object.fromEntries(Object.entries(oldView).filter(([key]) =>
    !['buffer', 'byteOffset', 'byteLength'].includes(key))));
  oldViewMap.set(oldViewId, copiedId);
}

for (const oldId of retainedAccessorMap.keys()) {
  const accessor = newAccessors[retainedAccessorMap.get(oldId)];
  if (Number.isInteger(accessor.bufferView)) accessor.bufferView = oldViewMap.get(accessor.bufferView);
  if (accessor.sparse) {
    accessor.sparse.indices.bufferView = oldViewMap.get(accessor.sparse.indices.bufferView);
    accessor.sparse.values.bufferView = oldViewMap.get(accessor.sparse.values.bufferView);
  }
}
for (const image of json.images ?? []) if (Number.isInteger(image.bufferView)) image.bufferView = oldViewMap.get(image.bufferView);

function addFloatAccessor(values, components, type, target, includeBounds = true) {
  const bytes = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  const bufferView = appendBinary(bytes, { target });
  const accessor = { bufferView, componentType: 5126, count: values.length / components, type };
  if (includeBounds) Object.assign(accessor, minMax(values, components));
  const id = newAccessors.length;
  newAccessors.push(accessor);
  return id;
}

function addSparseFloatAccessor(values, components, type) {
  const count = values.length / components;
  const nonzeroVertices = [];
  for (let vertex = 0; vertex < count; vertex++) {
    let nonzero = false;
    for (let component = 0; component < components; component++) {
      if (values[vertex * components + component] !== 0) nonzero = true;
    }
    if (nonzero) nonzeroVertices.push(vertex);
  }
  const indexComponentType = count <= 256 ? 5121 : count <= 65536 ? 5123 : 5125;
  const sparseIndices = indexComponentType === 5121 ? Uint8Array.from(nonzeroVertices)
    : indexComponentType === 5123 ? Uint16Array.from(nonzeroVertices)
      : Uint32Array.from(nonzeroVertices);
  const sparseValues = new Float32Array(nonzeroVertices.length * components);
  for (let dst = 0; dst < nonzeroVertices.length; dst++) {
    const src = nonzeroVertices[dst];
    for (let component = 0; component < components; component++) {
      sparseValues[dst * components + component] = values[src * components + component];
    }
  }
  const accessor = {
    componentType: 5126,
    count,
    type,
    ...minMax(values, components),
  };
  let encodedBytes = 0;
  if (nonzeroVertices.length > 0) {
    const indicesView = appendBinary(Buffer.from(sparseIndices.buffer, sparseIndices.byteOffset, sparseIndices.byteLength));
    const valuesView = appendBinary(Buffer.from(sparseValues.buffer, sparseValues.byteOffset, sparseValues.byteLength), { target: 34962 });
    accessor.sparse = {
      count: nonzeroVertices.length,
      indices: { bufferView: indicesView, componentType: indexComponentType },
      values: { bufferView: valuesView },
    };
    encodedBytes = sparseIndices.byteLength + sparseValues.byteLength;
  }
  const id = newAccessors.length;
  newAccessors.push(accessor);
  return { id, encodedBytes, nonzeroVertices: nonzeroVertices.length };
}

function addIndexAccessor(indices) {
  const bytes = Buffer.from(indices.buffer, indices.byteOffset, indices.byteLength);
  const bufferView = appendBinary(bytes, { target: 34963 });
  const accessor = {
    bufferView,
    componentType: indices instanceof Uint16Array ? 5123 : 5125,
    count: indices.length,
    type: 'SCALAR',
    min: [indices.length ? Math.min(...indices) : 0],
    max: [indices.length ? Math.max(...indices) : 0],
  };
  const id = newAccessors.length;
  newAccessors.push(accessor);
  return id;
}

for (const item of replacements) {
  const remappedPosition = gather(item.sourcePositions, 3, item.remap);
  const remappedNormal = gather(item.sourceNormals, 3, item.remap);
  const remappedUv = gather(item.sourceUv, 2, item.remap);
  const attributes = {
    POSITION: addFloatAccessor(remappedPosition, 3, 'VEC3', 34962),
    NORMAL: addFloatAccessor(remappedNormal, 3, 'VEC3', 34962),
    TEXCOORD_0: addFloatAccessor(remappedUv, 2, 'VEC2', 34962),
  };
  const targets = [];
  let morphEncodedBytes = 0;
  let morphStoredValues = 0;
  for (let target = 0; target < item.morphPositionArrays.length; target++) {
    const position = addSparseFloatAccessor(gather(item.morphPositionArrays[target], 3, item.remap), 3, 'VEC3');
    const normal = addSparseFloatAccessor(gather(item.morphNormalArrays[target], 3, item.remap), 3, 'VEC3');
    morphEncodedBytes += position.encodedBytes + normal.encodedBytes;
    morphStoredValues += position.nonzeroVertices + normal.nonzeroVertices;
    targets.push({
      POSITION: position.id,
      NORMAL: normal.id,
    });
  }
  item.compactMorphEncodedBytes = morphEncodedBytes;
  item.compactMorphStoredValues = morphStoredValues;
  item.compactBaseAttributeBytes = remappedPosition.byteLength + remappedNormal.byteLength + remappedUv.byteLength;
  item.compactIndexBytes = item.indices.byteLength;
  item.primitive.attributes = attributes;
  item.primitive.indices = addIndexAccessor(item.indices);
  item.primitive.targets = targets;
}

for (const candidateMesh of json.meshes ?? []) {
  for (const primitive of candidateMesh.primitives ?? []) {
    if (replacements.some((item) => item.primitive === primitive)) continue;
    for (const [semantic, oldId] of Object.entries(primitive.attributes ?? {})) {
      primitive.attributes[semantic] = retainedAccessorMap.get(oldId);
    }
    if (Number.isInteger(primitive.indices)) primitive.indices = retainedAccessorMap.get(primitive.indices);
    for (const target of primitive.targets ?? []) {
      for (const [semantic, oldId] of Object.entries(target)) target[semantic] = retainedAccessorMap.get(oldId);
    }
  }
}
for (const skin of json.skins ?? []) if (Number.isInteger(skin.inverseBindMatrices)) skin.inverseBindMatrices = retainedAccessorMap.get(skin.inverseBindMatrices);
for (const animation of json.animations ?? []) {
  for (const sampler of animation.samplers ?? []) {
    sampler.input = retainedAccessorMap.get(sampler.input);
    sampler.output = retainedAccessorMap.get(sampler.output);
  }
}

json.accessors = newAccessors;
json.bufferViews = newBufferViews;
json.buffers = [{ byteLength: binaryLength }];
json.asset.generator = `${json.asset.generator ?? 'unknown'}; authored face LOD via meshoptimizer 0.22`;

const outputBinary = Buffer.concat(binaryChunks, binaryLength);
const jsonBytes = Buffer.from(JSON.stringify(json));
const jsonPadding = Buffer.alloc((4 - jsonBytes.length % 4) % 4, 0x20);
const paddedJson = Buffer.concat([jsonBytes, jsonPadding]);
const binaryPadding = Buffer.alloc((4 - outputBinary.length % 4) % 4);
const paddedBinary = Buffer.concat([outputBinary, binaryPadding]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + paddedJson.length + 8 + paddedBinary.length, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(paddedJson.length, 0);
jsonHeader.writeUInt32LE(0x4e4f534a, 4);
const binaryHeader = Buffer.alloc(8);
binaryHeader.writeUInt32LE(paddedBinary.length, 0);
binaryHeader.writeUInt32LE(0x004e4942, 4);
const outputBytes = Buffer.concat([header, jsonHeader, paddedJson, binaryHeader, paddedBinary]);

// Reparse structural references and ensure every output accessor stays in bounds.
const checked = parseGlb(outputBytes);
for (const [index, accessor] of checked.json.accessors.entries()) accessorView(checked.json, checked.binary, index);
for (const image of checked.json.images ?? []) {
  if (Number.isInteger(image.bufferView)) invariant(checked.json.bufferViews[image.bufferView], 'Image has a broken bufferView reference');
}
for (const candidateMesh of checked.json.meshes ?? []) {
  for (const primitive of candidateMesh.primitives ?? []) {
    const positionId = primitive.attributes?.POSITION;
    invariant(Number.isInteger(positionId), `Mesh ${candidateMesh.name ?? ''} has no POSITION accessor`);
    const vertexCount = checked.json.accessors[positionId].count;
    const referenced = [
      ...Object.values(primitive.attributes ?? {}),
      ...(Number.isInteger(primitive.indices) ? [primitive.indices] : []),
      ...(primitive.targets ?? []).flatMap((target) => Object.values(target)),
    ];
    for (const accessorId of referenced) {
      invariant(Number.isInteger(accessorId) && checked.json.accessors[accessorId], 'Primitive has a broken accessor reference');
    }
    for (const target of primitive.targets ?? []) {
      for (const accessorId of Object.values(target)) {
        invariant(checked.json.accessors[accessorId].count === vertexCount, 'Morph target count differs from its base mesh');
      }
    }
    if (Number.isInteger(primitive.indices)) {
      const indexAccessor = checked.json.accessors[primitive.indices];
      invariant(indexAccessor.type === 'SCALAR' && indexAccessor.count % 3 === 0, 'Triangle primitive has malformed indices');
      const values = readIndices(checked.json, checked.binary, primitive.indices);
      invariant(values.every((value) => value < vertexCount), 'Primitive index exceeds its POSITION accessor');
    }
  }
}

const report = {
  source: {
    path: path.relative(process.cwd(), inputPath),
    sha256: sha256(inputBytes),
    bytes: inputBytes.length,
    glbVersion: 2,
    mesh: mesh.name,
    morphTargets: morphNames,
    note: 'Eyes and every non-target mesh/material/image remain unchanged; no runtime adoption is implied.',
  },
  method: {
    library: 'meshoptimizer 0.22.0',
    api: 'simplifyWithAttributes',
    flags: ['LockBorder'],
    targetError: maxRelativeError,
    errorUnits: 'relative to the source position bounds (meshoptimizer default; not meters)',
    attributeChannels: ['TEXCOORD_0.xy', 'NORMAL.xyz', ...morphNames.map((name) => `${name}.POSITION.xyz`)],
    attributeWeights: { uv: uvWeight, baseNormal: baseNormalWeight, everyMorphPositionDelta: morphPositionWeight },
    morphNormalHandling: 'All six morph NORMAL arrays are retained and compacted with the same vertex remap. The simplifier error metric uses all six POSITION deltas plus base normals and UVs; the 32-channel API limit prevents also adding every morph NORMAL xyz channel.',
    boundaryPolicy: 'Explicitly lock every source boundary vertex and enable LockBorder; this preserves any neck seam represented by an open boundary. Reject if any locked vertex is missing from the output.',
  },
  primitives: replacements.map((item) => ({
    material: item.materialName,
    sourceTriangles: triangleCount(item.sourceIndices),
    requestedMaxTriangles: item.settings.triangles,
    outputTriangles: item.triangles,
    targetReached: item.triangles <= item.settings.triangles,
    targetError: maxRelativeError,
    measuredRelativeError: item.relativeError,
    sourceVertices: item.sourceVertexCount,
    compactVertices: item.remap.length,
    removedVertices: item.sourceVertexCount - item.remap.length,
    boundaryEdges: item.boundary.boundaryEdges,
    lockedBoundaryVertices: item.boundary.lockedVertices,
    retainedBoundaryVertices: item.retainedLockedVertices,
    outputIndexComponentType: item.indices instanceof Uint16Array ? 'UNSIGNED_SHORT' : 'UNSIGNED_INT',
    simplifyMs: Number(item.simplifyMs.toFixed(3)),
    sourceDecodedAttributeBytes: item.sourcePositions.byteLength + item.sourceNormals.byteLength + item.sourceUv.byteLength
      + item.morphPositionArrays.reduce((sum, values) => sum + values.byteLength, 0)
      + item.morphNormalArrays.reduce((sum, values) => sum + values.byteLength, 0)
      + item.sourceIndices.byteLength,
    sourceStoredAccessorPayloadBytes: item.sourceStoredAccessorPayloadBytes,
    outputStoredGeometryPayloadBytes: item.compactBaseAttributeBytes + item.compactMorphEncodedBytes + item.compactIndexBytes,
    outputMorphNonzeroVertexRecords: item.compactMorphStoredValues,
    status: item.triangles <= item.settings.triangles ? 'target-reached-within-error-limit' : 'above-target-under-configured-error-and-boundary-constraints',
  })),
  output: {
    path: path.relative(process.cwd(), outputPath),
    sha256: sha256(outputBytes),
    bytes: outputBytes.length,
    retainedTextureImages: checked.json.images?.length ?? 0,
    retainedMeshes: checked.json.meshes.length,
    retainedMaterials: checked.json.materials.length,
    glbReferencesChecked: true,
  },
  limitations: [
    'The tool is a standalone geometry prototype; it does not validate browser rendering or expression quality.',
    'Meshoptimizer reports a geometric error metric, not a pixel-space guarantee.',
    'The mouth target is allowed to remain above 2,000 triangles if the configured error or locked boundaries stop simplification.',
  ],
};

writeFileSync(outputPath, outputBytes);
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
