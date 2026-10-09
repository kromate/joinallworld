import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { attestActorSampleIdentity, attestPositionProgram, sampleActorGeometry, type ActorGeometrySampleInput, type ActorSampleHostContext, type ActorSoleInput } from './sample-actor-geometry.ts';
import { createWardrobeRenderer } from '../../../src/scene/wardrobe/renderer.ts';
import { cloneSkinnedBodyScene } from '../../../src/scene/body/shared-resource-cache.ts';
import { createAvatarAppearanceController } from '../../../src/scene/body/appearance.ts';
import { createFootContactController } from '../../../src/scene/body/foot-contact.ts';
import { normalizeLook } from '../../../src/scene/avatar-look.ts';
import { resolveAvatarWearablesForRenderer } from '../../../src/game/wardrobe/rules.ts';
import type { SkinnedMesh, AnimationClip } from 'three';

const BODY_SOURCE = '4fa64261e15a7e104f527ad4782aff2bb80c53d559dc7a448d95d797d92c6bdb';
const WARDROBE_SOURCE = '4b053592fdc8efdad0e9cd5071cb853594c2db53829cd74116bf578f439f82da';
const THREE_LOCK = 'd3a82d0f0d7e750bee84042a2ab36dcaa655cf6e7c9bdb8047823e507112efa9';

globalThis.self ??= globalThis as unknown as typeof self;
globalThis.createImageBitmap ??= (async () => ({ width: 1024, height: 1024, close() {} })) as typeof createImageBitmap;
await MeshoptDecoder.ready;

function attestedMaterials(root: THREE.Object3D) {
  const records = [];
  root.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const key = material.customProgramCacheKey();
      const path = key === 'allworld-wardrobe-fabric-v2' ? 'production-wardrobe-fabric'
        : key === 'allworld-body-sleep-socket-eyes-2' ? 'production-body-skinning' : 'three-default-skinning';
      const source = path === 'production-wardrobe-fabric' ? WARDROBE_SOURCE : path === 'production-body-skinning' ? BODY_SOURCE : THREE_LOCK;
      const attestation = attestPositionProgram(material, path, source);
      if (attestation) records.push(attestation);
    }
  });
  return records;
}
function context(root: THREE.Object3D, appearanceKey = 'test-look'): ActorSampleHostContext {
  return { rendererPath: 'skinned', appearanceKey, phase: { hostPhase: 'walk-loop', pose: 'walk', easing: false,
    sampleTimeSeconds: 0.37, gaitPhaseRadians: null, transitionClip: null, transitionProgress: null } };
}
function input(root: THREE.Object3D, soles: ActorGeometrySampleInput['soles'] = null, appearanceKey?: string): ActorGeometrySampleInput {
  return { root, identity: attestActorSampleIdentity(root, context(root, appearanceKey)), soles, positionPrograms: attestedMaterials(root) };
}
function triangleGeometry(vertices: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex([0, 1, 2, 3, 4, 5]);
  geometry.addGroup(0, 3, 0); geometry.addGroup(3, 3, 1);
  return geometry;
}
function activeWorldBounds(mesh: THREE.SkinnedMesh): readonly [number, number, number, number, number, number] {
  const { index, drawRange } = mesh.geometry;
  const position = mesh.geometry.getAttribute('position');
  assert.ok(index && position, 'production geometry bounds require indexed positions');
  const start = drawRange.start, count = drawRange.count === Infinity ? index.count - start : Math.min(drawRange.count, index.count - start);
  assert.ok(Number.isInteger(start) && start >= 0 && start % 3 === 0 && Number.isInteger(count) && count >= 0 && count % 3 === 0, 'active drawRange is triangle-aligned');
  const vertices = new Set<number>();
  for (let offset = start; offset < start + count; offset += 3) for (let corner = 0; corner < 3; corner++) {
    const vertex = index.getX(offset + corner);
    assert.ok(Number.isInteger(vertex) && vertex >= 0 && vertex < position.count, `active triangle references an in-range vertex: index[${offset + corner}]=${vertex}/${position.count}`);
    vertices.add(vertex);
  }
  assert.ok(vertices.size > 0, 'active drawRange contains vertices');
  const low = new THREE.Vector3(Infinity, Infinity, Infinity), high = new THREE.Vector3(-Infinity, -Infinity, -Infinity), point = new THREE.Vector3();
  for (const id of vertices) { mesh.getVertexPosition(id, point); point.applyMatrix4(mesh.matrixWorld); low.min(point); high.max(point); }
  return [low.x, low.y, low.z, high.x, high.y, high.z];
}
function assertVectorNear(actual: readonly number[], expected: THREE.Vector3, label: string): void {
  assert.equal(actual.length, 3, `${label} has a 3D point`);
  assert.ok(new THREE.Vector3(actual[0], actual[1], actual[2]).distanceTo(expected) <= 1e-5, `${label} matches independent parent-to-world transform`);
}

test('samples only active material groups and drawRange; immutable host identity is a snapshot', () => {
  const root = new THREE.Group(); root.position.set(10, 0, 0);
  const geometry = triangleGeometry([-1, 0, 0, 1, 0, 0, 0, 1, 0, 100, 0, 0, 101, 0, 0, 100, 1, 0]);
  const visible = new THREE.MeshBasicMaterial(), hidden = new THREE.MeshBasicMaterial({ visible: false });
  const mesh = new THREE.Mesh(geometry, [visible, hidden]); mesh.name = 'body'; root.add(mesh);
  const hostContext = context(root); const identity = attestActorSampleIdentity(root, hostContext);
  (hostContext.phase as { hostPhase: string }).hostPhase = 'mutated-after-attestation';
  const result = sampleActorGeometry({ root, identity, soles: null, positionPrograms: attestedMaterials(root) });
  assert.equal(result.state, 'ready');
  if (result.state !== 'ready') return;
  assert.deepEqual(result.bounds, [9, 0, 0, 11, 1, 0]);
  assert.equal(result.activeGeometryTriangles, 1);
  assert.equal(result.sampledVertexCount, 3);
  assert.equal(result.identity.phase.hostPhase, 'walk-loop');
  assert.ok(Object.isFrozen(result.identity) && Object.isFrozen(result.identity.phase) && Object.isFrozen(result.identity.rootMatrixWorld));
  assert.equal(result.soles.state, 'unknown');
  hidden.visible = true;
  const both = sampleActorGeometry(input(root));
  assert.equal(both.state, 'ready');
  if (both.state === 'ready') assert.equal(both.activeGeometryTriangles, 2);
  visible.dispose(); hidden.dispose(); geometry.dispose();
});

test('rejects structural identity forgery and custom shader paths without a pinned material attestation', () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(triangleGeometry([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1]), new THREE.MeshBasicMaterial());
  root.add(mesh);
  const structural = { ...context(root), rootMatrixWorld: root.matrixWorld.toArray(), attestor: 'allworld-host-sample-v3' } as never;
  const forged = sampleActorGeometry({ root, identity: structural, soles: null, positionPrograms: [] });
  assert.equal(forged.state, 'unknown');
  if (forged.state === 'unknown') assert.equal(forged.reason, 'identity-not-host-attested');
  const material = mesh.material as THREE.Material;
  material.onBeforeCompile = shader => { shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n transformed.x += 1.0;'); };
  const noAttestation = attestPositionProgram(material, 'three-default-skinning', THREE_LOCK);
  assert.equal(noAttestation, null);
  const result = sampleActorGeometry(input(root));
  assert.equal(result.state, 'unknown');
  if (result.state === 'unknown') assert.match(result.reason, /unattested-vertex-position-program/);
  const exactPathMaterial = new THREE.MeshStandardMaterial();
  exactPathMaterial.onBeforeCompile = () => {};
  exactPathMaterial.customProgramCacheKey = () => 'allworld-body-sleep-socket-eyes-2';
  const exactPath = attestPositionProgram(exactPathMaterial, 'production-body-skinning', BODY_SOURCE);
  assert.ok(exactPath);
  exactPathMaterial.onBeforeCompile = () => {};
  const changedRoot = new THREE.Group();
  const changedMesh = new THREE.Mesh(triangleGeometry([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1]), exactPathMaterial); changedRoot.add(changedMesh);
  const callbackChanged = sampleActorGeometry({ root: changedRoot, identity: attestActorSampleIdentity(changedRoot, context(changedRoot)), soles: null,
    positionPrograms: exactPath ? [exactPath] : [] });
  assert.equal(callbackChanged.state, 'unknown');
  if (callbackChanged.state === 'unknown') assert.equal(callbackChanged.reason, 'invalid-position-program-attestation');
  changedMesh.geometry.dispose();
  exactPathMaterial.dispose();
  mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
});

test('one-sided and empty production sole samples are unknown, never treated as sampler absence', () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(triangleGeometry([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1]), new THREE.MeshBasicMaterial()); root.add(mesh);
  const oneSide = sampleActorGeometry(input(root, { frameNode: root, contacts: [{ side: 'left', x: 0, y: 0, z: 0 }] }));
  assert.equal(oneSide.state, 'ready');
  if (oneSide.state === 'ready') assert.deepEqual(oneSide.soles, { state: 'unknown', reason: 'incomplete-foot-contact-pair' });
  const empty = sampleActorGeometry(input(root, { frameNode: root, contacts: [] }));
  assert.equal(empty.state, 'ready');
  if (empty.state === 'ready') assert.deepEqual(empty.soles, { state: 'unknown', reason: 'incomplete-foot-contact-pair' });
  mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose();
});

async function parseBody(key: 'male' | 'female'): Promise<{ scene: THREE.Group; mesh: SkinnedMesh }> {
  const bytes = readFileSync(new URL(`../../../src/scene/body/assets/base-body-${key}.glb`, import.meta.url));
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', resolve, reject));
  let mesh: SkinnedMesh | null = null;
  gltf.scene.traverse(node => { if ((node as SkinnedMesh).isSkinnedMesh && !mesh) mesh = node as SkinnedMesh; });
  assert.ok(mesh);
  return { scene: gltf.scene, mesh };
}
async function parseWalk(): Promise<AnimationClip> {
  const bytes = readFileSync(new URL('../../../src/scene/body/assets/clip-pack.glb', import.meta.url));
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await new Promise<{ animations: AnimationClip[] }>((resolve, reject) => loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', resolve, reject));
  const clip = gltf.animations.find(candidate => candidate.name === 'walk');
  assert.ok(clip, 'the shipped clip pack must contain the actual walk clip');
  return clip;
}

for (const key of ['male', 'female'] as const) {
  test(`${key} production geometry adapters include sibling wardrobe, parent-frame foot contacts, appearance, walk and mask restore`, async () => {
    const [template, walk] = await Promise.all([parseBody(key), parseWalk()]);
    const actor = new THREE.Group(); actor.position.set(3, 1, -2); actor.rotation.y = 0.31; actor.scale.set(1.15, 0.92, 1.08);
    const world = new THREE.Group(); world.position.set(8, 0.4, -5); world.scale.set(1.1, 1.05, 0.9); world.add(actor);
    const bodyObject = new THREE.Group(); actor.add(bodyObject);
    const clone = cloneSkinnedBodyScene(template.scene); bodyObject.add(clone.scene);
    const mesh = clone.mesh;
    const fullIndexCount = mesh.geometry.index!.count;
    const fullDrawCount = mesh.geometry.drawRange.count;
    const sourcePosition = Array.from(mesh.geometry.getAttribute('position').array as ArrayLike<number>);
    const wardrobe = createWardrobeRenderer(mesh);
    const look = normalizeLook({ body: key === 'male' ? 'man' : 'woman', outfit: 'office', accessories: [], wearables: [], appearance: { ageAppearance: 'mature' } }, 'sampler-v3-production-adapter');
    const ids = resolveAvatarWearablesForRenderer(look);
    assert.equal(wardrobe.wear({ look, ids }), true);
    const maskedBaseTriangles = mesh.geometry.drawRange.count / 3;
    const overlayTriangles = wardrobe.object.geometry.index!.count / 3;
    assert.ok(wardrobe.metrics.hiddenTriangles > 0, 'actual wardrobe renderer should mask fully covered base faces');
    assert.ok(wardrobe.object.visible && wardrobe.object.parent === mesh.parent, 'wardrobe is a rendered sibling of the source body mesh');
    const appearance = createAvatarAppearanceController(mesh);
    assert.equal(appearance.ok, true);
    if (!appearance.ok) return;
    const appearanceResult = appearance.controller.apply({ ageAppearance: 'mature' }, look.face, 'grin');
    assert.equal(appearanceResult.ok, true);
    assert.notDeepEqual(Array.from(mesh.geometry.getAttribute('position').array as ArrayLike<number>), sourcePosition, 'production appearance controller changes the face geometry');
    const foot = createFootContactController(bodyObject, mesh, wardrobe.object);
    const mixer = new THREE.AnimationMixer(clone.scene); mixer.clipAction(walk).play(); mixer.setTime(0.37);
    world.updateMatrixWorld(true);
    const contacts = foot.sample();
    assert.deepEqual(contacts.map(contact => contact.side).sort(), ['left', 'right']);
    const soles: ActorSoleInput = { frameNode: bodyObject.parent!, contacts };
    const appearanceKey = JSON.stringify({ body: look.body, outfit: look.outfit, accessories: look.accessories, wearables: ids, appearance: appearance.controller.appearance, seed: 'sampler-v3-production-adapter' });
    const result = sampleActorGeometry({ root: actor, identity: attestActorSampleIdentity(actor, { rendererPath: 'skinned', appearanceKey,
      phase: { hostPhase: 'walk-loop', pose: 'walk', easing: false, sampleTimeSeconds: 0.37, gaitPhaseRadians: null, transitionClip: null, transitionProgress: null } }),
      soles, positionPrograms: attestedMaterials(actor) });
    assert.equal(result.state, 'ready');
    if (result.state === 'ready') {
      assert.equal(result.sampledMeshes.find(item => item.name === mesh.name)?.triangles, maskedBaseTriangles, 'base count respects the production mask drawRange');
      assert.equal(result.sampledMeshes.find(item => item.name === 'avatar-wardrobe')?.triangles, overlayTriangles, 'body-subtree scan includes the production wardrobe sibling');
      assert.equal(result.activeGeometryTriangles, result.sampledMeshes.reduce((sum, item) => sum + item.triangles, 0));
      assert.equal(result.soles.state, 'ready');
      if (result.soles.state === 'ready') {
        assert.equal(result.soles.points.length, 2);
        const independentlyTransformed = new Map(contacts.map(contact => [contact.side, (contact.points ?? [contact]).map(point => new THREE.Vector3(point.x, point.y, point.z).applyMatrix4(actor.matrixWorld))]));
        for (const side of ['left', 'right'] as const) {
          const actual = result.soles.points.find(entry => entry.side === side);
          const expected = independentlyTransformed.get(side);
          assert.ok(actual && expected && actual.points.length === expected.length, `${side} sole point count matches source contact samples`);
          actual!.points.forEach((point, index) => assertVectorNear(point, expected![index]!, `${side} sole point ${index}`));
        }
      }
      assert.ok(result.bounds[0] > 5 && result.bounds[1] > 0, 'bounds are expressed in scene world after actor and parent placement/scaling');
      const overlayBounds = activeWorldBounds(wardrobe.object), visibleBodyBounds = activeWorldBounds(mesh);
      const extendsVisibleBody = overlayBounds[0] < visibleBodyBounds[0] - 1e-5 || overlayBounds[1] < visibleBodyBounds[1] - 1e-5 || overlayBounds[2] < visibleBodyBounds[2] - 1e-5
        || overlayBounds[3] > visibleBodyBounds[3] + 1e-5 || overlayBounds[4] > visibleBodyBounds[4] + 1e-5 || overlayBounds[5] > visibleBodyBounds[5] + 1e-5;
      assert.ok(extendsVisibleBody, 'actual office wardrobe includes skinned vertices outside the masked visible-body bounds');
    }
    assert.equal(wardrobe.wear(null), true);
    world.updateMatrixWorld(true);
    const restored = sampleActorGeometry(input(actor, { frameNode: bodyObject.parent!, contacts: foot.sample() }, appearanceKey));
    assert.equal(restored.state, 'ready');
    if (restored.state === 'ready') {
      assert.equal(mesh.geometry.drawRange.count, fullDrawCount, 'wear(null) restores the source body draw range');
      assert.equal(restored.sampledMeshes.some(item => item.name === 'avatar-wardrobe'), false);
    }
    assert.equal(mesh.geometry.index!.count, fullIndexCount, 'wardrobe mask changes only drawRange/index contents, not source index allocation');
    mixer.stopAllAction(); mixer.uncacheRoot(clone.scene); wardrobe.dispose(); appearance.controller.dispose();
    clone.scene.traverse(node => { const child = node as THREE.Mesh; if (child.geometry?.isBufferGeometry) child.geometry.dispose(); });
    mesh.skeleton.dispose();
    template.scene.traverse(node => { const child = node as THREE.Mesh; if (child.geometry?.isBufferGeometry) child.geometry.dispose(); });
  });
}
