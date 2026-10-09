import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(root, '../../..');
const authoredPath = path.join(repoRoot, 'evidence/graphics-loop/authored-head-spike-v1/downloaded-37934994451/authored-face-37934994451/generated/expressive-head-lod.glb');
const bodyPaths = {
  male: path.join(repoRoot, 'src/scene/body/assets/base-body-male.glb'),
  female: path.join(repoRoot, 'src/scene/body/assets/base-body-female.glb'),
};
const reportPath = path.join(root, 'fit-report.json');
const HEAD_WEIGHT_MIN = 0.25;
const SKIN_REGION_MIN = 0.45;
const HAIR_REGION_MIN = 0.45;
const HAIR_REGION_MAX = 0.2;
const NECK_CLEARANCE = 0.015;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function glb(bytes) {
  assert(bytes.readUInt32LE(0) === 0x46546c67 && bytes.readUInt32LE(4) === 2, 'Expected a GLB v2 file');
  assert(bytes.readUInt32LE(8) === bytes.length, 'Invalid GLB total length');
  let json;
  let binary;
  for (let offset = 12; offset < bytes.length;) {
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    assert(offset + 8 + length <= bytes.length, 'Truncated GLB chunk');
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString('utf8').trimEnd());
    if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  assert(json && binary, 'GLB must contain JSON and BIN chunks');
  return { json, binary };
}

function decodeView(json, binary, viewIndex) {
  const view = json.bufferViews[viewIndex];
  assert(view, `Missing bufferView ${viewIndex}`);
  const compressed = view.extensions?.EXT_meshopt_compression;
  if (compressed) {
    const source = binary.subarray(compressed.byteOffset, compressed.byteOffset + compressed.byteLength);
    assert(source.length === compressed.byteLength, `Truncated meshopt data in view ${viewIndex}`);
    const output = new Uint8Array(compressed.count * compressed.byteStride);
    MeshoptDecoder.decodeGltfBuffer(output, compressed.count, compressed.byteStride, source, compressed.mode, compressed.filter);
    return output;
  }
  assert(view.buffer === 0, `Uncompressed view ${viewIndex} is not in the embedded buffer`);
  const start = view.byteOffset ?? 0;
  return binary.subarray(start, start + view.byteLength);
}

const componentBytes = new Map([[5120, 1], [5121, 1], [5122, 2], [5123, 2], [5125, 4], [5126, 4]]);
const typeSize = new Map([['SCALAR', 1], ['VEC2', 2], ['VEC3', 3], ['VEC4', 4], ['MAT4', 16]]);

function readAccessor(json, decodedViews, accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  assert(accessor && !accessor.sparse && Number.isInteger(accessor.bufferView), `Unsupported source accessor ${accessorIndex}`);
  const bytesPerComponent = componentBytes.get(accessor.componentType);
  const components = typeSize.get(accessor.type);
  assert(bytesPerComponent && components, `Unsupported component/type at accessor ${accessorIndex}`);
  const view = json.bufferViews[accessor.bufferView];
  const decoded = decodedViews.get(accessor.bufferView);
  const elementSize = bytesPerComponent * components;
  const stride = view.byteStride ?? elementSize;
  const base = accessor.byteOffset ?? 0;
  assert(decoded && base + Math.max(0, accessor.count - 1) * stride + (accessor.count ? elementSize : 0) <= decoded.length,
    `Accessor ${accessorIndex} exceeds decoded view`);
  const output = new ArrayBuffer(accessor.count * elementSize);
  const sourceView = new DataView(decoded.buffer, decoded.byteOffset, decoded.byteLength);
  const targetView = new DataView(output);
  for (let i = 0; i < accessor.count; i++) {
    for (let c = 0; c < components; c++) {
      const src = base + i * stride + c * bytesPerComponent;
      const dst = (i * components + c) * bytesPerComponent;
      if (accessor.componentType === 5120) targetView.setInt8(dst, sourceView.getInt8(src));
      else if (accessor.componentType === 5121) targetView.setUint8(dst, sourceView.getUint8(src));
      else if (accessor.componentType === 5122) targetView.setInt16(dst, sourceView.getInt16(src, true), true);
      else if (accessor.componentType === 5123) targetView.setUint16(dst, sourceView.getUint16(src, true), true);
      else if (accessor.componentType === 5125) targetView.setUint32(dst, sourceView.getUint32(src, true), true);
      else targetView.setFloat32(dst, sourceView.getFloat32(src, true), true);
    }
  }
  const Typed = accessor.componentType === 5120 ? Int8Array
    : accessor.componentType === 5121 ? Uint8Array
      : accessor.componentType === 5122 ? Int16Array
        : accessor.componentType === 5123 ? Uint16Array
          : accessor.componentType === 5125 ? Uint32Array : Float32Array;
  return { values: new Typed(output), accessor };
}

function boundsOf(points) {
  const box = new THREE.Box3().makeEmpty();
  for (const p of points) box.expandByPoint(p);
  assert(Number.isFinite(box.min.x) && box.max.x > box.min.x && box.max.y > box.min.y && box.max.z > box.min.z,
    'Expected nondegenerate anatomical bounds');
  return {
    min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new THREE.Vector3()).toArray(),
    center: box.getCenter(new THREE.Vector3()).toArray(),
  };
}

function composeNode(node) {
  const position = new THREE.Vector3(...(node.translation ?? [0, 0, 0]));
  const quaternion = new THREE.Quaternion(...(node.rotation ?? [0, 0, 0, 1]));
  const scale = new THREE.Vector3(...(node.scale ?? [1, 1, 1]));
  return new THREE.Matrix4().compose(position, quaternion, scale);
}

function decodeBody(key, bytes) {
  const { json, binary } = glb(bytes);
  const meshNodeIndex = json.nodes.findIndex((node) => Number.isInteger(node.mesh) && Number.isInteger(node.skin));
  const meshNode = json.nodes[meshNodeIndex];
  const primitive = json.meshes[meshNode.mesh].primitives[0];
  const skin = json.skins[meshNode.skin];
  const jointNames = skin.joints.map((nodeIndex) => json.nodes[nodeIndex]?.name ?? `bone-${nodeIndex}`);
  const headIndex = jointNames.indexOf('Head');
  const neckIndex = jointNames.indexOf('neck_01');
  assert(headIndex >= 0 && neckIndex >= 0, `${key}: missing Head or neck_01`);
  const required = ['POSITION', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0'];
  for (const semantic of required) assert(Number.isInteger(primitive.attributes[semantic]), `${key}: missing ${semantic}`);
  const neededViews = new Set([...Object.values(primitive.attributes), primitive.indices, skin.inverseBindMatrices].map((id) => json.accessors[id].bufferView));
  const decodedViews = new Map();
  for (const viewIndex of neededViews) decodedViews.set(viewIndex, decodeView(json, binary, viewIndex));
  const position = readAccessor(json, decodedViews, primitive.attributes.POSITION).values;
  const color = readAccessor(json, decodedViews, primitive.attributes.COLOR_0).values;
  const joints = readAccessor(json, decodedViews, primitive.attributes.JOINTS_0).values;
  const weights = readAccessor(json, decodedViews, primitive.attributes.WEIGHTS_0).values;
  const indices = readAccessor(json, decodedViews, primitive.indices).values;
  const inverseBinds = readAccessor(json, decodedViews, skin.inverseBindMatrices).values;
  const matrix = composeNode(meshNode);
  const headIndexOffset = headIndex * 16;
  const headInverseBind = new THREE.Matrix4().fromArray(Array.from(inverseBinds.slice(headIndexOffset, headIndexOffset + 16)));
  const neckIndexOffset = neckIndex * 16;
  const neckInverseBind = new THREE.Matrix4().fromArray(Array.from(inverseBinds.slice(neckIndexOffset, neckIndexOffset + 16)));
  const headRest = new THREE.Vector3().setFromMatrixPosition(headInverseBind.invert()).applyMatrix4(matrix);
  const neckRest = new THREE.Vector3().setFromMatrixPosition(neckInverseBind.invert()).applyMatrix4(matrix);
  const worldPoint = new THREE.Vector3();
  const points = [];
  const selected = new Uint8Array(position.length / 3);
  let headVertices = 0;
  let skinFitVertices = 0;
  for (let vertex = 0; vertex < position.length / 3; vertex++) {
    worldPoint.set(position[vertex * 3], position[vertex * 3 + 1], position[vertex * 3 + 2]).applyMatrix4(matrix);
    let headWeight = 0;
    for (let c = 0; c < 4; c++) if (joints[vertex * 4 + c] === headIndex) headWeight += weights[vertex * 4 + c] / (weights.constructor === Uint8Array ? 255 : 1);
    const isSkin = color[vertex * 4] / 255 >= SKIN_REGION_MIN
      && color[vertex * 4 + 3] / 255 <= HAIR_REGION_MAX;
    const isScalp = color[vertex * 4 + 3] / 255 >= HAIR_REGION_MIN;
    const isRemovedRegion = headWeight >= HEAD_WEIGHT_MIN
      && (isSkin || isScalp)
      && worldPoint.y >= neckRest.y - NECK_CLEARANCE;
    if (isRemovedRegion) {
      selected[vertex] = 1;
      headVertices++;
      if (isSkin) {
        skinFitVertices++;
        points.push(worldPoint.clone());
      }
    }
  }
  assert(points.length > 0, `${key}: no candidate face vertices`);
  const keptIndices = [];
  let removedTriangles = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i], b = indices[i + 1], c = indices[i + 2];
    if (selected[a] && selected[b] && selected[c]) removedTriangles++;
    else keptIndices.push(a, b, c);
  }

  return {
    key,
    keyHash: sha256(bytes),
    bodyBytes: bytes.length,
    bodyTriangles: indices.length / 3,
    headIndex,
    neckIndex,
    meshMatrix: matrix.toArray(),
    headRest: headRest.toArray(),
    neckRest: neckRest.toArray(),
    headNeckGap: headRest.y - neckRest.y,
    candidateVertexCount: headVertices,
    skinFitVertexCount: skinFitVertices,
    fitVertexCount: points.length,
    fitBounds: boundsOf(points),
    removedTriangles: removedTriangles,
    retainedTriangles: indices.length / 3 - removedTriangles,
    bodyTrianglesAfterHeadRegionRemoval: keptIndices.length / 3,
  };
}

function authoredBounds(bytes) {
  const { json, binary } = glb(bytes);
  const decodedViews = new Map();
  const vertexPoints = [];
  let sourceTriangles = 0;
  const targetMaterials = new Set(['VitSkin', 'VitMouth']);
  const meshNodeMatrixByMesh = new Map();
  for (const node of json.nodes) {
    if (!Number.isInteger(node.mesh)) continue;
    const matrix = composeNode(node);
    meshNodeMatrixByMesh.set(node.mesh, matrix);
  }
  for (const [meshIndex, mesh] of json.meshes.entries()) {
    const matrix = meshNodeMatrixByMesh.get(meshIndex) ?? new THREE.Matrix4();
    for (const primitive of mesh.primitives) {
      if (!targetMaterials.has(json.materials[primitive.material]?.name)) continue;
      const positionId = primitive.attributes.POSITION;
      const viewIndex = json.accessors[positionId].bufferView;
      if (!decodedViews.has(viewIndex)) decodedViews.set(viewIndex, decodeView(json, binary, viewIndex));
      const positions = readAccessor(json, decodedViews, positionId).values;
      for (let vertex = 0; vertex < positions.length / 3; vertex++) {
        vertexPoints.push(new THREE.Vector3(positions[vertex * 3], positions[vertex * 3 + 1], positions[vertex * 3 + 2]).applyMatrix4(matrix));
      }
      const indexId = primitive.indices;
      const indexView = json.accessors[indexId].bufferView;
      if (!decodedViews.has(indexView)) decodedViews.set(indexView, decodeView(json, binary, indexView));
      sourceTriangles += readAccessor(json, decodedViews, indexId).values.length / 3;
    }
  }
  assert(vertexPoints.length > 0, 'No VitSkin/VitMouth surface in authored head');
  return {
    hash: sha256(bytes), bytes: bytes.length, materials: [...targetMaterials],
    triangles: sourceTriangles, bounds: boundsOf(vertexPoints),
    nodeTransforms: json.nodes.filter((node) => Number.isInteger(node.mesh)).map((node) => ({ mesh: node.mesh, name: node.name, matrix: composeNode(node).toArray() })),
  };
}

await MeshoptDecoder.ready;
const authoredBytes = readFileSync(authoredPath);
const authored = authoredBounds(authoredBytes);
const bodies = {};
for (const key of ['male', 'female']) bodies[key] = decodeBody(key, readFileSync(bodyPaths[key]));

const fits = {};
for (const [key, body] of Object.entries(bodies)) {
  const sourceSize = authored.bounds.size;
  const targetSize = body.fitBounds.size;
  const scale = targetSize[1] / sourceSize[1];
  const tx = body.fitBounds.center[0] - authored.bounds.center[0] * scale;
  const ty = body.fitBounds.min[1] - authored.bounds.min[1] * scale;
  const tz = body.fitBounds.center[2] - authored.bounds.center[2] * scale;
  const transformed = {
    min: [authored.bounds.min[0] * scale + tx, authored.bounds.min[1] * scale + ty, authored.bounds.min[2] * scale + tz],
    max: [authored.bounds.max[0] * scale + tx, authored.bounds.max[1] * scale + ty, authored.bounds.max[2] * scale + tz],
  };
  fits[key] = {
    method: 'uniform scale to candidate skin-region height; align lower Y seam, horizontal center X and depth center Z',
    rootLocalToBodyParent: new THREE.Matrix4().makeScale(scale, scale, scale).premultiply(new THREE.Matrix4().makeTranslation(tx, ty, tz)).toArray(),
    uniformScale: scale,
    translation: [tx, ty, tz],
    targetBounds: body.fitBounds,
    transformedAuthoredBounds: transformed,
    sourceToTargetDimensionRatios: targetSize.map((value, i) => value / sourceSize[i]),
    note: 'This is a deterministic fit proposal from source bounds. It does not prove neck sealing, face alignment, or animation quality.'
  };
}

const report = {
  method: {
    candidatePredicate: `Head joint weight >= ${HEAD_WEIGHT_MIN}; remove skin vertices (region red >= ${SKIN_REGION_MIN}, alpha <= ${HAIR_REGION_MAX}) OR scalp vertices (region alpha >= ${HAIR_REGION_MIN}), with rest Y >= neck Y - ${NECK_CLEARANCE} m. Fit bounds use skin vertices only.`,
    removalRule: `Remove only triangles whose three vertices satisfy the head-weight, skin-or-scalp, and neck-Y conditions. Mixed head/neck and shoulder triangles stay on the original body; scalp removal does not expand head-fit bounds.`,
    neckClosure: 'The runtime adapter additionally stitches the lowest closed VitSkin boundary to the largest retained-body cut loop with a 4-ring skinned connector. It welds body seam endpoints by transformed position at 1e-6 m tolerance while retaining source UV/joint samples, interpolates toward each resampled lower boundary vertex’s original four joint influences, and adds a 1.5 mm overlap into authored skin. Runtime metrics report selected loop sizes and connector triangle count; this report does not claim rendered seam acceptance.',
    important: 'These are source-rest bounds and index counts, not rendered head/neck seam proof. Lower-boundary filtering may leave overlap; the root full-body GPU test must check seams during motion.'
  },
  authored: {
    path: path.relative(repoRoot, authoredPath),
    sha256: authored.hash,
    bytes: authored.bytes,
    triangles: authored.triangles,
    bounds: authored.bounds,
    fitMaterials: authored.materials,
    nodeTransforms: authored.nodeTransforms,
  },
  bodies,
  fitProposals: fits,
};
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
