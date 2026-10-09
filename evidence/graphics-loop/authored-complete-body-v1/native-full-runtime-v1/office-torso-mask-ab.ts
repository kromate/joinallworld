import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createKit } from '../../../../src/scene/kit.ts';
import { prepareNativeSkinnedBody } from './native-prepared-factory.ts';
import { applyBodyMaskUnion, type BodyTriangleHideSet } from '../body-mask-union.ts';
import bodyAssetUrl from '../authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb?url';
import officeHideUrl from '../authored-clothing/office-export/out/office-female-body-hide-map.json?url';
import shoeHideUrl from '../authored-footwear/out/shoes01-body-hide-map.json?url';

const LOOK = Object.freeze({
  body: 'woman', hair: 'afro', outfit: 'office', fabric: 'plain', skin: 'skin3', hairColor: 'black',
  outfitColor: 'red', bottomsColor: 'cream', accessories: [], face: 'round', expression: 'smile',
  appearance: { height: 'average', build: 'average', ageAppearance: 'adult' },
});
const SEED = 'prepared-npc-v1';
const SOURCE_INDEX_SHA256 = '4c29f318e20b87a2c0ddce3689fa0ab285ee390fc02e5f3a017736df772a3661';
const TORSO_CANDIDATES: BodyTriangleHideSet = Object.freeze({
  asset: 'female-office-v29-active-direction-idle',
  bodySourceTriangleCount: 26756,
  triangleIds: Object.freeze([2308, 2309, 2325, 2353, 2362, 2363, 2366, 2367, 2368, 2369, 2433, 3120, 3121, 3124, 3136, 3137, 15562, 15578, 15594, 15604, 15605, 15608, 15609, 15610, 15611, 16363]),
});

function required<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing fixture element ${selector}`);
  return node;
}
function skinned(root: THREE.Object3D, name: string): THREE.SkinnedMesh {
  let found: THREE.SkinnedMesh | undefined;
  root.traverse((node) => { if (node.name === name && (node as THREE.SkinnedMesh).isSkinnedMesh) found = node as THREE.SkinnedMesh; });
  if (!found) throw new Error(`Prepared actor is missing SkinnedMesh ${name}`);
  return found;
}
function sha256(bytes: ArrayBuffer): Promise<string> {
  return crypto.subtle.digest('SHA-256', bytes).then((digest) => [...new Uint8Array(digest)].map((v) => v.toString(16).padStart(2, '0')).join(''));
}
async function jsonAt<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Fixture metadata request failed: ${url} (${response.status})`);
  return response.json() as Promise<T>;
}

const canvas = required<HTMLCanvasElement>('#stage');
const status = required<HTMLDivElement>('#status');
const statusJson = required<HTMLPreElement>('#status-json');
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
camera.position.set(0.78, 1.48, 5.35);
camera.lookAt(0.78, 0.94, 0);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

let actor: Awaited<ReturnType<typeof prepareNativeSkinnedBody>> | undefined;
let kit: ReturnType<typeof createKit> | undefined;
let body: THREE.SkinnedMesh | undefined;
let candidate: THREE.SkinnedMesh | undefined;
let candidateLease: Awaited<ReturnType<typeof applyBodyMaskUnion>> | undefined;
let candidateSourceGeometry: THREE.BufferGeometry | undefined;
let rawRoot: THREE.Object3D | undefined;
let disposed = false;
let variant: 'existing' | 'candidate' = 'existing';
let pose: 'idle' | 'walk' | 'interact' = 'idle';
let view: 'front' | 'profile' | 'back' = 'front';
let sampleNumber = 0;

function setStatus(message: string, state: 'loading' | 'ready' | 'error'): void {
  status.textContent = message;
  status.dataset.state = state;
}
function renderState() {
  if (!actor || !body || !candidate) return null;
  return {
    state: 'ready', sampleNumber: ++sampleNumber, variant, pose, view,
    look: LOOK, seed: SEED,
    factory: {
      family: actor.preparedMetrics.bodyKey,
      retargetMode: actor.preparedMetrics.retargetMode,
      actorPosition: actor.object.position.toArray(),
      actorQuaternion: actor.object.quaternion.toArray(),
      actorScale: actor.object.scale.toArray(),
      bodyMatrixWorld: body.matrixWorld.toArray(),
      candidateMatrixWorld: candidate.matrixWorld.toArray(),
      garmentMatrixWorld: skinned(actor.object, 'Authored office suit').matrixWorld.toArray(),
      pose: actor.pose,
      lastDirectionContactSolve: actor.lastDirectionContactSolve,
      bodyTriangles: body.geometry.getIndex()!.count / 3,
      candidateTriangles: candidate.geometry.getIndex()!.count / 3,
      torsoCandidateTriangles: TORSO_CANDIDATES.triangleIds.length,
      sourceBodyIndexSha256: SOURCE_INDEX_SHA256,
      existingMaskTriangles: actor.wardrobe.hiddenTriangles,
      candidateMaskMetrics: candidateLease?.metrics,
      activeBodyVisible: body.visible,
      candidateVisible: candidate.visible,
    },
    render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, frame: renderer.info.render.frame },
  };
}
function record() { statusJson.textContent = JSON.stringify(renderState(), null, 2); }
function setVariant(next: 'existing' | 'candidate') {
  if (!body || !candidate) throw new Error('Actors are not ready');
  variant = next;
  body.visible = next === 'existing';
  candidate.visible = next === 'candidate';
  renderNow();
  record();
}
function renderNow() {
  if (!disposed) renderer.render(scene, camera);
}
function setView(next: 'front' | 'profile' | 'back') {
  view = next;
  const target = new THREE.Vector3(0.78, 0.94, 0);
  camera.position.set(0.78, 1.48, 5.35);
  if (next === 'profile') camera.position.set(5.35, 1.48, 0);
  if (next === 'back') camera.position.set(0.78, 1.48, -5.35);
  camera.lookAt(target);
  renderNow();
  record();
}
function setPose(next: 'idle' | 'walk' | 'interact') {
  if (!actor) throw new Error('Actor is not ready');
  pose = next;
  actor.show(next, false);
  if (next === 'walk') actor.stride(Math.PI * 0.5, false, 0);
  const solve = actor.solveFeet(() => 0);
  if (solve.limited || solve.maxError > 0.004) throw new Error(`Pose ${next} shoe solve failed: ${JSON.stringify(solve)}`);
  actor.object.updateWorldMatrix(true, false);
  actor.object.updateMatrixWorld(true);
  renderNow();
  record();
}
function bindButton(id: string, action: () => void): void {
  required<HTMLButtonElement>(`#${id}`).addEventListener('click', () => {
    try { action(); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error), 'error'); record(); }
  });
}

async function prepare(): Promise<void> {
  try {
    setStatus('Preparing V29 direction-retarget actor…', 'loading');
    const officeHide = await jsonAt<{ asset: string; bodySourceTriangleCount: number; bodyHideSourceTriangleIds: number[] }>(officeHideUrl);
    const shoeHide = await jsonAt<{ asset: string; bodySourceTriangleCount: number; sourceBodyTriangleIds: number[] }>(shoeHideUrl);
    assertMap(officeHide, shoeHide);
    kit = createKit();
    actor = await prepareNativeSkinnedBody({ kit, seed: SEED, look: LOOK, sceneScale: 1, retargetMode: 'directions' });
    actor.object.name = 'V29 female office torso A-B actor';
    actor.place(0.78, 0, 0, 0);
    actor.show('idle', false);
    scene.add(actor.object);
    body = skinned(actor.object, 'Body');
    const garment = skinned(actor.object, 'Authored office suit');
    if (body.skeleton !== garment.skeleton || actor.preparedMetrics.bodyKey !== 'female' || actor.preparedMetrics.retargetMode !== 'directions') {
      throw new Error('Factory did not produce the pinned female direction-retarget office actor');
    }

    await MeshoptDecoder.ready;
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const response = await fetch(bodyAssetUrl);
    if (!response.ok) throw new Error(`Source GLB request failed (${response.status})`);
    const rawGltf = await loader.parseAsync(await response.arrayBuffer(), new URL('.', bodyAssetUrl).href);
    rawRoot = rawGltf.scene;
    const rawBody = skinned(rawRoot, 'Body');
    const rawIndex = rawBody.geometry.getIndex();
    if (!rawIndex || rawIndex.count / 3 !== TORSO_CANDIDATES.bodySourceTriangleCount) throw new Error('Pinned raw Body triangle topology does not match the candidate ID domain');
    const rawIndexBytes = new Uint8Array(rawIndex.array.buffer, rawIndex.array.byteOffset, rawIndex.array.byteLength);
    if (await sha256(rawIndexBytes.slice().buffer) !== SOURCE_INDEX_SHA256) throw new Error('Raw Body source index SHA does not match hide-map provenance');

    candidateSourceGeometry = new THREE.BufferGeometry();
    for (const [name, attribute] of Object.entries(body.geometry.attributes)) candidateSourceGeometry.setAttribute(name, attribute);
    candidateSourceGeometry.morphAttributes = { ...body.geometry.morphAttributes };
    candidateSourceGeometry.morphTargetsRelative = body.geometry.morphTargetsRelative;
    candidateSourceGeometry.setIndex(rawIndex.clone());
    candidateSourceGeometry.boundingBox = rawBody.geometry.boundingBox?.clone() ?? null;
    candidateSourceGeometry.boundingSphere = rawBody.geometry.boundingSphere?.clone() ?? null;

    candidate = new THREE.SkinnedMesh(candidateSourceGeometry, body.material);
    candidate.name = 'Diagnostic candidate body with 26 torso hide IDs';
    candidate.position.copy(body.position);
    candidate.quaternion.copy(body.quaternion);
    candidate.scale.copy(body.scale);
    candidate.matrix.copy(body.matrix);
    candidate.matrixAutoUpdate = body.matrixAutoUpdate;
    candidate.bindMode = body.bindMode;
    candidate.bind(body.skeleton, body.bindMatrix);
    candidate.bindMatrix.copy(body.bindMatrix);
    candidate.bindMatrixInverse.copy(body.bindMatrixInverse);
    candidate.morphTargetDictionary = body.morphTargetDictionary ? { ...body.morphTargetDictionary } : undefined;
    candidate.morphTargetInfluences = body.morphTargetInfluences ? [...body.morphTargetInfluences] : undefined;
    candidate.castShadow = body.castShadow;
    candidate.receiveShadow = body.receiveShadow;
    candidate.frustumCulled = body.frustumCulled;
    candidate.renderOrder = body.renderOrder;
    candidate.layers.mask = body.layers.mask;
    candidate.onBeforeRender = body.onBeforeRender;
    candidate.visible = false;
    body.parent!.add(candidate);
    candidate.updateWorldMatrix(true, false);
    candidate.updateMatrixWorld(true);
    candidateLease = await applyBodyMaskUnion(candidate, {
      expectedSourceIndexSha256: SOURCE_INDEX_SHA256,
      expectedSourceTriangleCount: TORSO_CANDIDATES.bodySourceTriangleCount,
      hideSets: [
        { asset: officeHide.asset, bodySourceTriangleCount: officeHide.bodySourceTriangleCount, triangleIds: officeHide.bodyHideSourceTriangleIds },
        { asset: shoeHide.asset, bodySourceTriangleCount: shoeHide.bodySourceTriangleCount, triangleIds: shoeHide.sourceBodyTriangleIds },
        TORSO_CANDIDATES,
      ],
    });
    const expectedHidden = new Set([...officeHide.bodyHideSourceTriangleIds, ...shoeHide.sourceBodyTriangleIds, ...TORSO_CANDIDATES.triangleIds]);
    if (candidateLease.metrics.hiddenTriangles !== expectedHidden.size) throw new Error('Candidate union count does not match deduplicated exact source IDs');
    setPose('idle');
    setVariant('existing');
    setView('front');
    setStatus('Ready · existing vs 26-triangle candidate mask', 'ready');
    record();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
    throw error;
  }
}
function assertMap(office: { bodySourceTriangleCount: number; bodyHideSourceTriangleIds: number[] }, shoes: { bodySourceTriangleCount: number; sourceBodyTriangleIds: number[] }): void {
  const n = TORSO_CANDIDATES.bodySourceTriangleCount;
  if (office.bodySourceTriangleCount !== n || shoes.bodySourceTriangleCount !== n) throw new Error('Existing hide maps do not reference the same source Body');
  if (new Set(TORSO_CANDIDATES.triangleIds).size !== TORSO_CANDIDATES.triangleIds.length) throw new Error('Candidate hide IDs contain duplicates');
  if (TORSO_CANDIDATES.triangleIds.some((id) => !Number.isInteger(id) || id < 0 || id >= n)) throw new Error('Candidate hide ID lies outside the exact source Body');
}

bindButton('body-source', () => setVariant('existing'));
bindButton('body-candidate', () => setVariant('candidate'));
bindButton('pose-idle', () => setPose('idle'));
bindButton('pose-walk', () => setPose('walk'));
bindButton('pose-interact', () => setPose('interact'));
bindButton('view-front', () => setView('front'));
bindButton('view-profile', () => setView('profile'));
bindButton('view-back', () => setView('back'));
bindButton('sample', record);

function resize() {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderNow();
}
new ResizeObserver(resize).observe(canvas);
resize();
window.addEventListener('beforeunload', () => {
  disposed = true;
  candidateLease?.dispose();
  if (candidate) candidate.parent?.remove(candidate);
  candidateSourceGeometry?.dispose();
  rawRoot?.traverse((node) => {
    if (!node.isMesh) return;
    node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
  });
  actor?.object.parent?.remove(actor.object);
  actor?.dispose();
  kit?.dispose();
  floor.geometry.dispose();
  (floor.material as THREE.Material).dispose();
  renderer.dispose();
});

const api = { readyState: 'loading', ready: prepare(), setVariant, setPose, setView, sample: renderState };
(window as Window & { officeTorsoMaskAB?: typeof api }).officeTorsoMaskAB = api;
api.ready.then(() => { api.readyState = 'ready'; }).catch(() => { api.readyState = 'failed'; });
