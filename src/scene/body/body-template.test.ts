import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { AnimationMixer } from 'three';
import type { AnimationClip, BufferAttribute, Group, SkinnedMesh } from 'three';
import { createAvatarAppearanceController } from './appearance.ts';
import { cloneSkinnedBodyScene } from './shared-resource-cache.ts';

await MeshoptDecoder.ready;
globalThis.self ??= globalThis as unknown as typeof self;
globalThis.createImageBitmap ??= (async () => ({ width: 1024, height: 1024, close() {} })) as typeof createImageBitmap;

async function template(key: 'male' | 'female'): Promise<{ scene: Group; mesh: SkinnedMesh }> {
  const bytes = readFileSync(new URL(`./assets/base-body-${key}.glb`, import.meta.url));
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await new Promise<{ scene: Group }>((resolve, reject) => loader.parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', resolve, reject,
  ));
  let mesh: SkinnedMesh | null = null;
  gltf.scene.traverse((node) => { if ((node as SkinnedMesh).isSkinnedMesh && !mesh) mesh = node as SkinnedMesh; });
  assert.ok(mesh);
  return { scene: gltf.scene, mesh };
}
let clipsOnce: Promise<AnimationClip[]> | null = null;
function clips(): Promise<AnimationClip[]> {
  clipsOnce ??= (async () => {
    const bytes = readFileSync(new URL('./assets/clip-pack.glb', import.meta.url));
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await new Promise<{ animations: AnimationClip[] }>((resolve, reject) => loader.parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', resolve, reject,
    ));
    return gltf.animations;
  })();
  return clipsOnce;
}

for (const key of ['male', 'female'] as const) {
  test(`${key} actor clones share the template only read-only and isolate geometry, skeleton, appearance`, async () => {
    const [source, animationClips] = await Promise.all([template(key), clips()]);
    const sourcePosition = source.mesh.geometry.getAttribute('position') as BufferAttribute;
    const sourceValues = Array.from(sourcePosition.array as ArrayLike<number>);
    const first = cloneSkinnedBodyScene(source.scene), second = cloneSkinnedBodyScene(source.scene);
    assert.notStrictEqual(first.mesh.geometry, second.mesh.geometry);
    assert.notStrictEqual(first.mesh.skeleton, second.mesh.skeleton);
    assert.notStrictEqual(first.mesh.skeleton.bones[0], second.mesh.skeleton.bones[0]);
    assert.strictEqual(first.mesh.material, second.mesh.material, 'the instance factory replaces this shared template material before rendering');

    const firstAppearance = createAvatarAppearanceController(first.mesh), secondAppearance = createAvatarAppearanceController(second.mesh);
    assert.equal(firstAppearance.ok && secondAppearance.ok, true);
    if (!firstAppearance.ok || !secondAppearance.ok) return;
    firstAppearance.controller.apply({ ageAppearance: 'mature' }, 'round', 'grin');
    const changed = first.mesh.geometry.getAttribute('position').array as ArrayLike<number>;
    const untouched = second.mesh.geometry.getAttribute('position').array as ArrayLike<number>;
    assert.ok(Array.from(changed).some((value, index) => value !== sourceValues[index]), 'first actor appearance deforms its own geometry');
    assert.deepEqual(Array.from(untouched), sourceValues, 'another actor and the immutable template keep source positions');

    const headA = first.mesh.skeleton.bones.find((bone) => bone.name === 'Head');
    const headB = second.mesh.skeleton.bones.find((bone) => bone.name === 'Head');
    assert.ok(headA && headB);
    const initial = headB.position.x;
    headA.position.x += 0.1;
    assert.equal(headB.position.x, initial, 'pose mutation stays on the first actor skeleton');
    const walk = animationClips.find((clip) => clip.name === 'walk');
    assert.ok(walk);
    const mixer = new AnimationMixer(first.scene);
    mixer.clipAction(walk).play(); mixer.setTime(0.37);
    assert.notDeepEqual(headA.quaternion.toArray(), headB.quaternion.toArray(), 'a real shipped pose clip animates only its actor clone');

    firstAppearance.controller.dispose(); secondAppearance.controller.dispose();
    mixer.stopAllAction(); mixer.uncacheRoot(first.scene);
    first.mesh.geometry.dispose(); second.mesh.geometry.dispose();
    first.mesh.skeleton.dispose(); second.mesh.skeleton.dispose();
    assert.deepEqual(Array.from(sourcePosition.array as ArrayLike<number>), sourceValues, 'the retained source template remains unchanged');
    source.scene.traverse((node) => { const mesh = node as SkinnedMesh; mesh.geometry?.dispose(); if (mesh.isSkinnedMesh) mesh.skeleton.dispose(); });
  });
}
