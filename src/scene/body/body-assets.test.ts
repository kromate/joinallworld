// The shipped skinned-body assets (public/body/, made by scripts/body/build-body.ts) against the phase-1 budgets, read
// straight from the files: brotli bytes, triangles, bones, influences per vertex, one material, the clips.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { brotliCompressSync, constants } from 'node:zlib';
import { BODY_MANIFEST } from './manifest.ts';

const KB = 1024;
const BUDGET = { body: 300 * KB, clips: 200 * KB, phase: 500 * KB, triangles: 10_000, bones: 30 };
const file = (name: string) => readFileSync(new URL(`../../../public/body/${name}`, import.meta.url));
const brotli = (bytes: Buffer) => brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length;
interface Accessor { count: number; type: string; componentType: number; max?: number[] }
interface Glb {
  accessors: Accessor[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; material?: number }[] }[];
  materials?: unknown[]; skins?: { joints: number[] }[]; nodes: { name?: string }[];
  animations?: { name: string; samplers: { input: number }[] }[];
}
function json(bytes: Buffer): Glb {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'a binary glTF');
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as Glb;
}

for (const key of ['male', 'female'] as const) {
  test(`${key}.glb: one skinned mesh within the hero budget`, () => {
    const bytes = file(`${key}.glb`), gltf = json(bytes), facts = BODY_MANIFEST.bodies[key];
    assert.ok(brotli(bytes) <= BUDGET.body, `${key}: ${brotli(bytes)} B brotli > ${BUDGET.body}`);
    assert.equal(gltf.meshes?.length, 1, 'one mesh');
    assert.equal(gltf.meshes[0]!.primitives.length, 1, 'one primitive: one draw call');
    assert.equal(gltf.materials?.length, 1, 'one material');
    const primitive = gltf.meshes[0]!.primitives[0]!;
    const triangles = gltf.accessors[primitive.indices!]!.count / 3;
    assert.ok(triangles <= BUDGET.triangles, `${key}: ${triangles} triangles`);
    assert.equal(gltf.skins?.length, 1, 'one skeleton');
    const bones = gltf.skins[0]!.joints.length;
    assert.ok(bones <= BUDGET.bones, `${key}: ${bones} bones`);
    assert.deepEqual(gltf.skins[0]!.joints.map((joint) => gltf.nodes[joint]!.name), [...BODY_MANIFEST.bones], 'the shared skeleton, by name');
    // Four influences a vertex: one JOINTS/WEIGHTS pair of VEC4, nothing more.
    assert.equal(gltf.accessors[primitive.attributes.JOINTS_0!]!.type, 'VEC4');
    assert.equal(gltf.accessors[primitive.attributes.WEIGHTS_0!]!.type, 'VEC4');
    assert.equal(primitive.attributes.JOINTS_1, undefined);
    assert.equal(primitive.attributes.WEIGHTS_1, undefined);
    assert.ok(primitive.attributes.COLOR_0 !== undefined, 'the clothing regions');
    // The manifest the runtime reads describes this very file.
    assert.equal(facts.bytes, bytes.length);
    assert.equal(facts.triangles, triangles);
    assert.equal(facts.bones, bones);
    assert.ok(facts.url.endsWith(`?v=${createHash('sha256').update(bytes).digest('hex').slice(0, 10)}`), 'the cache-busting hash is current');
  });
}

test('clips.glb: the core clip pack, every clip with a length, within budget', () => {
  const bytes = file('clips.glb'), gltf = json(bytes);
  assert.ok(brotli(bytes) <= BUDGET.clips, `${brotli(bytes)} B brotli > ${BUDGET.clips}`);
  assert.equal(gltf.meshes, undefined, 'no mesh: clips only');
  const names = (gltf.animations ?? []).map((clip) => clip.name);
  for (const name of ['idle', 'walk', 'sit-enter', 'sit', 'sit-exit']) assert.ok(names.includes(name), `has ${name}`);
  assert.deepEqual(names, [...BODY_MANIFEST.clips.names]);
  for (const clip of gltf.animations ?? []) {
    const length = Math.max(...clip.samplers.map((sampler) => gltf.accessors[sampler.input]!.max?.[0] ?? 0));
    assert.ok(length > 0.5, `${clip.name} runs for ${length} s`);
  }
  assert.equal(BODY_MANIFEST.clips.bytes, bytes.length);
});

test('one body and the clips stay inside the after-first-paint phase gate', () => {
  const clips = brotli(file('clips.glb'));
  for (const key of ['male', 'female'] as const) {
    const total = brotli(file(`${key}.glb`)) + clips;
    // The lazy chunk (skinned.ts + GLTFLoader + meshopt decoder) is about 60 KB brotli; leave it 150.
    assert.ok(total + 150 * KB <= BUDGET.phase, `${key} + clips: ${total} B brotli`);
  }
});
