import * as THREE from 'three';
import type { SkinnedBody } from '/src/scene/body/skinned.ts';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { BODY_FILES } from '/src/scene/body/files.ts';
import { captureWardrobeRestFrame } from '/src/scene/wardrobe/geometry.ts';
import { buildExpandedOfficeShell } from '../../office-source-shell-v2/office-expanded-shell.ts';
import { buildOfficeSourceCornerChart } from '../source-corner-chart.ts';
import { sourceCornerSkinningHook, SOURCE_CORNER_SKINNING_CACHE_KEY } from '../source-corner-skinning-adapter.ts';

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
  displayedMaskTriangles: number;
  dispose(): void;
}>;

const SOURCE_BODY_SHA256 = Object.freeze({
  male: 'b0078206da9f7de0bf346be8133522cf514009f03f262f716613dd196d180686',
  female: '977ca5e73ba7b19af2627dab1ba0f0ef3e3d8548bf7b4d54f45faf22cd56001c',
});
type RecoveredSource = { index: Uint16Array | Uint32Array; sourceIndexSha256: string; sourceAttributeSha256: string; triangles: number };
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

async function recoverFullSource(body: SkinnedBody, base: THREE.SkinnedMesh): Promise<RecoveredSource> {
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
      const attrDigests: Record<string, string> = {};
      for (const name of rawNames) {
        const source = raw.geometry.getAttribute(name) as THREE.BufferAttribute, display = base.geometry.getAttribute(name) as THREE.BufferAttribute;
        if (source.itemSize !== display.itemSize || source.count !== display.count || source.normalized !== display.normalized || source.array.constructor !== display.array.constructor) throw new Error(`Raw source attribute layout differs on displayed body: ${name}`);
        // Appearance legitimately morphs position/normal on the displayed actor. Prove vertex identity with
        // stable UV/color/skin channels, then hash the exact current actor attributes that the chart will clone.
        if (['uv', 'color', 'skinIndex', 'skinWeight'].includes(name) && !equalBytes(attributeBytes(source), attributeBytes(display))) throw new Error(`Raw source vertex correspondence differs on stable attribute ${name}`);
        attrDigests[name] = await sha256(attributeBytes(display));
      }
      const rawIndex = raw.geometry.index as THREE.BufferAttribute, sourceBytes = attributeBytes(rawIndex), copied = (rawIndex.array as Uint16Array | Uint32Array).slice();
      if (copied.constructor !== displayedIndex.array.constructor) throw new Error('Raw GLB index component type differs from displayed body');
      const sourceIndexSha256 = await sha256(sourceBytes);
      const sourceAttributeSha256 = await sha256(new TextEncoder().encode(JSON.stringify(attrDigests)));
      const sameMatrix = (a: THREE.Matrix4, b: THREE.Matrix4) => a.elements.every((value, index) => value === b.elements[index]);
      if (raw.bindMode !== base.bindMode || !sameMatrix(raw.bindMatrix, base.bindMatrix) || raw.skeleton.bones.length !== base.skeleton.bones.length) throw new Error('Raw source bind mode/matrix or rig size differs from displayed body');
      for (let i = 0; i < raw.skeleton.bones.length; i++) {
        const a = raw.skeleton.bones[i]!, b = base.skeleton.bones[i]!, ai = raw.skeleton.boneInverses[i]!, bi = base.skeleton.boneInverses[i]!;
        if (a.name !== b.name || !sameMatrix(ai, bi)) throw new Error(`Raw source rig differs at bone ${i}`);
      }
      base.updateMatrix();
      const matrix = base.matrix.clone();
      if (!sameMatrix(raw.matrix, matrix)) throw new Error('Raw source body mesh transform differs from displayed body');
      return { index: copied, sourceIndexSha256, sourceAttributeSha256, triangles: copied.length / 3 };
    } finally { disposeParsedScene(gltf.scene); }
  })();
  recoveredSources.set(key, promise);
  try { return await promise; } catch (error) { recoveredSources.delete(key); throw error; }
}

function privateFullSourceMesh(base: THREE.SkinnedMesh, source: RecoveredSource): THREE.SkinnedMesh {
  const geometry = base.geometry.clone();
  geometry.setIndex(new THREE.BufferAttribute(source.index.slice(), 1));
  const mesh = new THREE.SkinnedMesh(geometry, base.material);
  mesh.position.copy(base.position); mesh.quaternion.copy(base.quaternion); mesh.scale.copy(base.scale);
  mesh.matrix.copy(base.matrix); mesh.matrixAutoUpdate = base.matrixAutoUpdate;
  mesh.bindMode = base.bindMode; mesh.bind(base.skeleton, base.bindMatrix.clone());
  mesh.updateMatrixWorld(true);
  return mesh;
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
export async function applyOfficeSourceChart(body: SkinnedBody, kind: 'source' | 'chart'): Promise<FixtureAugmentation> {
  if (body.wardrobeError) throw new Error(body.wardrobeError);
  const base = baseMesh(body), wardrobe = wardrobeMesh(body), source = await recoverFullSource(body, base);
  const sourceBase = privateFullSourceMesh(base, source), rest = captureWardrobeRestFrame(sourceBase);
  const displayedIndex = base.geometry.index;
  if (!displayedIndex || base.geometry.drawRange.start !== 0 || !Number.isInteger(base.geometry.drawRange.count) || base.geometry.drawRange.count >= displayedIndex.count) { sourceBase.geometry.dispose(); throw new Error('Expected the production body mask to retain a partial draw range'); }
  const displayedMaskIndexBytes = attributeBytes(displayedIndex).slice(), displayedMaskDrawRange = { ...base.geometry.drawRange };
  const hip = rest.bones.get('pelvis')?.point, neck = rest.bones.get('neck_01')?.point;
  if (!hip || !neck) { sourceBase.geometry.dispose(); throw new Error('Actual rig lacks pelvis/neck rest anchors'); }
  const hemY = hip.y - 0.085, options = { hemY, neckTopY: neck.y - 0.018 };
  let ordinary: ReturnType<typeof buildExpandedOfficeShell>, exact: ReturnType<typeof buildOfficeSourceCornerChart>;
  try {
    ordinary = buildExpandedOfficeShell(sourceBase, rest, { ...options, radialEase: 0 });
    exact = buildOfficeSourceCornerChart(sourceBase, rest, options);
  } finally { sourceBase.geometry.dispose(); }
  const expected = body.key === 'male' ? { triangles: 3266, vertices: 1778 } : { triangles: 3541, vertices: 1893 };
  if (ordinary.triangles !== expected.triangles || ordinary.geometry.getAttribute('position').count !== expected.vertices || exact.triangles !== expected.triangles || exact.geometry.getAttribute('position').count !== expected.vertices || source.triangles !== 9002) { ordinary.geometry.dispose(); exact.geometry.dispose(); throw new Error(`Full-source shell differs from reviewed CPU output for ${body.key}`); }
  sameZeroEaseChart(ordinary.geometry, exact.geometry);
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
    displayedMaskTriangles: displayedMaskDrawRange.count / 3,
    dispose() {
      if (disposed) return;
      disposed = true;
      shellMesh.removeFromParent(); shellGeometry.dispose(); shellMaterial.dispose();
      if (kind === 'source') exact.geometry.dispose(); else ordinary.geometry.dispose();
    },
  };
}
