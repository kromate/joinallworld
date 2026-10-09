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
const officeGlbPath = path.join(here, 'authored-clothing/office-export/out/office-female.glb');
const expectedSha = '1f8d4fd4b867785226a9c057562289381ae071cf5acbcca248133a3216ae476f';
const officeExpectedSha = 'fd3f4ac0985dae3d6f46469fc8f22ea22d84628c83829c77802a79b1f8f3c053';
const bytes = await readFile(glbPath);
assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedSha);
const officeBytes = await readFile(officeGlbPath);
assert.equal(createHash('sha256').update(officeBytes).digest('hex'), officeExpectedSha);
const officeView = new DataView(officeBytes.buffer, officeBytes.byteOffset, officeBytes.byteLength);
const officeJsonLength = officeView.getUint32(12, true);
const officeJson = JSON.parse(new TextDecoder().decode(officeBytes.subarray(20, 20 + officeJsonLength)));
assert.ok(officeJson.materials.some((material) => material.pbrMetallicRoughness?.baseColorTexture),
  'pinned office garment has the baked base-color texture that the solid palette must detach');
const asset = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '/');
let source;
asset.scene.traverse((node) => { if (node.isMesh) { assert.equal(source, undefined); source = node.material; } });
assert.ok(source instanceof THREE.MeshStandardMaterial);
const sourceColor = source.color.clone();
const sourceMap = source.map;
const sourceRoughness = source.roughness;
const sourceMetalness = source.metalness;
const first = createAuthoredClothingPalette(source, { shirt: '#cb674d', trousers: '#36594a' });
const second = createAuthoredClothingPalette(source, { shirt: '#284f93', trousers: '#d2a83d' });
assert.notEqual(first.material, source);
assert.notEqual(second.material, source);
assert.notEqual(first.material, second.material);
assert.equal(first.material.map, null, 'plain-fabric palette retained the source color artwork');
assert.equal(second.material.map, null, 'second actor retained the source color artwork');
assert.equal(first.material.vertexColors, false, 'plain-fabric palette retained baked vertex colors');
assert.equal(second.material.vertexColors, false, 'second palette retained baked vertex colors');
assert.equal(source.map, sourceMap, 'palette setup detached or mutated the shared source map');
assert.equal(first.material.roughness, sourceRoughness, 'solid palette discarded authored roughness');
assert.equal(first.material.metalness, sourceMetalness, 'solid palette discarded authored PBR metalness');
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
const mappedMaterial = new THREE.MeshStandardMaterial({ map: new THREE.Texture(), vertexColors: true, roughness: 0.37 });
const originalTexture = mappedMaterial.map;
const mappedRoughness = mappedMaterial.roughness;
let textureDisposed = false;
originalTexture.addEventListener('dispose', () => { textureDisposed = true; });
const solidPalette = createAuthoredClothingPalette(mappedMaterial, { shirt: '#ba6750', trousers: '#334d68' });
assert.equal(solidPalette.material.map, null, 'mapped source was not removed from the palette clone');
assert.equal(solidPalette.material.vertexColors, false, 'vertex color multiplication was not disabled');
assert.equal(mappedMaterial.map, originalTexture, 'palette detached the shared source texture');
assert.equal(solidPalette.material.roughness, mappedRoughness, 'map detachment discarded authored roughness');
let firstDisposed = false, secondDisposed = false, sourceDisposed = false;
first.material.addEventListener('dispose', () => { firstDisposed = true; });
second.material.addEventListener('dispose', () => { secondDisposed = true; });
source.addEventListener('dispose', () => { sourceDisposed = true; });
first.dispose(); first.dispose(); second.dispose();
solidPalette.dispose();
assert.ok(firstDisposed && secondDisposed, 'owned materials were not disposed idempotently');
assert.equal(sourceDisposed, false, 'disposing palette disposed shared source material');
assert.equal(textureDisposed, false, 'disposing solid palette disposed the shared source texture');
assert.equal(AUTHORED_CLOTHING_PALETTE_CONTRACT.transitionWidthMetres, 0.002);
console.log(JSON.stringify({
  status: 'pass',
  sourceSha256: expectedSha,
  officeSourceSha256: officeExpectedSha,
  officeHasBaseColorMap: true,
  baseMaterial: source.type,
  materialClones: 3,
  sourceMapPreserved: source.map === sourceMap,
  paletteMapDetached: first.material.map === null && second.material.map === null && solidPalette.material.map === null,
  vertexColorMultiplicationDisabled: !first.material.vertexColors && !second.material.vertexColors && !solidPalette.material.vertexColors,
  roughnessRetained: first.material.roughness === sourceRoughness,
  shaderMarkers: [AUTHORED_CLOTHING_PALETTE_CONTRACT.vertexMarker, AUTHORED_CLOTHING_PALETTE_CONTRACT.fragmentMarker],
  centerYMetres: AUTHORED_CLOTHING_PALETTE_CONTRACT.centerYMetres,
  transitionWidthMetres: AUTHORED_CLOTHING_PALETTE_CONTRACT.transitionWidthMetres,
  trianglesChanged: 0,
  geometryBytesChanged: 0,
  sourceMaterialDisposed: sourceDisposed,
}, null, 2));
