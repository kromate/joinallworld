import * as THREE from 'three';
import type { SkinnedBody } from '../../../src/scene/body/skinned.ts';

export type AuthoredFaceExpression = 'neutral' | 'smile' | 'grin' | 'talk' | 'blink';

export interface AuthoredHeadMetrics {
  readonly bodyKey: string;
  readonly sourceMeshes: number;
  readonly sourceExpressionMeshes: number;
  readonly sourceMorphNames: readonly string[];
  readonly sourceBounds: Readonly<{ min: readonly number[]; max: readonly number[]; size: readonly number[] }>;
  readonly bodyHeadBounds: Readonly<{ min: readonly number[]; max: readonly number[]; size: readonly number[] }>;
  readonly uniformScale: number;
  readonly sourceToBodyTranslation: readonly number[];
  readonly bodyTrianglesBefore: number;
  readonly bodyTrianglesRemoved: number;
  readonly bodyTrianglesAfter: number;
  readonly mixedRegionTriangles: number;
  readonly neckBridgeTriangles: number;
  readonly bodyCutBoundaryVertices: number;
  readonly authoredNeckBoundaryVertices: number;
  readonly neckBridgeHeadOverlapMetres: number;
  readonly authoredTriangles: number;
  readonly ownedMaterialClones: number;
  readonly sourceGeometryBytesReferenced: number;
  readonly expressionMorphNames: readonly string[];
}

export interface AuthoredHeadController {
  /** Bone-attached native authored-head coordinate frame. Add native-coordinate hair/accessories here. */
  readonly object: THREE.Group;
  readonly metrics: AuthoredHeadMetrics;
  setExpression(name: AuthoredFaceExpression, seconds: number): void;
  dispose(): void;
}

const HEAD_WEIGHT_MIN = 0.25;
const SKIN_REGION_MIN = 0.45;
const HAIR_REGION_MIN = 0.45;
const NECK_CLEARANCE_METRES = 0.015;
const REQUIRED_MORPHS = [
  'Happy',
  'Smile_Lips_Closed',
  'Jaw_Lower',
  'Eyes_Closed_Max',
  'Eyebrows_Raised_Left',
  'Eyebrows_Raised_Right',
] as const;

type Bounds = { min: THREE.Vector3; max: THREE.Vector3 };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Authored head fit: ${message}`);
}

function mergeBox(into: THREE.Box3, next: THREE.Box3): void {
  into.union(next);
}

function boxSummary(box: THREE.Box3): { min: readonly number[]; max: readonly number[]; size: readonly number[] } {
  assert(!box.isEmpty(), 'expected nonempty fit bounds');
  return Object.freeze({
    min: Object.freeze(box.min.toArray()),
    max: Object.freeze(box.max.toArray()),
    size: Object.freeze(box.getSize(new THREE.Vector3()).toArray()),
  });
}

function materialList(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function geometryForFitBounds(root: THREE.Group): { box: THREE.Box3; triangles: number; meshes: THREE.Mesh[] } {
  root.updateWorldMatrix(true, true);
  const inverseRoot = root.matrixWorld.clone().invert();
  const bounds = new THREE.Box3().makeEmpty();
  const selected: THREE.Mesh[] = [];
  let triangles = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry?.getAttribute('position')) return;
    const materials = materialList(mesh);
    if (!materials.some((material) => material.name === 'VitSkin' || material.name === 'VitMouth')) return;
    const geometry = mesh.geometry;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingBox) return;
    mesh.updateWorldMatrix(true, false);
    const toRoot = inverseRoot.clone().multiply(mesh.matrixWorld);
    const localBounds = geometry.boundingBox.clone().applyMatrix4(toRoot);
    mergeBox(bounds, localBounds);
    triangles += (geometry.index?.count ?? geometry.getAttribute('position').count) / 3;
    selected.push(mesh);
  });
  assert(selected.some((mesh) => materialList(mesh).some((material) => material.name === 'VitSkin')),
    'template has no VitSkin surface');
  assert(selected.some((mesh) => materialList(mesh).some((material) => material.name === 'VitMouth')),
    'template has no VitMouth surface');
  assert(!bounds.isEmpty(), 'template face bounds are empty');
  return { box: bounds, triangles, meshes: selected };
}

function bodyHeadRegion(bodyMesh: THREE.SkinnedMesh): {
  selected: Uint8Array;
  skinVertices: Uint8Array;
  bounds: THREE.Box3;
  headBone: THREE.Bone;
  headRestInParent: THREE.Matrix4;
  mixedTriangles: number;
} {
  const geometry = bodyMesh.geometry;
  const position = geometry.getAttribute('position');
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  const region = geometry.getAttribute('color');
  const index = geometry.index;
  assert(position?.itemSize === 3 && position.count > 0, 'body has no indexed positions');
  assert(index && index.count > 0 && index.count % 3 === 0, 'body needs indexed triangles');
  assert(skinIndex?.itemSize >= 4 && skinWeight?.itemSize >= 4, 'body is missing four-channel skinning');
  assert(region?.itemSize >= 4, 'body is missing its skin/hair region attribute');
  assert(bodyMesh.skeleton && bodyMesh.skeleton.bones.length > 0, 'body has no skeleton');

  const headIndex = bodyMesh.skeleton.bones.findIndex((bone) => bone.name === 'Head');
  const neckIndex = bodyMesh.skeleton.bones.findIndex((bone) => bone.name === 'neck_01');
  assert(headIndex >= 0 && neckIndex >= 0, 'body rig lacks Head or neck_01');
  const headBone = bodyMesh.skeleton.bones[headIndex]!;
  const inverseBind = bodyMesh.skeleton.boneInverses[headIndex];
  const neckInverseBind = bodyMesh.skeleton.boneInverses[neckIndex];
  assert(inverseBind && neckInverseBind, 'body rig has no bind matrices for its head/neck');
  bodyMesh.updateMatrix();
  const headRestInParent = bodyMesh.matrix.clone().multiply(inverseBind.clone().invert());
  const neckRest = new THREE.Vector3().setFromMatrixPosition(neckInverseBind.clone().invert()).applyMatrix4(bodyMesh.matrix);
  const thresholdY = neckRest.y - NECK_CLEARANCE_METRES;

  const selected = new Uint8Array(position.count);
  const skinVertices = new Uint8Array(position.count);
  const bounds = new THREE.Box3().makeEmpty();
  const point = new THREE.Vector3();
  for (let vertex = 0; vertex < position.count; vertex++) {
    let headWeight = 0;
    for (let channel = 0; channel < 4; channel++) {
      if (skinIndex.getComponent(vertex, channel) === headIndex) headWeight += skinWeight.getComponent(vertex, channel);
    }
    point.set(position.getX(vertex), position.getY(vertex), position.getZ(vertex)).applyMatrix4(bodyMesh.matrix);
    const skinVertex = region.getX(vertex) >= SKIN_REGION_MIN && region.getW(vertex) <= 0.2;
    const scalpVertex = region.getW(vertex) >= HAIR_REGION_MIN;
    if (headWeight < HEAD_WEIGHT_MIN || (!skinVertex && !scalpVertex) || point.y < thresholdY) continue;
    selected[vertex] = 1;
    if (skinVertex) skinVertices[vertex] = 1;
    // Scalp vertices are removed from the old body, but only skin determines the head fit bounds.
    if (skinVertex) bounds.expandByPoint(point);
  }
  assert(!bounds.isEmpty() && bounds.max.y > bounds.min.y, 'no body vertices match the authored skin/head region');

  const indexArray = index.array;
  const isRemoved = (triangleOffset: number): boolean => {
    const a = index.getX(triangleOffset);
    const b = index.getX(triangleOffset + 1);
    const c = index.getX(triangleOffset + 2);
    assert(a < selected.length && b < selected.length && c < selected.length, 'body index exceeds vertex count');
    return selected[a] === 1 && selected[b] === 1 && selected[c] === 1;
  };
  let mixedTriangles = 0;
  for (let offset = 0; offset < index.count; offset += 3) {
    const anyHead = selected[index.getX(offset)] === 1 || selected[index.getX(offset + 1)] === 1 || selected[index.getX(offset + 2)] === 1;
    if (anyHead && !isRemoved(offset)) mixedTriangles++;
  }
  assert(indexArray.length === index.count, 'unexpected interleaved body index');
  return { selected, skinVertices, bounds, headBone, headRestInParent, mixedTriangles };
}

type BoundaryVertex = { index: number; position: THREE.Vector3; uv: THREE.Vector2; jointWeights?: readonly (readonly [number, number])[] };

function closedLoops(edges: Iterable<readonly [number, number]>, vertices: (index: number) => BoundaryVertex): BoundaryVertex[][] {
  const adjacency = new Map<number, number[]>();
  for (const [a, b] of edges) {
    const aa = adjacency.get(a) ?? [];
    const bb = adjacency.get(b) ?? [];
    if (!aa.includes(b)) aa.push(b);
    if (!bb.includes(a)) bb.push(a);
    adjacency.set(a, aa);
    adjacency.set(b, bb);
  }
  const visited = new Set<number>();
  const loops: BoundaryVertex[][] = [];
  for (const start of adjacency.keys()) {
    if (visited.has(start)) continue;
    const component: number[] = [];
    const pending = [start];
    while (pending.length) {
      const current = pending.pop()!;
      if (visited.has(current)) continue;
      visited.add(current);
      component.push(current);
      for (const next of adjacency.get(current) ?? []) if (!visited.has(next)) pending.push(next);
    }
    if (component.length < 8 || component.some((index) => adjacency.get(index)?.length !== 2)) continue;
    const ordered = [component[0]!];
    let previous = -1;
    let current = ordered[0]!;
    while (true) {
      const neighbors = adjacency.get(current)!;
      const next = neighbors[0] === previous ? neighbors[1]! : neighbors[0]!;
      if (next === ordered[0]) break;
      if (ordered.includes(next) || ordered.length > component.length) break;
      ordered.push(next);
      previous = current;
      current = next;
    }
    if (ordered.length === component.length && adjacency.get(current)?.includes(ordered[0])) {
      loops.push(ordered.map(vertices));
    }
  }
  return loops;
}

function bodyCutLoop(bodyMesh: THREE.SkinnedMesh, selected: Uint8Array): BoundaryVertex[] {
  const geometry = bodyMesh.geometry;
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  const index = geometry.index;
  assert(index && uv?.itemSize >= 2 && skinIndex?.itemSize >= 4 && skinWeight?.itemSize >= 4,
    'body neck cut needs indexed UV and skin-weight geometry');
  const edges = new Set<string>();
  for (let offset = 0; offset < index.count; offset += 3) {
    const triangle = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
    const anySelected = triangle.some((vertex) => selected[vertex] === 1);
    const allSelected = triangle.every((vertex) => selected[vertex] === 1);
    if (!anySelected || allSelected) continue;
    for (let side = 0; side < 3; side++) {
      const a = triangle[side]!;
      const b = triangle[(side + 1) % 3]!;
      if (selected[a] !== 1 || selected[b] !== 1) continue;
      edges.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
  }
  const loops = closedLoops([...edges].map((key) => key.split(':').map(Number) as [number, number]), (vertex) => {
    const influences: Array<readonly [number, number]> = [];
    for (let channel = 0; channel < 4; channel++) {
      const weight = skinWeight.getComponent(vertex, channel);
      if (weight > 0) influences.push([skinIndex.getComponent(vertex, channel), weight]);
    }
    return {
      index: vertex,
      position: new THREE.Vector3(position.getX(vertex), position.getY(vertex), position.getZ(vertex)).applyMatrix4(bodyMesh.matrix),
      uv: new THREE.Vector2(uv.getX(vertex), uv.getY(vertex)),
      jointWeights: influences,
    };
  });
  assert(loops.length > 0, 'could not find a closed retained-body neck cut boundary');
  loops.sort((a, b) => b.length - a.length);
  return loops[0]!;
}

function authoredSkinBoundary(template: THREE.Group, sourceToBodyParent: THREE.Matrix4): BoundaryVertex[] {
  template.updateWorldMatrix(true, true);
  const inverseRoot = template.matrixWorld.clone().invert();
  const boundaryEdges = new Set<string>();
  const edgeCounts = new Map<string, number>();
  const data = new Map<number, BoundaryVertex>();
  let vertexId = 0;
  template.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || !materialList(mesh).some((material) => material.name === 'VitSkin')) return;
    const position = mesh.geometry.getAttribute('position');
    const uv = mesh.geometry.getAttribute('uv');
    const index = mesh.geometry.index;
    assert(position?.itemSize === 3 && uv?.itemSize >= 2 && index, 'authored skin boundary needs indexed positions and UVs');
    mesh.updateWorldMatrix(true, false);
    const toTarget = sourceToBodyParent.clone().multiply(inverseRoot).multiply(mesh.matrixWorld);
    const base = vertexId;
    for (let vertex = 0; vertex < position.count; vertex++) {
      data.set(base + vertex, {
        index: base + vertex,
        position: new THREE.Vector3(position.getX(vertex), position.getY(vertex), position.getZ(vertex)).applyMatrix4(toTarget),
        uv: new THREE.Vector2(uv.getX(vertex), uv.getY(vertex)),
      });
    }
    const groups = mesh.geometry.groups.length ? mesh.geometry.groups : [{ start: 0, count: index.count, materialIndex: 0 }];
    const materialArray = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const group of groups) {
      if (materialArray[group.materialIndex ?? 0]?.name !== 'VitSkin') continue;
      for (let offset = group.start; offset < group.start + group.count; offset += 3) {
        const tri = [base + index.getX(offset), base + index.getX(offset + 1), base + index.getX(offset + 2)];
        for (let side = 0; side < 3; side++) {
          const a = tri[side]!, b = tri[(side + 1) % 3]!;
          const key = a < b ? `${a}:${b}` : `${b}:${a}`;
          edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
        }
      }
    }
    vertexId += position.count;
  });
  for (const [edge, count] of edgeCounts) if (count === 1) boundaryEdges.add(edge);
  const loops = closedLoops([...boundaryEdges].map((key) => key.split(':').map(Number) as [number, number]), (vertex) => data.get(vertex)!);
  assert(loops.length > 0, 'could not find a closed authored VitSkin boundary');
  loops.sort((a, b) => {
    const meanY = (loop: BoundaryVertex[]) => loop.reduce((sum, vertex) => sum + vertex.position.y, 0) / loop.length;
    return meanY(a) - meanY(b);
  });
  return loops[0]!;
}

function ringSamples(loop: BoundaryVertex[], center: THREE.Vector3, count: number): BoundaryVertex[] {
  const sorted = loop.map((vertex) => ({
    vertex,
    angle: (Math.atan2(vertex.position.z - center.z, vertex.position.x - center.x) + Math.PI * 2) % (Math.PI * 2),
  })).sort((a, b) => a.angle - b.angle);
  const result: BoundaryVertex[] = [];
  for (let sample = 0; sample < count; sample++) {
    const angle = sample * Math.PI * 2 / count;
    let nextIndex = sorted.findIndex((item) => item.angle >= angle);
    if (nextIndex < 0) nextIndex = 0;
    const previousIndex = (nextIndex + sorted.length - 1) % sorted.length;
    const previous = sorted[previousIndex]!;
    const next = sorted[nextIndex]!;
    let a = previous.angle;
    let b = next.angle;
    let tAngle = angle;
    if (nextIndex === 0) b += Math.PI * 2;
    if (tAngle < a) tAngle += Math.PI * 2;
    const t = b === a ? 0 : (tAngle - a) / (b - a);
    const jointWeights = new Map<number, number>();
    for (const [joint, weight] of previous.vertex.jointWeights ?? []) jointWeights.set(joint, (jointWeights.get(joint) ?? 0) + weight * (1 - t));
    for (const [joint, weight] of next.vertex.jointWeights ?? []) jointWeights.set(joint, (jointWeights.get(joint) ?? 0) + weight * t);
    result.push({
      index: sample,
      position: previous.vertex.position.clone().lerp(next.vertex.position, t),
      uv: previous.vertex.uv.clone().lerp(next.vertex.uv, t),
      jointWeights: jointWeights.size ? [...jointWeights.entries()] : undefined,
    });
  }
  return result;
}

function makeNeckBridge(
  bodyMesh: THREE.SkinnedMesh,
  bodyLoop: BoundaryVertex[],
  authoredLoop: BoundaryVertex[],
): { mesh: THREE.SkinnedMesh; triangles: number; headOverlap: number } {
  const bodyGeometry = bodyMesh.geometry;
  const skinIndex = bodyGeometry.getAttribute('skinIndex');
  const skinWeight = bodyGeometry.getAttribute('skinWeight');
  const uv = bodyGeometry.getAttribute('uv');
  const index = bodyGeometry.index;
  assert(index && skinIndex?.itemSize >= 4 && skinWeight?.itemSize >= 4 && uv?.itemSize >= 2,
    'neck bridge needs source skinning and UV attributes');
  assert(!Array.isArray(bodyMesh.material), 'neck bridge expects the shipped single body material');
  const headIndex = bodyMesh.skeleton.bones.findIndex((bone) => bone.name === 'Head');
  const neckIndex = bodyMesh.skeleton.bones.findIndex((bone) => bone.name === 'neck_01');
  assert(headIndex >= 0 && neckIndex >= 0, 'neck bridge requires Head and neck_01 joints');

  const center = bodyLoop.reduce((sum, vertex) => sum.add(vertex.position), new THREE.Vector3()).multiplyScalar(1 / bodyLoop.length);
  const samples = Math.max(32, Math.min(96, Math.ceil(Math.max(bodyLoop.length, authoredLoop.length) / 4) * 4));
  const bodyRing = ringSamples(bodyLoop, center, samples);
  const headRing = ringSamples(authoredLoop, center, samples);
  const ringCount = 4;
  const inverseMesh = bodyMesh.matrix.clone().invert();
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const joints: number[] = [];
  const weights: number[] = [];
  const indices: number[] = [];
  const headOverlap = 0.0015;
  for (let row = 0; row < ringCount; row++) {
    const t = row / (ringCount - 1);
    for (let sample = 0; sample < samples; sample++) {
      const top = headRing[sample]!;
      const bottom = bodyRing[sample]!;
      const point = top.position.clone().lerp(bottom.position, t);
      point.y += (1 - t) * headOverlap;
      point.applyMatrix4(inverseMesh);
      positions.push(point.x, point.y, point.z);
      // Continue the original body neck's skin UV and skin-region channel through the connector.
      uvs.push(bottom.uv.x, bottom.uv.y);
      colors.push(1, 0, 0, 0);
      const blended = new Map<number, number>([[headIndex, 1 - t]]);
      for (const [joint, weight] of bottom.jointWeights ?? [[neckIndex, 1] as const]) {
        blended.set(joint, (blended.get(joint) ?? 0) + weight * t);
      }
      const strongest = [...blended.entries()].filter(([, weight]) => weight > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const totalWeight = strongest.reduce((sum, [, weight]) => sum + weight, 0);
      assert(totalWeight > 0, 'neck bridge generated a vertex with no skin weights');
      for (let channel = 0; channel < 4; channel++) {
        const influence = strongest[channel];
        joints.push(influence?.[0] ?? 0);
        weights.push(influence ? influence[1] / totalWeight : 0);
      }
    }
  }
  for (let row = 0; row < ringCount - 1; row++) {
    for (let sample = 0; sample < samples; sample++) {
      const next = (sample + 1) % samples;
      const a = row * samples + sample;
      const b = row * samples + next;
      const c = (row + 1) * samples + sample;
      const d = (row + 1) * samples + next;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4));
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const bridge = new THREE.SkinnedMesh(geometry, bodyMesh.material);
  bridge.name = 'authored-head-neck-bridge';
  bridge.frustumCulled = false;
  bridge.matrixAutoUpdate = false;
  bridge.matrix.copy(bodyMesh.matrix);
  bridge.bindMode = bodyMesh.bindMode;
  bridge.bind(bodyMesh.skeleton, bodyMesh.bindMatrix);
  return { mesh: bridge, triangles: indices.length / 3, headOverlap };
}

function replacementIndex(bodyMesh: THREE.SkinnedMesh, selected: Uint8Array): {
  index: THREE.BufferAttribute;
  groups: Array<{ start: number; count: number; materialIndex: number }>;
  drawCount: number;
  removedTriangles: number;
  bodyTrianglesBefore: number;
  bodyTrianglesAfter: number;
} {
  const source = bodyMesh.geometry;
  const sourceIndex = source.index;
  assert(sourceIndex, 'body geometry has no index');
  const count = sourceIndex.count;
  assert(count % 3 === 0, 'body index does not contain whole triangles');
  const draw = source.drawRange;
  assert(draw.start === 0 && (!Number.isFinite(draw.count) || draw.count >= count),
    'fit must run before a partial body draw range is installed');
  const hadGroups = source.groups.length > 0;
  const groups = hadGroups ? source.groups : [{ start: 0, count, materialIndex: 0 }];
  const coverage = new Uint8Array(count / 3);
  const output: number[] = [];
  const outputGroups: Array<{ start: number; count: number; materialIndex: number }> = [];
  let removedTriangles = 0;

  for (const group of groups) {
    assert(group.start % 3 === 0 && group.count % 3 === 0 && group.start + group.count <= count,
      'body material group is not triangle-aligned');
    const groupStart = output.length;
    for (let offset = group.start; offset < group.start + group.count; offset += 3) {
      const triangle = offset / 3;
      assert(coverage[triangle] === 0, 'body groups overlap');
      coverage[triangle] = 1;
      const a = sourceIndex.getX(offset);
      const b = sourceIndex.getX(offset + 1);
      const c = sourceIndex.getX(offset + 2);
      if (selected[a] === 1 && selected[b] === 1 && selected[c] === 1) {
        removedTriangles++;
        continue;
      }
      output.push(a, b, c);
    }
    if (output.length > groupStart) outputGroups.push({ start: groupStart, count: output.length - groupStart, materialIndex: group.materialIndex ?? 0 });
  }
  assert(coverage.every((value) => value === 1), 'body groups do not cover the complete source index');
  assert(removedTriangles > 0 && output.length >= 3, 'head filter did not produce a viable replacement');

  const indices = sourceIndex.array instanceof Uint32Array ? Uint32Array.from(output) : Uint16Array.from(output);
  return {
    index: new THREE.BufferAttribute(indices, 1),
    groups: hadGroups ? outputGroups : [],
    drawCount: indices.length,
    removedTriangles,
    bodyTrianglesBefore: count / 3,
    bodyTrianglesAfter: indices.length / 3,
  };
}

function cloneActorTemplate(template: THREE.Group): { root: THREE.Group; ownedMaterials: THREE.Material[]; expressionMeshes: THREE.Mesh[]; allMeshes: THREE.Mesh[] } {
  const root = template.clone(true);
  const ownedMaterials: THREE.Material[] = [];
  const expressionMeshes: THREE.Mesh[] = [];
  const allMeshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    allMeshes.push(mesh);
    const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const clonedMaterials = sourceMaterials.map((material) => {
      const clone = material.clone();
      ownedMaterials.push(clone);
      return clone;
    });
    mesh.material = Array.isArray(mesh.material) ? clonedMaterials : clonedMaterials[0]!;
    mesh.frustumCulled = false;
    if (mesh.morphTargetDictionary && mesh.morphTargetInfluences) expressionMeshes.push(mesh);
  });
  assert(allMeshes.length > 0, 'template has no mesh objects');
  assert(expressionMeshes.length >= 2, 'template must have independent skinned face and mouth morph meshes');
  for (const name of REQUIRED_MORPHS) {
    assert(expressionMeshes.some((mesh) => Number.isInteger(mesh.morphTargetDictionary?.[name])),
      `template is missing facial target ${name}`);
  }
  return { root, ownedMaterials, expressionMeshes, allMeshes };
}

function geometryArrayBytes(root: THREE.Group): number {
  const arrays = new Set<ArrayBufferView>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const collect = (attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined) => {
      if (!attribute) return;
      arrays.add(attribute instanceof THREE.InterleavedBufferAttribute ? attribute.data.array : attribute.array);
    };
    for (const attribute of Object.values(mesh.geometry.attributes)) collect(attribute);
    collect(mesh.geometry.index ?? undefined);
    for (const attributes of Object.values(mesh.geometry.morphAttributes)) {
      for (const attribute of attributes) collect(attribute);
    }
  });
  return [...arrays].reduce((sum, array) => sum + array.byteLength, 0);
}

function setMorphWeight(mesh: THREE.Mesh, target: typeof REQUIRED_MORPHS[number], value: number): void {
  const dictionary = mesh.morphTargetDictionary;
  const influences = mesh.morphTargetInfluences;
  if (!dictionary || !influences) return;
  const index = dictionary[target];
  if (Number.isInteger(index) && index! >= 0 && index! < influences.length) influences[index!] = value;
}

/**
 * Attach a per-actor clone of the authored head to the production Head bone and hide only the old face triangles.
 * The body geometry is already an actor-private clone in loadBody; this adapter replaces only its index attribute,
 * preserving geometry identity for the existing appearance controller. Call before constructing the wardrobe overlay.
 * The returned object is a
 * child of Head whose local coordinates are the authored asset's native root coordinates; native hair can be added
 * to `controller.object`. Body/face region selection uses the same skin/head thresholds as appearance.ts.
 */
export function attachAuthoredHead(body: Pick<SkinnedBody, 'object' | 'key'>, template: THREE.Group): AuthoredHeadController {
  const bodyMeshCandidates: THREE.SkinnedMesh[] = [];
  body.object.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) bodyMeshCandidates.push(mesh);
  });
  assert(bodyMeshCandidates.length === 1, 'expected exactly one shipped body SkinnedMesh inside body.object');
  const bodyMesh = bodyMeshCandidates[0]!;
  const faceBounds = geometryForFitBounds(template);
  const region = bodyHeadRegion(bodyMesh);
  if (template.matrixAutoUpdate) template.updateMatrix();

  const sourceSize = faceBounds.box.getSize(new THREE.Vector3());
  const targetSize = region.bounds.getSize(new THREE.Vector3());
  const uniformScale = targetSize.y / sourceSize.y;
  assert(Number.isFinite(uniformScale) && uniformScale > 0.2 && uniformScale < 2,
    `implausible authored head scale ${uniformScale}`);
  const sourceCenter = faceBounds.box.getCenter(new THREE.Vector3());
  const targetCenter = region.bounds.getCenter(new THREE.Vector3());
  const fitTranslation = new THREE.Vector3(
    targetCenter.x - sourceCenter.x * uniformScale,
    region.bounds.min.y - faceBounds.box.min.y * uniformScale,
    targetCenter.z - sourceCenter.z * uniformScale,
  );
  const sourceToBodyParent = new THREE.Matrix4()
    .makeScale(uniformScale, uniformScale, uniformScale)
    .premultiply(new THREE.Matrix4().makeTranslation(fitTranslation.x, fitTranslation.y, fitTranslation.z));
  const boneRestInverse = region.headRestInParent.clone().invert();
  const attachmentMatrix = boneRestInverse.multiply(sourceToBodyParent);
  assert(attachmentMatrix.elements.every(Number.isFinite), 'computed attachment transform is nonfinite');

  const bodyBoundary = bodyCutLoop(bodyMesh, region.selected);
  const authoredBoundary = authoredSkinBoundary(template, sourceToBodyParent);
  const neckBridge = makeNeckBridge(bodyMesh, bodyBoundary, authoredBoundary);
  assert(bodyMesh.parent, 'body mesh has no parent for the skinned neck bridge');

  const originalGeometry = bodyMesh.geometry;
  const originalIndex = originalGeometry.index;
  assert(originalIndex, 'body geometry has no source index');
  const originalGroups = originalGeometry.groups.map((group) => ({ ...group }));
  const originalDrawRange = { ...originalGeometry.drawRange };
  const filtered = replacementIndex(bodyMesh, region.selected);
  const cloned = cloneActorTemplate(template);
  // The public frame exposes template-root coordinates. Cancel the root transform only on
  // this actor clone; child mesh transforms and source geometry remain unchanged.
  cloned.root.position.set(0, 0, 0);
  cloned.root.quaternion.identity();
  cloned.root.scale.set(1, 1, 1);
  cloned.root.matrix.identity();
  cloned.root.matrixAutoUpdate = false;
  const attachment = new THREE.Group();
  attachment.name = 'authored-head-native-frame';
  attachment.matrixAutoUpdate = false;
  attachment.matrix.copy(attachmentMatrix);
  attachment.add(cloned.root);
  const oldFacialDetail = body.object.getObjectByName('avatar-facial-detail');
  const previousFacialDetailVisible = oldFacialDetail?.visible;
  let disposed = false;

  // Commit only after all inputs, geometry, and per-actor material clones validated.
  originalGeometry.setIndex(filtered.index);
  originalGeometry.clearGroups();
  for (const group of filtered.groups) originalGeometry.addGroup(group.start, group.count, group.materialIndex);
  originalGeometry.setDrawRange(0, filtered.drawCount);
  region.headBone.add(attachment);
  bodyMesh.parent.add(neckBridge.mesh);
  if (oldFacialDetail) oldFacialDetail.visible = false;
  attachment.updateMatrixWorld(true);

  const expressionMeshes = cloned.expressionMeshes;
  const setExpression = (name: AuthoredFaceExpression, seconds: number) => {
    if (disposed) return;
    const time = Number.isFinite(seconds) ? seconds : 0;
    let happy = 0, closedSmile = 0, jaw = 0, eyesClosed = 0, browLeft = 0, browRight = 0;
    switch (name) {
      case 'smile': happy = 0.45; closedSmile = 0.8; browLeft = 0.12; browRight = 0.12; break;
      case 'grin': happy = 0.9; jaw = 0.32; browLeft = 0.22; browRight = 0.22; break;
      case 'talk': happy = 0.18; jaw = 0.16 + 0.3 * (0.5 + 0.5 * Math.sin(Math.max(0, time) * Math.PI * 4.1)); break;
      case 'blink': eyesClosed = 1; break;
    }
    for (const mesh of expressionMeshes) {
      const dictionary = mesh.morphTargetDictionary;
      const influences = mesh.morphTargetInfluences;
      if (!dictionary || !influences) continue;
      influences.fill(0);
      setMorphWeight(mesh, 'Happy', happy);
      setMorphWeight(mesh, 'Smile_Lips_Closed', closedSmile);
      setMorphWeight(mesh, 'Jaw_Lower', jaw);
      setMorphWeight(mesh, 'Eyes_Closed_Max', eyesClosed);
      setMorphWeight(mesh, 'Eyebrows_Raised_Left', browLeft);
      setMorphWeight(mesh, 'Eyebrows_Raised_Right', browRight);
    }
  };
  setExpression('neutral', 0);

  const metrics: AuthoredHeadMetrics = Object.freeze({
    bodyKey: body.key,
    sourceMeshes: cloned.allMeshes.length,
    sourceExpressionMeshes: expressionMeshes.length,
    sourceMorphNames: Object.freeze([...REQUIRED_MORPHS]),
    sourceBounds: boxSummary(faceBounds.box),
    bodyHeadBounds: boxSummary(region.bounds),
    uniformScale,
    sourceToBodyTranslation: Object.freeze(fitTranslation.toArray()),
    bodyTrianglesBefore: filtered.bodyTrianglesBefore,
    bodyTrianglesRemoved: filtered.removedTriangles,
    bodyTrianglesAfter: filtered.bodyTrianglesAfter,
    mixedRegionTriangles: region.mixedTriangles,
    neckBridgeTriangles: neckBridge.triangles,
    bodyCutBoundaryVertices: bodyBoundary.length,
    authoredNeckBoundaryVertices: authoredBoundary.length,
    neckBridgeHeadOverlapMetres: neckBridge.headOverlap,
    authoredTriangles: faceBounds.triangles,
    ownedMaterialClones: cloned.ownedMaterials.length,
    sourceGeometryBytesReferenced: geometryArrayBytes(cloned.root),
    expressionMorphNames: Object.freeze([...REQUIRED_MORPHS]),
  });

  return {
    object: attachment,
    metrics,
    setExpression,
    dispose() {
      if (disposed) return;
      disposed = true;
      attachment.removeFromParent();
      if (bodyMesh.geometry === originalGeometry && bodyMesh.geometry.index === filtered.index) {
        originalGeometry.setIndex(originalIndex);
        originalGeometry.clearGroups();
        for (const group of originalGroups) originalGeometry.addGroup(group.start, group.count, group.materialIndex);
        originalGeometry.setDrawRange(originalDrawRange.start, originalDrawRange.count);
      }
      neckBridge.mesh.removeFromParent();
      neckBridge.mesh.geometry.dispose();
      for (const material of cloned.ownedMaterials) material.dispose();
      if (oldFacialDetail && typeof previousFacialDetailVisible === 'boolean') oldFacialDetail.visible = previousFacialDetailVisible;
    },
  };
}
