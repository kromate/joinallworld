import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, '../authored-character-spike-v1/parametric-base-expressive.glb');
const outputPath = path.join(here, 'parametric-base-facial.glb');
const inputsPath = path.join(here, 'expression-source-inputs');
mkdirSync(inputsPath, { recursive: true });
const sourceHash = '0152129ce2c6022911747f9d7a6df3fdb72a9e6e1bea73db414da1cb8f483077';
const extraRoot = 'https://raw.githubusercontent.com/makehumancommunity/extra-targets/7eaba3453134385bb5ea9811ef0b33b85b4b556d/';
const targetRoot = `${extraRoot}assets/faceunits01/targets/faceunits/`;
const targets = [
  { file: 'eyeBlinkLeft.target', name: 'nativeFacialBlinkLeft', bytes: 16277, sha256: '53d35e0a8357140d4e37277a674f211bdaf97be011b61cfcdff618f0bfea0ec8', mesh: 'Body' },
  { file: 'eyeBlinkRight.target', name: 'nativeFacialBlinkRight', bytes: 16075, sha256: '00d159a70fad650b336eb6f739a1a6a47f916da4331ef9848fb0eef989ca5cc5', mesh: 'Body' },
  { file: 'jawOpen.target', name: 'nativeFacialJawOpen', bytes: 51426, sha256: '2439e703e434f999b58a1d26cffdb6b2fd5f30941b8ff19cac70b75392d4de6f', mesh: 'Body' },
  { file: 'mouthSmileLeft.target', name: 'nativeFacialSmileLeft', bytes: 32657, sha256: '11cabf2fa6f9664c4d0b9f8f0cadaf4b2a1a9625b72c7593262465ce8d4cb9a2', mesh: 'Body' },
  { file: 'mouthSmileRight.target', name: 'nativeFacialSmileRight', bytes: 33258, sha256: '70578981892db13c02512455583c2f9743683d5c571c1e2624b09638cf37bedd', mesh: 'Body' },
];
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function pinnedInput(file, url, bytesExpected, shaExpected) {
  const filePath = path.join(inputsPath, file);
  let bytes;
  try { bytes = readFileSync(filePath); }
  catch {
    const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
    assert(response.ok, `HTTP ${response.status} fetching ${file}`);
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; assert(size <= bytesExpected, `${file} exceeds pinned size cap`); chunks.push(chunk); }
    bytes = Buffer.concat(chunks);
    writeFileSync(filePath, bytes);
  }
  assert.equal(bytes.length, bytesExpected, `${file} length`);
  assert.equal(hash(bytes), shaExpected, `${file} SHA-256`);
  return bytes;
}

function parseGlb(bytes) {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, 'GLB magic');
  assert.equal(bytes.readUInt32LE(4), 2, 'GLB version');
  let json, bin, jsonIndex = -1, binIndex = -1, offset = 12;
  const chunks = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data: Buffer.from(data) });
    if (type === 0x4e4f534a) { json = JSON.parse(data.toString('utf8')); jsonIndex = chunks.length - 1; }
    if (type === 0x004e4942) { bin = Buffer.from(data); binIndex = chunks.length - 1; }
    offset += length + 8;
  }
  assert(json && bin, 'GLB JSON/BIN chunks');
  return { json, bin, chunks, jsonIndex, binIndex };
}

function encodeGlb(json, bin, chunks, jsonIndex, binIndex) {
  chunks[jsonIndex].data = Buffer.from(JSON.stringify(json));
  chunks[binIndex].data = bin;
  const outputChunks = chunks.map(({ type, data }) => {
    const paddedLength = (data.length + 3) & ~3;
    const padded = Buffer.alloc(paddedLength, type === 0x4e4f534a ? 0x20 : 0);
    data.copy(padded);
    const header = Buffer.alloc(8); header.writeUInt32LE(paddedLength, 0); header.writeUInt32LE(type, 4);
    return Buffer.concat([header, padded]);
  });
  const total = 12 + outputChunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(total, 8);
  return Buffer.concat([header, ...outputChunks]);
}

function parseObjWithUv(text) {
  const vertices = [], uvs = [], faces = []; let group = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) { const [, x, y, z] = line.trim().split(/\s+/); vertices.push([+x, +y, +z]); }
    else if (line.startsWith('vt ')) { const [, u, v] = line.trim().split(/\s+/); uvs.push([+u, +v]); }
    else if (line.startsWith('g ')) group = line.slice(2).trim();
    else if (line.startsWith('f ')) faces.push({ group, corners: line.slice(2).trim().split(/\s+/).map((part) => { const [v, vt] = part.split('/'); return [Number(v) - 1, Number(vt) - 1]; }) });
  }
  return { vertices, uvs, faces };
}

function buildOrigins(obj, groups, meshName, expectedCount) {
  const wanted = meshName === 'Body' ? ['body'] : meshName === 'Teeth' ? ['helper-upper-teeth', 'helper-lower-teeth'] : meshName === 'Tongue' ? ['helper-tongue'] : ['helper-l-eye', 'helper-r-eye'];
  const byPair = new Map(), origins = [];
  for (const face of obj.faces) if (wanted.includes(face.group)) for (const [sourceId, uvId] of face.corners) {
    const key = `${sourceId}/${uvId}`;
    if (!byPair.has(key)) { byPair.set(key, origins.length); origins.push(sourceId); }
  }
  assert.equal(origins.length, expectedCount, `${meshName} source vertex/UV split count`);
  const seen = new Set(origins);
  const ranges = wanted.flatMap((group) => groups[group]);
  const allowed = new Set(ranges.flatMap(([from, to]) => Array.from({ length: to - from + 1 }, (_, i) => from + i)));
  for (const sourceId of seen) assert(allowed.has(sourceId), `${meshName} source ID ${sourceId} in pinned group metadata`);
  return origins;
}

function readTarget(bytes) {
  const rows = [];
  for (const raw of bytes.toString('utf8').split('\n')) {
    const line = raw.trim(); if (!line || line.startsWith('#')) continue;
    const [id, x, y, z] = line.split(/\s+/); rows.push([Number(id), Number(x) * 0.1, Number(y) * 0.1, Number(z) * 0.1]);
  }
  return rows;
}

function makeDelta(rows, origins, meshName, targetName) {
  const bySource = new Map(rows.map(([id, x, y, z]) => [id, [x, y, z]]));
  const mapped = new Float32Array(origins.length * 3); let matchedRows = 0, skippedRows = [];
  const sourceIds = new Set(origins);
  for (const [id, delta] of bySource) {
    if (!sourceIds.has(id)) { skippedRows.push(id); continue; }
    matchedRows++;
  }
  for (let i = 0; i < origins.length; i++) {
    const d = bySource.get(origins[i]); if (d) { mapped[i * 3] = d[0]; mapped[i * 3 + 1] = d[1]; mapped[i * 3 + 2] = d[2]; }
  }
  const expectedMatched = {
    nativeFacialBlinkLeft: { Body: 718 }, nativeFacialBlinkRight: { Body: 718 },
    nativeFacialJawOpen: { Body: 2249, Teeth: 68, Tongue: 226 },
    nativeFacialSmileLeft: { Body: 1640 }, nativeFacialSmileRight: { Body: 1641 },
  }[targetName]?.[meshName];
  assert(Number.isInteger(expectedMatched), `no expected mapping for ${targetName}/${meshName}`);
  assert.equal(matchedRows, expectedMatched, `${targetName} exact source row coverage for ${meshName}`);
  return { values: mapped, matchedRows, skippedRows, affectedVertices: origins.filter((id) => bySource.has(id)).length };
}

function appendMorph(binState, json, meshName, targetName, values) {
  const mesh = json.meshes.find((item) => item.name === meshName), primitive = mesh.primitives[0];
  const appendBytes = (raw) => {
    let currentLength = binState.reduce((sum, part) => sum + part.length, 0);
    const byteOffset = (currentLength + 3) & ~3;
    if (byteOffset > currentLength) { binState.push(Buffer.alloc(byteOffset - currentLength)); currentLength = byteOffset; }
    const viewIndex = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: currentLength, byteLength: raw.length });
    binState.push(raw);
    return viewIndex;
  };
  const dense = Buffer.from(values.buffer, values.byteOffset, values.byteLength);
  const nonzeroIndices = [];
  for (let i = 0; i < values.length / 3; i++) if (values[i * 3] !== 0 || values[i * 3 + 1] !== 0 || values[i * 3 + 2] !== 0) nonzeroIndices.push(i);
  assert(nonzeroIndices.length > 0, `${meshName}.${targetName} must contain nonzero target data`);
  const indexArray = new Uint16Array(nonzeroIndices);
  const valuesArray = new Float32Array(nonzeroIndices.length * 3);
  const denseBounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < values.length; i += 3) for (let axis = 0; axis < 3; axis++) { denseBounds.min[axis] = Math.min(denseBounds.min[axis], values[i + axis]); denseBounds.max[axis] = Math.max(denseBounds.max[axis], values[i + axis]); }
  for (let i = 0; i < nonzeroIndices.length; i++) {
    const sourceOffset = nonzeroIndices[i] * 3;
    valuesArray.set(values.subarray(sourceOffset, sourceOffset + 3), i * 3);
  }
  const indicesView = appendBytes(Buffer.from(indexArray.buffer));
  const valuesView = appendBytes(Buffer.from(valuesArray.buffer));
  const accessorIndex = json.accessors.length;
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let axis = 0; axis < 3; axis++) { min[axis] = denseBounds.min[axis]; max[axis] = denseBounds.max[axis]; }
  json.accessors.push({ componentType: 5126, count: values.length / 3, type: 'VEC3', min, max, sparse: { count: nonzeroIndices.length, indices: { bufferView: indicesView, componentType: 5123 }, values: { bufferView: valuesView } } });
  primitive.targets.push({ POSITION: accessorIndex });
  mesh.extras.targetNames.push(targetName);
  mesh.weights.push(0);
  const sparseBytes = indexArray.byteLength + valuesArray.byteLength;
  return { accessorIndex, denseBytes: dense.length, sparseBytes, sparseCount: nonzeroIndices.length, savingsBytes: dense.length - sparseBytes };
}

function decodeChunks(glbBytes) {
  const b = Buffer.from(glbBytes); let offset = 12, json, bin;
  while (offset < b.length) {
    const size = b.readUInt32LE(offset), type = b.readUInt32LE(offset + 4), chunk = b.subarray(offset + 8, offset + 8 + size);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8'));
    if (type === 0x004e4942) bin = Buffer.from(chunk);
    offset += size + 8;
  }
  return { json, bin };
}

function rounded(x) { return Number(x.toFixed(6)); }

const started = performance.now();
const sourceBytes = readFileSync(sourcePath);
assert.equal(hash(sourceBytes), sourceHash, 'input actor exact source hash');
const targetBytes = new Map();
const targetInputs = await Promise.all(targets.map(async (target) => [target.name, await pinnedInput(target.file, `${targetRoot}${target.file}`, target.bytes, target.sha256)]));
for (const [name, bytes] of targetInputs) targetBytes.set(name, bytes);
const [license, packBytes] = await Promise.all([
  pinnedInput('extra-targets-LICENSE', `${extraRoot}LICENSE`, 7048, 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499'),
  pinnedInput('faceunits01.json', `${extraRoot}assets/faceunits01/packs/faceunits01.json`, 18636, 'fd647a088691ddd9193ce9600df3377bb9ccf69c2904f0a7773a3c246d234c18'),
]);
assert.equal(hash(license), 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499', 'CC0 license exact hash');
assert(license.includes(Buffer.from('CC0 1.0 Universal')), 'pinned source license declares CC0 1.0 Universal');
assert.equal(hash(packBytes), 'fd647a088691ddd9193ce9600df3377bb9ccf69c2904f0a7773a3c246d234c18', 'faceunits pack exact hash');
const pack = JSON.parse(packBytes.toString('utf8'));
for (const name of ['eyeBlinkLeft', 'eyeBlinkRight', 'jawOpen', 'mouthSmileLeft', 'mouthSmileRight']) assert.equal(pack[name]?.license, 'CC0', `${name} pack metadata CC0`);
const hmRoot = 'https://raw.githubusercontent.com/nirholas/three.ws/ec8d1d270b93b8e2e87e8a6160bb908665fe1fcd/avatar-sources/anny/';
const [objBytes, groupBytes] = await Promise.all([
  pinnedInput('hm08-base.obj', `${hmRoot}3dobjs/base.obj`, 1749303, '8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c'),
  pinnedInput('basemesh_vertex_groups.json', `${hmRoot}mesh_metadata/basemesh_vertex_groups.json`, 81984, '8cb1417bc55ae5ec8aa99f90734e81ed5fbb556511ff6a2c00e0534b70911444'),
]);
const objText = objBytes.toString('utf8');
const groups = JSON.parse(groupBytes.toString('utf8'));
const obj = parseObjWithUv(objText);
const parsed = parseGlb(sourceBytes), sourceJson = parsed.json, originalBin = parsed.bin;
const sourceMeshNames = ['Body', 'Eyes', 'Teeth', 'Tongue'];
const origins = {};
for (const name of sourceMeshNames) {
  const mesh = sourceJson.meshes.find((item) => item.name === name);
  assert(mesh, `source has ${name} mesh`);
  origins[name] = buildOrigins(obj, groups, name, sourceJson.accessors[mesh.primitives[0].attributes.POSITION].count);
}

const json = structuredClone(sourceJson);
const binParts = [originalBin];
const appended = [];
const mappingSummary = {};
const denseCandidates = new Map();
for (const target of targets) {
  const rows = readTarget(targetBytes.get(target.name));
  const names = target.name.includes('Blink') ? ['Body'] : target.name.includes('Smile') ? ['Body'] : ['Body', 'Teeth', 'Tongue'];
  mappingSummary[target.name] = {};
  for (const meshName of names) {
    const transfer = makeDelta(rows, origins[meshName], meshName, target.name);
    const record = appendMorph(binParts, json, meshName, target.name, transfer.values);
    mappingSummary[target.name][meshName] = { matchedRows: transfer.matchedRows, affectedVertices: transfer.affectedVertices, skippedRows: transfer.skippedRows.length, accessorIndex: record.accessorIndex };
    denseCandidates.set(`${meshName}/${target.name}`, transfer.values);
    appended.push({ mesh: meshName, name: target.name, ...record });
  }
}
const combinedBin = Buffer.concat(binParts);
json.buffers[0].byteLength = combinedBin.length;
json.asset.extras ??= {};
json.asset.extras.authoredExpressionSources = {
  repo: 'makehumancommunity/extra-targets', commit: '7eaba3453134385bb5ea9811ef0b33b85b4b556d',
  license: 'CC0 1.0 Universal', targetScale: 0.1, targetNames: Object.fromEntries(targets.map(({ file, name, sha256 }) => [name, { file, sha256 }]))
};
const outputBytes = encodeGlb(json, combinedBin, parsed.chunks, parsed.jsonIndex, parsed.binIndex);
writeFileSync(outputPath, outputBytes);
assert.equal(hash(readFileSync(outputPath)), hash(outputBytes), 'output bytes persist');

// Decode with the production dependency to validate accessor and morph semantics.
await MeshoptDecoder.ready;
const loaded = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(outputBytes.buffer.slice(outputBytes.byteOffset, outputBytes.byteOffset + outputBytes.byteLength), '/');
const loadedMeshes = new Map(); loaded.scene.traverse((node) => { if (node.isMesh && node.morphTargetDictionary) loadedMeshes.set(node.name, node); });
assert.deepEqual([...loadedMeshes.keys()].sort(), sourceMeshNames.slice().sort());
const sourceLoaded = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(sourceBytes.buffer.slice(sourceBytes.byteOffset, sourceBytes.byteOffset + sourceBytes.byteLength), '/');
const sourceLoadedMeshes = new Map(); sourceLoaded.scene.traverse((node) => { if (node.isMesh && node.morphTargetDictionary) sourceLoadedMeshes.set(node.name, node); });
function equalAttribute(a, b, label) {
  assert(a && b, `${label} exists on source and output`);
  assert.equal(a.count, b.count, `${label} count`);
  const aa = Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength), bb = Buffer.from(b.array.buffer, b.array.byteOffset, b.array.byteLength);
  assert(aa.equals(bb), `${label} bytes unchanged`);
}
for (const name of sourceMeshNames) {
  const oldMesh = sourceLoadedMeshes.get(name), newMesh = loadedMeshes.get(name);
  for (const attr of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) equalAttribute(oldMesh.geometry.attributes[attr], newMesh.geometry.attributes[attr], `${name}.${attr}`);
  equalAttribute(oldMesh.geometry.index, newMesh.geometry.index, `${name}.index`);
  const oldTargets = oldMesh.geometry.morphAttributes.position, newTargets = newMesh.geometry.morphAttributes.position;
  assert.equal(oldTargets.length, json.meshes.find((item) => item.name === name).extras.targetNames.length - (name === 'Body' ? 5 : ['Teeth','Tongue'].includes(name) ? 1 : 0), `${name} old target count preserved`);
  for (let i = 0; i < oldTargets.length; i++) equalAttribute(oldTargets[i], newTargets[i], `${name}.morph[${i}]`);
  for (const [key, dense] of denseCandidates) if (key.startsWith(`${name}/`)) {
    const targetName = key.slice(name.length + 1), targetIndex = newMesh.morphTargetDictionary[targetName];
    const decoded = newMesh.geometry.morphAttributes.position[targetIndex];
    assert.equal(decoded.count, dense.length / 3, `${key} decoded sparse vertex count`);
    let maxDeltaError = 0;
    for (let i = 0; i < dense.length; i++) maxDeltaError = Math.max(maxDeltaError, Math.abs(decoded.array[i] - dense[i]));
    assert.equal(maxDeltaError, 0, `${key} sparse-to-dense decode is exactly equivalent`);
  }
}
for (const name of sourceMeshNames) {
  const source = sourceJson.meshes.find((item) => item.name === name), output = json.meshes.find((item) => item.name === name);
  assert.equal(output.primitives[0].targets.length, source.primitives[0].targets.length + appended.filter((x) => x.mesh === name).length, `${name} morph target count appended`);
  const mesh = loadedMeshes.get(name);
  for (const target of targets.filter((item) => item.mesh === name || (item.name.includes('JawOpen') && ['Teeth', 'Tongue'].includes(name)))) {
    assert(Number.isInteger(mesh.morphTargetDictionary[target.name]), `${name} dictionary contains ${target.name}`);
    assert.equal(mesh.morphTargetInfluences[mesh.morphTargetDictionary[target.name]], 0, `${name}.${target.name} starts neutral`);
  }
}
for (const name of ['Eyes']) assert(!loadedMeshes.get(name).morphTargetDictionary.nativeFacialJawOpen && !loadedMeshes.get(name).morphTargetDictionary.nativeFacialBlinkLeft, 'Eyes receive no facial targets');

const body = loadedMeshes.get('Body'), bodyGeom = body.geometry, index = bodyGeom.index;
function loopComponents(geometry) {
  const edgeCount = new Map();
  for (let i = 0; i < index.count; i += 3) {
    const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    for (let e = 0; e < 3; e++) { const a = tri[e], b = tri[(e + 1) % 3], k = a < b ? `${a}:${b}` : `${b}:${a}`, entry = edgeCount.get(k); if (entry) entry.n++; else edgeCount.set(k, { a, b, n: 1 }); }
  }
  const adj = new Map();
  for (const { a, b, n } of edgeCount.values()) if (n === 1) { if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []); adj.get(a).push(b); adj.get(b).push(a); }
  const visited = new Set(), loops = [];
  for (const start of adj.keys()) if (!visited.has(start)) { const stack = [start], verts = []; visited.add(start); while (stack.length) { const v = stack.pop(); verts.push(v); for (const next of adj.get(v) ?? []) if (!visited.has(next)) { visited.add(next); stack.push(next); } } if (verts.every((v) => adj.get(v)?.length === 2)) loops.push(verts); }
  const base = bodyGeom.attributes.position;
  return loops.map((vertices) => {
    const p = vertices.map((v) => [base.getX(v), base.getY(v), base.getZ(v)]), min = [0,1,2].map((a) => Math.min(...p.map((v) => v[a]))), max = [0,1,2].map((a) => Math.max(...p.map((v) => v[a])));
    if (min[1] < 1.53 || max[1] > 1.56 || min[2] < 0.125 || max[0]-min[0] < 0.018 || max[0]-min[0] > 0.035) return null;
    return { vertices, side: (min[0]+max[0])/2 > 0 ? 'left' : 'right' };
  }).filter(Boolean);
}
const eyeLoops = loopComponents(bodyGeom);
assert.equal(eyeLoops.length, 4, 'source eye boundary loops preserved');
const bodyBase = bodyGeom.attributes.position;
const morphDelta = (mesh, vertex, name) => { const idx = mesh.morphTargetDictionary[name], a = mesh.geometry.morphAttributes.position[idx]; return [a.getX(vertex), a.getY(vertex), a.getZ(vertex)]; };
const classify = eyeLoops.map((loop) => { const points = loop.vertices.map((vertex) => ({ vertex, y: bodyBase.getY(vertex) + morphDelta(body, vertex, 'bodyFeminine')[1] + morphDelta(body, vertex, 'headRound')[1] * 0.72 } )).sort((a,b)=>a.y-b.y); const half=Math.floor(points.length/2); return {...loop,lower:points.slice(0,half).map(x=>x.vertex),upper:points.slice(-half).map(x=>x.vertex)}; });
function eyeGap(leftName, rightName, weight) {
  const result = {};
  for (const side of ['left','right']) {
    const gaps = classify.filter((loop)=>loop.side===side).map((loop)=>{
      const y=(vs)=>vs.reduce((sum,v)=>sum+bodyBase.getY(v)+morphDelta(body,v,'bodyFeminine')[1]+morphDelta(body,v,'headRound')[1]*.72+morphDelta(body,v,side==='left'?leftName:rightName)[1]*weight,0)/vs.length;
      return y(loop.upper)-y(loop.lower);
    }); result[side]=gaps.reduce((a,b)=>a+b,0)/gaps.length;
  }
  return result;
}
const blinkGaps = { neutral: { left: 0, right: 0 } };
for (const side of ['left','right']) {
  const arcs = classify.filter((loop) => loop.side === side);
  const gaps = arcs.map((loop) => { const y=(vs)=>vs.reduce((sum,v)=>sum+bodyBase.getY(v)+morphDelta(body,v,'bodyFeminine')[1]+morphDelta(body,v,'headRound')[1]*.72,0)/vs.length; return y(loop.upper)-y(loop.lower); });
  blinkGaps.neutral[side]=gaps.reduce((a,b)=>a+b,0)/gaps.length;
}
blinkGaps.bilateral=eyeGap('nativeFacialBlinkLeft','nativeFacialBlinkRight',1);
assert(blinkGaps.bilateral.left < 0.0002 && blinkGaps.bilateral.right < 0.0002, 'native blink closes both measured lid gaps');
const jawMetrics = {};
for (const name of ['Body','Teeth','Tongue']) {
  const mesh=loadedMeshes.get(name), idx=mesh.morphTargetDictionary.nativeFacialJawOpen, delta=mesh.geometry.morphAttributes.position[idx];
  let affected=0,max=0; for(let i=0;i<delta.count;i++){const d=Math.hypot(delta.getX(i),delta.getY(i),delta.getZ(i));if(d>1e-9)affected++;max=Math.max(max,d);}
  jawMetrics[name]={vertices:mesh.geometry.attributes.position.count,affectedVertices:affected,maxDisplacementMeters:rounded(max)};
  assert(affected>0, `${name} jaw target has nonzero deltas`);
}
assert.equal(jawMetrics.Teeth.affectedVertices,68,'jaw target moves all lower teeth source vertices');
assert.equal(jawMetrics.Tongue.affectedVertices,253,'jaw target moves all tongue seam-split vertices');
const targetKeys={nativeFacialBlinkLeft:'eyeBlinkLeft',nativeFacialBlinkRight:'eyeBlinkRight',nativeFacialJawOpen:'jawOpen',nativeFacialSmileLeft:'mouthSmileLeft',nativeFacialSmileRight:'mouthSmileRight'};
const denseBytes = appended.reduce((sum,item)=>sum+item.denseBytes,0), sparseBytes=appended.reduce((sum,item)=>sum+item.sparseBytes,0);
const report={schema:'joinallworld.authored-expression-bake.v1',source:{path:path.relative(here,sourcePath),sha256:sourceHash,bytes:sourceBytes.length,hm08BaseObjSha256:'8e761e6624b8f54536409135d1636da63b32486a90d4897f84e121d144f6fb4c',groupMetadataSha256:'8cb1417bc55ae5ec8aa99f90734e81ed5fbb556511ff6a2c00e0534b70911444'},output:{path:path.basename(outputPath),sha256:hash(outputBytes),bytes:outputBytes.length},license:{repository:'makehumancommunity/extra-targets',commit:'7eaba3453134385bb5ea9811ef0b33b85b4b556d',license:'CC0 1.0 Universal',licenseSha256:hash(license),packPath:'assets/faceunits01/packs/faceunits01.json',packSha256:hash(packBytes)},targets:targets.map(({file,name,bytes,sha256})=>({file,name,bytes,sha256,license:pack[targetKeys[name]]?.license})),meshTargetRouting:{Body:['nativeFacialBlinkLeft','nativeFacialBlinkRight','nativeFacialJawOpen','nativeFacialSmileLeft','nativeFacialSmileRight'],Eyes:[],Teeth:['nativeFacialJawOpen'],Tongue:['nativeFacialJawOpen']},mapping:mappingSummary,sparseEncoding:{format:'glTF sparse FLOAT VEC3 accessors with UNSIGNED_SHORT vertex indices',densePayloadBytes:denseBytes,sparsePayloadBytes:sparseBytes,payloadSavingsBytes:denseBytes-sparseBytes,perTarget:appended.map(({mesh,name,denseBytes,sparseBytes,sparseCount})=>({mesh,name,denseBytes,sparseBytes,sparseCount}))},blinkApertureMeters:Object.fromEntries(Object.entries(blinkGaps).map(([k,v])=>[k,Object.fromEntries(Object.entries(v).map(([s,x])=>[s,rounded(x)]))])),jawOpen:jawMetrics,preserved:{sourceMeshes:sourceJson.meshes.length,sourceMeshNames:sourceJson.meshes.map((m)=>m.name),sourceMorphNames:Object.fromEntries(sourceJson.meshes.map(m=>[m.name,m.extras.targetNames])),sourceAccessorCount:sourceJson.accessors.length,outputAccessorCount:json.accessors.length,sourceBufferPrefixByteIdentical:combinedBin.subarray(0,originalBin.length).equals(originalBin),sourceAccessorDefinitionsRetained:JSON.stringify(sourceJson.accessors)===JSON.stringify(json.accessors.slice(0,sourceJson.accessors.length)),sourceBufferViewsRetained:JSON.stringify(sourceJson.bufferViews)===JSON.stringify(json.bufferViews.slice(0,sourceJson.bufferViews.length)),decodedSourceAttributesAndMorphsByteIdentical:true,decodedNewSparseMorphsExactlyEqualDenseCandidates:true,outputHasTargetNormals:false,normalLimitation:'New facial targets provide POSITION deltas only, matching source target convention; no per-target NORMAL morphs are supplied.'},elapsedMs:Math.round(performance.now()-started)};
writeFileSync(path.join(here,'authored-expression-bake-report.json'),`${JSON.stringify(report,null,2)}\n`);
console.log(JSON.stringify({output:report.output,elapsedMs:report.elapsedMs,mapping:report.mapping,blinkApertureMeters:report.blinkApertureMeters,jawOpen:report.jawOpen,meshTargetRouting:report.meshTargetRouting},null,2));
