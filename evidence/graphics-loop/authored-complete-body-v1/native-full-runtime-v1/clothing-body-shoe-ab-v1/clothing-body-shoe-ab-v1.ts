import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createKit } from '../../../../../src/scene/kit.ts';
import type { BodyKey } from '../../../../../src/scene/body/manifest.ts';
import { prepareNativeSkinnedBody } from '../native-prepared-factory-v29.ts';
import { trimAuthoredSockAboveTrouserHem } from '../trouser-sock-trim.ts';
import { applyBodyMaskUnion } from '../../body-mask-union.ts';
import bodyAssetUrl from '../../authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb?url';
import officeFemaleHideUrl from '../../authored-clothing/office-export/out/office-female-body-hide-map.json?url';
import shoesHideUrl from '../../authored-footwear/out/shoes01-body-hide-map.json?url';
import { deriveBodyCoveragePatch } from './body-coverage-patch.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const status = document.querySelector<HTMLDivElement>('#status')!;
const output = document.querySelector<HTMLPreElement>('#status-json')!;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#d7e2e6');
scene.add(new THREE.HemisphereLight('#f5f4ea', '#837c71', 2));
const key = new THREE.DirectionalLight('#fff2dc', 3.2);
key.position.set(-3.5, 6.5, 4);
scene.add(key);
const fill = new THREE.DirectionalLight('#d5e6ff', 1.1);
fill.position.set(4, 3.5, -3);
scene.add(fill);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: '#dedbd3', roughness: 0.94 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.012;
scene.add(floor);
const camera = new THREE.PerspectiveCamera(33, 1, 0.05, 80);
camera.position.set(0, 1.52, 5.15);
camera.lookAt(0, 0.94, 0);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

type Actor = Awaited<ReturnType<typeof prepareNativeSkinnedBody>>;
type Outfit = 'casual' | 'office';
let actor: Actor | undefined;
let kit: ReturnType<typeof createKit> | undefined;
let family: BodyKey = 'male';
let outfit: Outfit = 'casual';
let currentLook: Record<string, unknown> | undefined;
let seed = '';
let pose: 'idle' | 'walk' | 'interact' = 'idle';
let phase = 0;
let yaw = 0;
let view: 'front' | 'quarter' | 'side' | 'back' = 'front';
let variant: 'source' | 'candidate' = 'source';
let sourceShoeGeometry: THREE.BufferGeometry | undefined;
let trimmedShoeGeometry: THREE.BufferGeometry | undefined;
let trimLease: ReturnType<typeof trimAuthoredSockAboveTrouserHem> | undefined;
let body: THREE.SkinnedMesh | undefined;
let bodyCandidate: THREE.SkinnedMesh | undefined;
let bodyCandidateSourceGeometry: THREE.BufferGeometry | undefined;
let bodyCandidateLease: Awaited<ReturnType<typeof applyBodyMaskUnion>> | undefined;
let bodyCoverageMetrics: ReturnType<typeof deriveBodyCoveragePatch>['metrics'] | undefined;
let sampledTrimPhases: readonly number[] = Object.freeze([]);
const ownedActors: Array<{ actor: Actor; kit: ReturnType<typeof createKit>; trimLease?: ReturnType<typeof trimAuthoredSockAboveTrouserHem> }> = [];
let disposed = false;
let generation = 0;
let sourceIndexSha256 = '';
let sourceAttributeNames: readonly string[] = Object.freeze([]);

function meshNamed(name: string): THREE.SkinnedMesh | undefined {
  let result: THREE.SkinnedMesh | undefined;
  actor?.object.traverse((node) => { if (node.name === name && (node as THREE.SkinnedMesh).isSkinnedMesh) result = node as THREE.SkinnedMesh; });
  return result;
}
function garmentName(): string { return outfit === 'office' ? 'Authored office suit' : 'Authored casual suit'; }
function state() {
  if (!actor) return { state: 'loading', family, outfit, generation };
  const shoes = meshNamed('Authored footwear shoes01');
  const garment = meshNamed(garmentName());
  const shoeIndex = shoes?.geometry.getIndex();
  return {
    state: 'ready', family, outfit, look: currentLook, seed, pose, phase, view, yawDegrees: yaw * 180 / Math.PI, variant, generation,
    trimPolicy: outfit === 'office' && family === 'female' ? 'explicit skirt no-op' : 'actual per-side trouser hem; private shoe index',
    trim: trimLease?.metrics ?? { status: 'not-applied' },
    bodyCoveragePatch: bodyCoverageMetrics ?? null,
    bodyMaskCandidate: bodyCandidateLease?.metrics ?? null,
    trimSampledWalkPhases: sampledTrimPhases,
    components: {
      body: body ? {
        name: body.name, visible: body.visible,
        activeTriangles: (body.geometry.getIndex()?.count ?? 0) / 3,
        candidateTriangles: bodyCandidate ? (bodyCandidate.geometry.getIndex()?.count ?? 0) / 3 : null,
        existingHiddenTriangles: actor.wardrobe.hiddenTriangles,
        unionHiddenTriangles: bodyCandidateLease?.metrics.hiddenTriangles ?? null,
        candidateVisible: bodyCandidate?.visible ?? false,
      } : null,
      garment: garment ? { name: garment.name, visible: garment.visible, triangles: (garment.geometry.getIndex()?.count ?? 0) / 3 } : null,
      shoes: shoes ? {
        name: shoes.name, visible: shoes.visible,
        activeTriangles: shoeIndex ? shoeIndex.count / 3 : 0,
        sourceTriangles: sourceShoeGeometry ? (sourceShoeGeometry.getIndex()?.count ?? 0) / 3 : null,
        candidateTriangles: trimmedShoeGeometry ? (trimmedShoeGeometry.getIndex()?.count ?? 0) / 3 : null,
        activeIsPrivateCandidate: shoes.geometry === trimmedShoeGeometry,
        sourceIndexSha256,
        sourceAttributeNames,
        allSourceAttributesSharedReadOnly: !!sourceShoeGeometry && !!trimmedShoeGeometry
          && Object.entries(sourceShoeGeometry.attributes).every(([name, attribute]) => trimmedShoeGeometry!.getAttribute(name) === attribute),
      } : null,
    },
    factory: { family: actor.preparedMetrics.bodyKey, retargetMode: actor.preparedMetrics.retargetMode, clothingTriangles: actor.preparedMetrics.clothingTriangles, shoeTriangles: actor.preparedMetrics.shoeTriangles },
    render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, frame: renderer.info.render.frame, canvasWidth: canvas.width, canvasHeight: canvas.height },
  };
}
function record() { output.textContent = JSON.stringify(state(), null, 2); }
function render() { if (!disposed) renderer.render(scene, camera); }
function setVariant(next: 'source' | 'candidate') {
  const shoes = meshNamed('Authored footwear shoes01');
  if (!shoes || !sourceShoeGeometry || !trimmedShoeGeometry) throw new Error('Shoes are not ready');
  variant = next;
  shoes.geometry = next === 'source' ? sourceShoeGeometry : trimmedShoeGeometry;
  if (body && bodyCandidate) {
    body.visible = next === 'source';
    bodyCandidate.visible = next === 'candidate';
  }
  render(); record();
}
function setPose(next: 'idle' | 'walk' | 'interact', walkPhase = Math.PI * 0.5) {
  if (!actor) throw new Error('Actor is not ready');
  pose = next;
  phase = next === 'walk' ? walkPhase : 0;
  actor.show(next, false);
  if (next === 'walk') actor.stride(phase, false, 0);
  const support = actor.solveFeet(() => 0);
  if (support.limited || support.maxError > 0.004) throw new Error(`Pose support failed: ${JSON.stringify(support)}`);
  actor.place(0, 0, 0, yaw);
  render(); record();
}
function setView(next: 'front' | 'quarter' | 'side' | 'back') {
  view = next;
  yaw = next === 'quarter' ? -Math.PI / 4 : next === 'side' ? -Math.PI / 2 : next === 'back' ? Math.PI : 0;
  if (actor) actor.place(0, 0, 0, yaw);
  const target = new THREE.Vector3(0, 0.94, 0);
  camera.position.set(0, 1.52, 5.15);
  if (next === 'quarter') camera.position.set(3.64, 1.52, 3.64);
  if (next === 'side') camera.position.set(5.15, 1.52, 0);
  if (next === 'back') camera.position.set(0, 1.52, -5.15);
  camera.lookAt(target); render(); record();
}
function prepareTrimAcrossIdleAndWalk(garment: THREE.SkinnedMesh, shoes: THREE.SkinnedMesh) {
  const phases = [Math.PI * 0.5, Math.PI, Math.PI * 1.5, Math.PI * 2];
  const hidden = new Set<number>();
  const protectedSoles = new Set<number>();
  const probe = () => trimAuthoredSockAboveTrouserHem({
    actorRoot: actor!.object, garment, shoes, trouserOutfit: true,
    additionalRemovedSourceTriangleIds: [...hidden],
    protectedSoleSourceTriangleIds: [...protectedSoles],
  });
  actor!.show('idle', false);
  let lease = probe();
  for (const id of lease.metrics.removedSourceTriangleIds) hidden.add(id);
  for (const id of lease.metrics.protectedSoleSourceTriangleIds) protectedSoles.add(id);
  lease.dispose();
  for (const walkPhase of phases) {
    actor!.show('walk', false);
    actor!.stride(walkPhase, false, 0);
    actor!.place(0, 0, 0, yaw);
    const contact = actor!.solveFeet(() => 0);
    if (contact.limited || contact.maxError > 0.004) throw new Error(`Trim sample walk support failed at ${walkPhase}: ${JSON.stringify(contact)}`);
    lease = probe();
    for (const id of lease.metrics.removedSourceTriangleIds) hidden.add(id);
    for (const id of lease.metrics.protectedSoleSourceTriangleIds) protectedSoles.add(id);
    lease.dispose();
  }
  actor!.show('idle', false);
  actor!.place(0, 0, 0, yaw);
  const idleContact = actor!.solveFeet(() => 0);
  if (idleContact.limited || idleContact.maxError > 0.004) throw new Error(`Trim restore idle support failed: ${JSON.stringify(idleContact)}`);
  sampledTrimPhases = Object.freeze(phases);
  return trimAuthoredSockAboveTrouserHem({
    actorRoot: actor!.object, garment, shoes, trouserOutfit: true,
    additionalRemovedSourceTriangleIds: [...hidden],
    protectedSoleSourceTriangleIds: [...protectedSoles],
  });
}
async function load(next: BodyKey, nextOutfit: Outfit): Promise<void> {
  const request = ++generation;
  bodyCandidateLease?.dispose(); bodyCandidateLease = undefined;
  bodyCandidate?.parent?.remove(bodyCandidate); bodyCandidate = undefined;
  bodyCandidateSourceGeometry?.dispose(); bodyCandidateSourceGeometry = undefined;
  const oldActor = actor;
  if (oldActor) {
    const oldIndex = ownedActors.findIndex((entry) => entry.actor === oldActor);
    if (oldIndex >= 0) {
      const [oldEntry] = ownedActors.splice(oldIndex, 1);
      if (!oldEntry) throw new Error('Actor ownership entry disappeared during replacement');
      oldEntry.trimLease?.dispose();
      oldEntry.actor.object.parent?.remove(oldEntry.actor.object);
      oldEntry.actor.dispose();
      oldEntry.kit.dispose();
    }
  }
  actor = undefined;
  sourceShoeGeometry = undefined;
  trimmedShoeGeometry = undefined;
  sourceIndexSha256 = '';
  sourceAttributeNames = Object.freeze([]);
  sampledTrimPhases = Object.freeze([]);
  trimLease = undefined;
  body = undefined; bodyCoverageMetrics = undefined;
  kit = createKit();
  family = next; outfit = nextOutfit; pose = 'idle'; phase = 0; variant = 'source';
  status.textContent = `Loading ${next} ${nextOutfit} actor…`; status.dataset.state = 'loading'; record();
  const look = next === 'male' ? {
    body: 'man', hair: 'lowcut', outfit: nextOutfit, fabric: 'plain', skin: 'skin3', hairColor: 'darkbrown',
    outfitColor: 'navy', bottomsColor: 'cream', accessories: [], face: 'oval', expression: 'neutral',
    appearance: { height: 'average', build: 'average', ageAppearance: 'adult' },
  } : {
    body: 'woman', hair: 'afro', outfit: nextOutfit, fabric: 'plain', skin: 'skin3', hairColor: 'darkbrown',
    outfitColor: nextOutfit === 'office' ? 'red' : 'violet', bottomsColor: 'cream', accessories: [], face: 'oval', expression: 'neutral',
    appearance: { height: 'average', build: 'average', ageAppearance: 'adult' },
  };
  currentLook = look; seed = next === 'female' && nextOutfit === 'office' ? 'component-isolation-female-office' : `sock-trim-${next}-${nextOutfit}`;
  const owner = kit;
  let prepared: Actor;
  try {
    prepared = await prepareNativeSkinnedBody({ kit: owner, seed, look, sceneScale: 1, retargetMode: 'directions' });
  } catch (error) {
    owner.dispose();
    if (request === generation && !disposed) { status.textContent = error instanceof Error ? error.message : String(error); status.dataset.state = 'error'; record(); }
    throw error;
  }
  if (request !== generation || disposed || owner !== kit) { prepared.dispose(); owner.dispose(); return; }
  actor = prepared;
  const ownedEntry = { actor: prepared, kit: owner, trimLease: undefined as ReturnType<typeof trimAuthoredSockAboveTrouserHem> | undefined };
  ownedActors.push(ownedEntry);
  actor.object.name = `V29 ${next} ${nextOutfit} shoe sock-trim A-B actor`;
  scene.add(actor.object);
  actor.place(0, 0, 0, yaw);
  actor.show('idle', false);
  body = meshNamed('Body');
  const shoes = meshNamed('Authored footwear shoes01');
  const garment = meshNamed(garmentName());
  if (!body || !shoes || !garment) throw new Error(`Prepared actor is missing Body, ${garmentName()}, or footwear`);

  if (next === 'female' && nextOutfit === 'office') {
    await preparePixelSeedBodyCandidate(body, garment);
  }
  sourceShoeGeometry = shoes.geometry;
  const sourceIndex = sourceShoeGeometry.getIndex();
  if (!sourceIndex) throw new Error('Source shoe has no index');
  const indexBytes = new Uint8Array(sourceIndex.array.byteLength);
  indexBytes.set(new Uint8Array(sourceIndex.array.buffer, sourceIndex.array.byteOffset, sourceIndex.array.byteLength));
  sourceIndexSha256 = await crypto.subtle.digest('SHA-256', indexBytes.buffer)
    .then((digest) => [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join(''));
  sourceAttributeNames = Object.freeze(Object.keys(sourceShoeGeometry.attributes).sort());
  const sourceIndexSnapshot = sourceIndex.array.slice() as typeof sourceIndex.array;
  const sourceMaterial = shoes.material;
  const sourceSkeleton = shoes.skeleton;
  const sourceAttributeSnapshot = { ...sourceShoeGeometry.attributes };
  const trouserOutfit = nextOutfit === 'casual' || next === 'male';
  trimLease = trouserOutfit
    ? prepareTrimAcrossIdleAndWalk(garment, shoes)
    : trimAuthoredSockAboveTrouserHem({ actorRoot: actor.object, garment, shoes, trouserOutfit: false });
  ownedEntry.trimLease = trimLease;
  trimmedShoeGeometry = shoes.geometry;
  const candidateIndex = trimmedShoeGeometry.getIndex();
  if (!candidateIndex) throw new Error('Trim candidate has no index');
  if (shoes.skeleton !== sourceSkeleton || shoes.material !== sourceMaterial || shoes.skeleton !== garment.skeleton) {
    throw new Error('Trim changed shared actor skeleton or shoe material');
  }
  if (sourceIndex.array.some((value, index) => value !== sourceIndexSnapshot[index])) throw new Error('Trim mutated source index bytes');
  if (Object.entries(sourceAttributeSnapshot).some(([name, attribute]) => sourceShoeGeometry!.getAttribute(name) !== attribute)) throw new Error('Trim changed source attribute bindings');
  if (Object.entries(sourceAttributeSnapshot).some(([name, attribute]) => trimmedShoeGeometry!.getAttribute(name) !== attribute)) throw new Error('Trim did not preserve source attribute identity');
  if (trouserOutfit && candidateIndex.count >= sourceIndex.count) throw new Error('Trouser trim did not reduce the shoe index');
  if (!trouserOutfit && candidateIndex.count !== sourceIndex.count) throw new Error('Skirt no-op changed shoe index count');
  if (trimLease.metrics.protectedSoleSourceTriangleIds.some((id) => trimLease!.metrics.removedSourceTriangleIds.includes(id))) throw new Error('A sole-contact triangle was removed');
  const support = actor.solveFeet(() => 0);
  if (support.limited || support.maxError > 0.004) throw new Error(`Initial shoe support failed after trim: ${JSON.stringify(support)}`);
  setVariant('source');
  status.textContent = `Ready · source vs body-mask + sock-trim candidate · ${trimLease.metrics.status}`; status.dataset.state = 'ready'; record();
}

async function preparePixelSeedBodyCandidate(sourceBody: THREE.SkinnedMesh, garment: THREE.SkinnedMesh): Promise<void> {
  if (!actor || !kit) throw new Error('Actor is not ready for the body patch');
  await MeshoptDecoder.ready;
  const url = new URL(bodyAssetUrl, window.location.href);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Raw Body index GLB request failed: ${response.status}`);
  const raw = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(await response.arrayBuffer(), new URL('.', url).href);
  let rawBody: THREE.SkinnedMesh | undefined;
  raw.scene.traverse((node) => { if (node.name === 'Body' && (node as THREE.SkinnedMesh).isSkinnedMesh) rawBody = node as THREE.SkinnedMesh; });
  const rawIndex = rawBody?.geometry.getIndex();
  if (!rawBody || !rawIndex || rawIndex.count / 3 !== 26756) throw new Error('Pinned raw Body index is unavailable or changed');
  const rawIndexBytes = new Uint8Array(rawIndex.array.buffer, rawIndex.array.byteOffset, rawIndex.array.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', rawIndexBytes.slice().buffer);
  const indexSha = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  if (indexSha !== '4c29f318e20b87a2c0ddce3689fa0ab285ee390fc02e5f3a017736df772a3661') throw new Error(`Raw Body index SHA mismatch: ${indexSha}`);

  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(sourceBody.geometry.attributes)) geometry.setAttribute(name, attribute);
  geometry.morphAttributes = { ...sourceBody.geometry.morphAttributes };
  geometry.morphTargetsRelative = sourceBody.geometry.morphTargetsRelative;
  geometry.setIndex(rawIndex.clone());
  geometry.boundingBox = rawBody.geometry.boundingBox?.clone() ?? null;
  geometry.boundingSphere = rawBody.geometry.boundingSphere?.clone() ?? null;
  const candidate = new THREE.SkinnedMesh(geometry, sourceBody.material);
  candidate.name = 'Office blouse covered-body candidate';
  candidate.position.copy(sourceBody.position); candidate.quaternion.copy(sourceBody.quaternion); candidate.scale.copy(sourceBody.scale);
  candidate.matrix.copy(sourceBody.matrix); candidate.matrixAutoUpdate = sourceBody.matrixAutoUpdate;
  candidate.bindMode = sourceBody.bindMode; candidate.bind(sourceBody.skeleton, sourceBody.bindMatrix);
  candidate.bindMatrix.copy(sourceBody.bindMatrix); candidate.bindMatrixInverse.copy(sourceBody.bindMatrixInverse);
  candidate.morphTargetDictionary = sourceBody.morphTargetDictionary ? { ...sourceBody.morphTargetDictionary } : undefined;
  candidate.morphTargetInfluences = sourceBody.morphTargetInfluences ? [...sourceBody.morphTargetInfluences] : undefined;
  candidate.castShadow = sourceBody.castShadow; candidate.receiveShadow = sourceBody.receiveShadow;
  candidate.frustumCulled = sourceBody.frustumCulled; candidate.renderOrder = sourceBody.renderOrder;
  sourceBody.parent!.add(candidate); candidate.updateWorldMatrix(true, false); candidate.updateMatrixWorld(true);
  const patch = deriveBodyCoveragePatch({ body: candidate, garment, sourceTriangleCount: 26756, seedTriangleIds: [3136] });
  const officeResponse = await fetch(officeFemaleHideUrl); const shoeResponse = await fetch(shoesHideUrl);
  if (!officeResponse.ok || !shoeResponse.ok) throw new Error('Could not load exact office/shoe body hide maps');
  const officeHide = await officeResponse.json() as { asset: string; bodySourceTriangleCount: number; bodyHideSourceTriangleIds: number[] };
  const shoeHide = await shoeResponse.json() as { asset: string; bodySourceTriangleCount: number; sourceBodyTriangleIds: number[] };
  bodyCandidateSourceGeometry = geometry; bodyCandidate = candidate;
  bodyCandidateLease = await applyBodyMaskUnion(candidate, {
    expectedSourceIndexSha256: indexSha, expectedSourceTriangleCount: 26756,
    hideSets: [
      { asset: officeHide.asset, bodySourceTriangleCount: officeHide.bodySourceTriangleCount, triangleIds: officeHide.bodyHideSourceTriangleIds },
      { asset: shoeHide.asset, bodySourceTriangleCount: shoeHide.bodySourceTriangleCount, triangleIds: shoeHide.sourceBodyTriangleIds },
      { asset: 'female-office-pixel-attributed-connected-blouse-coverage', bodySourceTriangleCount: 26756, triangleIds: patch.triangleIds },
    ],
  });
  bodyCoverageMetrics = patch.metrics;
  candidate.visible = false;
  sourceBody.visible = true;
  raw.scene.traverse((node) => { if (node instanceof THREE.Mesh) { node.geometry.dispose(); for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose(); } });
}
function bind(id: string, callback: () => void): void {
  document.querySelector<HTMLButtonElement>(`#${id}`)!.addEventListener('click', () => {
    try { callback(); } catch (error) { status.textContent = error instanceof Error ? error.message : String(error); status.dataset.state = 'error'; record(); }
  });
}
bind('load-man', () => { void load('male', 'casual'); });
bind('load-woman', () => { void load('female', 'casual'); });
bind('load-woman-office', () => { void load('female', 'office'); });
bind('load-man-office', () => { void load('male', 'office'); });
bind('source-shoes', () => setVariant('source'));
bind('trimmed-shoes', () => setVariant('candidate'));
bind('pose-idle', () => setPose('idle'));
bind('pose-walk-a', () => setPose('walk', Math.PI * 0.5));
bind('pose-walk-b', () => setPose('walk', Math.PI * 1.5));
bind('pose-interact', () => setPose('interact'));
bind('view-front', () => setView('front'));
bind('view-quarter', () => setView('quarter'));
bind('view-side', () => setView('side'));
bind('view-back', () => setView('back'));
Object.assign(window, { clothingBodyShoeAB: {
  get readyState() { return actor ? 'ready' : disposed ? 'disposed' : status.dataset.state === 'error' ? 'failed' : 'loading'; },
  load, setVariant, setPose, setView, sample: () => state(),
} });
function resize(): void {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width)); const height = Math.max(1, Math.floor(rect.height));
  renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); render(); record();
}
window.addEventListener('resize', resize);
window.addEventListener('pagehide', () => {
  disposed = true; generation++;
  bodyCandidateLease?.dispose();
  bodyCandidate?.parent?.remove(bodyCandidate);
  bodyCandidateSourceGeometry?.dispose();
  for (const entry of ownedActors.splice(0)) {
    entry.trimLease?.dispose();
    entry.actor.dispose(); scene.remove(entry.actor.object);
    entry.kit.dispose();
  }
  renderer.dispose();
}, { once: true });
resize();
void load('male', 'casual');
