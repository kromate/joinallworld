import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { Look } from '../../../src/scene/avatar-look.ts';
import { createAuthoredClothingPalette } from './clothing-palette.ts';
import { createAuthoredHairPalette } from './hair-palette.ts';
import { applyBodyMaskUnion, type BodyMaskLease, type BodyTriangleHideSet } from './body-mask-union.ts';
import casualSuitUrl from './authored-clothing/out/male_casualsuit01.glb?url';
import bodyHideMapUrl from './authored-clothing/out/body-hide-map.json?url';
import shortHairUrl from './authored-hair/out/short02-mobile.glb?url';
import afroHairUrl from './authored-hair/out/afro01-mobile.glb?url';
import officeMaleUrl from './authored-clothing/office-export/out/office-male.glb?url';
import officeFemaleUrl from './authored-clothing/office-export/out/office-female.glb?url';
import officeMaleHideUrl from './authored-clothing/office-export/out/office-male-body-hide-map.json?url';
import officeFemaleHideUrl from './authored-clothing/office-export/out/office-female-body-hide-map.json?url';
import femaleCasualUrl from './authored-clothing/casual-female-export/out/casual-female.glb?url';
import femaleCasualHideUrl from './authored-clothing/casual-female-export/out/casual-female-body-hide-map.json?url';

/** This first authored outfit is deliberately limited to the casual suit bake. */
export type AuthoredPresentationLook = Pick<Look, 'body' | 'outfit' | 'outfitColor' | 'bottomsColor' | 'fabric'>
  & Partial<Pick<Look, 'hair' | 'hairColor' | 'appearance' | 'accessories' | 'wearables'>>;

export interface AuthoredPresentationOptions {
  /** Optional Kit lifecycle owner; templates are cached and disposed only within this owner. */
  readonly kitOwner?: AuthoredPresentationKitOwner;
  readonly additionalBodyHideSets?: readonly BodyTriangleHideSet[];
  /** Viewer-selected, same-origin mobile hair GLB. Geometry and alpha texture remain source-authored. */
  readonly hairAssetUrl?: string;
  readonly hairSha256?: string;
  readonly hairAssetName?: 'short02' | 'afro01';
}

export interface AuthoredPresentationKitOwner {
  onDispose(callback: () => void): () => boolean;
}

export interface AuthoredPresentationMetrics {
  readonly bodySourceIndexSha256: string;
  readonly outfitSha256: string;
  readonly hairSha256?: string;
  readonly bodySourceTriangles: number;
  readonly bodyVisibleTriangles: number;
  readonly hiddenBodyTriangles: number;
  readonly outfitTriangles: number;
  readonly hairTriangles: number;
  readonly overlayDrawCalls: number;
  readonly bodyMaskIndexBytes: number;
  readonly outfitGeometryBytes: number;
  readonly copiedMorphs: readonly string[];
  readonly unsupported: readonly string[];
}

export interface AuthoredPresentation {
  readonly metrics: AuthoredPresentationMetrics;
  setColors(shirt: THREE.ColorRepresentation, trousers: THREE.ColorRepresentation, hairColor: THREE.ColorRepresentation): void;
  dispose(): void;
}

interface BodyHideMap {
  schema: 'joinallworld.authored-clothing-body-hide.v1';
  asset: string;
  sourcePins: { body?: string; asset: string; bodyCommit?: string; commit?: string };
  bodySourceTriangleCount: number;
  removedBodyTriangles: number;
  bodyHideSourceTriangleIds: number[];
}

interface OutfitTemplate {
  root: THREE.Group;
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  jointNames: string[];
  targetNames: string[];
}

interface OutfitGeometryEntry {
  geometry: THREE.BufferGeometry;
  disposed: boolean;
  references: number;
  outfitTriangles: number;
  hairTriangles: number;
  byteLength: number;
}

const BODY_SOURCE_INDEX_SHA256 = '4c29f318e20b87a2c0ddce3689fa0ab285ee390fc02e5f3a017736df772a3661';
const OUTFIT_SHA256 = '1f8d4fd4b867785226a9c057562289381ae071cf5acbcca248133a3216ae476f';
const BODY_HIDE_MAP_SHA256 = 'dbe0c82a3e31da4e6ce37f4f1d9dc8611143c7c9e6dbef72ffea8d281aebe099';
const SHORT_HAIR_SHA256 = 'a2637b4d14055cbd537b9b0f6e46c695b4a5bdc99e7d779956d58218ffc626a0';
const AFRO_HAIR_SHA256 = '3d37f4a379c19b4d64a9c21bb08418858ede79317a477b34b3fdfb965fd11474';
const BODY_SOURCE_REVISION = 'ec8d1d270b93b8e2e87e8a6160bb908665fe1fcd';
const OUTFIT_SOURCE_REVISION = '8cf9645b975a98eea056b140df11a1d278da0d10';
const BODY_SOURCE_TRIANGLES = 26_756;
const OUTFIT_TRIANGLES = 16_672;
const HIDDEN_BODY_TRIANGLES = 6_728;
const NORMALIZED_LOOK_COLORS: Readonly<Record<string, string>> = Object.freeze({
  blue: '#3f72c4', green: '#3f9a5a', red: '#c9423a', orange: '#e0822f', violet: '#8055c2',
  pink: '#dd6fa0', teal: '#2f9d98', navy: '#243a66', cream: '#ece2c6', gold: '#d6a83a',
});
const SUPPORTED_BODY_MORPHS = new Set(['bodyFeminine', 'bodyMasculine']);
const CLOTHING_SHAPE_MORPHS = new Set([
  'bodyMuscular', 'bodySofter', 'bodyHeavier', 'bodyThinner', 'heightTaller', 'heightShorter',
  'chestVShape', 'bustBigger', 'bustSmaller', 'shouldersWider', 'shouldersNarrower', 'hipsWider', 'hipsNarrower',
]);

interface OutfitSpec { readonly url: string; readonly sha: string; readonly hideUrl: string; readonly hideSha: string; readonly asset: string; readonly triangles: number; readonly vertices: number; readonly hidden: number; readonly morphs: readonly string[]; readonly sourceMorphs?: readonly string[]; }
const OFFICE_SPECS: Readonly<Record<'man' | 'woman', OutfitSpec>> = Object.freeze({
  man: { url: officeMaleUrl, sha: '74354b1293815f8753fe5b0cb618cb00da1fd19e7bb7f99fbff1817d243e73db', hideUrl: officeMaleHideUrl, hideSha: '337127fe061c4563faf8a5272135c4311b1893fc5c04c06ac7311e3c922136a3', asset: 'male_elegantsuit01', triangles: 14956, vertices: 8522, hidden: 6748, morphs: ['bodyMasculine'], sourceMorphs: ['bodyMale'] },
  woman: { url: officeFemaleUrl, sha: 'fd3f4ac0985dae3d6f46469fc8f22ea22d84628c83829c77802a79b1f8f3c053', hideUrl: officeFemaleHideUrl, hideSha: '47c3999dd2facb11511965925d2adfa160519a72f4cbb4834ccfd636be7cfa66', asset: 'female_elegantsuit01', triangles: 4192, vertices: 2446, hidden: 5010, morphs: ['bodyFeminine'], sourceMorphs: ['bodyFemale'] },
});
const CASUAL_SPECS: Readonly<Record<'man' | 'woman', OutfitSpec>> = Object.freeze({
  man: { url: casualSuitUrl, sha: OUTFIT_SHA256, hideUrl: bodyHideMapUrl, hideSha: BODY_HIDE_MAP_SHA256, asset: 'male_casualsuit01', triangles: OUTFIT_TRIANGLES, vertices: 8984, hidden: HIDDEN_BODY_TRIANGLES, morphs: ['bodyFeminine','bodyMasculine'] },
  woman: { url: femaleCasualUrl, sha: '7063492e52bb8817981349df45e141e0bc70dbe3e339d4d2dac8df3bdc3342bd', hideUrl: femaleCasualHideUrl, hideSha: '4efb1cbdb673673f93fc4af657f12ffd59e837c04cebd3a51d2270c361e3d753', asset: 'female_casualsuit01', triangles: 4236, vertices: 2406, hidden: 5376, morphs: ['bodyFeminine'], sourceMorphs: ['bodyFemale'] },
});
interface PresentationTemplateCache {
  closed: boolean;
  outfits: Map<string, Promise<{ outfit: OutfitTemplate; hideMap: BodyHideMap }>>;
  hairs: Map<string, Promise<OutfitTemplate>>;
  roots: Set<THREE.Group>;
}
const presentationTemplateCaches = new WeakMap<AuthoredPresentationKitOwner, PresentationTemplateCache>();
const disposedTemplateRoots = new WeakSet<THREE.Object3D>();
const bodyMaskCache = new WeakMap<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();
const outfitGeometryCache = new WeakMap<THREE.BufferGeometry, Map<string, OutfitGeometryEntry>>();
const bodyIndexHashCache = new WeakMap<THREE.BufferGeometry, Promise<string>>();
const sourceDisposeHooks = new WeakSet<THREE.BufferGeometry>();

function fail(message: string): never {
  throw new Error(`Authored presentation: ${message}`);
}

function disposeTemplateRoot(root: THREE.Object3D): void {
  if (disposedTemplateRoots.has(root)) return;
  disposedTemplateRoots.add(root);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const images = new Set<{ close?: () => void }>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    }
  });
  for (const texture of textures) {
    const source = texture.source?.data ?? texture.image;
    if (source && typeof source === 'object' && 'close' in source && typeof source.close === 'function') images.add(source as { close: () => void });
    texture.dispose();
  }
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const image of images) image.close?.();
}

function closeTemplateCache(cache: PresentationTemplateCache): void {
  if (cache.closed) return;
  cache.closed = true;
  cache.outfits.clear();
  cache.hairs.clear();
  for (const root of cache.roots) disposeTemplateRoot(root);
  cache.roots.clear();
}

function templateCacheFor(owner: AuthoredPresentationKitOwner): PresentationTemplateCache {
  const cached = presentationTemplateCaches.get(owner);
  if (cached) return cached;
  const cache: PresentationTemplateCache = { closed: false, outfits: new Map(), hairs: new Map(), roots: new Set() };
  presentationTemplateCaches.set(owner, cache);
  owner.onDispose(() => closeTemplateCache(cache));
  return cache;
}

function createStandaloneOwner(): { owner: AuthoredPresentationKitOwner; dispose(): void } {
  const callbacks = new Set<() => void>();
  let closed = false;
  return {
    owner: {
      onDispose(callback) {
        if (closed) { callback(); return () => false; }
        callbacks.add(callback);
        return () => callbacks.delete(callback);
      },
    },
    dispose() {
      if (closed) return;
      closed = true;
      for (const callback of [...callbacks]) { callbacks.delete(callback); callback(); }
    },
  };
}

function assertTemplateCacheOpen(cache: PresentationTemplateCache): void {
  check(!cache.closed, 'Kit was disposed while authored presentation assets were loading');
}

function normalizeBoneName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^mixamorig/, '');
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function geometryBytes(geometry: THREE.BufferGeometry): number {
  const arrays = new Set<ArrayBufferView>();
  for (const attribute of Object.values(geometry.attributes)) arrays.add(attribute.array);
  for (const attributes of Object.values(geometry.morphAttributes)) for (const attribute of attributes) arrays.add(attribute.array);
  if (geometry.index) arrays.add(geometry.index.array);
  return [...arrays].reduce((sum, array) => sum + array.byteLength, 0);
}

function bytesHex(bytes: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest('SHA-256', bytes).then((digest) =>
    [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join(''));
}

async function hashBytes(bytes: ArrayBuffer): Promise<string> {
  return bytesHex(bytes);
}

async function hashIndex(index: THREE.BufferAttribute): Promise<string> {
  const values = index.array;
  const view = new Uint8Array(values.buffer, values.byteOffset, values.byteLength);
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return bytesHex(copy.buffer as ArrayBuffer);
}

function bodyIndexHash(geometry: THREE.BufferGeometry): Promise<string> {
  const cached = bodyIndexHashCache.get(geometry);
  if (cached) return cached;
  const index = geometry.getIndex();
  check(index, 'Body has no source triangle index');
  const pending = hashIndex(index);
  bodyIndexHashCache.set(geometry, pending);
  return pending;
}

async function fetchPinnedBytes(url: string, expectedHash: string, label: string): Promise<ArrayBuffer> {
  const response = await fetch(new URL(url, import.meta.url).href, { credentials: 'same-origin' });
  if (!response.ok) fail(`${label} fetch failed (${response.status})`);
  const bytes = await response.arrayBuffer();
  const actualHash = await hashBytes(bytes);
  if (actualHash !== expectedHash) fail(`${label} SHA-256 mismatch (${actualHash})`);
  return bytes;
}

function validateHideMap(value: unknown, spec: OutfitSpec): BodyHideMap {
  check(typeof value === 'object' && value !== null, 'body hide map is not an object');
  const map = value as Partial<BodyHideMap>;
  check(map.schema === 'joinallworld.authored-clothing-body-hide.v1', 'unsupported body hide map schema');
  check(map.asset === spec.asset, 'body hide map belongs to a different outfit');
  check((map.sourcePins?.body ?? map.sourcePins?.bodyCommit) === BODY_SOURCE_REVISION
    && (map.sourcePins?.commit ?? map.sourcePins?.asset) === OUTFIT_SOURCE_REVISION,
    'body hide map source revisions do not match the pinned bake');
  check(map.bodySourceTriangleCount === BODY_SOURCE_TRIANGLES, 'body source triangle count changed');
  check(map.removedBodyTriangles === spec.hidden, 'body deletion count changed');
  check(Array.isArray(map.bodyHideSourceTriangleIds) && map.bodyHideSourceTriangleIds.length === spec.hidden,
    'body hide triangle list has the wrong length');
  const ids = new Set<number>();
  for (const id of map.bodyHideSourceTriangleIds) {
    check(Number.isInteger(id) && id >= 0 && id < BODY_SOURCE_TRIANGLES, `invalid hidden body triangle ${id}`);
    check(!ids.has(id), `duplicate hidden body triangle ${id}`);
    ids.add(id);
  }
  return map as BodyHideMap;
}

async function loadTemplate(spec: OutfitSpec): Promise<{ outfit: OutfitTemplate; hideMap: BodyHideMap }> {
  await MeshoptDecoder.ready;
  const [outfitBytes, hideBytes] = await Promise.all([
    fetchPinnedBytes(spec.url, spec.sha, spec.asset),
    fetchPinnedBytes(spec.hideUrl, spec.hideSha, 'body hide map'),
  ]);
  const hideMap = validateHideMap(JSON.parse(new TextDecoder().decode(hideBytes)) as unknown, spec);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const suitAssetUrl = new URL(spec.url, import.meta.url);
  const baseUrl = new URL('.', suitAssetUrl.protocol === 'data:' ? import.meta.url : suitAssetUrl).href;
  const gltf = await loader.parseAsync(outfitBytes, baseUrl);
  try {
  let mesh: THREE.Mesh | undefined;
  gltf.scene.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) {
      if (mesh) fail('casual suit GLB contains more than one mesh');
      mesh = node as THREE.Mesh;
    }
  });
  check(mesh, 'casual suit GLB has no mesh');
  check(!(mesh instanceof THREE.SkinnedMesh), 'outfit asset must not contain a second skeleton');
  check(!Array.isArray(mesh.material) && mesh.material instanceof THREE.MeshStandardMaterial,
    'outfit GLB must have one standard material');
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  check(position && index && skinIndex && skinWeight, 'outfit GLB is missing indexed skin attributes');
  check(index.count / 3 === spec.triangles && index.count % 3 === 0, 'outfit triangle count changed');
  check(position.count === spec.vertices, `outfit vertex count changed (${position.count})`);
  check(geometry.groups.length === 0, 'outfit source unexpectedly contains material groups');
  check(skinIndex.itemSize === 4 && skinWeight.itemSize === 4 && skinIndex.count === position.count && skinWeight.count === position.count,
    'outfit skin attribute layout changed');
  const userData = mesh.userData as { jointNames?: unknown; targetNames?: unknown };
  check(Array.isArray(userData.jointNames) && userData.jointNames.length === 52 && userData.jointNames.every((name) => typeof name === 'string'),
    'outfit GLB joint-name contract changed');
  check(JSON.stringify(userData.targetNames) === JSON.stringify(spec.sourceMorphs ?? spec.morphs), 'outfit morph target order changed');
  check((geometry.morphAttributes.position?.length ?? 0) === spec.morphs.length, 'outfit morph attribute count changed');
  const targetNames = [...spec.morphs];
  const jointNames = userData.jointNames as string[];
  const canonicalJointNames = jointNames.map(normalizeBoneName);
  check(new Set(canonicalJointNames).size === canonicalJointNames.length, 'outfit joint names are ambiguous');
  return {
    outfit: {
      root: gltf.scene,
      mesh,
      geometry,
      material: mesh.material as THREE.MeshStandardMaterial,
      jointNames,
      targetNames,
    },
    hideMap,
  };
  } catch (error) {
    disposeTemplateRoot(gltf.scene);
    throw error;
  }
}

async function loadHairTemplate(url: string, expectedHash: string, assetName: 'short02' | 'afro01'): Promise<OutfitTemplate> {
  check(/^[0-9a-f]{64}$/i.test(expectedHash), 'hair asset requires its pinned SHA-256');
  const assetUrl = new URL(url, import.meta.url);
  const bytes = await fetchPinnedBytes(assetUrl.href, expectedHash.toLowerCase(), 'authored hair');
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(bytes, new URL('.', assetUrl.protocol === 'data:' ? import.meta.url : assetUrl).href);
  try {
  let mesh: THREE.Mesh | undefined;
  gltf.scene.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) {
      if (mesh) fail('hair GLB contains more than one mesh');
      mesh = node as THREE.Mesh;
    }
  });
  check(mesh, 'hair GLB has no mesh');
  check(!(mesh instanceof THREE.SkinnedMesh), 'hair asset must not contain a second skeleton');
  check(!Array.isArray(mesh.material) && mesh.material instanceof THREE.MeshStandardMaterial, 'hair GLB must have one standard material');
  const geometry = mesh.geometry;
  const index = geometry.getIndex(), position = geometry.getAttribute('position');
  const skinIndex = geometry.getAttribute('skinIndex'), skinWeight = geometry.getAttribute('skinWeight');
  check(index && position && skinIndex && skinWeight && index.count % 3 === 0, 'hair GLB is missing indexed skin attributes');
  const expectedHair = assetName === 'short02' ? { vertices: 2_061, triangles: 3_344 } : { vertices: 2_276, triangles: 2_192 };
  check(position.count === expectedHair.vertices && index.count / 3 === expectedHair.triangles, `${assetName} hair geometry changed`);
  check(geometry.groups.length === 0, 'hair GLB unexpectedly contains material groups');
  check(skinIndex.count === position.count && skinWeight.count === position.count && skinIndex.itemSize === 4 && skinWeight.itemSize === 4,
    'hair skin attribute layout changed');
  const userData = mesh.userData as { jointNames?: unknown; targetNames?: unknown };
  check(Array.isArray(userData.jointNames) && userData.jointNames.length === 52 && userData.jointNames.every((name) => typeof name === 'string'),
    'hair joint-name contract changed');
  check(JSON.stringify(userData.targetNames) === JSON.stringify(['bodyFeminine', 'bodyMasculine']), 'hair morph target order changed');
  check((geometry.morphAttributes.position?.length ?? 0) === 2, 'hair morph attribute count changed');
  check((mesh.material as THREE.MeshStandardMaterial).map && (mesh.material as THREE.MeshStandardMaterial).transparent,
    'hair GLB must retain its source alpha texture');
  return {
    root: gltf.scene,
    mesh,
    geometry,
    material: mesh.material as THREE.MeshStandardMaterial,
    jointNames: userData.jointNames as string[],
    targetNames: userData.targetNames as string[],
  };
  } catch (error) {
    disposeTemplateRoot(gltf.scene);
    throw error;
  }
}

function getHairTemplate(cache: PresentationTemplateCache, url: string, expectedHash: string, assetName: 'short02' | 'afro01'): Promise<OutfitTemplate> {
  assertTemplateCacheOpen(cache);
  const key = `${new URL(url, import.meta.url).href}:${expectedHash.toLowerCase()}:${assetName}`;
  let pending = cache.hairs.get(key);
  if (!pending) {
    const created = loadHairTemplate(url, expectedHash, assetName).then((template) => {
      if (cache.closed) { disposeTemplateRoot(template.root); fail('Kit was disposed while hair was loading'); }
      cache.roots.add(template.root);
      return template;
    }).catch((error: unknown) => {
      if (cache.hairs.get(key) === created) cache.hairs.delete(key);
      throw error;
    });
    pending = created;
    cache.hairs.set(key, pending);
  }
  return pending;
}

function getTemplate(cache: PresentationTemplateCache, spec: OutfitSpec): Promise<{ outfit: OutfitTemplate; hideMap: BodyHideMap }> {
  assertTemplateCacheOpen(cache);
  let pending = cache.outfits.get(spec.sha);
  if (!pending) {
    const created = loadTemplate(spec).then((result) => {
      if (cache.closed) { disposeTemplateRoot(result.outfit.root); fail('Kit was disposed while clothing was loading'); }
      cache.roots.add(result.outfit.root);
      return result;
    }).catch((error: unknown) => {
      if (cache.outfits.get(spec.sha) === created) cache.outfits.delete(spec.sha);
      throw error;
    });
    pending = created;
    cache.outfits.set(spec.sha, pending);
  }
  return pending;
}

function bodyMaskGeometry(source: THREE.BufferGeometry, hideMap: BodyHideMap): THREE.BufferGeometry {
  const key = hideMap.bodyHideSourceTriangleIds.join(',');
  let sourceMasks = bodyMaskCache.get(source);
  if (!sourceMasks) { sourceMasks = new Map(); bodyMaskCache.set(source, sourceMasks); }
  const cached = sourceMasks.get(key);
  if (cached) return cached;
  const index = source.getIndex();
  const position = source.getAttribute('position');
  check(index && position, 'Body must have indexed positions');
  check(source.groups.length === 0, 'grouped Body geometry is unsupported by this exact-index hide map');
  check(index.count / 3 === BODY_SOURCE_TRIANGLES && index.count % 3 === 0, 'Body triangle layout changed');
  check(position.count === 14_517, `Body vertex count changed (${position.count})`);
  check(source.drawRange.start === 0 && (source.drawRange.count === Infinity || source.drawRange.count === index.count),
    'Body draw range is already altered');

  const retained: number[] = [];
  const hidden = new Set(hideMap.bodyHideSourceTriangleIds);
  for (let triangle = 0; triangle < BODY_SOURCE_TRIANGLES; triangle++) {
    const offset = triangle * 3;
    if (hidden.has(triangle)) continue;
    retained.push(index.getX(offset), index.getX(offset + 1), index.getX(offset + 2));
  }
  check(retained.length / 3 === BODY_SOURCE_TRIANGLES - hideMap.bodyHideSourceTriangleIds.length, 'filtered Body index count is inconsistent');
  const filtered = index.array instanceof Uint32Array ? new Uint32Array(retained) : new Uint16Array(retained);
  const wrapper = new THREE.BufferGeometry();
  wrapper.name = `authored-casual-suit-body-mask-${hideMap.asset}`;
  for (const [name, attribute] of Object.entries(source.attributes)) wrapper.setAttribute(name, attribute);
  wrapper.morphAttributes = { ...source.morphAttributes };
  wrapper.morphTargetsRelative = source.morphTargetsRelative;
  wrapper.setIndex(new THREE.BufferAttribute(filtered, 1));
  wrapper.setDrawRange(0, filtered.length);
  wrapper.boundingBox = source.boundingBox?.clone() ?? null;
  wrapper.boundingSphere = source.boundingSphere?.clone() ?? null;
  sourceMasks.set(key, wrapper);
  if (!sourceDisposeHooks.has(source)) {
    sourceDisposeHooks.add(source);
    source.addEventListener('dispose', () => {
      for (const mask of bodyMaskCache.get(source)?.values() ?? []) mask.dispose();
      bodyMaskCache.delete(source);
    });
  }
  return wrapper;
}

function outfitBoneIndices(outfit: OutfitTemplate, body: THREE.SkinnedMesh): { indices: number[]; key: string } {
  const bodyByName = new Map<string, number>();
  body.skeleton.bones.forEach((bone, index) => {
    const name = normalizeBoneName(bone.name);
    check(!bodyByName.has(name), `Body has duplicate joint ${bone.name}`);
    bodyByName.set(name, index);
  });
  const indices = outfit.jointNames.map((name) => {
    const index = bodyByName.get(normalizeBoneName(name));
    check(index !== undefined, `Body skeleton is missing outfit joint ${name}`);
    return index;
  });
  check(body.skeleton.bones.length === 52 && indices.length === 52 && new Set(indices).size === 52,
    'Body and outfit joint sets do not match exactly');
  return { indices, key: indices.join(',') };
}

function acquireOutfitGeometry(outfit: OutfitTemplate, body: THREE.SkinnedMesh): OutfitGeometryEntry {
  const { indices, key } = outfitBoneIndices(outfit, body);
  let entries = outfitGeometryCache.get(outfit.geometry);
  if (!entries) {
    entries = new Map();
    outfitGeometryCache.set(outfit.geometry, entries);
  }
  const cached = entries.get(key);
  if (cached) {
    cached.references++;
    return cached;
  }

  const source = outfit.geometry;
  const sourceIndex = source.getIndex()!;
  check(sourceIndex.array instanceof Uint16Array || sourceIndex.array instanceof Uint32Array,
    'outfit index must use an unsigned integer array');
  const sourceSkinIndex = source.getAttribute('skinIndex');
  check(sourceSkinIndex instanceof THREE.BufferAttribute,
    'outfit skin attributes must be non-interleaved');
  check(sourceSkinIndex.array instanceof Uint16Array || sourceSkinIndex.array instanceof Uint32Array,
    'outfit joint indices must use an unsigned integer array');
  const geometry = source.clone();
  geometry.name = 'authored-casual-suit-remapped';
  // Keep the authored triangle order intact. A single material shades the
  // connected source garment with a smooth shirt/trouser color transition.
  geometry.clearGroups();
  geometry.setDrawRange(0, sourceIndex.count);

  const remappedJoints = sourceSkinIndex.array.slice() as Uint16Array | Uint32Array;
  for (let vertex = 0; vertex < sourceSkinIndex.count; vertex++) {
    for (let lane = 0; lane < 4; lane++) {
      const sourceJoint = Math.round(sourceSkinIndex.getComponent(vertex, lane));
      check(sourceJoint >= 0 && sourceJoint < indices.length, `outfit skin joint ${sourceJoint} is out of range`);
      remappedJoints[vertex * 4 + lane] = indices[sourceJoint]!;
    }
  }
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(remappedJoints, 4, sourceSkinIndex.normalized));
  const entry: OutfitGeometryEntry = {
    geometry,
    disposed: false,
    references: 1,
    outfitTriangles: sourceIndex.count / 3,
    hairTriangles: 0,
    byteLength: geometryBytes(geometry),
  };
  entries.set(key, entry);
  if (!sourceDisposeHooks.has(outfit.geometry)) {
    sourceDisposeHooks.add(outfit.geometry);
    outfit.geometry.addEventListener('dispose', () => {
      for (const item of entries!.values()) { if (!item.disposed) { item.disposed = true; item.geometry.dispose(); } }
      entries!.clear();
    });
  }
  return entry;
}

function acquireHairGeometry(hair: OutfitTemplate, body: THREE.SkinnedMesh): OutfitGeometryEntry {
  const { indices, key } = outfitBoneIndices(hair, body);
  let entries = outfitGeometryCache.get(hair.geometry);
  if (!entries) {
    entries = new Map();
    outfitGeometryCache.set(hair.geometry, entries);
  }
  const cached = entries.get(key);
  if (cached) {
    cached.references++;
    return cached;
  }
  const source = hair.geometry;
  const sourceIndex = source.getIndex()!;
  const sourceSkinIndex = source.getAttribute('skinIndex');
  check(sourceSkinIndex instanceof THREE.BufferAttribute, 'hair joint indices must be non-interleaved');
  check(sourceSkinIndex.array instanceof Uint16Array || sourceSkinIndex.array instanceof Uint32Array,
    'hair joint indices must use an unsigned integer array');
  const geometry = source.clone();
  geometry.name = 'authored-hair-remapped';
  const remappedJoints = sourceSkinIndex.array.slice() as Uint16Array | Uint32Array;
  for (let vertex = 0; vertex < sourceSkinIndex.count; vertex++) {
    for (let lane = 0; lane < 4; lane++) {
      const sourceJoint = Math.round(sourceSkinIndex.getComponent(vertex, lane));
      check(sourceJoint >= 0 && sourceJoint < indices.length, `hair skin joint ${sourceJoint} is out of range`);
      remappedJoints[vertex * 4 + lane] = indices[sourceJoint]!;
    }
  }
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(remappedJoints, 4, sourceSkinIndex.normalized));
  const entry: OutfitGeometryEntry = {
    geometry,
    disposed: false,
    references: 1,
    outfitTriangles: 0,
    hairTriangles: sourceIndex.count / 3,
    byteLength: geometryBytes(geometry),
  };
  entries.set(key, entry);
  if (!sourceDisposeHooks.has(hair.geometry)) {
    sourceDisposeHooks.add(hair.geometry);
    hair.geometry.addEventListener('dispose', () => {
      for (const item of entries!.values()) { if (!item.disposed) { item.disposed = true; item.geometry.dispose(); } }
      entries!.clear();
    });
  }
  return entry;
}

function releaseOutfitGeometry(outfit: OutfitTemplate, entry: OutfitGeometryEntry): void {
  entry.references--;
  if (entry.references < 0) fail('outfit geometry reference count underflow');
  if (entry.references === 0) {
    if (!entry.disposed) { entry.disposed = true; entry.geometry.dispose(); }
    outfitGeometryCache.get(outfit.geometry)?.forEach((value, key) => {
      if (value === entry) outfitGeometryCache.get(outfit.geometry)?.delete(key);
    });
  }
}

function paletteColor(value: THREE.ColorRepresentation, name: string): THREE.Color {
  if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return new THREE.Color(value);
  if (typeof value === 'string') {
    const color = NORMALIZED_LOOK_COLORS[value.toLowerCase()];
    if (color) return new THREE.Color(color);
  }
  fail(`${name} must be a normalized hex color or supported look swatch`);
}

function describeUnsupported(body: THREE.SkinnedMesh, look: AuthoredPresentationLook, hairLoaded: boolean): string[] {
  const unsupported: string[] = [];
  if (look.hair && !hairLoaded) unsupported.push(`hair:${look.hair} (no authored hair asset selected)`);

  if (look.fabric !== 'plain') unsupported.push(`fabric:${look.fabric} (the authored suit has no fabric variants)`);
  if (look.accessories?.length) unsupported.push(`accessories:${look.accessories.join(',')}`);
  if (look.wearables?.length) unsupported.push(`wearables:${look.wearables.join(',')}`);
  const appearance = look.appearance;
  if (appearance?.height && appearance.height !== 'average') unsupported.push(`height:${appearance.height}`);
  if (appearance?.build && appearance.build !== 'average') unsupported.push(`build:${appearance.build}`);
  if (appearance?.ageAppearance && appearance.ageAppearance !== 'adult') unsupported.push(`ageAppearance:${appearance.ageAppearance}`);
  const dictionary = body.morphTargetDictionary ?? {};
  const influences = body.morphTargetInfluences ?? [];
  for (const [name, index] of Object.entries(dictionary)) {
    if (CLOTHING_SHAPE_MORPHS.has(name) && !SUPPORTED_BODY_MORPHS.has(name) && Math.abs(influences[index] ?? 0) > 1e-4) {
      unsupported.push(`bodyMorph:${name}`);
    }
  }
  return unsupported;
}

function copyMorphValues(body: THREE.SkinnedMesh, outfit: THREE.SkinnedMesh, names: readonly string[]): string[] {
  const bodyDictionary = body.morphTargetDictionary ?? {};
  const outfitDictionary = outfit.morphTargetDictionary ?? {};
  const bodyValues = body.morphTargetInfluences;
  const outfitValues = outfit.morphTargetInfluences;
  check(bodyValues && outfitValues, 'body and outfit must expose morph influences');
  const copied: string[] = [];
  for (const name of names) {
    const bodyIndex = bodyDictionary[name], outfitIndex = outfitDictionary[name];
    check(Number.isInteger(bodyIndex) && Number.isInteger(outfitIndex), `missing supported outfit morph ${name}`);
    outfitValues[outfitIndex!] = bodyValues[bodyIndex!] ?? 0;
    copied.push(name);
  }
  return copied;
}

function syncMorphValues(body: THREE.SkinnedMesh, outfit: THREE.SkinnedMesh, names: readonly string[]): void {
  const bodyDictionary = body.morphTargetDictionary ?? {};
  const outfitDictionary = outfit.morphTargetDictionary ?? {};
  if (!body.morphTargetInfluences || !outfit.morphTargetInfluences) return;
  for (const name of names) {
    const bodyIndex = bodyDictionary[name], outfitIndex = outfitDictionary[name];
    if (Number.isInteger(bodyIndex) && Number.isInteger(outfitIndex)) {
      outfit.morphTargetInfluences[outfitIndex!] = body.morphTargetInfluences[bodyIndex!] ?? 0;
    }
  }
}

function createSkinnedSibling(
  body: THREE.SkinnedMesh,
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  name: string,
  targetNames: readonly string[],
): THREE.SkinnedMesh {
  check(body.parent, 'Body must be attached to the character root before presentation');
  const outfit = new THREE.SkinnedMesh(geometry, material);
  outfit.name = name;
  outfit.userData.targetNames = [...targetNames];
  outfit.position.copy(body.position);
  outfit.quaternion.copy(body.quaternion);
  outfit.scale.copy(body.scale);
  outfit.matrix.copy(body.matrix);
  outfit.matrixAutoUpdate = body.matrixAutoUpdate;
  outfit.bindMode = body.bindMode;
  outfit.bind(body.skeleton, body.bindMatrix);
  outfit.frustumCulled = false;
  outfit.castShadow = true;
  outfit.receiveShadow = true;
  outfit.renderOrder = body.renderOrder + 1;
  outfit.updateMorphTargets();
  check(outfit.morphTargetInfluences?.length === targetNames.length, 'authored morph names do not match target count');
  outfit.morphTargetDictionary = Object.fromEntries(targetNames.map((target, index) => [target, index]));
  body.parent.add(outfit);
  return outfit;
}

/**
 * Add the pinned CC0 casual suit to a cloned authored actor. The body source index
 * is checked before applying the bake's source-triangle hide list; the shared
 * template attributes and skeleton remain owned by the caller's character Kit.
 */
export async function applyAuthoredPresentation(
  root: THREE.Group,
  look: AuthoredPresentationLook,
  options: AuthoredPresentationOptions = {},
): Promise<AuthoredPresentation> {
  check(look.outfit === 'casual' || look.outfit === 'office', `no authored outfit for ${look.outfit}`);
  check(look.body === 'man' || look.body === 'woman', `unsupported body family ${look.body}`);
  const spec = look.outfit === 'office' ? OFFICE_SPECS[look.body] : CASUAL_SPECS[look.body];
  const requestedHair = look.hair === 'afro' || look.hair === 'curls' ? 'afro01'
    : look.hair === 'lowcut' || look.hair === 'low-cut' || look.hair === 'fade' || look.hair === 'classic' ? 'short02' : undefined;
  check(Boolean(options.hairAssetUrl) === Boolean(options.hairSha256), 'custom hair URL and SHA-256 must be supplied together');
  check(Boolean(options.hairAssetUrl) === Boolean(options.hairAssetName), 'custom hair URL and asset name must be supplied together');
  if (options.hairAssetUrl) {
    check(new URL(options.hairAssetUrl, import.meta.url).origin === new URL(import.meta.url).origin,
      'custom hair asset URL must be same-origin');
  }
  if ((options.hairAssetUrl || options.hairSha256 || options.hairAssetName) && !requestedHair) {
    fail(`no authored hair mapping is available for ${look.hair ?? 'this look'}`);
  }
  if (options.hairAssetName && options.hairAssetName !== requestedHair) fail('selected hair asset does not match the look hairstyle');
  const hairName = requestedHair;
  const hairUrl = options.hairAssetUrl ?? (hairName === 'short02' ? shortHairUrl : hairName === 'afro01' ? afroHairUrl : undefined);
  const hairHash = options.hairSha256 ?? (hairName === 'short02' ? SHORT_HAIR_SHA256 : hairName === 'afro01' ? AFRO_HAIR_SHA256 : undefined);
  let body: THREE.SkinnedMesh | undefined;
  root.traverse((node) => {
    if (node.name === 'Body' && (node as THREE.SkinnedMesh).isSkinnedMesh) {
      if (body) fail('actor contains multiple Body skinned meshes');
      body = node as THREE.SkinnedMesh;
    }
  });
  check(body, 'actor is missing its authored Body skinned mesh');
  const sourceBody = body;
  const sourceGeometry = sourceBody.geometry;
  const actualBodyIndexHash = await bodyIndexHash(sourceGeometry);
  check(actualBodyIndexHash === BODY_SOURCE_INDEX_SHA256, `Body source index hash changed (${actualBodyIndexHash})`);
  const standalone = options.kitOwner ? undefined : createStandaloneOwner();
  const owner = options.kitOwner ?? standalone!.owner;
  const templateCache = templateCacheFor(owner);
  assertTemplateCacheOpen(templateCache);
  let loadedTemplates: [{ outfit: OutfitTemplate; hideMap: BodyHideMap }, OutfitTemplate | undefined];
  try {
    loadedTemplates = await Promise.all([
      getTemplate(templateCache, spec),
      hairUrl && hairHash && hairName ? getHairTemplate(templateCache, hairUrl, hairHash, hairName) : Promise.resolve(undefined),
    ]);
  } catch (error) {
    standalone?.dispose();
    throw error;
  }
  const [{ outfit: template, hideMap }, hairTemplate] = loadedTemplates;
  assertTemplateCacheOpen(templateCache);
  let entry: OutfitGeometryEntry | undefined;
  let hairEntry: OutfitGeometryEntry | undefined;
  let clothingPalette: ReturnType<typeof createAuthoredClothingPalette> | undefined;
  let hairMaterial: THREE.MeshStandardMaterial | undefined;
  let hairPalette: ReturnType<typeof createAuthoredHairPalette> | undefined;
  let clothing: THREE.SkinnedMesh | undefined;
  let hair: THREE.SkinnedMesh | undefined;
  let mask: THREE.BufferGeometry | undefined;
  let maskLease: BodyMaskLease | undefined;
  let disposed = false;
  let ownerDisposer: (() => boolean) | undefined;
  const cleanupPresentation = () => {
    if (disposed) return;
    disposed = true;
    if (clothing) clothing.parent?.remove(clothing);
    if (hair) hair.parent?.remove(hair);
    if (maskLease) maskLease.dispose();
    else if (sourceBody.geometry === mask) sourceBody.geometry = sourceGeometry;
    clothingPalette?.dispose();
    hairPalette?.dispose();
    if (entry) releaseOutfitGeometry(template, entry);
    if (hairEntry && hairTemplate) releaseOutfitGeometry(hairTemplate, hairEntry);
    ownerDisposer?.();
    standalone?.dispose();
  };
  try {
    entry = acquireOutfitGeometry(template, sourceBody);
    if (hairTemplate) hairEntry = acquireHairGeometry(hairTemplate, sourceBody);
    clothingPalette = createAuthoredClothingPalette(template.material, {
      shirt: paletteColor(look.outfitColor, 'outfitColor'),
      trousers: paletteColor(look.bottomsColor, 'bottomsColor'),
    });
    clothing = createSkinnedSibling(sourceBody, entry.geometry, clothingPalette.material, look.outfit === 'office' ? 'Authored office suit' : 'Authored casual suit', template.targetNames);
    const copiedMorphs = copyMorphValues(sourceBody, clothing, template.targetNames);
    const previousOnBeforeRender = clothing.onBeforeRender;
    clothing.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
      syncMorphValues(sourceBody, clothing!, template.targetNames);
      previousOnBeforeRender.call(clothing!, renderer, scene, camera, geometry, material, group);
    };
    const copiedHairMorphs: string[] = [];
    if (hairTemplate && hairEntry) {
      hairPalette = createAuthoredHairPalette(hairTemplate.material, hairName!, look.hairColor ?? '#1c1917');
      hairMaterial = hairPalette.material;
      hair = createSkinnedSibling(sourceBody, hairEntry.geometry, hairMaterial, `Authored hair ${hairName}`, hairTemplate.targetNames);
      copiedHairMorphs.push(...copyMorphValues(sourceBody, hair, hairTemplate.targetNames));
      const previousHairOnBeforeRender = hair.onBeforeRender;
      hair.onBeforeRender = (renderer, scene, camera, geometry, material, group) => {
        syncMorphValues(sourceBody, hair!, hairTemplate.targetNames);
        previousHairOnBeforeRender.call(hair!, renderer, scene, camera, geometry, material, group);
      };
    }
    if (look.outfit === 'office' || options.additionalBodyHideSets?.length) {
      maskLease = await applyBodyMaskUnion(sourceBody, {
        expectedSourceIndexSha256: BODY_SOURCE_INDEX_SHA256,
        expectedSourceTriangleCount: BODY_SOURCE_TRIANGLES,
        hideSets: [{ asset: hideMap.asset, bodySourceTriangleCount: hideMap.bodySourceTriangleCount,
          triangleIds: hideMap.bodyHideSourceTriangleIds }, ...(options.additionalBodyHideSets ?? [])],
      });
      mask = maskLease.geometry;
    } else {
      mask = bodyMaskGeometry(sourceGeometry, hideMap);
      sourceBody.geometry = mask;
    }
    const presentation: AuthoredPresentation = {
      metrics: {
        bodySourceIndexSha256: actualBodyIndexHash,
        outfitSha256: spec.sha,
        bodySourceTriangles: BODY_SOURCE_TRIANGLES,
        bodyVisibleTriangles: maskLease?.metrics.visibleTriangles ?? BODY_SOURCE_TRIANGLES - spec.hidden,
        hiddenBodyTriangles: maskLease?.metrics.hiddenTriangles ?? spec.hidden,
        outfitTriangles: entry.outfitTriangles,
        hairTriangles: hairEntry?.hairTriangles ?? 0,
        overlayDrawCalls: 1 + (hairEntry ? 1 : 0),
        bodyMaskIndexBytes: mask.getIndex()!.array.byteLength,
        outfitGeometryBytes: entry.byteLength + (hairEntry?.byteLength ?? 0),
        copiedMorphs: [...new Set(hairEntry ? [...copiedMorphs, ...copiedHairMorphs] : copiedMorphs)],
        unsupported: describeUnsupported(sourceBody, look, Boolean(hairEntry)),
        ...(hairEntry && hairHash ? { hairSha256: hairHash } : {}),
      },
      setColors(shirt, trousers, hairColor) {
        check(!disposed, 'cannot update disposed presentation');
        const top=paletteColor(shirt,'outfitColor'),bottom=paletteColor(trousers,'bottomsColor'),hair=paletteColor(hairColor,'hairColor');
        clothingPalette!.setColors({shirt:top,trousers:bottom});
        hairPalette?.setColor(hair);
      },
      dispose() { cleanupPresentation(); },
    };
    if (options.kitOwner) ownerDisposer = options.kitOwner.onDispose(() => presentation.dispose());
    assertTemplateCacheOpen(templateCache);
    return presentation;
  } catch (error) {
    cleanupPresentation();
    throw error;
  }
}
