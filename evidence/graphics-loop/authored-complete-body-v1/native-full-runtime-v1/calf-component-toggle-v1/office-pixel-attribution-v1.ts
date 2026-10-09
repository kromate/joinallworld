import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { createKit } from '../../../../../src/scene/kit.ts';
import type { BodyKey } from '../../../../../src/scene/body/manifest.ts';
import { prepareNativeSkinnedBody } from '../native-prepared-factory-v29.ts';
import bodyAssetUrl from '../../authored-body-compression/outcompressed/parametric-base-facial-meshopt.glb?url';

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
const SOURCE_BODY_INDEX_SHA256 = '4c29f318e20b87a2c0ddce3689fa0ab285ee390fc02e5f3a017736df772a3661';
const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: '#dedbd3', roughness: 0.94 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.012;
scene.add(floor);
const camera = new THREE.PerspectiveCamera(33, 1, 0.05, 80);
camera.position.set(0, 1.52, 5.15);
camera.lookAt(0, 0.94, 0);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

type Actor = Awaited<ReturnType<typeof prepareNativeSkinnedBody>>;
let actor: Actor | undefined;
let kit: ReturnType<typeof createKit> | undefined;
let family: BodyKey = 'female';
let outfit: 'casual' | 'office' = 'casual';
let currentLook: Record<string, unknown> | undefined;
let seed = '';
let pose: 'idle' | 'walk' = 'idle';
let phase = 0;
let yaw = 0;
let disposed = false;
let generation = 0;
let sourceProbe: THREE.SkinnedMesh | undefined;
let sourceProbeGeometry: THREE.BufferGeometry | undefined;
let rawBodyIndex: THREE.BufferAttribute | undefined;
let rawSourcePromise: Promise<void> | undefined;

function meshNamed(name: string): THREE.Mesh | undefined {
  let result: THREE.Mesh | undefined;
  actor?.object.traverse((node) => {
    if (node.name === name && node instanceof THREE.Mesh) result = node;
  });
  return result;
}
function garmentName(): string { return outfit === 'office' ? 'Authored office suit' : 'Authored casual suit'; }
function state() {
  if (!actor) return { state: 'loading', family, generation };
  const body = meshNamed('Body');
  const garment = meshNamed(garmentName());
  const shoes = meshNamed('Authored footwear shoes01');
  return {
    state: 'ready', family, outfit, look: currentLook, seed,
    pose, phase, yawDegrees: yaw * 180 / Math.PI, generation,
    components: {
      body: body ? { visible: body.visible, triangles: body.geometry.index ? body.geometry.index.count / 3 : 0 } : null,
      garment: garment ? { name: garment.name, visible: garment.visible, triangles: garment.geometry.index ? garment.geometry.index.count / 3 : 0 } : null,
      shoes: shoes ? { name: shoes.name, visible: shoes.visible, triangles: shoes.geometry.index ? shoes.geometry.index.count / 3 : 0 } : null,
    },
    factory: {
      family: actor.preparedMetrics.bodyKey,
      retargetMode: actor.preparedMetrics.retargetMode,
      clothingTriangles: actor.preparedMetrics.clothingTriangles,
      shoeTriangles: actor.preparedMetrics.shoeTriangles,
      bodyTriangles: actor.preparedMetrics.authoredBodyTriangles,
    },
    render: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, frame: renderer.info.render.frame },
  };
}
function record() { output.textContent = JSON.stringify(state(), null, 2); }
async function loadRawSourceIndex(): Promise<void> {
  if (!rawSourcePromise) rawSourcePromise = (async () => {
    await MeshoptDecoder.ready;
    const url = new URL(bodyAssetUrl, window.location.href);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Raw body GLB fetch failed (${response.status})`);
    const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(await response.arrayBuffer(), new URL('.', url).href);
    let found: THREE.SkinnedMesh | undefined;
    gltf.scene.traverse((node) => { if (node.name === 'Body' && (node as THREE.SkinnedMesh).isSkinnedMesh) found = node as THREE.SkinnedMesh; });
    rawBodyIndex = found?.geometry.getIndex() ?? undefined;
    if (!rawBodyIndex || rawBodyIndex.count / 3 !== 26756) throw new Error('Raw source Body index is missing or changed');
    const view = new Uint8Array(rawBodyIndex.array.buffer, rawBodyIndex.array.byteOffset, rawBodyIndex.array.byteLength);
    const bytes = new Uint8Array(view.byteLength); bytes.set(view);
    const digest = await crypto.subtle.digest('SHA-256', bytes.buffer);
    const hash = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
    if (hash !== SOURCE_BODY_INDEX_SHA256) throw new Error(`Raw Body index SHA mismatch: ${hash}`);
  })();
  await rawSourcePromise;
}
function clearSourceProbe(): void {
  sourceProbe?.parent?.remove(sourceProbe);
  sourceProbe = undefined;
  sourceProbeGeometry?.dispose();
  sourceProbeGeometry = undefined;
}
async function prepareSourceProbe(body: THREE.SkinnedMesh): Promise<void> {
  await loadRawSourceIndex();
  const geometry = new THREE.BufferGeometry();
  for (const [name, attribute] of Object.entries(body.geometry.attributes)) geometry.setAttribute(name, attribute);
  geometry.morphAttributes = { ...body.geometry.morphAttributes };
  geometry.morphTargetsRelative = body.geometry.morphTargetsRelative;
  geometry.setIndex(rawBodyIndex!.clone());
  geometry.boundingBox = body.geometry.boundingBox?.clone() ?? null;
  geometry.boundingSphere = body.geometry.boundingSphere?.clone() ?? null;
  const materials = Array.isArray(body.material)
    ? body.material.map(() => new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false, depthWrite: false, depthTest: false }))
    : new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, colorWrite: false, depthWrite: false, depthTest: false });
  const probe = new THREE.SkinnedMesh(geometry, materials);
  probe.name = 'Hidden raw source-index ray probe';
  probe.position.copy(body.position); probe.quaternion.copy(body.quaternion); probe.scale.copy(body.scale);
  probe.matrix.copy(body.matrix); probe.matrixAutoUpdate = body.matrixAutoUpdate;
  probe.bindMode = body.bindMode;
  probe.bind(body.skeleton, body.bindMatrix); probe.bindMatrix.copy(body.bindMatrix); probe.bindMatrixInverse.copy(body.bindMatrixInverse);
  probe.morphTargetDictionary = body.morphTargetDictionary ? { ...body.morphTargetDictionary } : undefined;
  probe.morphTargetInfluences = body.morphTargetInfluences ? [...body.morphTargetInfluences] : undefined;
  probe.visible = false;
  if (!body.parent) throw new Error('Body has no parent for the raw-index ray probe');
  body.parent.add(probe);
  sourceProbe = probe;
  sourceProbeGeometry = geometry;
}
function inspectPagePixel(pageX: number, pageY: number) {
  if (!actor || !sourceProbe || !rawBodyIndex) throw new Error('Live source-index probe is not ready');
  const rect = canvas.getBoundingClientRect();
  const x = pageX - rect.left;
  const y = pageY - rect.top;
  if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) throw new Error('Pixel is outside the canvas');
  actor.object.updateWorldMatrix(true, false);
  actor.object.updateMatrixWorld(true);
  sourceProbe.skeleton.update();
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(x / rect.width * 2 - 1, 1 - y / rect.height * 2), camera);
  const sourceBodyHit = raycaster.intersectObject(sourceProbe, false)[0];
  const body = meshNamed('Body') as THREE.SkinnedMesh | undefined;
  const visibleBodyHit = body ? raycaster.intersectObject(body, false)[0] : undefined;
  const garment = meshNamed(garmentName()) as THREE.SkinnedMesh | undefined;
  const garmentHit = garment ? raycaster.intersectObject(garment, false)[0] : undefined;
  const sourceFace = sourceBodyHit?.faceIndex;
  const triangleVertices = sourceFace === undefined ? null : [rawBodyIndex.getX(sourceFace * 3), rawBodyIndex.getX(sourceFace * 3 + 1), rawBodyIndex.getX(sourceFace * 3 + 2)];
  const depth = sourceBodyHit && garmentHit ? garmentHit.distance - sourceBodyHit.distance : null;
  return {
    state: 'pixel-attribution', requestedPagePixel: [pageX, pageY], canvasRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    canvasPixel: [x, y], ndc: [x / rect.width * 2 - 1, 1 - y / rect.height * 2], pose, phase, yaw, family, outfit, seed,
    rawBodyFaceIndex: sourceFace ?? null, rawBodyTriangleVertices: triangleVertices,
    bodyHit: sourceBodyHit ? { distance: sourceBodyHit.distance, world: sourceBodyHit.point.toArray(), uv: sourceBodyHit.uv?.toArray() ?? null } : null,
    visibleBodyHit: visibleBodyHit ? { currentGeometryFaceIndex: visibleBodyHit.faceIndex ?? null, distance: visibleBodyHit.distance, world: visibleBodyHit.point.toArray() } : null,
    garmentHit: garmentHit ? { faceIndex: garmentHit.faceIndex ?? null, distance: garmentHit.distance, world: garmentHit.point.toArray(), uv: garmentHit.uv?.toArray() ?? null } : null,
    garmentBehindBodyMetres: depth,
    evidence: depth !== null && depth > 0 && depth < 0.04 ? 'body face lies in front of blouse surface within 4cm along this pixel ray; inspect whether hiding this exact face changes the patch' : 'this ray does not prove a blouse surface within 4cm behind body; do not mask from this sample',
  };
}
function applyVisibility() {
  const showBody = document.querySelector<HTMLInputElement>('#show-body')!.checked;
  const showClothes = document.querySelector<HTMLInputElement>('#show-clothes')!.checked;
  const showShoes = document.querySelector<HTMLInputElement>('#show-shoes')!.checked;
  const body = meshNamed('Body');
  const garment = meshNamed(garmentName());
  const shoes = meshNamed('Authored footwear shoes01');
  if (body) body.visible = showBody;
  if (garment) garment.visible = showClothes;
  if (shoes) shoes.visible = showShoes;
  render();
  record();
}
function render() {
  if (disposed) return;
  renderer.render(scene, camera);
}
async function load(next: BodyKey, nextOutfit: 'casual' | 'office' = 'casual'): Promise<void> {
  const request = ++generation;
  clearSourceProbe();
  actor?.dispose();
  if (actor) scene.remove(actor.object);
  actor = undefined;
  kit?.dispose();
  kit = createKit();
  family = next;
  outfit = nextOutfit;
  pose = 'idle';
  phase = 0;
  status.textContent = `Loading ${next} casual actor…`;
  status.dataset.state = 'loading';
  record();
  const look = next === 'male' ? {
    body: 'man', hair: 'lowcut', outfit: nextOutfit, fabric: 'plain', skin: 'skin3', hairColor: 'darkbrown',
    outfitColor: 'navy', bottomsColor: 'cream', accessories: [], face: 'oval', expression: 'neutral',
    appearance: { height: 'average', build: 'average', ageAppearance: 'adult' },
  } : {
    body: 'woman', hair: 'afro', outfit: nextOutfit, fabric: 'plain', skin: 'skin3', hairColor: 'darkbrown',
    outfitColor: 'red', bottomsColor: 'cream', accessories: [], face: 'oval', expression: 'neutral',
    appearance: { height: 'average', build: 'average', ageAppearance: 'adult' },
  };
  currentLook = look;
  seed = `component-isolation-${next}-${nextOutfit}`;
  const owner = kit;
  let prepared: Actor;
  try {
    prepared = await prepareNativeSkinnedBody({ kit: owner, seed, look, sceneScale: 1, retargetMode: 'directions' });
  } catch (error) {
    if (request === generation && !disposed) {
      status.textContent = error instanceof Error ? error.message : String(error);
      status.dataset.state = 'error';
      record();
    }
    throw error;
  }
  if (request !== generation || disposed || owner !== kit) {
    prepared.dispose();
    return;
  }
  actor = prepared;
  actor.object.name = `V29 ${next} casual component isolation actor`;
  scene.add(actor.object);
  actor.place(0, 0, 0, yaw);
  actor.show('idle', false);
  if (next === 'female' && nextOutfit === 'office') await prepareSourceProbe(meshNamed('Body') as THREE.SkinnedMesh);
  const solve = actor.solveFeet(() => 0);
  if (solve.limited || solve.maxError > 0.004) throw new Error(`Initial shoe support failed: ${JSON.stringify(solve)}`);
  applyVisibility();
  status.textContent = 'Ready · isolate Body / casual garment / shoes';
  status.dataset.state = 'ready';
  record();
}
function setPose(next: 'idle' | 'walk', walkPhase = Math.PI * 0.5): void {
  if (!actor) return;
  pose = next;
  phase = next === 'walk' ? walkPhase : 0;
  actor.show(next, false);
  if (next === 'walk') actor.stride(phase, false, 0);
  const solve = actor.solveFeet(() => 0);
  if (solve.limited || solve.maxError > 0.004) throw new Error(`Pose support failed: ${JSON.stringify(solve)}`);
  actor.place(0, 0, 0, yaw);
  applyVisibility();
}
function setView(next: 'front' | 'side' | 'back'): void {
  yaw = next === 'side' ? -Math.PI / 2 : next === 'back' ? Math.PI : 0;
  if (actor) actor.place(0, 0, 0, yaw);
  const target = new THREE.Vector3(0, 0.94, 0);
  camera.position.set(0, 1.52, 5.15);
  if (next === 'side') camera.position.set(5.15, 1.52, 0);
  if (next === 'back') camera.position.set(0, 1.52, -5.15);
  camera.lookAt(target);
  render();
  record();
}
function bind(id: string, callback: () => void): void {
  document.querySelector<HTMLButtonElement>(`#${id}`)!.addEventListener('click', () => {
    try { callback(); }
    catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      status.dataset.state = 'error';
      record();
    }
  });
}
bind('load-man', () => { void load('male', 'casual'); });
bind('load-woman', () => { void load('female', 'casual'); });
bind('load-woman-office', () => { void load('female', 'office'); });
bind('pose-idle', () => setPose('idle'));
bind('pose-walk-a', () => setPose('walk', Math.PI * 0.5));
bind('pose-walk-b', () => setPose('walk', Math.PI * 1.5));
bind('view-front', () => setView('front'));
bind('view-side', () => setView('side'));
bind('view-back', () => setView('back'));
for (const id of ['show-body', 'show-clothes', 'show-shoes']) {
  document.querySelector<HTMLInputElement>(`#${id}`)!.addEventListener('change', applyVisibility);
}
function setComponents(components: { body: boolean; clothes: boolean; shoes: boolean }): void {
  document.querySelector<HTMLInputElement>('#show-body')!.checked = components.body;
  document.querySelector<HTMLInputElement>('#show-clothes')!.checked = components.clothes;
  document.querySelector<HTMLInputElement>('#show-shoes')!.checked = components.shoes;
  applyVisibility();
}
bind('body-only', () => setComponents({ body: true, clothes: false, shoes: false }));
bind('clothes-only', () => setComponents({ body: false, clothes: true, shoes: false }));
bind('shoes-only', () => setComponents({ body: false, clothes: false, shoes: true }));
bind('show-all', () => setComponents({ body: true, clothes: true, shoes: true }));
bind('pixel-probe', () => {
  const result = inspectPagePixel(543, 165);
  output.textContent = JSON.stringify(result, null, 2);
});
Object.assign(window, { calfComponentToggle: {
  get readyState() { return actor ? 'ready' : disposed ? 'disposed' : status.dataset.state === 'error' ? 'failed' : 'loading'; },
  load: (next: BodyKey, nextOutfit: 'casual' | 'office' = 'casual') => load(next, nextOutfit),
  setComponents, setPose, setView, sample: () => state(), inspectPagePixel,
} });
Object.assign(window, { officePixelAttribution: { get readyState() { return status.dataset.state === 'error' ? 'failed' : actor && outfit === 'office' && sourceProbe && status.dataset.state === 'ready' ? 'ready' : 'loading'; }, inspectPagePixel } });

function resize(): void {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(rect.width));
  const height = Math.max(1, Math.floor(rect.height));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  render();
  record();
}
window.addEventListener('resize', resize);
window.addEventListener('pagehide', () => {
  disposed = true;
  generation++;
  clearSourceProbe();
  actor?.dispose();
  if (actor) scene.remove(actor.object);
  kit?.dispose();
  renderer.dispose();
}, { once: true });
resize();
void load('female', 'office');
