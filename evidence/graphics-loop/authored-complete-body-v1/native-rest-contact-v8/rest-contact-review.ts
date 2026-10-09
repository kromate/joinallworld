import * as THREE from 'three';
import { createKit } from '../../../../src/scene/kit.ts';
import type { Look } from '../../../../src/scene/avatar-look.ts';
import { prepareNativeSkinnedBody, NATIVE_PREPARED_POSE_COVERAGE, NATIVE_PREPARED_CONDITIONAL_CONTACT_COVERAGE } from './native-full-runtime-v8/native-prepared-factory.ts';
import type { NativeSeat } from './native-full-runtime-v8/native-full-runtime.ts';
import { createHomeChairFixture, createHomeRestPropFixture, HOME_SOURCE_TILE } from './home-rest-props.ts';
import type { NativeRestPose, NativeRestProp } from './native-rest-contact.ts';
import { createNativeRestContactProbe } from './native-rest-contact.ts';

type Family = 'man' | 'woman';
type Pose = 'idle' | 'walk' | 'jog' | 'sit' | 'interact' | 'dance' | 'lie' | 'soak' | 'wash' | 'bucket' | 'cook' | 'cookLow' | 'eat' | 'drink' | 'homeDoor';
type Prop = NativeRestProp;
type Actor = Awaited<ReturnType<typeof prepareNativeSkinnedBody>>;
type Fixture = ReturnType<typeof createHomeRestPropFixture>;

function required<T extends HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  if (!node) throw new Error(`Missing viewer element ${selector}`);
  return node;
}

const canvas = required<HTMLCanvasElement>('#stage');
const status = required<HTMLElement>('#status');
const metrics = required<HTMLElement>('#metrics');
const events = required<HTMLElement>('#events');
const familyInput = required<HTMLSelectElement>('#family');
const propInput = required<HTMLSelectElement>('#prop');
const poseInput = required<HTMLSelectElement>('#pose');

const scene = new THREE.Scene();
scene.background = new THREE.Color('#d7e2e6');
scene.fog = new THREE.Fog('#d7e2e6', 8, 18);
const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 80);
camera.position.set(0, 1.65, 5.9); camera.lookAt(0, 0.92, 0);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
scene.add(new THREE.HemisphereLight('#f5f4ea', '#837c71', 2));
const key = new THREE.DirectionalLight('#fff2dc', 3.2); key.position.set(-3.5, 6.5, 4); key.castShadow = true;
key.shadow.mapSize.set(1024, 1024); scene.add(key);
const fill = new THREE.DirectionalLight('#d5e6ff', 1.1); fill.position.set(4, 3.5, -3); scene.add(fill);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(16, 16), new THREE.MeshStandardMaterial({ color: '#dedbd3', roughness: 0.94 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.012; ground.receiveShadow = true; scene.add(ground);

const home = new THREE.Group(); home.name = 'source-home-item-frame';
home.position.set(0, 0, 0); scene.add(home);
const fixtures = new Map<Prop, Fixture>();
for (const [prop, pose] of [['bed', 'lie'], ['mat', 'lie'], ['tub', 'soak'], ['shower', 'wash']] as const) {
  const fixture = createHomeRestPropFixture(prop, pose);
  fixture.group.visible = false; home.add(fixture.group); fixtures.set(prop, fixture);
}
// Exact SHAPES.chair from the pinned 3af home-scene.ts; the seat top is y=.41.
const chair = createHomeChairFixture(); home.add(chair.group);

const poses: readonly Pose[] = ['idle', 'walk', 'jog', 'sit', 'interact', 'dance', 'lie', 'soak', 'wash', 'bucket', 'cook', 'cookLow', 'eat', 'drink', 'homeDoor'];
const restPoseForProp: Record<Prop, NativeRestPose> = { bed: 'lie', mat: 'lie', tub: 'soak', shower: 'wash' };
const restPropForPose: Partial<Record<Pose, Prop>> = { lie: 'bed', soak: 'tub', wash: 'shower' };
function lookFor(body: Family): Look {
  return { body, hair: body === 'woman' ? 'afro' : 'lowcut', outfit: body === 'woman' ? 'office' : 'casual', fabric: 'plain',
    skin: 'skin4', hairColor: 'darkbrown', outfitColor: body === 'woman' ? 'blue' : 'navy', bottomsColor: 'cream',
    accessories: [], face: 'oval', expression: 'neutral', appearance: { height: 'average', build: 'average', ageAppearance: 'adult' } };
}
function setStatus(message: string, error = false): void { status.textContent = message; status.dataset.state = error ? 'error' : 'ready'; }
function note(message: string): void { events.textContent = `${message}\n${events.textContent}`.slice(0, 1800); }
function queryMeshes(meshes: readonly THREE.Mesh[], x: number, z: number): number | null {
  const active = meshes.filter((mesh) => mesh.visible);
  for (const mesh of active) { mesh.updateWorldMatrix(true, false); mesh.updateMatrixWorld(true); }
  const ray = new THREE.Raycaster(new THREE.Vector3(x, 12, z), new THREE.Vector3(0, -1, 0), 0, 24);
  return ray.intersectObjects(active, false)[0]?.point.y ?? null;
}
function chairSupport(seat: NativeSeat, actorRoot: THREE.Group) {
  home.updateWorldMatrix(true, false);
  const target = new THREE.Vector3(seat.x, seat.top, seat.z).applyMatrix4(home.matrixWorld);
  const top = queryMeshes([chair.seat], target.x, target.z);
  const floor = queryMeshes([ground], target.x, target.z);
  if (top === null || floor === null) return { kind: 'diagnostic' as const, floorY: floor ?? NaN };
  actorRoot.updateWorldMatrix(true, false); actorRoot.updateMatrixWorld(true);
  const hip = actorRoot.getObjectByName('mixamorigHips')?.getWorldPosition(new THREE.Vector3());
  if (!hip) return { kind: 'diagnostic' as const, floorY: floor };
  return { kind: 'seat-anchor' as const, hipWorld: [target.x, hip.y, target.z] as const, seatTopY: top, floorY: floor };
}
function placement(prop: Prop): { x: number; y?: number; top?: number; z: number; ry: number } {
  const tile = HOME_SOURCE_TILE;
  switch (prop) {
    case 'bed': return { x: 0, top: 0.015 + 0.56 * tile, z: (0.64 - 2 * 0.38) * tile, ry: 0 };
    case 'mat': return { x: 0, top: 0.015 + 0.08 * tile, z: (0.64 - 2 * 0.36) * tile, ry: 0 };
    case 'tub': return { x: 2 * 0.2 * tile, top: 0.015 + 0.1 * tile, z: 0, ry: -Math.PI / 2 };
    case 'shower': return { x: -0.05 * tile, y: 0.03 + 0.08 * tile, z: -0.05 * tile, ry: 0 };
  }
}
let kit = createKit();
let actor: Actor | null = null;
let contactProbe: ReturnType<typeof createNativeRestContactProbe> | null = null;
let active: Fixture | null = null;
let family = familyInput.value as Family;
let currentPose: Pose = 'idle';
let yaw = 0;
let looping = false;
let loopStart = performance.now();
let transitioningOut = false;
let disposed = false;

function chooseProp(prop: Prop): Fixture {
  for (const fixture of fixtures.values()) fixture.group.visible = false;
  const fixture = fixtures.get(prop);
  if (!fixture) throw new Error(`Missing fixture ${prop}`);
  fixture.group.visible = true; active = fixture; propInput.value = prop;
  const at = placement(prop);
  if (prop === 'shower') actor?.workOn(at.x, at.y!, at.z, at.ry);
  else actor?.sitOn(at.x, at.top!, at.z, at.ry);
  return fixture;
}

async function rebuild(nextFamily: Family): Promise<void> {
  actor?.dispose(); actor = null; contactProbe = null; kit.dispose(); kit = createKit();
  family = nextFamily; familyInput.value = family;
  const prepared = await prepareNativeSkinnedBody({
    kit, seed: `rest-review-${family}`, look: lookFor(family), sceneScale: HOME_SOURCE_TILE * 0.72,
    seatSupport: chairSupport,
    restSupport: (pose) => active && restPoseForProp[active.prop] === pose
      ? { kind: 'prop-rest', surface: active.supportSurface }
      : null,
  });
  actor = prepared; home.add(actor.object); actor.place(0, 0, 0, 0); actor.show('idle', false);
  const body = actor.object.getObjectByName('Body') as THREE.SkinnedMesh | null;
  const clothingName = family === 'woman' ? 'Authored office suit' : 'Authored casual suit';
  const clothing = actor.object.getObjectByName(clothingName) as THREE.SkinnedMesh | null;
  const shoes = actor.object.getObjectByName('Authored footwear shoes01') as THREE.SkinnedMesh | null;
  if (!body?.isSkinnedMesh || !clothing?.isSkinnedMesh || !shoes?.isSkinnedMesh) throw new Error('Rest review actor is missing visible body/clothing/footwear meshes');
  contactProbe = createNativeRestContactProbe(actor.object, [body, clothing, shoes]);
  setStatus(`Ready · ${family} · source clip pack loaded`);
  renderMetrics();
}

function poseProp(pose: Pose): Fixture | null {
  const requested = restPropForPose[pose];
  if (!requested) { active = null; for (const fixture of fixtures.values()) fixture.group.visible = false; return null; }
  const selected = propInput.value as Prop;
  const prop = pose === 'lie' && (selected === 'mat' || selected === 'bed') ? selected : requested;
  return chooseProp(prop);
}

function showPose(pose: Pose, animate = true): void {
  if (!actor) throw new Error('Prepared GLB is not ready');
  poseProp(pose);
  if (pose === 'sit') actor.sitOn(0, 0.015 + 0.41 * HOME_SOURCE_TILE, -0.08 * HOME_SOURCE_TILE, 0);
  else if (['bucket', 'cook', 'cookLow', 'eat', 'drink', 'homeDoor'].includes(pose)) actor.workOn(0, 0, 0, 0);
  else if (!restPropForPose[pose]) actor.place(0, 0, 0, 0);
  actor.show(pose, animate); currentPose = pose; looping = false; transitioningOut = false;
  note(`${family} show(${pose}, animate=${animate}) · support=${active?.supportSurface.id ?? 'none'}`);
  renderMetrics();
}

function exitRest(): void {
  if (!actor) return;
  actor.show('idle', true); currentPose = 'idle'; looping = false; transitioningOut = true;
  note(`Exit ${active?.supportSurface.id ?? 'rest prop'} → idle; retain prop until transition settles`);
}

function setYaw(degrees: number): void {
  yaw = degrees * Math.PI / 180;
  camera.position.set(Math.sin(yaw) * 5.9, 1.65, Math.cos(yaw) * 5.9);
  camera.lookAt(0, 0.92, 0);
}

function snapshot(includeContact = true): unknown {
  if (!actor) return { ready: false };
  const contacts = actor.sampleFootContacts();
  const body = actor.object.getObjectByName('Body') as THREE.SkinnedMesh | null;
  const box = new THREE.Box3().setFromObject(actor.object);
  return { ready: true, family, pose: currentPose, easing: actor.easing, prop: active?.prop ?? null,
    viewerStatus: status.textContent, viewerStatusState: status.dataset.state ?? null,
    propId: active?.supportSurface.id ?? null, yawDegrees: yaw * 180 / Math.PI,
    unconditionalCoverage: [...NATIVE_PREPARED_POSE_COVERAGE], conditionalCoverage: NATIVE_PREPARED_CONDITIONAL_CONTACT_COVERAGE,
    bodyTriangles: body?.geometry.index ? body.geometry.index.count / 3 : null, wardrobe: actor.wardrobe,
    bounds: { min: box.min.toArray(), max: box.max.toArray() },
    contacts: contacts.map((contact) => ({ side: contact.side, x: contact.x, y: contact.y, z: contact.z,
      points: (contact.points ?? []).map((point) => ({ x: point.x, y: point.y, z: point.z })) })),
    restMeasurement: includeContact && active && contactProbe
      ? contactProbe.sample(active.supportSurface, contacts) : null,
    limitation: 'The host prop query raycasts selected source-mirrored meshes. Snapshot is not a whole-mesh penetration proof.' };
}

function renderMetrics(): void { metrics.textContent = JSON.stringify(snapshot(false), null, 2); }
function resize(): void {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  renderer.setSize(rect.width, rect.height, false); camera.aspect = rect.width / rect.height; camera.updateProjectionMatrix();
}
const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(canvas);
let previous = performance.now();
function frame(now: number): void {
  if (disposed) return;
  const dt = Math.min(0.05, (now - previous) / 1000); previous = now;
  try {
    if (actor?.easing) actor.step(dt);
    if (actor && looping && !actor.easing) actor.sampleUse(currentPose, (now - loopStart) / 1000);
    if (transitioningOut && actor && !actor.easing) { transitioningOut = false; active = null; for (const fixture of fixtures.values()) fixture.group.visible = false; }
    renderer.render(scene, camera);
    renderMetrics();
  } catch (error) {
    looping = false; transitioningOut = false;
    setStatus(error instanceof Error ? error.message : String(error), true);
    note(`ERROR ${error instanceof Error ? error.message : String(error)}`);
  }
  requestAnimationFrame(frame);
}

required<HTMLButtonElement>('#show').addEventListener('click', () => {
  try { showPose(poseInput.value as Pose, true); setStatus(`Requested ${poseInput.value}`); }
  catch (error) { setStatus(error instanceof Error ? error.message : String(error), true); note(`ERROR ${String(error)}`); }
});
required<HTMLButtonElement>('#loop').addEventListener('click', () => {
  if (!actor) return;
  try {
    if (restPropForPose[currentPose]) poseProp(currentPose);
    looping = !looping; loopStart = performance.now();
    note(`${looping ? 'Looping' : 'Stopped'} source sample for ${currentPose}`);
  } catch (error) { setStatus(error instanceof Error ? error.message : String(error), true); }
});
required<HTMLButtonElement>('#exit').addEventListener('click', () => { try { exitRest(); } catch (error) { setStatus(String(error), true); } });
required<HTMLButtonElement>('#snapshot').addEventListener('click', () => { renderMetrics(); note('Snapshot refreshed'); });
familyInput.addEventListener('change', () => { void rebuild(familyInput.value as Family).catch((error) => setStatus(String(error), true)); });
propInput.addEventListener('change', () => { const prop = propInput.value as Prop; try { chooseProp(prop); renderMetrics(); } catch (error) { setStatus(String(error), true); } });
poseInput.addEventListener('change', () => { currentPose = poseInput.value as Pose; });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-yaw]')) button.addEventListener('click', () => setYaw(Number(button.dataset.yaw)));

declare global { interface Window { restContactReview: { ready: Promise<void>; snapshot(): unknown; pose(pose: string, animate?: boolean): void; prop(prop: string): void; family(family: string): Promise<void>; yaw(degrees: number): void; loop(enabled: boolean): void; exit(): void } } }
const ready = rebuild(family).then(() => { resize(); requestAnimationFrame(frame); }).catch((error) => { setStatus(error instanceof Error ? error.message : String(error), true); throw error; });
window.restContactReview = {
  ready, snapshot: () => snapshot(true),
  pose(pose, animate = false) { if (!poses.includes(pose as Pose)) throw new Error(`Unknown pose ${pose}`); showPose(pose as Pose, animate); },
  prop(prop) { if (!fixtures.has(prop as Prop)) throw new Error(`Unknown prop ${prop}`); chooseProp(prop as Prop); renderMetrics(); },
  async family(next) { if (next !== 'man' && next !== 'woman') throw new Error(`Unknown family ${next}`); await rebuild(next); },
  yaw: setYaw,
  loop(enabled) { if (!actor) throw new Error('Actor is not ready'); if (restPropForPose[currentPose]) poseProp(currentPose); looping = enabled; loopStart = performance.now(); },
  exit: exitRest,
};
window.addEventListener('pagehide', () => {
  if (disposed) return;
  disposed = true; resizeObserver.disconnect(); actor?.dispose(); actor = null; kit.dispose();
  for (const fixture of fixtures.values()) fixture.dispose();
  chair.dispose(); ground.geometry.dispose(); (ground.material as THREE.Material).dispose(); renderer.dispose();
});
