import * as THREE from 'three';
import type { BodyTriangleHideSet } from '../body-mask-union.ts';

export interface TorsoClothingMaskOptions {
  readonly asset: string;
  readonly body: THREE.SkinnedMesh;
  readonly garment: THREE.SkinnedMesh;
  /** Must be the unmasked source Body geometry whose triangle IDs the hide set addresses. */
  readonly sourceGeometry?: THREE.BufferGeometry;
  readonly alreadyHiddenTriangleIds?: ReadonlySet<number>;
  /** Maximum inward distance from an exposed skin triangle to clothing behind that surface. */
  readonly maxPenetrationMetres?: number;
}

export interface TorsoClothingMaskResult {
  readonly hideSet: BodyTriangleHideSet;
  readonly metrics: Readonly<{
    sourceTriangles: number;
    alreadyHiddenTriangles: number;
    nonTorsoTriangles: number;
    testedTorsoTriangles: number;
    clothBehindSkinTriangles: number;
    maxPenetrationMetres: number;
    penetrationDepthsMetres: readonly number[];
    /** Triangle centroids in Body-local coordinates, useful for independent visual review. */
    sourceCentroids: readonly (readonly [number, number, number])[];
  }>;
}

const TORSO_JOINT = /^(spine|spine1|spine2|spine3|chest)$/;
const NECK_JOINT = /neck/;
const ARM_JOINT = /(clavicle|shoulder|upperarm|lowerarm|forearm|hand)/;

function invariant(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(`Torso clothing mask: ${message}`);
}

function normalizeJoint(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^mixamorig/, '');
}

function xyz(buffer: Float64Array, index: number, target = new THREE.Vector3()): THREE.Vector3 {
  const offset = index * 3;
  return target.set(buffer[offset]!, buffer[offset + 1]!, buffer[offset + 2]!);
}

function worldPositions(mesh: THREE.SkinnedMesh, geometry: THREE.BufferGeometry): Float64Array {
  const position = geometry.getAttribute('position');
  const values = new Float64Array(position.count * 3);
  const point = new THREE.Vector3();
  for (let vertex = 0; vertex < position.count; vertex++) {
    mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld);
    const offset = vertex * 3;
    values[offset] = point.x;
    values[offset + 1] = point.y;
    values[offset + 2] = point.z;
  }
  return values;
}

/**
 * Finds visible torso skin triangles that sit outside the actual posed garment.
 * A body triangle is hidden only when a ray cast inward from its exposed surface
 * intersects cloth within the configured depth. A V-neck/opening with no cloth
 * behind it therefore remains visible. This returns source triangle IDs only;
 * it does not mutate either mesh or install a geometry mask.
 */
export function createTorsoClothingHideSet(options: TorsoClothingMaskOptions): TorsoClothingMaskResult {
  const { body, garment } = options;
  const geometry = options.sourceGeometry ?? body.geometry;
  const index = geometry.getIndex();
  const position = geometry.getAttribute('position');
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');
  const garmentIndex = garment.geometry.getIndex();
  const garmentPosition = garment.geometry.getAttribute('position');
  const depthLimit = options.maxPenetrationMetres ?? 0.04;
  invariant(options.asset.trim().length > 0, 'asset name is required');
  invariant(body.isSkinnedMesh && garment.isSkinnedMesh, 'body and garment must be SkinnedMesh instances');
  invariant(body.skeleton === garment.skeleton, 'body and garment must use the same corrected actor skeleton');
  invariant(index && index.count % 3 === 0 && position && skinIndex && skinWeight, 'source Body geometry must be indexed and skinned');
  invariant(garmentIndex && garmentIndex.count % 3 === 0 && garmentPosition, 'garment geometry must be indexed');
  invariant(skinIndex.itemSize === 4 && skinWeight.itemSize === 4, 'source Body must use four joint influences');
  invariant(Number.isFinite(depthLimit) && depthLimit > 0 && depthLimit <= 0.08, 'penetration range must be in (0, 8cm]');
  invariant(body.skeleton === garment.skeleton, 'garment skeleton binding changed');
  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    invariant(body.geometry.getAttribute(name) === attribute, `Body current geometry does not share source ${name} attribute`);
  }
  for (const [name, attributes] of Object.entries(geometry.morphAttributes)) {
    invariant(body.geometry.morphAttributes[name]?.length === attributes.length
      && body.geometry.morphAttributes[name]?.every((attribute, index) => attribute === attributes[index]),
    `Body current geometry does not share source ${name} morph attributes`);
  }

  body.updateWorldMatrix(true, false);
  body.updateMatrixWorld(true);
  garment.updateWorldMatrix(true, false);
  garment.updateMatrixWorld(true);
  body.skeleton.update();
  const bodyPositions = worldPositions(body, geometry);
  const garmentPositions = worldPositions(garment, garment.geometry);
  const triangleCount = index.count / 3;
  const existing = options.alreadyHiddenTriangleIds ?? new Set<number>();
  const normalizedNames = body.skeleton.bones.map((bone) => normalizeJoint(bone.name));
  const torsoIndices = new Set<number>();
  const neckIndices = new Set<number>();
  const armIndices = new Set<number>();
  for (let joint = 0; joint < normalizedNames.length; joint++) {
    const name = normalizedNames[joint]!;
    if (TORSO_JOINT.test(name)) torsoIndices.add(joint);
    if (NECK_JOINT.test(name)) neckIndices.add(joint);
    if (ARM_JOINT.test(name)) armIndices.add(joint);
  }
  invariant(torsoIndices.size > 0, 'actor skeleton has no named spine/chest joints');

  const ray = new THREE.Ray();
  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const edgeA = new THREE.Vector3();
  const edgeB = new THREE.Vector3();
  const rootCenter = body.getWorldPosition(new THREE.Vector3());
  const intersection = new THREE.Vector3();
  const clothA = new THREE.Vector3();
  const clothB = new THREE.Vector3();
  const clothC = new THREE.Vector3();
  const cellSize = 0.08;
  const cells = new Map<string, number[]>();
  const cellKey = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const gridCell = (value: number) => Math.floor(value / cellSize);
  for (let triangle = 0; triangle < garmentIndex.count / 3; triangle++) {
    const offset = triangle * 3;
    xyz(garmentPositions, garmentIndex.getX(offset), clothA);
    xyz(garmentPositions, garmentIndex.getX(offset + 1), clothB);
    xyz(garmentPositions, garmentIndex.getX(offset + 2), clothC);
    const minX = gridCell(Math.min(clothA.x, clothB.x, clothC.x));
    const maxX = gridCell(Math.max(clothA.x, clothB.x, clothC.x));
    const minY = gridCell(Math.min(clothA.y, clothB.y, clothC.y));
    const maxY = gridCell(Math.max(clothA.y, clothB.y, clothC.y));
    const minZ = gridCell(Math.min(clothA.z, clothB.z, clothC.z));
    const maxZ = gridCell(Math.max(clothA.z, clothB.z, clothC.z));
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) {
      const key = cellKey(x, y, z);
      const values = cells.get(key);
      if (values) values.push(triangle); else cells.set(key, [triangle]);
    }
  }
  const testedGarmentTriangles = new Uint32Array(garmentIndex.count / 3);
  let queryId = 0;
  const hide: number[] = [];
  const depths: number[] = [];
  const centroids: [number, number, number][] = [];
  let alreadyHiddenTriangles = 0;
  let nonTorsoTriangles = 0;
  let testedTorsoTriangles = 0;
  const sourceCentroid = new THREE.Vector3();

  for (let triangle = 0; triangle < triangleCount; triangle++) {
    if (existing.has(triangle)) { alreadyHiddenTriangles++; continue; }
    const offset = triangle * 3;
    const ids = [index.getX(offset), index.getX(offset + 1), index.getX(offset + 2)];
    let torso = 0;
    let neck = 0;
    let arm = 0;
    let everyVertexHasTorso = true;
    for (const vertex of ids) {
      let vertexTorso = 0;
      for (let channel = 0; channel < 4; channel++) {
        const joint = skinIndex.getComponent(vertex, channel);
        const weight = skinWeight.getComponent(vertex, channel);
        if (torsoIndices.has(joint)) { torso += weight; vertexTorso += weight; }
        if (neckIndices.has(joint)) neck += weight;
        if (armIndices.has(joint)) arm += weight;
      }
      if (vertexTorso < 0.35) everyVertexHasTorso = false;
    }
    torso /= 3; neck /= 3; arm /= 3;
    if (!everyVertexHasTorso || torso < 0.58 || neck > 0.18 || arm > 0.16) { nonTorsoTriangles++; continue; }
    testedTorsoTriangles++;

    const a = xyz(bodyPositions, ids[0]!);
    const b = xyz(bodyPositions, ids[1]!);
    const c = xyz(bodyPositions, ids[2]!);
    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    edgeA.subVectors(b, a);
    edgeB.subVectors(c, a);
    normal.crossVectors(edgeA, edgeB);
    if (normal.lengthSq() < 1e-14) continue;
    normal.normalize();
    // Correct inconsistent winding using the actor-root radial direction.
    if (normal.dot(sourceCentroid.subVectors(centroid, rootCenter)) < 0) normal.negate();
    origin.copy(centroid).addScaledVector(normal, 0.0002);
    direction.copy(normal).negate();
    ray.origin.copy(origin);
    ray.direction.copy(direction);

    let nearest = Infinity;
    const end = origin.clone().addScaledVector(direction, depthLimit);
    const minX = gridCell(Math.min(origin.x, end.x)), maxX = gridCell(Math.max(origin.x, end.x));
    const minY = gridCell(Math.min(origin.y, end.y)), maxY = gridCell(Math.max(origin.y, end.y));
    const minZ = gridCell(Math.min(origin.z, end.z)), maxZ = gridCell(Math.max(origin.z, end.z));
    queryId++;
    for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) for (let z = minZ; z <= maxZ; z++) {
      for (const clothingTriangle of cells.get(cellKey(x, y, z)) ?? []) {
      if (testedGarmentTriangles[clothingTriangle] === queryId) continue;
      testedGarmentTriangles[clothingTriangle] = queryId;
      const garmentOffset = clothingTriangle * 3;
      xyz(garmentPositions, garmentIndex.getX(garmentOffset), clothA);
      xyz(garmentPositions, garmentIndex.getX(garmentOffset + 1), clothB);
      xyz(garmentPositions, garmentIndex.getX(garmentOffset + 2), clothC);
      if (!ray.intersectTriangle(clothA, clothB, clothC, false, intersection)) continue;
      const distance = origin.distanceTo(intersection);
      if (distance > 0.0001 && distance < nearest) nearest = distance;
      }
    }
    if (nearest <= depthLimit) {
      hide.push(triangle);
      depths.push(nearest);
      // Store local source centroid for a reviewer to confirm the patch is body torso.
      const local = body.worldToLocal(centroid.clone());
      centroids.push([local.x, local.y, local.z]);
    }
  }

  return Object.freeze({
    hideSet: Object.freeze({ asset: options.asset, bodySourceTriangleCount: triangleCount, triangleIds: Object.freeze(hide) }),
    metrics: Object.freeze({
      sourceTriangles: triangleCount,
      alreadyHiddenTriangles,
      nonTorsoTriangles,
      testedTorsoTriangles,
      clothBehindSkinTriangles: hide.length,
      maxPenetrationMetres: depths.length ? Math.max(...depths) : 0,
      penetrationDepthsMetres: Object.freeze(depths),
      sourceCentroids: Object.freeze(centroids.map((value) => Object.freeze(value))),
    }),
  });
}
