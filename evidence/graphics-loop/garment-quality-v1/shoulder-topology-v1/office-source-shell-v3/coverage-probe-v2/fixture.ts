import * as THREE from 'three';
import type { SkinnedBody } from '/src/scene/body/skinned.ts';
import { createAvatarAppearanceController } from '/src/scene/body/appearance.ts';
import { normalizeAvatarAppearance } from '/src/types/avatar.ts';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { BODY_FILES } from '/src/scene/body/files.ts';
import { buildWardrobeGeometry, captureWardrobeRestFrame } from '/src/scene/wardrobe/geometry.ts';
import type { ResolvedWardrobeLook } from '/src/scene/wardrobe/geometry.ts';
import { resolveAvatarWearablesForRenderer } from '/src/game/wardrobe/rules.ts';
import { buildExpandedOfficeShell } from '../../office-source-shell-v2/office-expanded-shell.ts';
import { buildOfficeSourceCornerChart } from '../source-corner-chart.ts';
import { sourceCornerSkinningHook, SOURCE_CORNER_SKINNING_CACHE_KEY } from '../source-corner-skinning-adapter.ts';
import { auditSourceMaskCoverage, type SourceMaskCoverageReport } from './coverage.ts';

type ShellRecord = { mesh: THREE.SkinnedMesh; kind: 'source' | 'chart'; geometry: THREE.BufferGeometry; material: THREE.Material };
export type FixtureAugmentation = Readonly<{
  shellTriangles: number;
  shellVertices: number;
  shellBytes: number;
  shellAttributeCount: number;
  retainedWardrobeTriangles: number;
  removedSyntheticTopTriangles: number;
  drawCallsForWardrobe: number;
  shellSourceFaceCount: number;
  sharedTopologyFingerprint: string;
  shaderAdapterKey: string | null;
  sourceIndexSha256: string;
  sourceAttributeSha256: string;
  sourceTriangleCount: number;
  appearanceReplayMatchesDisplayed: boolean;
  rawPositionEncodingBeforeAppearance: string;
  currentPositionEncodingAfterAppearance: string;
  rawNormalEncodingBeforeAppearance: string;
  currentNormalEncodingAfterAppearance: string;
  bindDiagnostics: Readonly<Record<string, unknown>>;
  sourceNormalProvenance: Readonly<Record<string, unknown>>;
  displayedMaskTriangles: number;
  sourceMaskCoverage: SourceMaskCoverageReport;
  dispose(): void;
}>;

const SOURCE_BODY_SHA256 = Object.freeze({
  male: 'b0078206da9f7de0bf346be8133522cf514009f03f262f716613dd196d180686',
  female: '977ca5e73ba7b19af2627dab1ba0f0ef3e3d8548bf7b4d54f45faf22cd56001c',
});
type RecoveredSource = { index: Uint16Array | Uint32Array; sourceIndexSha256: string; sourceAttributeSha256: string; triangles: number; appearanceReplayMatchesDisplayed: true; rawPositionEncodingBeforeAppearance: string; currentPositionEncodingAfterAppearance: string; rawNormalEncodingBeforeAppearance: string; currentNormalEncodingAfterAppearance: string; bindDiagnostics: Readonly<Record<string, unknown>> };
const recoveredSources = new Map<string, Promise<RecoveredSource>>();
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');
async function sha256(bytes: BufferSource): Promise<string> { return hex(await crypto.subtle.digest('SHA-256', bytes)); }

function baseMesh(body: SkinnedBody): THREE.SkinnedMesh {
  const mesh = body.object.getObjectByName(`body-${body.key}`) as THREE.SkinnedMesh | null;
  if (!mesh?.isSkinnedMesh) throw new Error(`Missing actual skinned source body ${body.key}`);
  return mesh;
}
function wardrobeMesh(body: SkinnedBody): THREE.SkinnedMesh {
  const mesh = body.object.getObjectByName('avatar-wardrobe') as THREE.SkinnedMesh | null;
  if (!mesh?.isSkinnedMesh || !mesh.geometry.index || mesh.geometry.groups.length !== 0) throw new Error('Expected the production one-material indexed wardrobe overlay');
  return mesh;
}
function attributeBytes(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Uint8Array {
  const array = attribute.array;
  return new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
}
function equalBytes(a: Uint8Array, b: Uint8Array): boolean { return a.length === b.length && a.every((value, index) => value === b[index]); }
function attributeEncoding(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): string { return `${attribute.array.constructor.name}[${attribute.itemSize}]${attribute.normalized ? ':normalized' : ''}:count=${attribute.count}`; }
function matrixWitness(a: THREE.Matrix4, b: THREE.Matrix4) { const finite = a.elements.every(Number.isFinite) && b.elements.every(Number.isFinite); return { finite, maxAbsDelta: finite ? Math.max(...a.elements.map((value, index) => Math.abs(value - b.elements[index]!))) : null, a: [...a.elements], b: [...b.elements] }; }
function inverseFor(mesh: THREE.SkinnedMesh): THREE.Matrix4 { return mesh.bindMode === 'attached' ? mesh.matrixWorld.clone().invert() : mesh.bindMatrix.clone().invert(); }
function normalStats(geometry: THREE.BufferGeometry, index: THREE.BufferAttribute) {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!position || !normal || index.count % 3 !== 0) throw new Error('Normal audit requires position/normal attributes and triangle indices');
  const zeroVertices: number[] = []; let nonFiniteNormals = 0;
  for (let vertex = 0; vertex < normal.count; vertex++) {
    const x = normal.getX(vertex), y = normal.getY(vertex), z = normal.getZ(vertex);
    if (![x, y, z].every(Number.isFinite)) nonFiniteNormals++;
    else if (x === 0 && y === 0 && z === 0) zeroVertices.push(vertex);
  }
  let degenerateFaces = 0, nonFiniteFaces = 0, facesTouchingZeroNormal = 0; const zeroNormalFaceIds: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), ab = new THREE.Vector3(), ac = new THREE.Vector3();
  const zeros = new Set(zeroVertices);
  for (let at = 0; at < index.count; at += 3) {
    const ia = index.getX(at), ib = index.getX(at + 1), ic = index.getX(at + 2);
    a.fromBufferAttribute(position, ia); b.fromBufferAttribute(position, ib); c.fromBufferAttribute(position, ic);
    ab.subVectors(b, a); ac.subVectors(c, a); const areaSq = ab.cross(ac).lengthSq();
    if (!Number.isFinite(areaSq)) nonFiniteFaces++; else if (areaSq === 0) degenerateFaces++;
    if (zeros.has(ia) || zeros.has(ib) || zeros.has(ic)) { facesTouchingZeroNormal++; if (zeroNormalFaceIds.length < 32) zeroNormalFaceIds.push(at / 3); }
  }
  return { vertexCount: position.count, normalCount: normal.count, zeroNormalVertexIds: zeroVertices, zeroNormalVertices: zeroVertices.length, nonFiniteNormals, triangleCount: index.count / 3, degenerateFaces, nonFiniteFaces, facesTouchingZeroNormal, zeroNormalFaceIdsSample: zeroNormalFaceIds };
}
function bytesSha(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): Promise<string> { return sha256(attributeBytes(attribute)); }
function bonesWitness(a: THREE.Skeleton, b: THREE.Skeleton) { const count = Math.max(a.bones.length, b.bones.length), bones = []; let namesEqual = a.bones.length === b.bones.length, inverseBindMaxAbsDelta = 0, finite = true; for (let i = 0; i < count; i++) { const left = a.bones[i], right = b.bones[i], leftInverse = a.boneInverses[i], rightInverse = b.boneInverses[i]; if (!left || !right || !leftInverse || !rightInverse) { namesEqual = false; finite = false; bones.push({ index: i, missing: true }); continue; } const inverse = matrixWitness(leftInverse, rightInverse); namesEqual &&= left.name === right.name; finite &&= inverse.finite; if (inverse.maxAbsDelta !== null) inverseBindMaxAbsDelta = Math.max(inverseBindMaxAbsDelta, inverse.maxAbsDelta); bones.push({ index: i, rawName: left.name, displayedName: right.name, namesEqual: left.name === right.name, inverseBindMaxAbsDelta: inverse.maxAbsDelta, ...(inverse.maxAbsDelta === 0 ? {} : { rawInverseBind: [...leftInverse.elements], displayedInverseBind: [...rightInverse.elements] }) }); } return { rawCount: a.bones.length, displayedCount: b.bones.length, namesEqual, finite, inverseBindMaxAbsDelta, bones }; }
function assertSameAttribute(a: THREE.BufferAttribute, b: THREE.BufferAttribute, name: string): void {
  if (a.itemSize !== b.itemSize || a.count !== b.count || a.normalized !== b.normalized || a.array.constructor !== b.array.constructor) throw new Error(`${name} layout differs between zero-ease and exact chart`);
  const x = attributeBytes(a), y = attributeBytes(b);
  if (x.length !== y.length || x.some((value, index) => value !== y[index])) throw new Error(`${name} bytes differ between zero-ease and exact chart`);
}
function filterSyntheticTop(body: SkinnedBody, wardrobe: THREE.SkinnedMesh, rest: ReturnType<typeof captureWardrobeRestFrame>, hemY: number): { kept: number; removed: number } {
  const geometry = wardrobe.geometry, position = geometry.getAttribute('position'), index = geometry.index;
  if (!position || !index) throw new Error('Production overlay is not indexed');
  if (geometry.drawRange.start !== 0 || !(geometry.drawRange.count === Infinity || geometry.drawRange.count >= index.count)) throw new Error('Unexpected overlay draw range; refusing a partial-index split');
  const itemRanges: { key: string; start: number; end: number }[] = [];
  let cursor = 0;
  for (const [key, triangles] of Object.entries(body.wardrobe.itemTriangles)) {
    if (!Number.isInteger(triangles) || triangles < 0) throw new Error(`Invalid production item triangle count for ${key}`);
    itemRanges.push({ key, start: cursor, end: cursor + triangles }); cursor += triangles;
  }
  if (cursor !== index.count / 3) throw new Error(`Wardrobe item ranges ${cursor} do not match active source indices ${index.count / 3}`);
  const officeRange = itemRanges.filter(range => range.key === 'outfit:office');
  if (officeRange.length !== 1 || officeRange[0]!.end <= officeRange[0]!.start) throw new Error('Cannot identify exactly one office outfit item range');
  const office = officeRange[0]!;
  const kept: number[] = [];
  let removed = 0;
  for (let triangle = 0; triangle < index.count / 3; triangle++) {
    const i = triangle * 3;
    const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const y = ids.map(id => new THREE.Vector3().fromBufferAttribute(position, id).applyMatrix4(rest.metresFromMesh).y);
    // The production office builder emits trousers first at/below this hem and its synthetic shirt above; item ranges outside `outfit:office` remain byte-for-byte indexed (hair/shoes/accessories are never y-filtered).
    // Keep only triangles wholly on the lower side; exact-boundary faces remain with the trouser section.
    if (triangle < office.start || triangle >= office.end || Math.max(...y) <= hemY + 0.00025) kept.push(...ids);
    else removed++;
  }
  if (!removed || kept.length === 0) throw new Error(`Office synthetic-top split was not identifiable (kept=${kept.length / 3}, removed=${removed})`);
  const IndexArray = position.count <= 65535 ? Uint16Array : Uint32Array;
  const filteredIndex = new THREE.BufferAttribute(new IndexArray(kept), 1);
  geometry.setIndex(filteredIndex);
  filteredIndex.needsUpdate = true;
  return { kept: kept.length / 3, removed };
}
function cloneFabricMaterial(source: THREE.Material, chart: boolean): THREE.Material {
  if (Array.isArray(source)) throw new Error('Wardrobe must use one fabric material');
  const material = source.clone();
  // THREE.Material.copy intentionally does not copy custom callbacks. Reuse the exact production
  // fabric callback (including its uWardrobeFabric closure) on the isolated clone before adding
  // the position-only chart adapter, and preserve its production cache key on the source variant.
  const fabricCompile = source.onBeforeCompile, fabricKey = source.customProgramCacheKey;
  material.onBeforeCompile = (shader, renderer) => fabricCompile.call(source, shader, renderer);
  material.customProgramCacheKey = () => fabricKey.call(source);
  if (chart) {
    material.onBeforeCompile = sourceCornerSkinningHook(material);
    material.customProgramCacheKey = () => SOURCE_CORNER_SKINNING_CACHE_KEY;
  }
  return material;
}
function sharedFingerprint(geometry: THREE.BufferGeometry): string {
  let h = 2166136261 >>> 0;
  const update = (data: Uint8Array) => { for (const byte of data) { h ^= byte; h = Math.imul(h, 16777619) >>> 0; } };
  for (const name of ['position', 'normal', 'color', 'wardrobeUv', 'wardrobeCloth', 'skinIndex', 'skinWeight']) { const attr = geometry.getAttribute(name) as THREE.BufferAttribute; update(new TextEncoder().encode(name)); update(attributeBytes(attr)); }
  if (geometry.index) update(attributeBytes(geometry.index as THREE.BufferAttribute));
  return h.toString(16).padStart(8, '0');
}

function disposeParsedScene(scene: THREE.Scene): void {
  const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
  scene.traverse(object => {
    const mesh = object as THREE.Mesh;
    if (mesh.geometry?.isBufferGeometry) geometries.add(mesh.geometry);
    const owned = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
    for (const material of owned) {
      materials.add(material);
      for (const value of Object.values(material)) if ((value as THREE.Texture | null)?.isTexture) textures.add(value as THREE.Texture);
    }
  });
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
}

async function recoverFullSource(body: SkinnedBody, base: THREE.SkinnedMesh, look: Readonly<{ appearance?: unknown; face: unknown; expression: unknown }>): Promise<RecoveredSource> {
  const key = body.key;
  const cached = recoveredSources.get(key);
  if (cached) return cached;
  const promise = (async () => {
    const url = key === 'male' ? BODY_FILES.male : key === 'female' ? BODY_FILES.female : null;
    if (!url) throw new Error(`No pinned source GLB for body family ${key}`);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not fetch full source body for ${key}: ${response.status}`);
    const bytes = await response.arrayBuffer(), bodySha = await sha256(bytes);
    if (bodySha !== SOURCE_BODY_SHA256[key]) throw new Error(`Full source GLB hash mismatch for ${key}: ${bodySha}`);
    await MeshoptDecoder.ready;
    const gltf = await loader.parseAsync(bytes, '');
    try {
      gltf.scene.updateMatrixWorld(true);
      const rawCandidates: THREE.SkinnedMesh[] = [];
      gltf.scene.traverse(node => { if ((node as THREE.SkinnedMesh).isSkinnedMesh && rawCandidates.length === 0) rawCandidates.push(node as THREE.SkinnedMesh); });
      const raw = rawCandidates[0] ?? null;
      if (!raw?.isSkinnedMesh || !raw.geometry.index) throw new Error(`Raw GLB is missing indexed body-${key}`);
      const displayedIndex = base.geometry.index;
      if (!displayedIndex || raw.geometry.index.itemSize !== displayedIndex.itemSize || raw.geometry.index.normalized !== displayedIndex.normalized || raw.geometry.index.array.constructor !== displayedIndex.array.constructor || raw.geometry.index.count !== displayedIndex.count || raw.geometry.index.count % 3 !== 0) throw new Error('Raw source index layout does not match the displayed body mesh');
      const rawNames = Object.keys(raw.geometry.attributes).sort(), displayNames = Object.keys(base.geometry.attributes).sort();
      if (JSON.stringify(rawNames) !== JSON.stringify(displayNames)) throw new Error('Raw source body attribute names differ from displayed production body');
      const rawPosition = raw.geometry.getAttribute('position') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
      if (!rawPosition || rawPosition.itemSize !== 3 || rawPosition.count === 0 || !(rawPosition.array instanceof Uint16Array) || rawPosition.normalized) throw new Error('Pinned GLB no longer has the expected quantized unsigned-short position accessor');
      const rawPositionEncodingBeforeAppearance = attributeEncoding(rawPosition);
      const rawNormal = raw.geometry.getAttribute('normal') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
      if (!rawNormal || rawNormal.itemSize !== 3 || rawNormal.count !== raw.geometry.getAttribute('position')?.count || !(rawNormal.array instanceof Int8Array) || !rawNormal.normalized) throw new Error('Pinned GLB no longer has the expected quantized signed-byte normal accessor');
      const rawNormalEncodingBeforeAppearance = attributeEncoding(rawNormal);
      // Both raw GLBs store normals as normalized signed bytes. The pinned recorded look falls back to
      // smile, so loadBody's production appearance controller replaces positions/normals with Float32
      // attributes after wardrobe masking. Replay that exact operation on this private parse after
      // copying the displayed in-place mask; then require every current attribute byte to match.
      if (look.face !== 'oval' || look.expression !== 'smile' || normalizeAvatarAppearance(look.appearance).ageAppearance !== 'adult') throw new Error('Pinned fixture appearance changed; update the explicit appearance replay contract');
      const fullSourceIndex = raw.geometry.index as THREE.BufferAttribute;
      const copiedFullSourceIndex = (fullSourceIndex.array as Uint16Array | Uint32Array).slice();
      const sourceIndexSha256 = await sha256(attributeBytes(fullSourceIndex));
      const displayedIndexForReplay = base.geometry.index;
      if (!displayedIndexForReplay || displayedIndexForReplay.array.constructor !== fullSourceIndex.array.constructor || displayedIndexForReplay.count !== fullSourceIndex.count) throw new Error('Displayed mask index layout differs from full source before appearance replay');
      raw.geometry.setIndex(displayedIndexForReplay.clone());
      raw.geometry.setDrawRange(base.geometry.drawRange.start, base.geometry.drawRange.count);
      raw.geometry.clearGroups();
      for (const group of base.geometry.groups) raw.geometry.addGroup(group.start, group.count, group.materialIndex);
      const appearance = createAvatarAppearanceController(raw);
      if (!appearance.ok) throw new Error(`Could not replay production appearance on private raw source: ${appearance.reason}`);
      try {
        const applied = appearance.controller.apply(normalizeAvatarAppearance(look.appearance), look.face, look.expression);
        if (!applied.ok) throw new Error(`Production appearance replay failed: ${applied.reason}`);
        const replayedPosition = raw.geometry.getAttribute('position') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
        if (!(replayedPosition.array instanceof Float32Array) || replayedPosition.normalized || replayedPosition.count !== rawPosition.count) throw new Error(`Expected smile appearance to rebuild quantized positions as Float32, received ${attributeEncoding(replayedPosition)}`);
        const currentPositionEncodingAfterAppearance = attributeEncoding(replayedPosition);
        const replayedNormal = raw.geometry.getAttribute('normal') as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
        if (!(replayedNormal.array instanceof Float32Array) || replayedNormal.normalized || replayedNormal.count !== raw.geometry.getAttribute('position')?.count) throw new Error(`Expected smile appearance to rebuild quantized normals as Float32, received ${attributeEncoding(replayedNormal)}`);
        const currentNormalEncodingAfterAppearance = attributeEncoding(replayedNormal);
        const attrDigests: Record<string, string> = {};
        for (const name of rawNames) {
          const source = raw.geometry.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute, display = base.geometry.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
          if (source.itemSize !== display.itemSize || source.count !== display.count || source.normalized !== display.normalized || source.array.constructor !== display.array.constructor) throw new Error(`Replayed actual-look source layout differs from displayed body: ${name} (raw=${attributeEncoding(source)}, display=${attributeEncoding(display)})`);
          if (!equalBytes(attributeBytes(source), attributeBytes(display))) throw new Error(`Replayed actual-look source bytes differ from displayed body: ${name}`);
          attrDigests[name] = await sha256(attributeBytes(display));
        }
        if (copiedFullSourceIndex.constructor !== displayedIndex.array.constructor) throw new Error('Raw GLB full index component type differs from displayed body');
        const sourceAttributeSha256 = await sha256(new TextEncoder().encode(JSON.stringify(attrDigests))); 
        // Attached SkinnedMesh instances derive bindMatrixInverse from their current world matrix.
        // Production applies avatar fit on a parent; the standalone GLTF parse has a different world matrix.
        gltf.scene.updateMatrixWorld(true);
        body.object.updateMatrixWorld(true);
        const rawBindInverseExpected = inverseFor(raw), displayedBindInverseExpected = inverseFor(base);
        const bindDiagnostics = {
          bindMode: { raw: raw.bindMode, displayed: base.bindMode, equal: raw.bindMode === base.bindMode },
          localMatrix: matrixWitness(raw.matrix, base.matrix),
          worldMatrix: matrixWitness(raw.matrixWorld, base.matrixWorld),
          bindMatrix: matrixWitness(raw.bindMatrix, base.bindMatrix),
          bindMatrixInverseRawVsDisplayed: matrixWitness(raw.bindMatrixInverse, base.bindMatrixInverse),
          rawInverseVsCanonical: matrixWitness(raw.bindMatrixInverse, rawBindInverseExpected),
          displayedInverseVsCanonical: matrixWitness(base.bindMatrixInverse, displayedBindInverseExpected),
          bones: bonesWitness(raw.skeleton, base.skeleton),
        };
        const matrixEntries = [bindDiagnostics.localMatrix, bindDiagnostics.worldMatrix, bindDiagnostics.bindMatrix, bindDiagnostics.bindMatrixInverseRawVsDisplayed, bindDiagnostics.rawInverseVsCanonical, bindDiagnostics.displayedInverseVsCanonical] as Array<{ finite: boolean; maxAbsDelta: number | null }>;
        const matricesFinite = matrixEntries.every(item => item.finite && item.maxAbsDelta !== null);
        const canonicalInverseDelta = Math.max(bindDiagnostics.rawInverseVsCanonical.maxAbsDelta ?? Infinity, bindDiagnostics.displayedInverseVsCanonical.maxAbsDelta ?? Infinity);
        const bindOK = bindDiagnostics.bindMode.equal && bindDiagnostics.localMatrix.maxAbsDelta === 0 && bindDiagnostics.bindMatrix.maxAbsDelta === 0 && bindDiagnostics.bones.namesEqual && bindDiagnostics.bones.finite && bindDiagnostics.bones.inverseBindMaxAbsDelta === 0 && matricesFinite && canonicalInverseDelta === 0;
        if (!bindOK) throw new Error(`Raw/displayed source binding witness failed: ${JSON.stringify(bindDiagnostics)}`);
        return { index: copiedFullSourceIndex, sourceIndexSha256, sourceAttributeSha256, triangles: copiedFullSourceIndex.length / 3, appearanceReplayMatchesDisplayed: true, rawPositionEncodingBeforeAppearance, currentPositionEncodingAfterAppearance, rawNormalEncodingBeforeAppearance, currentNormalEncodingAfterAppearance, bindDiagnostics };
      } finally { appearance.controller.dispose(); }
    } finally { disposeParsedScene(gltf.scene); }
  })();
  recoveredSources.set(key, promise);
  try { return await promise; } catch (error) { recoveredSources.delete(key); throw error; }
}

async function privateFullSourceMesh(base: THREE.SkinnedMesh, source: RecoveredSource): Promise<{ mesh: THREE.SkinnedMesh; normalProvenance: Readonly<Record<string, unknown>>; maskedZeroNormalVertexIds: ReadonlySet<number> }> {
  const geometry = base.geometry.clone();
  geometry.setIndex(new THREE.BufferAttribute(source.index.slice(), 1));
  const fullIndex = geometry.index as THREE.BufferAttribute;
  const maskedTopology = normalStats(geometry, fullIndex);
  const maskedZeroNormalVertexIds = new Set(maskedTopology.zeroNormalVertexIds);
  const { zeroNormalVertexIds: _maskedIds, zeroNormalFaceIdsSample: maskedZeroFaceSample, ...maskedTopologySummary } = maskedTopology;
  const names = Object.keys(geometry.attributes).filter(name => name !== 'normal');
  const before = new Map<string, { layout: string; bytes: Uint8Array; sha256: string }>();
  for (const name of names) {
    const attribute = geometry.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
    before.set(name, { layout: attributeEncoding(attribute), bytes: attributeBytes(attribute).slice(), sha256: await bytesSha(attribute) });
  }
  const indexBefore = attributeBytes(fullIndex).slice(), fullIndexSha256 = await bytesSha(fullIndex);
  if (fullIndexSha256 !== source.sourceIndexSha256) throw new Error('Private full index does not match untouched raw GLB index SHA');
  // Only this private clone gets full-topology normals. Production appearance ran computeVertexNormals()
  // after its body mask compacted the index, leaving excluded vertices with zero normals. Restoring the
  // source index first makes the normal field correspond to the complete source garment support.
  geometry.computeVertexNormals();
  const fullTopology = normalStats(geometry, fullIndex);
  for (const name of names) {
    const attribute = geometry.getAttribute(name) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute, original = before.get(name)!;
    if (attributeEncoding(attribute) !== original.layout || !equalBytes(attributeBytes(attribute), original.bytes) || await bytesSha(attribute) !== original.sha256) throw new Error(`Full-source normal rebuild changed non-normal attribute ${name}`);
  }
  if (!equalBytes(attributeBytes(fullIndex), indexBefore) || await bytesSha(fullIndex) !== fullIndexSha256) throw new Error('Full-source normal rebuild changed source index');
  if (fullTopology.triangleCount !== 9002 || fullTopology.nonFiniteNormals || fullTopology.nonFiniteFaces || fullTopology.degenerateFaces) throw new Error(`Full-source topology is not finite/nondegenerate: ${JSON.stringify({ triangleCount: fullTopology.triangleCount, nonFiniteNormals: fullTopology.nonFiniteNormals, nonFiniteFaces: fullTopology.nonFiniteFaces, degenerateFaces: fullTopology.degenerateFaces })}`);
  const sourceNormalProvenance = {
    derivedFrom: 'private-current-appearance-position-attributes + saved-full-GLB-index via THREE.BufferGeometry.computeVertexNormals',
    productionDisplayedNormalsMutated: false,
    normalOnlyMutation: true,
    fullIndexSha256,
    positionSha256: before.get('position')?.sha256 ?? null,
    skinIndexSha256: before.get('skinIndex')?.sha256 ?? null,
    skinWeightSha256: before.get('skinWeight')?.sha256 ?? null,
    maskedTopology: { ...maskedTopologySummary, zeroNormalFaceIdsSample: maskedZeroFaceSample },
    fullTopology: { ...fullTopology, zeroNormalVertexIds: undefined },
    nonNormalAttributesByteIdentical: true,
    fullIndexByteIdentical: true,
  };
  const mesh = new THREE.SkinnedMesh(geometry, base.material);
  mesh.position.copy(base.position); mesh.quaternion.copy(base.quaternion); mesh.scale.copy(base.scale);
  mesh.matrix.copy(base.matrix); mesh.matrixAutoUpdate = base.matrixAutoUpdate;
  mesh.bindMode = base.bindMode; mesh.bind(base.skeleton, base.bindMatrix.clone());
  mesh.updateMatrixWorld(true);
  return { mesh, normalProvenance: sourceNormalProvenance, maskedZeroNormalVertexIds };
}
function sameZeroEaseChart(a: THREE.BufferGeometry, b: THREE.BufferGeometry): void {
  const shared = ['position', 'normal', 'color', 'wardrobeUv', 'wardrobeCloth', 'skinIndex', 'skinWeight'];
  for (const name of shared) {
    const aa = a.getAttribute(name), bb = b.getAttribute(name);
    if (!aa || !bb) throw new Error(`Missing chart attribute ${name}`);
    assertSameAttribute(aa as THREE.BufferAttribute, bb as THREE.BufferAttribute, name);
  }
  if (!a.index || !b.index || a.index.count !== b.index.count) throw new Error('Source-face index counts differ');
  const ia = attributeBytes(a.index as THREE.BufferAttribute), ib = attributeBytes(b.index as THREE.BufferAttribute);
  if (ia.length !== ib.length || ia.some((value, i) => value !== ib[i])) throw new Error('Source-face index bytes differ');
}

/**
 * Applies the controlled GPU comparison after the actual production wardrobe has built and masked its body.
 * Both variants retain the exact production body mask, lower outfit, material/color inputs, skeleton and source mesh.
 * Only the generated shirt above the office hem is replaced by the v2 zero-ease chart; the right-side variant
 * adds the exact source-corner position adapter. The test intentionally adds one chart draw to the one retained
 * production wardrobe draw and reports its triangles/bytes separately.
 */
export async function applyOfficeSourceChart(body: SkinnedBody, kind: 'source' | 'chart', look: Readonly<{ appearance?: unknown; face: unknown; expression: unknown }>): Promise<FixtureAugmentation> {
  if (body.wardrobeError) throw new Error(body.wardrobeError);
  const base = baseMesh(body), wardrobe = wardrobeMesh(body), source = await recoverFullSource(body, base, look);
  const displayedNormal = base.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (!displayedNormal) throw new Error('Displayed body normal is missing');
  const displayedNormalBytes = attributeBytes(displayedNormal).slice();
  const fullSource = await privateFullSourceMesh(base, source), sourceBase = fullSource.mesh, rest = captureWardrobeRestFrame(sourceBase);
  const displayedIndex = base.geometry.index;
  if (!displayedIndex || base.geometry.drawRange.start !== 0 || !Number.isInteger(base.geometry.drawRange.count) || base.geometry.drawRange.count >= displayedIndex.count) { sourceBase.geometry.dispose(); throw new Error('Expected the production body mask to retain a partial draw range'); }
  const displayedMaskIndexBytes = attributeBytes(displayedIndex).slice(), displayedMaskDrawRange = { ...base.geometry.drawRange };
  const hip = rest.bones.get('pelvis')?.point, neck = rest.bones.get('neck_01')?.point;
  if (!hip || !neck) { sourceBase.geometry.dispose(); throw new Error('Actual rig lacks pelvis/neck rest anchors'); }
  const hemY = hip.y - 0.085, options = { hemY, neckTopY: neck.y - 0.018 };
  let ordinary: ReturnType<typeof buildExpandedOfficeShell>, exact: ReturnType<typeof buildOfficeSourceCornerChart>, coverage: SourceMaskCoverageReport;
  try {
    ordinary = buildExpandedOfficeShell(sourceBase, rest, { ...options, radialEase: 0 });
    exact = buildOfficeSourceCornerChart(sourceBase, rest, options);
    const resolvedLook: ResolvedWardrobeLook = {
      look: look as unknown as ResolvedWardrobeLook['look'],
      ids: resolveAvatarWearablesForRenderer(look as unknown as Parameters<typeof resolveAvatarWearablesForRenderer>[0]),
    };
    const maskSpec = buildWardrobeGeometry(rest, resolvedLook, 'everyday');
    try {
      coverage = auditSourceMaskCoverage({
        fullSource: sourceBase.geometry, displayedBody: base.geometry, shell: exact.geometry,
        shellSourceFaceIds: exact.sourceFaceIds, rest, skeleton: sourceBase.skeleton,
        maskSpec, hemY, neckTopY: options.neckTopY,
      });
      if (!coverage.maskReplayMatchesDisplayed || coverage.fullSourceTriangles !== source.triangles) throw new Error('Replayed whole-triangle mask differs from the exact current displayed body subset');
    } finally { maskSpec.geometry.dispose(); }
  } catch (error) {
    throw new Error(`Full-topology shell build failed: ${error instanceof Error ? error.message : String(error)}; normal provenance ${JSON.stringify(fullSource.normalProvenance)}`);
  } finally { sourceBase.geometry.dispose(); }
  const expected = body.key === 'male' ? { triangles: 3266, vertices: 1778 } : { triangles: 3541, vertices: 1893 };
  if (ordinary.triangles !== expected.triangles || ordinary.geometry.getAttribute('position').count !== expected.vertices || exact.triangles !== expected.triangles || exact.geometry.getAttribute('position').count !== expected.vertices || source.triangles !== 9002) { ordinary.geometry.dispose(); exact.geometry.dispose(); throw new Error(`Full-source shell differs from reviewed CPU output for ${body.key}`); }
  sameZeroEaseChart(ordinary.geometry, exact.geometry);
  if (!equalBytes(displayedNormalBytes, attributeBytes(base.geometry.getAttribute('normal') as THREE.BufferAttribute))) { ordinary.geometry.dispose(); exact.geometry.dispose(); sourceBase.geometry.dispose(); throw new Error('Private source-normal recomputation mutated displayed production normals'); }
  const supportVertices = new Set<number>(); for (const binding of exact.sourceBindings) for (const vertex of binding.vertices) supportVertices.add(vertex);
  const supportZeroBefore = [...supportVertices].filter(vertex => fullSource.maskedZeroNormalVertexIds.has(vertex)).length;
  const supportZeroAfter = [...supportVertices].filter(vertex => { const normal = sourceBase.geometry.getAttribute('normal') as THREE.BufferAttribute; return normal.getX(vertex) === 0 && normal.getY(vertex) === 0 && normal.getZ(vertex) === 0; }).length;
  const sourceNormalProvenance = { ...fullSource.normalProvenance, shellSupportVertices: supportVertices.size, supportVerticesZeroUnderMaskedNormals: supportZeroBefore, supportVerticesZeroAfterFullNormals: supportZeroAfter };
  if (supportZeroBefore === 0 || supportZeroAfter !== 0) { ordinary.geometry.dispose(); exact.geometry.dispose(); sourceBase.geometry.dispose(); throw new Error(`Full-topology normals did not resolve the exact shell-support zero-normal cause: ${JSON.stringify(sourceNormalProvenance)}`); }
  if (!equalBytes(displayedMaskIndexBytes, attributeBytes(base.geometry.index!)) || JSON.stringify(displayedMaskDrawRange) !== JSON.stringify(base.geometry.drawRange)) throw new Error('Full-source chart reconstruction mutated the displayed production body mask');
  const shellGeometry = kind === 'source' ? ordinary.geometry : exact.geometry;
  const split = filterSyntheticTop(body, wardrobe, rest, hemY);
  const shellMaterial = cloneFabricMaterial(wardrobe.material as THREE.Material, kind === 'chart');
  const shellMesh = new THREE.SkinnedMesh(shellGeometry, shellMaterial);
  shellMesh.name = `office-source-shell-${kind}`;
  shellMesh.bindMode = base.bindMode;
  shellMesh.bind(base.skeleton, base.bindMatrix);
  shellMesh.frustumCulled = false;
  shellMesh.renderOrder = wardrobe.renderOrder;
  wardrobe.add(shellMesh);
  shellMesh.updateMatrixWorld(true);
  const expectedAttributes = kind === 'chart' ? 11 : 7;
  if (Object.keys(shellGeometry.attributes).length !== expectedAttributes) throw new Error(`Unexpected ${kind} shell attribute count ${Object.keys(shellGeometry.attributes).length}`);
  const sourceBinding = kind === 'chart' ? exact.sourceFaceIds.length : ordinary.triangles;
  const shellBytes = Object.values(shellGeometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, 0)
    + (shellGeometry.index?.array.byteLength ?? 0);
  let disposed = false;
  return {
    shellTriangles: shellGeometry.index!.count / 3,
    shellVertices: shellGeometry.getAttribute('position').count,
    shellBytes,
    shellAttributeCount: Object.keys(shellGeometry.attributes).length,
    retainedWardrobeTriangles: split.kept,
    removedSyntheticTopTriangles: split.removed,
    drawCallsForWardrobe: 2,
    shellSourceFaceCount: sourceBinding,
    sharedTopologyFingerprint: sharedFingerprint(shellGeometry),
    shaderAdapterKey: kind === 'chart' ? SOURCE_CORNER_SKINNING_CACHE_KEY : null,
    sourceIndexSha256: source.sourceIndexSha256,
    sourceAttributeSha256: source.sourceAttributeSha256,
    sourceTriangleCount: source.triangles,
    appearanceReplayMatchesDisplayed: source.appearanceReplayMatchesDisplayed,
    rawPositionEncodingBeforeAppearance: source.rawPositionEncodingBeforeAppearance,
    currentPositionEncodingAfterAppearance: source.currentPositionEncodingAfterAppearance,
    rawNormalEncodingBeforeAppearance: source.rawNormalEncodingBeforeAppearance,
    currentNormalEncodingAfterAppearance: source.currentNormalEncodingAfterAppearance,
    bindDiagnostics: source.bindDiagnostics,
    sourceNormalProvenance,
    displayedMaskTriangles: displayedMaskDrawRange.count / 3,
    sourceMaskCoverage: coverage,
    dispose() {
      if (disposed) return;
      disposed = true;
      shellMesh.removeFromParent(); shellGeometry.dispose(); shellMaterial.dispose();
      if (kind === 'source') exact.geometry.dispose(); else ordinary.geometry.dispose();
    },
  };
}
