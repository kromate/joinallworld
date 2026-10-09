import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const bodyPath = path.join(repo, 'evidence/graphics-loop/authored-character-spike-v1/parametric-base-expressive.glb');
const outfitPath = path.join(here, 'authored-clothing/out/male_casualsuit01.glb');
const hideMapPath = path.join(here, 'authored-clothing/out/body-hide-map.json');
const pins = {
  body: '0152129ce2c6022911747f9d7a6df3fdb72a9e6e1bea73db414da1cb8f483077',
  outfit: '1f8d4fd4b867785226a9c057562289381ae071cf5acbcca248133a3216ae476f',
  hideMap: 'dbe0c82a3e31da4e6ce37f4f1d9dc8611143c7c9e6dbef72ffea8d281aebe099',
  sourceObj: '001921d237e408c35103720d046aa37f9c5512db1a179a5ede6a065cd504ba89',
};
const sourceObjUrl = 'https://raw.githubusercontent.com/s20220526/makehuman-assets/8cf9645b975a98eea056b140df11a1d278da0d10/base/clothes/male_casualsuit01/male_casualsuit01.obj';
const legBones = new Set(['leftupleg', 'rightupleg', 'leftleg', 'rightleg', 'leftfoot', 'rightfoot', 'lefttoebase', 'righttoebase']);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function parseGlb(bytes, label) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert(view.getUint32(0, true) === 0x46546c67 && view.getUint32(4, true) === 2, `${label} is not GLB v2`);
  let json, binary;
  for (let offset = 12; offset < bytes.byteLength;) {
    const length = view.getUint32(offset, true);
    const kind = view.getUint32(offset + 4, true);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (kind === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk));
    else if (kind === 0x004e4942) binary = chunk;
    offset += length + 8;
  }
  assert(json && binary, `${label} is missing JSON or BIN chunk`);
  return { json, binary };
}

function accessor(glb, accessorIndex) {
  const descriptor = glb.json.accessors[accessorIndex];
  const bufferView = glb.json.bufferViews[descriptor.bufferView];
  assert(!descriptor.sparse && !bufferView.extensions, 'audit expects direct, uncompressed accessors');
  const component = {
    5121: { bytes: 1, read: (view, offset) => view.getUint8(offset) },
    5123: { bytes: 2, read: (view, offset) => view.getUint16(offset, true) },
    5125: { bytes: 4, read: (view, offset) => view.getUint32(offset, true) },
    5126: { bytes: 4, read: (view, offset) => view.getFloat32(offset, true) },
  }[descriptor.componentType];
  const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[descriptor.type];
  assert(component && width, `unsupported accessor ${descriptor.name ?? accessorIndex}`);
  const stride = bufferView.byteStride ?? component.bytes * width;
  const start = bufferView.byteOffset + (descriptor.byteOffset ?? 0);
  const view = new DataView(glb.binary.buffer, glb.binary.byteOffset, glb.binary.byteLength);
  return Array.from({ length: descriptor.count }, (_, row) => Array.from({ length: width }, (_, lane) =>
    component.read(view, start + row * stride + lane * component.bytes)));
}

function nodeTransform(node) {
  return {
    translation: node.translation ?? [0, 0, 0],
    rotation: node.rotation ?? [0, 0, 0, 1],
    scale: node.scale ?? [1, 1, 1],
  };
}

function normalizeBoneName(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^mixamorig/, '');
}

function parseSourceObj(text) {
  const positions = [];
  const faces = [];
  const faceGroups = new Map();
  const lineTags = { groups: [], materials: [] };
  let group = '';
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('v ')) positions.push(line.trim().split(/\s+/).slice(1, 4).map(Number));
    else if (line.startsWith('g ')) {
      group = line.trim().split(/\s+/)[1] ?? '';
      lineTags.groups.push(group);
    } else if (line.startsWith('usemtl ')) lineTags.materials.push(line.trim().split(/\s+/)[1]);
    else if (line.startsWith('f ')) {
      const vertices = line.trim().split(/\s+/).slice(1).map((corner) => Number(corner.split('/')[0]) - 1);
      faces.push(vertices);
      faceGroups.set(group, (faceGroups.get(group) ?? 0) + 1);
    }
  }
  return { positionCount: positions.length, faces, faceGroups: Object.fromEntries(faceGroups), lineTags };
}

function sourceEdgeComponents(faces) {
  const parent = Array.from({ length: faces.length }, (_, index) => index);
  const find = (value) => {
    let node = value;
    while (parent[node] !== node) {
      parent[node] = parent[parent[node]];
      node = parent[node];
    }
    return node;
  };
  const union = (a, b) => {
    a = find(a); b = find(b);
    if (a !== b) parent[b] = a;
  };
  const edgeFaces = new Map();
  for (let face = 0; face < faces.length; face++) {
    const vertices = faces[face];
    for (let corner = 0; corner < vertices.length; corner++) {
      const a = vertices[corner], b = vertices[(corner + 1) % vertices.length];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const adjacent = edgeFaces.get(key) ?? [];
      adjacent.push(face);
      edgeFaces.set(key, adjacent);
    }
  }
  for (const adjacent of edgeFaces.values()) for (let i = 1; i < adjacent.length; i++) union(adjacent[0], adjacent[i]);
  const components = new Map();
  for (let face = 0; face < faces.length; face++) {
    const root = find(face);
    components.set(root, (components.get(root) ?? 0) + 1);
  }
  return {
    faceCount: faces.length,
    componentFaceCounts: [...components.values()].sort((a, b) => b - a),
    boundaryEdgeCount: [...edgeFaces.values()].filter((adjacent) => adjacent.length === 1).length,
    nonManifoldEdgeCount: [...edgeFaces.values()].filter((adjacent) => adjacent.length > 2).length,
  };
}

function categorizeSplit(glb, jointNames, rule) {
  const primitive = glb.json.meshes[0].primitives[0];
  const position = accessor(glb, primitive.attributes.POSITION);
  const indices = accessor(glb, primitive.indices).flat();
  const skinJoints = accessor(glb, primitive.attributes.JOINTS_0);
  const skinWeights = accessor(glb, primitive.attributes.WEIGHTS_0);
  const sourceVertices = accessor(glb, primitive.attributes._MH_SOURCE_VERTEX).map((row) => row[0]);
  const categories = [];
  const triangleY = [];
  for (let triangle = 0; triangle < indices.length / 3; triangle++) {
    const ids = indices.slice(triangle * 3, triangle * 3 + 3);
    const y = ids.reduce((sum, id) => sum + position[id][1], 0) / 3;
    let legWeight = 0;
    for (const id of ids) {
      for (let lane = 0; lane < 4; lane++) {
        const bone = normalizeBoneName(jointNames[skinJoints[id][lane]] ?? '');
        if (legBones.has(bone)) legWeight += skinWeights[id][lane] / 3;
      }
    }
    categories.push(rule === 'y-only' ? (y < 0.91 ? 'trousers' : 'shirt')
      : (y < 0.91 && legWeight >= 0.12 ? 'trousers' : 'shirt'));
    triangleY.push(y);
  }
  const firstPositionBySource = new Map();
  for (let vertex = 0; vertex < sourceVertices.length; vertex++) {
    if (!firstPositionBySource.has(sourceVertices[vertex])) firstPositionBySource.set(sourceVertices[vertex], position[vertex][1]);
  }
  const edgeFaces = new Map();
  for (let triangle = 0; triangle < categories.length; triangle++) {
    const outputIds = indices.slice(triangle * 3, triangle * 3 + 3);
    const sourceIds = outputIds.map((vertex) => sourceVertices[vertex]);
    for (const [a, b] of [[sourceIds[0], sourceIds[1]], [sourceIds[1], sourceIds[2]], [sourceIds[2], sourceIds[0]]]) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const rows = edgeFaces.get(key) ?? [];
      rows.push(triangle);
      edgeFaces.set(key, rows);
    }
  }
  const transitionY = [];
  const overfullEdges = [];
  for (const [key, adjacent] of edgeFaces) {
    if (adjacent.length > 2) overfullEdges.push({ key, adjacentCount: adjacent.length });
    if (adjacent.length !== 2 || categories[adjacent[0]] === categories[adjacent[1]]) continue;
    const [a, b] = key.split(':').map(Number);
    transitionY.push((firstPositionBySource.get(a) + firstPositionBySource.get(b)) / 2);
  }
  const bins = new Map();
  for (const y of transitionY) bins.set(Math.round(y * 100), (bins.get(Math.round(y * 100)) ?? 0) + 1);
  const categoriesCount = categories.reduce((counts, category) => ({ ...counts, [category]: (counts[category] ?? 0) + 1 }), {});
  return {
    rule,
    triangles: categories.length,
    categories: categoriesCount,
    transitionEdges: transitionY.length,
    transitionYMetres: transitionY.length ? { min: Math.min(...transitionY), max: Math.max(...transitionY), span: Math.max(...transitionY) - Math.min(...transitionY) } : null,
    distinctOneCmBins: bins.size,
    oneCmBins: Object.fromEntries([...bins.entries()].sort((a, b) => a[0] - b[0])),
    canonicalEdgeIncidenceAboveTwo: overfullEdges.length,
  };
}

const [bodyBytes, outfitBytes, hideBytes] = await Promise.all([
  readFile(bodyPath), readFile(outfitPath), readFile(hideMapPath),
]);
assert(sha(bodyBytes) === pins.body, 'body GLB pin mismatch');
assert(sha(outfitBytes) === pins.outfit, 'outfit GLB pin mismatch');
assert(sha(hideBytes) === pins.hideMap, 'hide-map pin mismatch');
const response = await fetch(sourceObjUrl, { signal: AbortSignal.timeout(15_000) });
assert(response.ok, `pinned source OBJ fetch failed: ${response.status}`);
const sourceObjBytes = new Uint8Array(await response.arrayBuffer());
assert(sourceObjBytes.byteLength === 699_545 && sha(sourceObjBytes) === pins.sourceObj, 'source OBJ pin mismatch');
const sourceText = new TextDecoder().decode(sourceObjBytes);
const sourceObj = parseSourceObj(sourceText);
const sourceTopology = sourceEdgeComponents(sourceObj.faces);
const body = parseGlb(bodyBytes, 'body GLB');
const outfit = parseGlb(outfitBytes, 'outfit GLB');
const bodyNode = body.json.nodes.find((node) => node.name === 'Body');
const outfitNode = outfit.json.nodes.find((node) => node.name === 'male_casualsuit01');
assert(bodyNode && outfitNode, 'expected body and outfit mesh nodes are present');
const outfitExtras = outfit.json.meshes[0].extras;
const splitWithJointAndHeight = categorizeSplit(outfit, outfitExtras.jointNames, 'height-and-leg-weight');
const splitByHeightOnly = categorizeSplit(outfit, outfitExtras.jointNames, 'y-only');
const output = {
  pins,
  bytes: { body: bodyBytes.byteLength, outfit: outfitBytes.byteLength, hideMap: hideBytes.byteLength, sourceObj: sourceObjBytes.byteLength },
  body: {
    bodyNodeTransform: nodeTransform(bodyNode),
    skinJointCount: body.json.skins?.[0]?.joints?.length ?? 0,
    positionBounds: body.json.accessors[body.json.meshes[bodyNode.mesh].primitives[0].attributes.POSITION].min.concat(
      body.json.accessors[body.json.meshes[bodyNode.mesh].primitives[0].attributes.POSITION].max),
  },
  outfit: {
    outfitNodeTransform: nodeTransform(outfitNode),
    jointCount: outfitExtras.jointNames.length,
    jointNameOrderMatchesHideMap: JSON.stringify(outfitExtras.jointNames) === JSON.stringify(JSON.parse(new TextDecoder().decode(hideBytes)).weights.jointNamesOrder),
    groups: outfit.json.meshes[0].primitives[0].groups ?? [],
    sourceTriangleCount: outfit.json.accessors[outfit.json.meshes[0].primitives[0].indices].count / 3,
    positionBounds: outfit.json.accessors[outfit.json.meshes[0].primitives[0].attributes.POSITION].min.concat(
      outfit.json.accessors[outfit.json.meshes[0].primitives[0].attributes.POSITION].max),
    meshNodeTransformsEqual: JSON.stringify(nodeTransform(bodyNode)) === JSON.stringify(nodeTransform(outfitNode)),
  },
  sourceObj: {
    positions: sourceObj.positionCount,
    faces: sourceTopology.faceCount,
    uniqueGroups: [...new Set(sourceObj.lineTags.groups)],
    useMaterialTags: [...new Set(sourceObj.lineTags.materials)],
    sourceFaceGroups: sourceObj.faceGroups,
    edgeConnectedComponentFaceCounts: sourceTopology.componentFaceCounts,
    boundaryEdgeCount: sourceTopology.boundaryEdgeCount,
    nonManifoldEdgeCount: sourceTopology.nonManifoldEdgeCount,
  },
  splitComparison: { currentV6Rule: splitWithJointAndHeight, heightOnlyControl: splitByHeightOnly },
  caveat: 'CPU source/topology audit only. It does not measure rendered garment fit, rest-skin overlap, or animated contact. The height-only split is a diagnostic control, not an accepted implementation.',
};
assert(output.outfit.jointCount === 52 && output.outfit.jointNameOrderMatchesHideMap, 'outfit joint order differs from the pinned source order');
assert(sourceTopology.componentFaceCounts.length === 1 && Object.keys(sourceObj.faceGroups).length === 1
  && sourceObj.faceGroups[''] === 8_336 && sourceObj.lineTags.groups.length === 0 && sourceObj.lineTags.materials.length === 0,
'unexpected authored OBJ material/group topology');
console.log(JSON.stringify(output, null, 2));
