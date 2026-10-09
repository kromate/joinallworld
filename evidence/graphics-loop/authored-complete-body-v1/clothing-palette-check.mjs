import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createAuthoredClothingPalette, AUTHORED_CLOTHING_PALETTE_CONTRACT } from './clothing-palette.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const glbPath = path.join(here, 'authored-clothing/out/male_casualsuit01.glb');
const expectedSha = '1f8d4fd4b867785226a9c057562289381ae071cf5acbcca248133a3216ae476f';
const bytes = await readFile(glbPath);
assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedSha);
const asset = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '/');
let source;
asset.scene.traverse((node) => { if (node.isMesh) { assert.equal(source, undefined); source = node.material; } });
assert.ok(source instanceof THREE.MeshStandardMaterial);
const sourceColor = source.color.clone();
const first = createAuthoredClothingPalette(source, { shirt: '#cb674d', trousers: '#36594a' });
const second = createAuthoredClothingPalette(source, { shirt: '#284f93', trousers: '#d2a83d' });
assert.notEqual(first.material, source);
assert.notEqual(second.material, source);
assert.notEqual(first.material, second.material);
assert.deepEqual(source.color.toArray(), sourceColor.toArray(), 'palette setup mutated shared source material');
assert.deepEqual(first.material.color.toArray(), [1, 1, 1], 'palette material did not replace neutral base factor');
assert.match(first.material.customProgramCacheKey(), /joinallworld\.authored-clothing-palette\.v1/, 'shader cache key lost palette version');
assert.equal(first.material.customProgramCacheKey(), second.material.customProgramCacheKey(), 'uniform-only palette values caused needless shader variants');

function compile(material) {
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  material.onBeforeCompile(shader, {});
  assert.match(shader.vertexShader, /varying float vAuthoredClothingRestY/);
  assert.match(shader.vertexShader, /vAuthoredClothingRestY = position\.y/);
  assert.match(shader.fragmentShader, /uAuthoredShirtColor/);
  assert.match(shader.fragmentShader, /smoothstep\(uAuthoredPaletteCenterY - uAuthoredPaletteHalfWidth/);
  assert.match(shader.fragmentShader, /mix\(uAuthoredTrouserColor, uAuthoredShirtColor/);
  assert.ok(shader.uniforms.uAuthoredShirtColor.value instanceof THREE.Color);
  assert.ok(shader.uniforms.uAuthoredTrouserColor.value instanceof THREE.Color);
  assert.equal(shader.uniforms.uAuthoredPaletteCenterY.value, 0.91);
  assert.equal(shader.uniforms.uAuthoredPaletteHalfWidth.value, 0.001);
  return shader;
}
const firstShader = compile(first.material);
const secondShader = compile(second.material);
assert.notEqual(firstShader.uniforms.uAuthoredShirtColor.value, secondShader.uniforms.uAuthoredShirtColor.value,
  'actors share mutable palette colors');
const updated = new THREE.Color('#008060');
first.setColors({ shirt: updated, trousers: '#301020' });
assert.deepEqual(firstShader.uniforms.uAuthoredShirtColor.value.toArray(), updated.toArray(), 'compiled palette failed to update');
assert.notDeepEqual(secondShader.uniforms.uAuthoredShirtColor.value.toArray(), updated.toArray(), 'palette update leaked to another actor');
let firstDisposed = false, secondDisposed = false, sourceDisposed = false;
first.material.addEventListener('dispose', () => { firstDisposed = true; });
second.material.addEventListener('dispose', () => { secondDisposed = true; });
source.addEventListener('dispose', () => { sourceDisposed = true; });
first.dispose(); first.dispose(); second.dispose();
assert.ok(firstDisposed && secondDisposed, 'owned materials were not disposed idempotently');
assert.equal(sourceDisposed, false, 'disposing palette disposed shared source material');
assert.equal(AUTHORED_CLOTHING_PALETTE_CONTRACT.transitionWidthMetres, 0.002);
console.log(JSON.stringify({
  status: 'pass',
  sourceSha256: expectedSha,
  baseMaterial: source.type,
  materialClones: 2,
  shaderMarkers: [AUTHORED_CLOTHING_PALETTE_CONTRACT.vertexMarker, AUTHORED_CLOTHING_PALETTE_CONTRACT.fragmentMarker],
  centerYMetres: AUTHORED_CLOTHING_PALETTE_CONTRACT.centerYMetres,
  transitionWidthMetres: AUTHORED_CLOTHING_PALETTE_CONTRACT.transitionWidthMetres,
  trianglesChanged: 0,
  geometryBytesChanged: 0,
  sourceMaterialDisposed: sourceDisposed,
}, null, 2));
