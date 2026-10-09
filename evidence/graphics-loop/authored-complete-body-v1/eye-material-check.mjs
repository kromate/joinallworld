import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { applyAuthoredEyeMaterial } from './eye-material.ts';

const started = performance.now();
const sourcePath = new URL('../authored-character-spike-v1/parametric-base-expressive.glb', import.meta.url);
const bytes = await readFile(sourcePath);
if (bytes.byteLength > 16 * 1024 * 1024) throw new Error('Source exceeds the 16 MiB input bound');
const sha256 = createHash('sha256').update(bytes).digest('hex');
if (sha256 !== '0152129ce2c6022911747f9d7a6df3fdb72a9e6e1bea73db414da1cb8f483077') throw new Error(`Pinned source hash changed: ${sha256}`);
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const gltf = await new Promise((resolve, reject) => loader.parse(arrayBuffer, '', resolve, reject));
let eyes;
gltf.scene.traverse(node => { if (node.name === 'Eyes') eyes = node; });
if (!eyes?.isMesh) throw new Error('Pinned source has no Eyes mesh');
const geometry = eyes.geometry;
const index = geometry.index;
const originalMaterial = eyes.material;
const beforeIndex = index?.array.slice();
const beforePosition = geometry.attributes.position.array.slice();
const beforeUv = geometry.attributes.uv.array.slice();
const result = applyAuthoredEyeMaterial(gltf.scene);
if (eyes.geometry !== geometry || eyes.geometry.index !== index || eyes.material === originalMaterial) throw new Error('Material application changed geometry ownership or failed to clone material');
const webglProgramSource = await readFile(new URL('../../../node_modules/three/src/renderers/webgl/WebGLProgram.js', import.meta.url), 'utf8');
if (!webglProgramSource.includes("'attribute vec2 uv;'")) throw new Error('Installed Three.js WebGLProgram prefix no longer declares uv');
const shader = {
  uniforms: {},
  // WebGLProgram.js prefixes this declaration before ShaderLib vertex source.
  vertexShader: 'attribute vec2 uv;\n#include <common>\nvoid main(){\n#include <begin_vertex>\n}',
  fragmentShader: '#include <common>\nvoid main(){\n#include <color_fragment>\n}',
};
eyes.material.onBeforeCompile(shader, {});
for (const marker of ['attribute vec2 uv;', 'vAuthoredEyeUv = uv;']) if (!shader.vertexShader.includes(marker)) throw new Error(`Vertex shader patch missing: ${marker}`);
if ((shader.vertexShader.match(/attribute vec2 uv;/g) ?? []).length !== 1) throw new Error('Vertex shader declares uv more than once');
for (const marker of ['authoredEyeA', 'authoredEyeB', 'authoredLimbal', 'authoredIris', 'authoredPupil', 'float pupilMask']) if (!shader.fragmentShader.includes(marker)) throw new Error(`Fragment shader patch missing: ${marker}`);
for (const key of ['authoredEyeA', 'authoredEyeB', 'authoredLimbal', 'authoredIris', 'authoredIrisLight', 'authoredPupil']) if (!shader.uniforms[key]) throw new Error(`Shader uniform missing: ${key}`);
result.dispose();
if (eyes.material !== originalMaterial || eyes.geometry !== geometry || eyes.geometry.index !== index) throw new Error('Disposal did not restore the source material and geometry');
for (const [name, before, after] of [['index', beforeIndex, index?.array], ['position', beforePosition, geometry.attributes.position.array], ['uv', beforeUv, geometry.attributes.uv.array]]) {
  if (before && after && before.some((value, i) => value !== after[i])) throw new Error(`Source ${name} values mutated`);
}
const elapsedMs = Math.round(performance.now() - started);
if (elapsedMs > 45_000) throw new Error(`CPU check exceeded 45 seconds (${elapsedMs} ms)`);
console.log(JSON.stringify({
  status: 'pass', sourceSha256: sha256, sourceBytes: bytes.byteLength,
  geometryUnchanged: true, sourceMaterialRestored: true, shaderPatchContract: 'pass (template injection and uniform check; no GPU compile)',
  geometry: { vertices: result.metrics.vertexCount, triangles: result.metrics.triangleCount, uvAttribute: 'TEXCOORD_0', hasIndices: Boolean(index) },
  islands: result.metrics.islands.map((island, i) => ({ eye: i + 1, ...island })), elapsedMs,
}, null, 2));
