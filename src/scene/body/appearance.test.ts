import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { BufferAttribute, SkinnedMesh } from 'three';
import { createAvatarAppearanceController } from './appearance.ts';

await MeshoptDecoder.ready;
globalThis.self ??= globalThis as unknown as typeof self;
globalThis.createImageBitmap ??= (async () => ({ width: 1024, height: 1024, close() {} })) as typeof createImageBitmap;

async function body(key: 'male' | 'female'): Promise<SkinnedMesh> {
  const bytes = readFileSync(new URL(`./assets/base-body-${key}.glb`, import.meta.url));
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await new Promise<{ scene: import('three').Group }>((resolve, reject) => loader.parse(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', resolve, reject,
  ));
  let result: SkinnedMesh | null = null;
  gltf.scene.traverse((node) => { if ((node as SkinnedMesh).isSkinnedMesh && !result) result = node as SkinnedMesh; });
  assert.ok(result, `${key} asset has its skinned mesh`);
  return result;
}

for (const key of ['male', 'female'] as const) {
  test(`${key} saved face silhouettes switch from immutable source and reset exactly`, async () => {
    const mesh = await body(key);
    const source = mesh.geometry.getAttribute('position') as BufferAttribute;
    const original = Array.from(source.array as ArrayLike<number>);
    const made = createAvatarAppearanceController(mesh);
    assert.equal(made.ok, true);
    if (!made.ok) return;
    const controller = made.controller;
    const round = controller.apply({}, 'round');
    assert.equal(round.ok, true);
    assert.equal(round.ok && round.face, 'round');
    assert.notEqual(mesh.geometry.getAttribute('position'), source);
    const roundValues = Array.from(mesh.geometry.getAttribute('position').array as ArrayLike<number>);
    assert.ok(roundValues.some((value, index) => value !== original[index]), 'round changes authored frontal face vertices');

    controller.apply({}, 'long');
    const longValues = Array.from(mesh.geometry.getAttribute('position').array as ArrayLike<number>);
    const changes = roundValues.map((value, index) => longValues[index]! - value);
    assert.ok(changes.some((value) => value !== 0), 'long recomputes from source rather than retaining the round deformation');

    controller.apply({}, 'oval', 'smile');
    const smileValues = Array.from(mesh.geometry.getAttribute('position').array as ArrayLike<number>);
    assert.equal(controller.expression, 'smile');
    controller.apply({}, 'oval', 'grin');
    const grinValues = Array.from(mesh.geometry.getAttribute('position').array as ArrayLike<number>);
    assert.equal(controller.expression, 'grin');
    assert.ok(grinValues.some((value, index) => value !== smileValues[index]), 'grin lip vertices are derived from the immutable source');
    controller.apply({}, 'oval', 'neutral');
    assert.equal(mesh.geometry.getAttribute('position'), source, 'neutral oval restores the source mouth geometry exactly');

    controller.apply({ ageAppearance: 'mature' }, 'long');
    assert.equal(controller.appearance.ageAppearance, 'mature');
    assert.equal(controller.face, 'long');
    controller.apply({ ageAppearance: 'adult' }, 'oval');
    assert.equal(mesh.geometry.getAttribute('position'), source, 'adult oval restores the exact source attribute');
    assert.ok(Array.from(source.array as ArrayLike<number>).every((value, index) => value === original[index]), 'the immutable decoded source positions were never edited');
    controller.dispose();
  });
}
