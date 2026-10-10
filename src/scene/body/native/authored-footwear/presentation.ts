import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import shoesUrl from './out/shoes01-mobile.glb?url';

const SHOES_SHA256 = '8f4060a275356489205f298bed9874da83920c166aeacffd36746e760a465557';
const JOINT_COUNT = 52;
const TARGET_NAMES = ['bodyFeminine', 'bodyMasculine'] as const;
const FEMININE_MAX_FIT_METRES = 0.04727106156356638;
const MASCULINE_MAX_FIT_METRES = 0.007975778640520927;

export interface AuthoredFootwearOptions {
  /** Optional Kit lifecycle owner; source templates are shared only within this owner. */
  readonly kitOwner?: AuthoredFootwearKitOwner;
}

export interface AuthoredFootwearKitOwner {
  onDispose(callback: () => void): () => boolean;
}

export interface AuthoredFootwearMetrics {
  readonly sourceSha256: string;
  readonly vertices: number;
  readonly triangles: number;
  readonly jointCount: number;
  readonly copiedMorphs: readonly string[];
  readonly remappedJointIndices: boolean;
  readonly feminineFitMaximumMetres: number;
  readonly masculineFitMaximumMetres: number;
  readonly warnings: readonly string[];
}

export interface AuthoredFootwear {
  readonly object: THREE.SkinnedMesh;
  readonly metrics: AuthoredFootwearMetrics;
  dispose(): void;
}

interface Template {
  root: THREE.Group;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
  jointNames: readonly string[];
  targetNames: readonly string[];
  vertices: number;
  triangles: number;
}

interface FootwearTemplateCache { closed: boolean; promise?: Promise<Template>; root?: THREE.Group; }
const templateCaches = new WeakMap<AuthoredFootwearKitOwner, FootwearTemplateCache>();
const disposedRoots = new WeakSet<THREE.Object3D>();

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Authored footwear: ${message}`);
}

function disposeTemplateRoot(root: THREE.Object3D): void {
  if (disposedRoots.has(root)) return;
  disposedRoots.add(root);
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

function createStandaloneOwner(): { owner: AuthoredFootwearKitOwner; dispose(): void } {
  const callbacks = new Set<() => void>();
  let closed = false;
  return {
    owner: {
      onDispose(callback) { if (closed) { callback(); return () => false; } callbacks.add(callback); return () => callbacks.delete(callback); },
    },
    dispose() { if (closed) return; closed = true; for (const callback of [...callbacks]) { callbacks.delete(callback); callback(); } },
  };
}

function cacheFor(owner: AuthoredFootwearKitOwner): FootwearTemplateCache {
  const current = templateCaches.get(owner);
  if (current) return current;
  const cache: FootwearTemplateCache = { closed: false };
  templateCaches.set(owner, cache);
  owner.onDispose(() => {
    if (cache.closed) return;
    cache.closed = true;
    if (cache.root) disposeTemplateRoot(cache.root);
    cache.root = undefined;
    cache.promise = undefined;
  });
  return cache;
}

function assertCacheOpen(cache: FootwearTemplateCache): void {
  invariant(!cache.closed, 'Kit was disposed while mobile shoe assets were loading');
}

function canonicalJoint(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^mixamorig/, '');
}

async function digest(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function loadTemplate(): Promise<Template> {
  await MeshoptDecoder.ready;
  const url = new URL(shoesUrl, import.meta.url);
  const response = await fetch(url.href, { credentials: 'same-origin' });
  invariant(response.ok, `mobile shoe fetch failed (${response.status})`);
  const bytes = await response.arrayBuffer();
  const actual = await digest(bytes);
  invariant(actual === SHOES_SHA256, `mobile shoe SHA-256 mismatch (${actual})`);
  const resourceBase = new URL('.', url.protocol === 'data:' ? import.meta.url : url).href;
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes, resourceBase);
  try {
  let mesh: THREE.Mesh | undefined;
  gltf.scene.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) {
      invariant(!mesh, 'shoe asset must contain one mesh');
      mesh = node as THREE.Mesh;
    }
  });
  invariant(mesh, 'shoe GLB has no mesh');
  invariant(!(mesh instanceof THREE.SkinnedMesh), 'shoe asset must not introduce a second skeleton');
  invariant(!Array.isArray(mesh.material) && mesh.material instanceof THREE.MeshStandardMaterial, 'shoe requires one standard material');
  const geometry = mesh.geometry;
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  invariant(position && index && skinIndex && skinWeight, 'shoe is missing indexed skinned geometry');
  invariant(position.count === 1904 && index.count / 3 === 3320 && index.count % 3 === 0, 'shoe geometry count changed');
  invariant(skinIndex.itemSize === 4 && skinWeight.itemSize === 4 && skinIndex.count === position.count && skinWeight.count === position.count,
    'shoe skin attribute layout changed');
  const extras = mesh.userData as { jointNames?: unknown; targetNames?: unknown };
  invariant(Array.isArray(extras.jointNames) && extras.jointNames.length === JOINT_COUNT && extras.jointNames.every((v) => typeof v === 'string'),
    'shoe joint-name contract changed');
  invariant(JSON.stringify(extras.targetNames) === JSON.stringify(TARGET_NAMES), 'shoe family morph order changed');
  invariant(geometry.morphAttributes.position?.length === TARGET_NAMES.length, 'shoe family morph payload changed');
  const material = mesh.material as THREE.MeshStandardMaterial;
  invariant(material.map && material.normalMap, 'mobile shoe diffuse or normal texture is missing');
  invariant(material.map.colorSpace === THREE.SRGBColorSpace && material.normalMap.colorSpace === THREE.NoColorSpace,
    'shoe texture color-space interpretation changed');
  for (let v = 0; v < position.count; v++) {
    let sum = 0;
    for (let lane = 0; lane < 4; lane++) {
      const joint = skinIndex.getComponent(v, lane), weight = skinWeight.getComponent(v, lane);
      invariant(Number.isInteger(joint) && joint >= 0 && joint < JOINT_COUNT, `source joint index invalid at vertex ${v}`);
      invariant(Number.isFinite(weight) && weight >= 0, `source joint weight invalid at vertex ${v}`);
      sum += weight;
    }
    invariant(Math.abs(sum - 1) < 2e-4, `source skin weights are not normalized at vertex ${v}`);
  }
  return {
    root: gltf.scene,
    geometry,
    material,
    jointNames: extras.jointNames as string[],
    targetNames: extras.targetNames as string[],
    vertices: position.count,
    triangles: index.count / 3,
  };
  } catch (error) {
    disposeTemplateRoot(gltf.scene);
    throw error;
  }
}

function getTemplate(cache: FootwearTemplateCache): Promise<Template> {
  assertCacheOpen(cache);
  cache.promise ??= loadTemplate().then((template) => {
    if (cache.closed) { disposeTemplateRoot(template.root); invariant(false, 'Kit was disposed while mobile shoes were loading'); }
    cache.root = template.root;
    return template;
  }).catch((error: unknown) => {
    cache.promise = undefined;
    throw error;
  });
  return cache.promise;
}

function remapJointIndices(source: Template, body: THREE.SkinnedMesh, geometry: THREE.BufferGeometry): void {
  const bodyIndices = new Map<string, number>();
  body.skeleton.bones.forEach((bone, index) => {
    const key = canonicalJoint(bone.name);
    invariant(!bodyIndices.has(key), `actor has ambiguous joint ${bone.name}`);
    bodyIndices.set(key, index);
  });
  const mapped = source.jointNames.map((name) => {
    const index = bodyIndices.get(canonicalJoint(name));
    invariant(index !== undefined, `actor skeleton is missing shoe joint ${name}`);
    return index;
  });
  invariant(body.skeleton.bones.length === JOINT_COUNT && mapped.length === JOINT_COUNT && new Set(mapped).size === JOINT_COUNT,
    'actor and shoe skeleton joint sets do not match bijectively');
  const indices = geometry.getAttribute('skinIndex');
  invariant(indices instanceof THREE.BufferAttribute, 'shoe joints must be a regular BufferAttribute');
  const remapped = indices.array.slice() as Uint16Array | Uint32Array;
  for (let vertex = 0; vertex < indices.count; vertex++) {
    for (let lane = 0; lane < 4; lane++) {
      const sourceIndex = Math.round(indices.getComponent(vertex, lane));
      invariant(sourceIndex >= 0 && sourceIndex < mapped.length, `shoe source joint out of range at vertex ${vertex}`);
      remapped[vertex * 4 + lane] = mapped[sourceIndex]!;
    }
  }
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(remapped, 4, indices.normalized));
}

function copyFamilyMorphs(body: THREE.SkinnedMesh, shoes: THREE.SkinnedMesh): void {
  const bodyDictionary = body.morphTargetDictionary ?? {};
  const shoeDictionary = shoes.morphTargetDictionary ?? {};
  const bodyInfluences = body.morphTargetInfluences;
  const shoeInfluences = shoes.morphTargetInfluences;
  invariant(bodyInfluences && shoeInfluences, 'body and footwear require morph influence arrays');
  for (const name of TARGET_NAMES) {
    const bi = bodyDictionary[name], si = shoeDictionary[name];
    invariant(Number.isInteger(bi) && Number.isInteger(si), `body or shoe is missing ${name}`);
    shoeInfluences[si!] = bodyInfluences[bi!] ?? 0;
  }
}

/** Attach the pinned, source-authored mobile shoes to an actor's existing Mixamo rig. */
export async function applyAuthoredFootwear(root: THREE.Group, options: AuthoredFootwearOptions = {}): Promise<AuthoredFootwear> {
  let body: THREE.SkinnedMesh | undefined;
  root.traverse((node) => {
    if (node.name === 'Body' && (node as THREE.SkinnedMesh).isSkinnedMesh) {
      invariant(!body, 'actor contains multiple Body meshes');
      body = node as THREE.SkinnedMesh;
    }
  });
  invariant(body, 'actor is missing the Body skinned mesh');
  const standalone = options.kitOwner ? undefined : createStandaloneOwner();
  const owner = options.kitOwner ?? standalone!.owner;
  const cache = cacheFor(owner);
  assertCacheOpen(cache);
  const sourceBody = body;
  let template: Template;
  try { template = await getTemplate(cache); } catch (error) { standalone?.dispose(); throw error; }
  assertCacheOpen(cache);
  const geometry = template.geometry.clone();
  const material = template.material.clone();
  let shoes: THREE.SkinnedMesh | undefined;
  let disposed = false;
  let unregisterOwner: (() => boolean) | undefined;
  let footwear: AuthoredFootwear | undefined;
  try {
    remapJointIndices(template, sourceBody, geometry);
    shoes = new THREE.SkinnedMesh(geometry, material);
    shoes.name = 'Authored footwear shoes01';
    shoes.position.copy(sourceBody.position);
    shoes.quaternion.copy(sourceBody.quaternion);
    shoes.scale.copy(sourceBody.scale);
    shoes.matrix.copy(sourceBody.matrix);
    shoes.matrixAutoUpdate = sourceBody.matrixAutoUpdate;
    shoes.bindMode = sourceBody.bindMode;
    shoes.bind(sourceBody.skeleton, sourceBody.bindMatrix);
    shoes.frustumCulled = false;
    shoes.castShadow = true;
    shoes.receiveShadow = true;
    shoes.renderOrder = sourceBody.renderOrder + 2;
    shoes.updateMorphTargets();
    shoes.morphTargetDictionary = Object.fromEntries(TARGET_NAMES.map((name, index) => [name, index]));
    invariant(shoes.morphTargetInfluences?.length === TARGET_NAMES.length, 'shoe family morph count changed');
    copyFamilyMorphs(sourceBody, shoes);
    const previousOnBeforeRender = shoes.onBeforeRender;
    shoes.onBeforeRender = (renderer, scene, camera, activeGeometry, activeMaterial, group) => {
      copyFamilyMorphs(sourceBody, shoes!);
      previousOnBeforeRender.call(shoes!, renderer, scene, camera, activeGeometry, activeMaterial, group);
    };
    invariant(sourceBody.parent, 'Body must be attached to actor root');
    sourceBody.parent.add(shoes);
    const metrics: AuthoredFootwearMetrics = Object.freeze({
      sourceSha256: SHOES_SHA256,
      vertices: template.vertices,
      triangles: template.triangles,
      jointCount: sourceBody.skeleton.bones.length,
      copiedMorphs: Object.freeze([...TARGET_NAMES]),
      remappedJointIndices: true,
      feminineFitMaximumMetres: FEMININE_MAX_FIT_METRES,
      masculineFitMaximumMetres: MASCULINE_MAX_FIT_METRES,
      warnings: Object.freeze(['The source footwear remains male-authored; maximum mapped feminine fit discrepancy is 4.73 cm and requires rendered review.']),
    });
    footwear = {
      object: shoes,
      metrics,
      dispose() {
        if (disposed) return;
        disposed = true;
        shoes!.parent?.remove(shoes!);
        geometry.dispose();
        material.dispose();
        unregisterOwner?.();
        standalone?.dispose();
      },
    };
    invariant(footwear, 'shoe instance was not created');
    if (options.kitOwner) unregisterOwner = options.kitOwner.onDispose(() => footwear!.dispose());
    assertCacheOpen(cache);
    return footwear!;
  } catch (error) {
    if (footwear) footwear.dispose();
    else {
      shoes?.parent?.remove(shoes);
      geometry.dispose();
      material.dispose();
      standalone?.dispose();
    }
    throw error;
  }
}
