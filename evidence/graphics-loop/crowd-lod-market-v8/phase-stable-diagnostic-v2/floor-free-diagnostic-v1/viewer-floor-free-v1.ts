import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer/meshopt_simplifier.module.js';
import { createKit } from '/src/scene/kit.ts';
import { loadBody, type SkinnedBody } from '/src/scene/body/skinned.ts';
import { normalizeLook } from '/src/scene/avatar-look.ts';
import { resolveAvatarWearablesForRenderer } from '/src/game/wardrobe/rules.ts';
import wardrobeGeometrySource from '/src/scene/wardrobe/geometry.ts?raw';
import wardrobeRendererSource from '/src/scene/wardrobe/renderer.ts?raw';
import { assertPoseCheckpointUnchanged } from './floor-visibility-contract.mjs';

type SavedActor = { id: string; seed: string; look: unknown; kind?: string };
type Fixture = { fixture: { city: string; seed: string; crowd: SavedActor[] } };
type MeshSource = { mesh: THREE.SkinnedMesh; index: Uint16Array | Uint32Array; attributes: Record<string, THREE.BufferAttribute> };
type Recipe = { id: string; family: string; topology: string; body: any; wardrobe: any };
type Active = {
  id: string; seed: string; look: ReturnType<typeof normalizeLook>; kit: ReturnType<typeof createKit>; body: SkinnedBody;
  base: THREE.SkinnedMesh; wardrobe: THREE.SkinnedMesh; originalBody: THREE.BufferGeometry; originalWardrobe: THREE.BufferGeometry;
  compactBody: THREE.BufferGeometry; compactWardrobe: THREE.BufferGeometry; sourceTriangles: number; compactTriangles: number;
  sourceIdentity: Record<string, unknown>; recipe: Recipe; poseCheckpoint: string;
};

const $ = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing #${id}`);
  return element as T;
};
const canvas = $('view') as HTMLCanvasElement;
const status = $('status') as HTMLPreElement;
const actorSelect = $('actor') as HTMLSelectElement;
const modeSelect = $('mode') as HTMLSelectElement;
const poseSelect = $('pose') as HTMLSelectElement;
const yawSelect = $('yaw') as HTMLSelectElement;
const phaseSelect = $('phase') as HTMLInputElement;
const framingSelect = $('framing') as HTMLSelectElement;
const loadButton = $('load') as HTMLButtonElement;
const renderButton = $('render') as HTMLButtonElement;
const captureButton = $('capture') as HTMLButtonElement;
const playWalkButton = $('play-walk') as HTMLButtonElement;
const groundReferenceButton = $('ground-reference') as HTMLButtonElement;
const GROUND_Y = 0;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = false;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#dfe7e8');
const hemi = new THREE.HemisphereLight('#ffffff', '#77706a', 1.55);
scene.add(hemi);
const keyLight = new THREE.DirectionalLight('#fff4e2', 2.0);
keyLight.position.set(-3.4, 5.6, 4.5);
scene.add(keyLight);
// Optional causal A/B only. It starts hidden because the prior full-canvas
// captures showed a hard ground-colored cutoff despite matching projection,
// support, CSS, and drawing-buffer dimensions.
const floor = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshStandardMaterial({ color: '#b9beb7', roughness: 1, depthTest: false, depthWrite: false }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = GROUND_Y;
floor.renderOrder = -1;
floor.visible = false;
scene.add(floor);
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 40);
const target = new THREE.Vector3(0, 1.2, 0);
let active: Active | null = null;
let fixture: Fixture | null = null;
let generation = 0;
let walkFrame: number | null = null;
let walkStartedAt = 0;
let walkElapsedBeforePlay = 0;
let walkTotalElapsedSeconds = 0;
// Exact phase last applied to SkinnedBody.stride; the range input is presentation-only and snaps to step=0.025.
let appliedWalkPhase = 0;
let lastLiveStatusAt = 0;
let lastFootSolve: { corrected: number; maxError: number; limited: boolean } | null = null;
let preSolveSoles: Array<Record<string, unknown>> = [];
let loadGeneration = 0;
const loadTrace: Array<Record<string, unknown>> = [];
let framingCamera: { yaw: number; position: THREE.Vector3; target: THREE.Vector3; sourceBounds: THREE.Box3 } | null = null;
const WALK_CYCLE_SECONDS = 2.4;

declare global {
  interface Window {
    __marketLodLiveWalk?: {
      play: () => void;
      pause: () => void;
      state: () => Record<string, unknown>;
      loadTrace: () => Array<Record<string, unknown>>;
    };
    __marketLodGroundReference?: {
      setVisible: (visible: boolean) => void;
      state: () => boolean;
    };
  }
}

const sha = async (bytes: BufferSource | string): Promise<string> => {
  const source = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
};
const attrBytes = (attribute: THREE.BufferAttribute): Uint8Array => new Uint8Array(
  attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength,
);
const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
};
const hashAttribute = (attribute: THREE.BufferAttribute): Promise<string> => sha(attrBytes(attribute));
function requireRawAttribute(attribute: THREE.BufferAttribute, label: string): void {
  if ((attribute as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) throw new Error(`${label}: interleaved attributes unsupported`);
  if (!ArrayBuffer.isView(attribute.array) || attribute.array instanceof DataView) throw new Error(`${label}: expected typed source data`);
}
async function hashAttributeSet(attributes: Record<string, THREE.BufferAttribute>, exclude: ReadonlySet<string> = new Set()): Promise<Record<string, string>> {
  const entries = await Promise.all(Object.entries(attributes).filter(([name]) => !exclude.has(name)).sort(([a], [b]) => a.localeCompare(b))
    .map(async ([name, attribute]) => {
      requireRawAttribute(attribute, name);
      return [name, await hashAttribute(attribute)] as const;
    }));
  return Object.fromEntries(entries);
}
const schema = (attributes: Record<string, THREE.BufferAttribute>): Record<string, unknown> => Object.fromEntries(
  Object.entries(attributes).sort(([a], [b]) => a.localeCompare(b)).map(([name, attribute]) => [name, {
    itemSize: attribute.itemSize, normalized: attribute.normalized, arrayType: attribute.array.constructor.name, count: attribute.count,
  }]),
);
const topologyKey = (look: ReturnType<typeof normalizeLook>): string => JSON.stringify({
  body: look.body, outfit: look.outfit, hair: look.hair, accessories: look.accessories,
  wearables: resolveAvatarWearablesForRenderer(look), face: look.face, expression: look.expression, appearance: look.appearance ?? null,
});
function meshAt(object: THREE.Object3D, name: string): THREE.SkinnedMesh {
  const mesh = object.getObjectByName(name) as THREE.SkinnedMesh | null;
  if (!mesh?.isSkinnedMesh || !mesh.geometry.index) throw new Error(`Missing indexed skinned mesh ${name}`);
  return mesh;
}
function sourceOf(mesh: THREE.SkinnedMesh): MeshSource {
  const index = mesh.geometry.index?.array;
  if (!(index instanceof Uint16Array || index instanceof Uint32Array)) throw new Error(`${mesh.name}: expected Uint16/Uint32 index`);
  const end = Math.min(index.length, mesh.geometry.drawRange.start + mesh.geometry.drawRange.count);
  if (mesh.geometry.drawRange.start !== 0 || end % 3) throw new Error(`${mesh.name}: invalid draw range`);
  return { mesh, index: index.slice(0, end), attributes: mesh.geometry.attributes as Record<string, THREE.BufferAttribute> };
}
function metricPositions(mesh: THREE.SkinnedMesh, position: THREE.BufferAttribute): { values: Float32Array; proof: Record<string, unknown> } {
  mesh.updateWorldMatrix(true, false);
  const matrix = mesh.matrixWorld.clone();
  if (matrix.elements.some((value) => !Number.isFinite(value)) || Math.abs(matrix.determinant()) < 1e-12) throw new Error(`${mesh.name}: invalid metric matrix`);
  const values = new Float32Array(position.count * 3), point = new THREE.Vector3();
  for (let vertex = 0; vertex < position.count; vertex++) {
    point.set(position.getX(vertex), position.getY(vertex), position.getZ(vertex)).applyMatrix4(matrix);
    if (![point.x, point.y, point.z].every(Number.isFinite)) throw new Error(`${mesh.name}: non-finite transformed position`);
    values.set([point.x, point.y, point.z], vertex * 3);
  }
  return { values, proof: { matrixElements: [...matrix.elements], inputUnits: 'mesh-local', outputUnits: 'scene units at loadBody scale 1' } };
}
function finiteSource(source: MeshSource): void {
  const position = source.attributes.position;
  if (!position) throw new Error(`${source.mesh.name}: missing position`);
  for (const [name, attribute] of Object.entries(source.attributes)) {
    requireRawAttribute(attribute, `${source.mesh.name}.${name}`);
    if (attribute.count !== position.count) throw new Error(`${source.mesh.name}.${name}: vertex count mismatch`);
    for (const value of attribute.array) if (!Number.isFinite(value)) throw new Error(`${source.mesh.name}.${name}: non-finite attribute`);
  }
  for (const index of source.index) if (!Number.isInteger(index) || index < 0 || index >= position.count) throw new Error(`${source.mesh.name}: invalid index`);
}
async function sourceIdentity(actor: SavedActor, look: ReturnType<typeof normalizeLook>, base: THREE.SkinnedMesh,
  wardrobe: THREE.SkinnedMesh, bodySource: MeshSource, wardrobeSource: MeshSource, items: Record<string, number>,
  trace?: (stage: string, details?: Record<string, unknown>) => void): Promise<Record<string, unknown>> {
  const bodyAttributes = base.geometry.attributes as Record<string, THREE.BufferAttribute>;
  const wardrobeAttributes = wardrobe.geometry.attributes as Record<string, THREE.BufferAttribute>;
  const assetPath = `/src/scene/body/assets/base-body-${base.name.slice('body-'.length)}.glb`;
  trace?.('identity-asset-fetch-start', { assetPath });
  const assetResponse = await fetch(assetPath, { cache: 'no-store' });
  trace?.('identity-asset-response', { assetPath, status: assetResponse.status, ok: assetResponse.ok,
    contentLength: assetResponse.headers.get('content-length') });
  if (!assetResponse.ok) throw new Error(`${actor.id}: asset HTTP ${assetResponse.status}`);
  const assetSha = await sha(await assetResponse.arrayBuffer());
  trace?.('identity-asset-hash-complete', { assetPath, assetSha });
  const bindSha = await sha(JSON.stringify({ bones: base.skeleton.bones.map((bone) => bone.name),
    inverse: base.skeleton.boneInverses.map((matrix) => matrix.elements), bind: base.bindMatrix.elements, matrix: base.matrix.elements }));
  const bodyAttributesHash = await hashAttributeSet(bodyAttributes);
  const wardrobeNonPalette = await hashAttributeSet(wardrobeAttributes, new Set(['color']));
  const bodyInfluenceSha = await sha(concatBytes(attrBytes(bodyAttributes.skinIndex!), attrBytes(bodyAttributes.skinWeight!)));
  const wardrobeInfluenceSha = await sha(concatBytes(attrBytes(wardrobeAttributes.skinIndex!), attrBytes(wardrobeAttributes.skinWeight!)));
  const wardrobeRangeSha = await sha(JSON.stringify({ ids: Object.keys(items), counts: items }));
  return {
    actorId: actor.id, seed: actor.seed, family: base.name.slice('body-'.length), normalizedLook: look,
    topology: topologyKey(look), resolvedWearables: resolveAvatarWearablesForRenderer(look), assetSha, assetPath, bindSha,
    bodySchema: schema(bodyAttributes), bodyAttributeHashes: bodyAttributesHash, bodyInfluenceSha,
    bodyIndexSha: await sha(new Uint8Array(bodySource.index.buffer, bodySource.index.byteOffset, bodySource.index.byteLength)),
    bodyMetric: metricPositions(base, bodyAttributes.position!).proof,
    wardrobeSchema: schema(wardrobeAttributes), wardrobeNonPaletteHashes: wardrobeNonPalette,
    wardrobeNonPaletteSha: await sha(JSON.stringify(wardrobeNonPalette)), wardrobeInfluenceSha,
    wardrobeIndexSha: await sha(new Uint8Array(wardrobeSource.index.buffer, wardrobeSource.index.byteOffset, wardrobeSource.index.byteLength)),
    wardrobeRangeSha, itemTriangles: items, wardrobeColorSha: await hashAttribute(wardrobeAttributes.color!),
    wardrobeMetric: metricPositions(wardrobe, wardrobeAttributes.position!).proof,
    generatorSourceSha: { geometry: await sha(wardrobeGeometrySource), renderer: await sha(wardrobeRendererSource) },
  };
}
type Packed = { positions: Float32Array; attributes: Float32Array; stride: number; weights: number[]; locks: Uint8Array; channelNames: string[] };
function featureWeight(name: string): number { return name === 'uv' || name === 'wardrobeUv' ? 0.7 : name === 'skinWeight' ? 0.4 : name === 'wardrobeCloth' ? 0.2 : 0.08; }
function packed(source: MeshSource): Packed {
  const position = source.attributes.position!;
  const names = source.mesh.name.startsWith('body-') ? ['uv', 'color', 'skinWeight']
    : source.mesh.name === 'avatar-wardrobe' ? ['wardrobeUv', 'color', 'skinWeight', 'wardrobeCloth'] : [];
  if (!names.length || names.some((name) => !source.attributes[name])) throw new Error(`${source.mesh.name}: unsupported simplifier schema`);
  const fields = names.map((name) => source.attributes[name]!);
  const stride = fields.reduce((sum, field) => sum + field.itemSize, 0);
  if (stride < 3 || stride > 32 || fields.some((field) => field.count !== position.count)) throw new Error(`${source.mesh.name}: invalid schema dimensions`);
  const attributes = new Float32Array(position.count * stride), weights = fields.flatMap((field, i) => Array.from({ length: field.itemSize }, () => featureWeight(names[i]!)));
  for (let vertex = 0; vertex < position.count; vertex++) {
    let offset = vertex * stride;
    for (const field of fields) for (let component = 0; component < field.itemSize; component++) {
      const value = field.getComponent(vertex, component);
      if (!Number.isFinite(value)) throw new Error(`${source.mesh.name}: non-finite packed feature`);
      attributes[offset++] = value;
    }
  }
  const metric = metricPositions(source.mesh, position).values;
  const locks = new Uint8Array(position.count), boundary = new Map<string, { a: number; b: number; n: number }>();
  for (let i = 0; i < source.index.length; i += 3) for (const [a, b] of [[source.index[i]!, source.index[i + 1]!], [source.index[i + 1]!, source.index[i + 2]!], [source.index[i + 2]!, source.index[i]!]]) {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`, edge = boundary.get(key) ?? { a, b, n: 0 }; edge.n++; boundary.set(key, edge);
  }
  const joints = source.attributes.skinIndex!, influence = source.attributes.skinWeight!;
  const support = (v: number) => [0, 1, 2, 3].filter((c) => influence.getComponent(v, c) > 1e-4)
    .map((c) => joints.getComponent(v, c)).sort((a, b) => a - b).join(',');
  for (const { a, b, n } of boundary.values()) {
    if (n === 1 || support(a) !== support(b)) { locks[a] = 1; locks[b] = 1; }
  }
  if (weights.length !== stride || weights.length > 32 || locks.length !== position.count) throw new Error(`${source.mesh.name}: Meshopt buffer preflight failed`);
  return { positions: metric, attributes, stride, weights, locks, channelNames: names };
}
function makeMap(source: MeshSource, targetTriangles: number, additionalLockedVertices: readonly number[] = []): any {
  finiteSource(source);
  const p = packed(source), position = source.attributes.position!;
  for (const vertex of additionalLockedVertices) {
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= position.count) throw new Error(`${source.mesh.name}: invalid extra lock vertex`);
    p.locks[vertex] = 1;
  }
  if (!source.index.length) return { index: [], sourceVertex: [], metrics: { status: 'empty-source-item', sourceTriangles: 0, outputTriangles: 0, simplifierInvoked: false } };
  const targetCount = Math.min(source.index.length, Math.floor(targetTriangles) * 3), error = 0.015;
  if (source.index.length % 3 || targetCount < 0 || targetCount % 3 || p.positions.length !== position.count * 3 || p.attributes.length !== position.count * p.stride ||
      p.weights.length !== p.stride || p.weights.some((w) => !Number.isFinite(w) || w < 0)) throw new Error(`${source.mesh.name}: Meshopt preflight rejected`);
  const [raw] = MeshoptSimplifier.simplifyWithAttributes(source.index, p.positions, 3, p.attributes, p.stride, p.weights,
    p.locks, targetCount, error, ['ErrorAbsolute', 'LockBorder', 'Sparse']);
  const sourceVertex = [...new Set(raw)].sort((a, b) => a - b), compact = new Map(sourceVertex.map((v, i) => [v, i]));
  const index = Array.from(raw, (v) => { const value = compact.get(v); if (value === undefined) throw new Error('Unknown simplified source index'); return value; });
  const retained = new Set(sourceVertex), missingLocks = [...p.locks.keys()].filter((i) => p.locks[i] && !retained.has(i));
  if (index.length % 3 || missingLocks.length) throw new Error(`${source.mesh.name}: invalid output or dropped ${missingLocks.length} locked vertices`);
  return { index, sourceVertex, metrics: { sourceTriangles: source.index.length / 3, outputTriangles: index.length / 3,
    sourceVertices: position.count, outputVertices: sourceVertex.length, channelNames: p.channelNames,
    hardLockedVertices: p.locks.reduce((a, b) => a + b, 0), retainedLocks: true, error, errorUnits: 'scene units' } };
}
const PRESERVED_BONE_THRESHOLD = 0.02;
const PRESERVED_BONES = ['Head', 'neck_01', 'hand_l', 'hand_r'] as const;
function makeBodyMap(source: MeshSource, simplifyTriangleTarget: number): any {
  finiteSource(source);
  if (source.mesh.name.startsWith('body-') === false) throw new Error('Body partition requires the production skinned body mesh');
  if (source.index.length % 3) throw new Error('Body partition requires triangle indices');
  const joints = source.attributes.skinIndex, weights = source.attributes.skinWeight;
  if (!joints || !weights || joints.itemSize < 4 || weights.itemSize < 4) throw new Error('Body partition requires four skin influences');
  const preserveJoint = new Map<number, string>();
  for (const boneName of PRESERVED_BONES) {
    const boneIndex = source.mesh.skeleton.bones.findIndex((bone) => bone.name === boneName);
    if (boneIndex < 0) throw new Error(`Required feature bone is missing: ${boneName}`);
    preserveJoint.set(boneIndex, boneName);
  }
  const protectedIndices: number[] = [], simplifyIndices: number[] = [];
  const byBone: Record<string, number> = Object.fromEntries(PRESERVED_BONES.map((name) => [name, 0]));
  const edgeOwners = new Map<string, { a: number; b: number; feature: boolean; body: boolean }>();
  let overlapCount = 0;
  for (let offset = 0; offset < source.index.length; offset += 3) {
    const triangle = [source.index[offset]!, source.index[offset + 1]!, source.index[offset + 2]!];
    const matched = new Set<string>();
    for (const vertex of triangle) for (let channel = 0; channel < 4; channel++) {
      if (weights.getComponent(vertex, channel) <= PRESERVED_BONE_THRESHOLD) continue;
      const feature = preserveJoint.get(joints.getComponent(vertex, channel));
      if (feature) matched.add(feature);
    }
    const isFeatureTriangle = matched.size > 0;
    if (isFeatureTriangle) {
      protectedIndices.push(...triangle);
      for (const feature of matched) byBone[feature] = (byBone[feature] ?? 0) + 1;
      if (matched.size > 1) overlapCount++;
    } else simplifyIndices.push(...triangle);
    for (const [a, b] of [[triangle[0]!, triangle[1]!], [triangle[1]!, triangle[2]!], [triangle[2]!, triangle[0]!]]) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const edge = edgeOwners.get(key) ?? { a, b, feature: false, body: false };
      if (isFeatureTriangle) edge.feature = true; else edge.body = true;
      edgeOwners.set(key, edge);
    }
  }
  if (!protectedIndices.length || !simplifyIndices.length) throw new Error('Feature partition produced an empty source region');
  const partitionBoundaryVertices = new Set<number>();
  for (const edge of edgeOwners.values()) if (edge.feature && edge.body) {
    partitionBoundaryVertices.add(edge.a); partitionBoundaryVertices.add(edge.b);
  }
  const simplifiedSource: MeshSource = { ...source, index: Uint32Array.from(simplifyIndices) };
  const reduced = makeMap(simplifiedSource, simplifyTriangleTarget, [...partitionBoundaryVertices]);
  const preservedSourceVertices = [...new Set(protectedIndices)].sort((a, b) => a - b);
  const sourceVertex = [...new Set([...preservedSourceVertices, ...reduced.sourceVertex])].sort((a, b) => a - b);
  const compactVertex = new Map(sourceVertex.map((vertex, index) => [vertex, index]));
  const protectedOutput = protectedIndices.map((vertex) => {
    const mapped = compactVertex.get(vertex);
    if (mapped === undefined) throw new Error('Protected body source vertex missing from gathered map');
    return mapped;
  });
  const reducedOutput = reduced.index.map((compactIndex: number) => {
    const sourceIndex = reduced.sourceVertex[compactIndex];
    const mapped = sourceIndex === undefined ? undefined : compactVertex.get(sourceIndex);
    if (mapped === undefined) throw new Error('Simplified body source vertex missing from gathered map');
    return mapped;
  });
  const protectedRoundTrip = protectedOutput.map((compactIndex) => sourceVertex[compactIndex]);
  if (protectedRoundTrip.length !== protectedIndices.length || protectedRoundTrip.some((vertex, i) => vertex !== protectedIndices[i])) {
    throw new Error('Protected source triangles changed during compact vertex remap');
  }
  const reducedVertexSet = new Set<number>(reduced.sourceVertex);
  const protectedVertexSet = new Set<number>(preservedSourceVertices);
  for (const vertex of partitionBoundaryVertices) {
    if (!protectedVertexSet.has(vertex) || !reducedVertexSet.has(vertex)) {
      throw new Error(`Partition boundary source vertex ${vertex} is missing from one of the two partitions`);
    }
  }
  const index = [...protectedOutput, ...reducedOutput];
  if (index.length % 3 || index.some((value) => value < 0 || value >= sourceVertex.length)) throw new Error('Combined body partition has invalid indices');
  const sourceTriangles = source.index.length / 3;
  const protectedTriangles = protectedIndices.length / 3;
  const simplifiedTriangles = simplifyIndices.length / 3;
  const sourceAttributeBytes = Object.values(source.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0);
  const compactAttributeBytes = sourceVertex.length * Object.values(source.attributes).reduce((sum, attribute) => sum + attribute.itemSize * attribute.array.BYTES_PER_ELEMENT, 0);
  const sourceGeometryIndexBytes = source.mesh.geometry.index?.array.byteLength ?? 0;
  const visibleSourceIndexBytes = source.index.byteLength;
  const simplifierInputIndexBytes = simplifiedSource.index.byteLength;
  const compactIndexBytes = compactIndexByteLength(index, sourceVertex.length);
  return { index, sourceVertex, metrics: {
    sourceTriangles, outputTriangles: index.length / 3,
    sourceVertices: source.attributes.position!.count, outputVertices: sourceVertex.length,
    featureRule: 'preserve triangle if any source corner has >2% weight for Head, neck_01, hand_l, or hand_r; overlaps retained once',
    featureWeightThreshold: PRESERVED_BONE_THRESHOLD,
    preservedBoneNames: [...PRESERVED_BONES],
    preservedTriangles: protectedTriangles,
    simplifiedSourceTriangles: simplifiedTriangles,
    simplifiedOutputTriangles: reduced.index.length / 3,
    preservedTrianglesByBone: byBone,
    trianglesMatchingMultiplePreservedBones: overlapCount,
    partitionBoundaryVertexCount: partitionBoundaryVertices.size,
    partitionBoundaryPolicy: 'non-feature simplifier receives explicit locks for every shared feature/body partition edge vertex, plus existing source borders and joint-support seams',
    featureTrianglesAreSourceExact: true,
    protectedTriangleRemapExact: true,
    partitionBoundaryRetainedInBothPartitions: true,
    triangleRegions: {
      all: { source: sourceTriangles, compact: index.length / 3 },
      preservedHeadNeckHands: { source: protectedTriangles, compact: protectedTriangles },
      simplifiedRemainingBody: { source: simplifiedTriangles, compact: reduced.index.length / 3 },
      byPreservedBoneSource: byBone,
      byPreservedBoneCompact: byBone,
    },
    byteCounts: {
      sourceAttributes: sourceAttributeBytes,
      sourceGeometryIndexArray: sourceGeometryIndexBytes,
      sourceVisibleIndexSlice: visibleSourceIndexBytes,
      sourceGeometryTotal: sourceAttributeBytes + sourceGeometryIndexBytes,
      simplifierInputIndex: simplifierInputIndexBytes,
      compactAttributes: compactAttributeBytes,
      compactIndex: compactIndexBytes,
      compactGeometryTotal: compactAttributeBytes + compactIndexBytes,
      sourceVertexRemapUint32: sourceVertex.length * Uint32Array.BYTES_PER_ELEMENT,
      note: 'Geometry byte counts are exact typed-array payload sizes; compact output indices are Uint16 when the remapped vertex range fits, otherwise Uint32. Recipe JS overhead and GPU allocation are excluded.',
    },
    simplifier: reduced.metrics,
  } };
}
function itemSubmeshes(source: MeshSource, items: Record<string, number>): Array<{ id: string; source: MeshSource }> {
  let cursor = 0;
  const result = Object.entries(items).map(([id, triangles]) => {
    if (!Number.isInteger(triangles) || triangles < 0) throw new Error(`${id}: invalid range count`);
    const next = cursor + triangles * 3;
    if (next > source.index.length) throw new Error(`${id}: item range exceeds source index`);
    const part = { ...source, index: source.index.slice(cursor, next) };
    cursor = next;
    return { id, source: part };
  });
  if (cursor !== source.index.length) throw new Error(`Wardrobe item ranges cover ${cursor}/${source.index.length}`);
  return result;
}
async function makeRecipe(actor: SavedActor, look: ReturnType<typeof normalizeLook>, base: THREE.SkinnedMesh, wardrobe: THREE.SkinnedMesh,
  items: Record<string, number>, trace?: (stage: string, details?: Record<string, unknown>) => void): Promise<Recipe> {
  const bodySource = sourceOf(base), wardrobeSource = sourceOf(wardrobe);
  const identity = await sourceIdentity(actor, look, base, wardrobe, bodySource, wardrobeSource, items, trace);
  const body = makeBodyMap(bodySource, 1_200);
  const wardrobeItems = itemSubmeshes(wardrobeSource, items).map(({ id, source }) => ({ id,
    ...makeMap(source, Math.max(12, Math.floor(source.index.length / 3 * 0.55))) }));
  return { id: actor.id, family: base.name.slice('body-'.length), topology: topologyKey(look), body: { map: body, identity }, wardrobe: { itemMaps: wardrobeItems, identity } };
}
function gatherArray(attribute: THREE.BufferAttribute, vertices: number[]): any {
  requireRawAttribute(attribute, 'compact gather');
  const Ctor = attribute.array.constructor as { new(length: number): typeof attribute.array };
  const output = new Ctor(vertices.length * attribute.itemSize);
  vertices.forEach((sourceVertex, outputVertex) => {
    if (!Number.isInteger(sourceVertex) || sourceVertex < 0 || sourceVertex >= attribute.count) throw new Error('Recipe has out-of-range vertex');
    const start = sourceVertex * attribute.itemSize;
    output.set(attribute.array.subarray(start, start + attribute.itemSize), outputVertex * attribute.itemSize);
  });
  return output;
}
function compactIndexAttribute(index: readonly number[], vertexCount: number): THREE.BufferAttribute {
  let maximum = -1;
  for (const value of index) {
    if (!Number.isInteger(value) || value < 0 || value >= vertexCount) throw new Error('Invalid compact index');
    maximum = Math.max(maximum, value);
  }
  if (vertexCount <= 65_536 && maximum <= 65_535) return new THREE.Uint16BufferAttribute(index, 1);
  return new THREE.Uint32BufferAttribute(index, 1);
}
function compactIndexByteLength(index: readonly number[], vertexCount: number): number {
  const maximum = index.reduce((max, value) => Math.max(max, value), -1);
  return index.length * (vertexCount <= 65_536 && maximum <= 65_535 ? Uint16Array.BYTES_PER_ELEMENT : Uint32Array.BYTES_PER_ELEMENT);
}
function gatheredGeometry(source: THREE.BufferGeometry, sourceVertex: number[], index: number[]): THREE.BufferGeometry {
  const output = new THREE.BufferGeometry();
  for (const [name, original] of Object.entries(source.attributes)) {
    requireRawAttribute(original, name);
    const values = gatherArray(original, sourceVertex);
    const attribute = new THREE.BufferAttribute(values, original.itemSize, original.normalized);
    attribute.name = original.name;
    output.setAttribute(name, attribute);
  }
  output.setIndex(compactIndexAttribute(index, sourceVertex.length));
  for (const group of source.groups) output.addGroup(group.start, group.count, group.materialIndex);
  output.setDrawRange(0, index.length);
  output.computeBoundingBox(); output.computeBoundingSphere();
  return output;
}
function gatheredWardrobe(source: THREE.BufferGeometry, maps: Array<{ id: string; index: number[]; sourceVertex: number[]; metrics: any }>): THREE.BufferGeometry {
  const nonempty = maps.filter((map) => map.index.length > 0);
  const sourceAttrs = source.attributes as Record<string, THREE.BufferAttribute>;
  const totalVertices = nonempty.reduce((sum, map) => sum + map.sourceVertex.length, 0);
  const output = new THREE.BufferGeometry();
  for (const [name, original] of Object.entries(sourceAttrs)) {
    requireRawAttribute(original, name);
    const Ctor = original.array.constructor as { new(length: number): typeof original.array };
    const values = new Ctor(totalVertices * original.itemSize);
    let vertexOffset = 0;
    for (const map of nonempty) {
      const gathered = gatherArray(original, map.sourceVertex);
      values.set(gathered, vertexOffset * original.itemSize);
      vertexOffset += map.sourceVertex.length;
    }
    const attribute = new THREE.BufferAttribute(values, original.itemSize, original.normalized);
    attribute.name = original.name;
    output.setAttribute(name, attribute);
  }
  const indices: number[] = [];
  let vertexOffset = 0;
  for (const map of nonempty) {
    indices.push(...map.index.map((value) => value + vertexOffset));
    vertexOffset += map.sourceVertex.length;
  }
  output.setIndex(compactIndexAttribute(indices, totalVertices));
  output.setDrawRange(0, indices.length);
  output.computeBoundingBox(); output.computeBoundingSphere();
  return output;
}
function boneCheckpoint(base: THREE.SkinnedMesh): string {
  return JSON.stringify(base.skeleton.bones.map((bone) => ({ p: bone.position.toArray(), q: bone.quaternion.toArray(), s: bone.scale.toArray() })));
}
function contactTelemetry(): Record<string, unknown> | null {
  if (!active) return null;
  active.body.object.parent?.updateWorldMatrix(true, true);
  const contacts = active.body.sampleFootContacts();
  const soles = contacts.map((contact) => ({
    side: contact.side, parentFrameX: contact.x, parentFrameY: contact.y, parentFrameZ: contact.z,
    lowestSampleY: Math.min(...(contact.points ?? [contact]).map((point) => point.y)),
    sampleYs: (contact.points ?? [contact]).map((point) => point.y),
    sampleCount: contact.points?.length ?? 1,
  }));
  const point = new THREE.Vector3();
  let deformedWorldMinY = Infinity;
  let deformedWorldMaxY = -Infinity;
  for (const mesh of [active.base, active.wardrobe]) {
    mesh.updateWorldMatrix(true, false);
    for (let index = 0; index < mesh.geometry.attributes.position!.count; index++) {
      mesh.getVertexPosition(index, point);
      point.applyMatrix4(mesh.matrixWorld);
      deformedWorldMinY = Math.min(deformedWorldMinY, point.y);
      deformedWorldMaxY = Math.max(deformedWorldMaxY, point.y);
    }
  }
  return {
    groundY: GROUND_Y,
    groundPlacement: 'horizontal plane y=0 in scene units; body.place(0,0,0,0) and SkinnedBody.solveFeet(heightAt => 0) use this same parent-frame target',
    supportSolve: lastFootSolve,
    soleFrame: 'body.object parent coordinates; fixture parent scene has identity world matrix',
    bodyRootWorldPosition: active.body.object.getWorldPosition(new THREE.Vector3()).toArray(),
    parentWorldMatrix: active.body.object.parent?.matrixWorld.elements ?? null,
    soleSamplesBeforeLastSolve: preSolveSoles,
    soles,
    deformedWorldMinY,
    deformedWorldMaxY,
    deformedGeometrySource: 'SkinnedMesh.getVertexPosition across the production-mutated body and wardrobe, then mesh.matrixWorld',
  };
}
function renderOrderPath(object: THREE.Object3D): Array<Record<string, unknown>> {
  const path: THREE.Object3D[] = [];
  for (let current: THREE.Object3D | null = object; current; current = current.parent) path.push(current);
  return path.reverse().map((item) => ({ name: item.name, type: item.type, isGroup: item instanceof THREE.Group,
    renderOrder: item.renderOrder, visible: item.visible }));
}
function materialRenderState(object: THREE.Mesh): Array<Record<string, unknown>> {
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  return materials.map((material) => ({ name: material.name, type: material.type,
    transparent: material.transparent, depthTest: material.depthTest, depthWrite: material.depthWrite,
    colorWrite: material.colorWrite, renderOrder: object.renderOrder }));
}
function renderSurfaceTelemetry(): Record<string, unknown> {
  const gl = renderer.getContext();
  const rect = canvas.getBoundingClientRect();
  const css = getComputedStyle(canvas);
  return {
    cssRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    cssSize: { width: css.width, height: css.height },
    canvasAttributes: { width: canvas.width, height: canvas.height },
    drawingBuffer: { width: gl.drawingBufferWidth, height: gl.drawingBufferHeight },
    pixelRatio: renderer.getPixelRatio(),
    rendererViewport: renderer.getViewport(new THREE.Vector4()).toArray(),
    glViewport: Array.from(gl.getParameter(gl.VIEWPORT) as Int32Array),
    glScissorEnabled: gl.isEnabled(gl.SCISSOR_TEST),
    glScissorBox: Array.from(gl.getParameter(gl.SCISSOR_BOX) as Int32Array),
  };
}
function solveStandingContact(): void {
  if (!active || (poseSelect.value !== 'idle' && poseSelect.value !== 'walk')) {
    preSolveSoles = [];
    lastFootSolve = null;
    return;
  }
  active.base.parent?.updateMatrixWorld(true);
  preSolveSoles = active.body.sampleFootContacts().map((contact) => ({
    side: contact.side, parentFrameX: contact.x, parentFrameY: contact.y, parentFrameZ: contact.z,
    lowestSampleY: Math.min(...(contact.points ?? [contact]).map((point) => point.y)),
    sampleYs: (contact.points ?? [contact]).map((point) => point.y),
  }));
  lastFootSolve = active.body.solveFeet(() => GROUND_Y);
  active.base.parent?.updateMatrixWorld(true);
}
function disposeActive(item: Active | null): void {
  if (!item) return;
  item.base.geometry = item.originalBody;
  item.wardrobe.geometry = item.originalWardrobe;
  item.body.dispose();
  item.compactBody.dispose(); item.compactWardrobe.dispose();
  item.kit.dispose();
  active = null;
}
function resize(): void {
  const width = canvas.clientWidth || 900, height = canvas.clientHeight || 650;
  renderer.setSize(width, height, false);
  camera.aspect = width / height; camera.updateProjectionMatrix();
  render();
}
function setGroundReferenceVisible(visible: boolean): void {
  const poseBefore = active ? boneCheckpoint(active.base) : null;
  floor.visible = visible;
  groundReferenceButton.setAttribute('aria-pressed', String(floor.visible));
  groundReferenceButton.textContent = floor.visible ? 'Hide y=0 reference' : 'Show y=0 reference';
  render(true, false);
  if (active) assertPoseCheckpointUnchanged(poseBefore ?? '', boneCheckpoint(active.base));
}
function toggleGroundReference(): void {
  setGroundReferenceVisible(!floor.visible);
}
function posedWorldBounds(): THREE.Box3 {
  if (!active) return new THREE.Box3();
  active.base.parent?.updateMatrixWorld(true);
  const result = new THREE.Box3();
  for (const mesh of [active.base, active.wardrobe]) {
    mesh.computeBoundingBox();
    if (mesh.boundingBox) result.union(mesh.boundingBox.clone().applyMatrix4(mesh.matrixWorld));
  }
  return result;
}
function fitFullBodyCamera(yaw: number, bounds = posedWorldBounds()): void {
  if (bounds.isEmpty()) throw new Error('Full-body frame has no posed actor bounds');
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  const limitingHalfFov = Math.min(verticalFov, horizontalFov) / 2;
  const distance = Math.max(0.5, sphere.radius * 1.18 / Math.sin(limitingHalfFov));
  const direction = new THREE.Vector3(Math.sin(yaw), 0.12, Math.cos(yaw)).normalize();
  const position = sphere.center.clone().addScaledVector(direction, distance);
  target.copy(sphere.center);
  camera.position.copy(position);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  framingCamera = { yaw, position: position.clone(), target: target.clone(), sourceBounds: bounds.clone() };
}
function projectedBodyBounds(): Record<string, unknown> | null {
  if (!active) return null;
  const bounds = posedWorldBounds();
  if (bounds.isEmpty()) return { empty: true, boundsInFrustum: false };
  camera.updateMatrixWorld(true);
  const points: THREE.Vector3[] = [];
  for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
    points.push(new THREE.Vector3(x, y, z).project(camera));
  }
  const xs = points.map((point) => (point.x * 0.5 + 0.5) * canvas.width);
  const ys = points.map((point) => (1 - (point.y * 0.5 + 0.5)) * canvas.height);
  const zs = points.map((point) => point.z);
  const left = Math.min(...xs), right = Math.max(...xs), top = Math.min(...ys), bottom = Math.max(...ys);
  const fullyVisible = left >= 0 && top >= 0 && right <= canvas.width && bottom <= canvas.height && Math.min(...zs) >= -1 && Math.max(...zs) <= 1;
  return { left, top, right, bottom, width: right - left, height: bottom - top,
    canvasWidth: canvas.width, canvasHeight: canvas.height, boundsInFrustum: fullyVisible,
    visibilityMeaning: 'Only eight deformed body/wardrobe AABB corners inside camera frustum; no pixel-occlusion test.' };
}
function render(updateTelemetry = true, refitCamera = true): void {
  if (!active) { renderer.render(scene, camera); return; }
  const yaw = Number(yawSelect.value) * Math.PI / 180;
  if (framingSelect.value === 'full-body') {
    if (refitCamera || !framingCamera || framingCamera.yaw !== yaw) fitFullBodyCamera(yaw);
    else {
      camera.position.copy(framingCamera.position);
      target.copy(framingCamera.target);
      camera.lookAt(target);
    }
  } else {
    framingCamera = null;
    target.set(0, 1.2, 0);
    camera.position.set(Math.sin(yaw) * 4.9, 1.38, Math.cos(yaw) * 4.9);
    camera.lookAt(target);
  }
  renderer.render(scene, camera);
  const currentBones = boneCheckpoint(active.base);
  const livePhase = appliedWalkPhase;
  document.documentElement.dataset.livePlaying = String(walkFrame !== null);
  document.documentElement.dataset.livePhase = String(livePhase);
  document.documentElement.dataset.livePoseCheckpoint = currentBones;
  if (!updateTelemetry) return;
  const canvasStats = renderer.info.render;
  const meta = {
    status: 'actual production loadBody; same actor/skeleton/look A/B', actor: active.id, seed: active.seed,
    normalizedLook: active.look, topology: active.recipe.topology, family: active.recipe.family,
    mode: modeSelect.value, pose: poseSelect.value, walkPhase: appliedWalkPhase, cameraState: {
      position: camera.position.toArray(), quaternion: camera.quaternion.toArray(),
      worldMatrix: camera.matrixWorld.toArray(), projectionMatrix: camera.projectionMatrix.toArray(),
      target: target.toArray(),
    },
    phaseControl: Number(phaseSelect.value), yawDegrees: Number(yawSelect.value),
    framing: framingSelect.value, fullBodyProjection: projectedBodyBounds(), contact: contactTelemetry(),
    groundReferenceVisible: floor.visible, renderSurface: renderSurfaceTelemetry(),
    renderOrderDiagnostic: active ? {
      floor: { path: renderOrderPath(floor), material: materialRenderState(floor), geometry: '5×5 PlaneGeometry rotated to horizontal y=0' },
      actor: [active.base, active.wardrobe].map((mesh) => ({ name: mesh.name,
        path: renderOrderPath(mesh), material: materialRenderState(mesh) })),
      rendererSort: 'Three WebGLRenderLists compare groupOrder then renderOrder ascending for opaque items.',
    } : null,
    liveWalk: window.__marketLodLiveWalk?.state() ?? null,
    exactBonePoseCheckpointAfterToggle: currentBones === active.poseCheckpoint,
    sourceTriangles: active.sourceTriangles, compactTriangles: active.compactTriangles,
    meshes: { body: 1, wardrobe: 1 }, compactStorage: modeSelect.value === 'compact' ? {
      bodyIndexBytes: active.compactBody.index?.array.byteLength ?? 0,
      wardrobeIndexBytes: active.compactWardrobe.index?.array.byteLength ?? 0,
      bodyAttributeBytes: Object.values(active.compactBody.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0),
      wardrobeAttributeBytes: Object.values(active.compactWardrobe.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0),
      totalTypedGeometryBytes: [active.compactBody, active.compactWardrobe].reduce((sum, geometry) => sum + Object.values(geometry.attributes).reduce((n, attribute) => n + attribute.array.byteLength, 0) + (geometry.index?.array.byteLength ?? 0), 0),
    } : null, renderer: { calls: canvasStats.calls, triangles: canvasStats.triangles,
      geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures },
    sourceIdentity: active.sourceIdentity,
    recipeMetrics: { body: active.recipe.body.map.metrics, wardrobe: active.recipe.wardrobe.itemMaps.map((item: any) => ({ id: item.id, ...item.metrics })) },
  };
  status.textContent = JSON.stringify(meta, null, 2);
  document.documentElement.dataset.ready = 'true';
  document.documentElement.dataset.actor = active.id;
  document.documentElement.dataset.mode = modeSelect.value;
}
function setPose(): void {
  if (!active) return;
  const pose = poseSelect.value;
  if (pose !== 'walk') pauseWalk(true);
  else if (walkFrame === null) walkElapsedBeforePlay = Number(phaseSelect.value) * WALK_CYCLE_SECONDS;
  if (pose === 'walk') {
    appliedWalkPhase = Number(phaseSelect.value);
    active.body.stride(appliedWalkPhase * Math.PI * 2, false, 0);
  } else active.body.show(pose as any, false);
  active.base.parent?.updateMatrixWorld(true);
  solveStandingContact();
  active.poseCheckpoint = boneCheckpoint(active.base);
  render();
}
function liveWalkState(): Record<string, unknown> {
  return {
    playing: walkFrame !== null, actor: active?.id ?? null, seed: active?.seed ?? null,
    mode: modeSelect.value, pose: poseSelect.value, phase: appliedWalkPhase, phaseControl: Number(phaseSelect.value),
    elapsedSeconds: walkFrame === null ? walkTotalElapsedSeconds : walkTotalElapsedSeconds + (performance.now() - walkStartedAt) / 1000,
    bonePoseCheckpoint: active ? boneCheckpoint(active.base) : null,
    renderer: active ? { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles } : null,
  };
}
function pauseWalk(renderAfter = true): void {
  if (walkFrame !== null) {
    cancelAnimationFrame(walkFrame);
    walkTotalElapsedSeconds += (performance.now() - walkStartedAt) / 1000;
  }
  walkFrame = null;
  if (active && poseSelect.value === 'walk') walkElapsedBeforePlay = appliedWalkPhase * WALK_CYCLE_SECONDS;
  playWalkButton.textContent = 'Play walk';
  document.documentElement.dataset.livePlaying = 'false';
  if (renderAfter && active) render();
}
function startWalk(): void {
  if (!active) return;
  if (walkFrame !== null) return;
  if (poseSelect.value !== 'walk') {
    poseSelect.value = 'walk';
    appliedWalkPhase = Number(phaseSelect.value);
    walkElapsedBeforePlay = appliedWalkPhase * WALK_CYCLE_SECONDS;
    active.body.stride(appliedWalkPhase * Math.PI * 2, false, 0);
    active.base.parent?.updateMatrixWorld(true);
    solveStandingContact();
    active.poseCheckpoint = boneCheckpoint(active.base);
  }
  fitFullBodyCameraIfSelected();
  const startedAt = performance.now();
  walkStartedAt = startedAt;
  playWalkButton.textContent = 'Pause walk';
  document.documentElement.dataset.livePlaying = 'true';
  const tick = (now: number): void => {
    if (!active || walkFrame === null) return;
    const elapsedInCycle = walkElapsedBeforePlay + (now - walkStartedAt) / 1000;
    const totalElapsed = walkTotalElapsedSeconds + (now - walkStartedAt) / 1000;
    const phase = (elapsedInCycle / WALK_CYCLE_SECONDS) % 1;
    phaseSelect.value = phase.toFixed(4); // The range control may snap this display value to its coarser step.
    appliedWalkPhase = phase;
    active.body.stride(appliedWalkPhase * Math.PI * 2, false, 0);
    active.base.parent?.updateMatrixWorld(true);
    solveStandingContact();
    active.poseCheckpoint = boneCheckpoint(active.base);
    render(false, false);
    document.documentElement.dataset.liveElapsedSeconds = totalElapsed.toFixed(3);
    if (now - lastLiveStatusAt >= 400) {
      lastLiveStatusAt = now;
      render(true, false);
    }
    walkFrame = requestAnimationFrame(tick);
  };
  walkFrame = requestAnimationFrame(tick);
  render();
}
function toggleWalkPlayback(): void {
  if (walkFrame !== null) pauseWalk();
  else startWalk();
}
function fitFullBodyCameraIfSelected(): void {
  if (active && framingSelect.value === 'full-body') fitFullBodyCamera(Number(yawSelect.value) * Math.PI / 180);
}
function toggleMode(): void {
  if (!active) return;
  const before = boneCheckpoint(active.base);
  active.base.geometry = modeSelect.value === 'compact' ? active.compactBody : active.originalBody;
  active.wardrobe.geometry = modeSelect.value === 'compact' ? active.compactWardrobe : active.originalWardrobe;
  const after = boneCheckpoint(active.base);
  if (before !== after) throw new Error('Geometry A/B mutated the live skeleton pose');
  active.poseCheckpoint = before;
  render(true, walkFrame === null && framingSelect.value !== 'full-body');
}
async function loadSelected(): Promise<void> {
  pauseWalk(false);
  walkTotalElapsedSeconds = 0;
  walkElapsedBeforePlay = Number(phaseSelect.value) * 2.4;
  framingCamera = null;
  const request = ++generation;
  const traceGeneration = ++loadGeneration;
  const trace = (stage: string, details: Record<string, unknown> = {}): void => {
    loadTrace.push({ generation: traceGeneration, actorId: actorSelect.value, stage,
      performanceNowMs: Math.round(performance.now() * 1000) / 1000, epochMs: Date.now(), ...details });
    if (loadTrace.length > 80) loadTrace.splice(0, loadTrace.length - 80);
  };
  trace('selection-start');
  loadButton.disabled = true;
  status.textContent = 'Loading one saved Market actor and preparing its same-actor compact A/B…';
  disposeActive(active);
  const actor = fixture?.fixture.crowd.find((item) => item.id === actorSelect.value);
  if (!actor) throw new Error('Selected saved Market actor missing');
  const kit = createKit();
  let body: SkinnedBody | null = null, compactBody: THREE.BufferGeometry | null = null, compactWardrobe: THREE.BufferGeometry | null = null;
  try {
    const look = normalizeLook(actor.look, actor.seed);
    trace('body-load-start', { family: look.body });
    body = await loadBody(kit, look, actor.seed, 1);
    trace('body-load-resolved', { bodyKey: body.key, requestGenerationCurrent: request === generation });
    if (request !== generation) { body.dispose(); kit.dispose(); return; }
    const base = meshAt(body.object, `body-${body.key}`), wardrobe = meshAt(body.object, 'avatar-wardrobe');
    if (!wardrobe.visible) throw new Error(`${actor.id}: production wardrobe missing`);
    const items = body.wardrobe.itemTriangles as Record<string, number>;
    trace('recipe-start');
    const recipe = await makeRecipe(actor, look, base, wardrobe, items, trace);
    trace('recipe-resolved', { requestGenerationCurrent: request === generation });
    if (request !== generation) { body.dispose(); kit.dispose(); return; }
    const bodySource = sourceOf(base), wardrobeSource = sourceOf(wardrobe);
    compactBody = gatheredGeometry(base.geometry, recipe.body.map.sourceVertex, recipe.body.map.index);
    compactWardrobe = gatheredWardrobe(wardrobe.geometry, recipe.wardrobe.itemMaps);
    const originalBody = base.geometry, originalWardrobe = wardrobe.geometry;
    const sourceTriangles = bodySource.index.length / 3 + wardrobeSource.index.length / 3;
    const compactTriangles = recipe.body.map.index.length / 3 + recipe.wardrobe.itemMaps.reduce((sum: number, item: any) => sum + item.index.length / 3, 0);
    const source = recipe.body.identity as Record<string, unknown>;
    scene.add(body.object);
    body.place(0, 0, 0, 0);
    base.geometry = originalBody; wardrobe.geometry = originalWardrobe;
    active = { id: actor.id, seed: actor.seed, look, kit, body, base, wardrobe, originalBody, originalWardrobe,
      compactBody, compactWardrobe, sourceTriangles, compactTriangles, sourceIdentity: source, recipe, poseCheckpoint: '' };
    trace('actor-published', { bodyKey: body.key });
    compactBody = null; compactWardrobe = null; body = null;
    setPose();
    toggleMode();
  } catch (error) {
    trace('load-failed', { message: error instanceof Error ? error.message : String(error) });
    compactBody?.dispose(); compactWardrobe?.dispose();
    body?.dispose(); kit.dispose();
    throw error;
  } finally { loadButton.disabled = false; }
}
function saveCanvas(): void {
  render(true, walkFrame === null && framingSelect.value !== 'full-body');
  const link = document.createElement('a');
  link.download = `${actorSelect.value}-${modeSelect.value}-${poseSelect.value}-yaw${yawSelect.value}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}
async function start(): Promise<void> {
  await MeshoptSimplifier.ready;
  MeshoptSimplifier.useExperimentalFeatures = true;
  const response = await fetch('/evidence/graphics-loop/venue-authored-people-browser-v1/candidate-market-day-12.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Market fixture HTTP ${response.status}`);
  fixture = await response.json() as Fixture;
  if (fixture.fixture.city !== 'lagos' || fixture.fixture.crowd.length !== 12) throw new Error('Unexpected saved Market fixture');
  const options = ['graphics-host-crowd-03', 'graphics-host-crowd-09', 'graphics-host-crowd-05', 'graphics-host-crowd-02'];
  for (const id of options) {
    const actor = fixture.fixture.crowd.find((item) => item.id === id);
    if (!actor) throw new Error(`Missing expected saved Market identity ${id}`);
    const option = document.createElement('option'); option.value = id;
    option.textContent = `${id} · ${(actor.look as any).body} · ${(actor.look as any).outfit} · ${(actor.look as any).face}/${(actor.look as any).expression}`;
    actorSelect.append(option);
  }
  window.__marketLodLiveWalk = { play: startWalk, pause: () => pauseWalk(), state: liveWalkState,
    loadTrace: () => loadTrace.map((entry) => ({ ...entry })) };
  window.__marketLodGroundReference = { setVisible: setGroundReferenceVisible, state: () => floor.visible };
  resize();
  loadButton.addEventListener('click', () => { void loadSelected().catch((error) => { status.textContent = `Rejected: ${error instanceof Error ? error.stack ?? error.message : String(error)}`; loadButton.disabled = false; }); });
  modeSelect.addEventListener('change', () => { try { toggleMode(); } catch (error) { status.textContent = String(error); } });
  poseSelect.addEventListener('change', setPose);
  // Camera rotation must never resample the live rig from the coarse phase control.
  yawSelect.addEventListener('change', () => { framingCamera = null; render(); });
  phaseSelect.addEventListener('change', () => { pauseWalk(false); setPose(); });
  framingSelect.addEventListener('change', () => { framingCamera = null; render(); });
  playWalkButton.addEventListener('click', toggleWalkPlayback);
  groundReferenceButton.addEventListener('click', toggleGroundReference);
  renderButton.addEventListener('click', render);
  captureButton.addEventListener('click', saveCanvas);
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', () => {
    generation++; pauseWalk(false); window.__marketLodLiveWalk = undefined; window.__marketLodGroundReference = undefined;
    disposeActive(active); renderer.dispose(); floor.geometry.dispose(); floor.material.dispose();
  }, { once: true });
  document.documentElement.dataset.ready = 'controls-ready';
  status.textContent = 'Ready. Load one actual saved Market actor; A/B uses that actor’s own source attributes and live skeleton.';
}
void start().catch((error) => { status.textContent = `Startup rejected: ${error instanceof Error ? error.stack ?? error.message : String(error)}`; });
