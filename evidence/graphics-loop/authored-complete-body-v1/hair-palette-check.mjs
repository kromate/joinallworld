import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import * as THREE from 'three';
import { createAuthoredHairPalette, AUTHORED_HAIR_PALETTE_REFERENCES } from './hair-palette.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = [
  { name: 'short02', file: 'authored-hair/out/short02-mobile.glb', sha: 'a2637b4d14055cbd537b9b0f6e46c695b4a5bdc99e7d779956d58218ffc626a0' },
  { name: 'afro01', file: 'authored-hair/out/afro01-mobile.glb', sha: '3d37f4a379c19b4d64a9c21bb08418858ede79317a477b34b3fdfb965fd11474' },
];
const srgbToLinear = (value) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

function parseGlb(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(4, true), 2);
  let json, binary;
  for (let offset = 12; offset < bytes.length;) {
    const size = view.getUint32(offset, true), type = view.getUint32(offset + 4, true);
    const chunk = bytes.subarray(offset + 8, offset + 8 + size);
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    if (type === 0x004e4942) binary = chunk;
    offset += size + 8;
  }
  assert(json && binary);
  return { json, binary };
}

function decodePng(png) {
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  let width, height, depth, type;
  const compressed = [];
  for (let offset = 8; offset < png.length;) {
    const size = png.readUInt32BE(offset), name = png.toString('ascii', offset + 4, offset + 8);
    const chunk = png.subarray(offset + 8, offset + 8 + size);
    if (name === 'IHDR') { width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4); depth = chunk[8]; type = chunk[9]; }
    if (name === 'IDAT') compressed.push(chunk);
    if (name === 'IEND') break;
    offset += size + 12;
  }
  assert.equal(depth, 8); assert.equal(type, 6);
  const raw = inflateSync(Buffer.concat(compressed)), stride = width * 4, decoded = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => { const p = a + b - c, da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c); return da <= db && da <= dc ? a : db <= dc ? b : c; };
  for (let y = 0; y < height; y++) {
    const input = y * (stride + 1) + 1, output = y * stride, filter = raw[input - 1];
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? decoded[output + x - 4] : 0;
      const up = y ? decoded[output + x - stride] : 0;
      const upperLeft = y && x >= 4 ? decoded[output + x - stride - 4] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2) : filter === 4 ? paeth(left, up, upperLeft) : NaN;
      assert(Number.isFinite(predictor), `PNG filter ${filter}`);
      decoded[output + x] = (raw[input + x] + predictor) & 255;
    }
  }
  const sum = [0, 0, 0], histogram = [0, 0, 0], alphaCounts = { transparent: 0, partial: 0, opaque: 0 };
  let alphaTotal = 0;
  for (let i = 0; i < decoded.length; i += 4) {
    const a = decoded[i + 3];
    if (!a) { alphaCounts.transparent++; continue; }
    if (a === 255) alphaCounts.opaque++; else alphaCounts.partial++;
    alphaTotal += a;
    for (let c = 0; c < 3; c++) sum[c] += srgbToLinear(decoded[i + c]) * a;
  }
  return { width, height, rgba: decoded, alphaCounts, alphaWeightedLinearMean: sum.map((channel) => channel / alphaTotal), alphaWeightedPixelEquivalents: alphaTotal / 255 };
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const results = [], pixelsByName = new Map();
for (const asset of assets) {
  const bytes = await readFile(path.join(here, asset.file));
  assert.equal(sha(bytes), asset.sha, `${asset.name} mobile GLB pin`);
  const { json, binary } = parseGlb(bytes);
  assert.equal(json.materials.length, 1);
  const materialJson = json.materials[0];
  assert.equal(materialJson.alphaMode, 'BLEND');
  assert.equal(materialJson.doubleSided, true);
  const image = json.images[0], imageView = json.bufferViews[image.bufferView];
  const png = binary.subarray(imageView.byteOffset, imageView.byteOffset + imageView.byteLength);
  const measured = decodePng(png);
  pixelsByName.set(asset.name, measured);
  const { rgba, ...stats } = measured;
  results.push({ asset: asset.name, glbSha256: sha(bytes), imageSha256: sha(png), imageBytes: png.length, ...stats });
}
if (process.env.HAIR_PALETTE_MEASURE_ONLY === '1') {
  console.log(JSON.stringify({ status: 'texture-measurement', textures: results }, null, 2));
  process.exit(0);
}

// Small material contract tests use the exact source material state encoded in the GLBs.
function standardMapMaterial(assetName) {
  const pixels = pixelsByName.get(assetName);
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const texture = new THREE.DataTexture(pixels.rgba, pixels.width, pixels.height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace; texture.needsUpdate = true; material.map = texture;
  return { material, texture };
}
const sourceA = standardMapMaterial('afro01'), sourceB = standardMapMaterial('short02');
const originalA = { color: sourceA.material.color.toArray(), transparent: sourceA.material.transparent, depthWrite: sourceA.material.depthWrite, side: sourceA.material.side, map: sourceA.material.map };
const afro = createAuthoredHairPalette(sourceA.material, 'afro01', '#68402f');
const short = createAuthoredHairPalette(sourceB.material, 'short02', '#291f24');
assert.notEqual(afro.material, sourceA.material);
assert.equal(afro.material.map, sourceA.material.map, 'hair map remains shared and unchanged');
assert.equal(afro.material.transparent, originalA.transparent);
assert.equal(afro.material.depthWrite, originalA.depthWrite);
assert.equal(afro.material.side, originalA.side);
assert.equal(afro.material.alphaTest, sourceA.material.alphaTest);
assert.equal(short.material.transparent, sourceB.material.transparent);
assert.equal(short.material.depthWrite, sourceB.material.depthWrite);
assert.equal(short.material.side, sourceB.material.side);
assert.equal(short.material.alphaTest, sourceB.material.alphaTest);
assert.deepEqual(sourceA.material.color.toArray(), originalA.color, 'source material remains untouched');
assert.equal(afro.material.color.getHex(), 0xffffff, 'palette shader does not multiply target by source base color');
assert.equal(short.material.customProgramCacheKey(), afro.material.customProgramCacheKey(), 'color values do not make new shader variants');

function compile(material) {
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader, {});
  assert.match(shader.fragmentShader, /uAuthoredHairColor/);
  assert.match(shader.fragmentShader, /uAuthoredHairReferenceLinear/);
  assert.match(shader.fragmentShader, /diffuseColor\.rgb\s*=\s*clamp\(/);
  return shader;
}
const afroShader = compile(afro.material), shortShader = compile(short.material);
assert.deepEqual(afroShader.uniforms.uAuthoredHairReferenceLinear.value.toArray(), AUTHORED_HAIR_PALETTE_REFERENCES.afro01);
assert.notEqual(afroShader.uniforms.uAuthoredHairColor.value, shortShader.uniforms.uAuthoredHairColor.value,
  'actors hold independent palette uniform values');
const updated = new THREE.Color('#9b6948');
afro.setColor(updated);
assert.deepEqual(afroShader.uniforms.uAuthoredHairColor.value.toArray(), updated.toArray(), 'already compiled material accepts palette updates');
assert.notDeepEqual(shortShader.uniforms.uAuthoredHairColor.value.toArray(), updated.toArray(), 'palette updates stay actor-private');
let sourceDisposed = false, afroDisposed = 0, shortDisposed = 0;
sourceA.material.addEventListener('dispose', () => { sourceDisposed = true; });
afro.material.addEventListener('dispose', () => afroDisposed++);
short.material.addEventListener('dispose', () => shortDisposed++);
afro.dispose(); afro.dispose(); short.dispose();
assert.equal(afroDisposed, 1); assert.equal(shortDisposed, 1); assert.equal(sourceDisposed, false);
const sourceMaterialsSurvivedPaletteDispose = !sourceDisposed;
sourceA.texture.dispose(); sourceB.texture.dispose(); sourceA.material.dispose(); sourceB.material.dispose();

console.log(JSON.stringify({
  status: 'pass',
  textures: results,
  palette: { referenceSpace: 'linear RGB, alpha-weighted mean of all alpha-positive embedded image texels',
    shaderContract: 'diffuseColor.rgb = clamp(targetLinear * diffuseColor.rgb / sourceReferenceLinear, 0, 1)',
    colorMaps: AUTHORED_HAIR_PALETTE_REFERENCES, mapAndAlphaSettingsPreserved: true,
    sourceMaterialsSurvivedPaletteDispose, privateMaterialsDisposedOnce: afroDisposed === 1 && shortDisposed === 1 },
  limitations: ['Shader source contract and material ownership only; no GPU, visual, hairstyle-fit, or mobile performance claim.'],
}, null, 2));
