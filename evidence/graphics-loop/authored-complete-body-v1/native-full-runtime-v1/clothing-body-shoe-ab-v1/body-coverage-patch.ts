import * as THREE from 'three';

export interface BodyCoveragePatchOptions {
  readonly body: THREE.SkinnedMesh;
  readonly garment: THREE.SkinnedMesh;
  readonly sourceTriangleCount: number;
  readonly seedTriangleIds: readonly number[];
  readonly maxGarmentGapMetres?: number;
  readonly maxSurfaceDistanceMetres?: number;
  readonly maxTriangles?: number;
}

export interface BodyCoveragePatch {
  readonly triangleIds: readonly number[];
  readonly metrics: Readonly<{
    seedTriangleIds: readonly number[];
    testedTriangles: number;
    coveredTriangles: number;
    maxGarmentGapMetres: number;
    maxSurfaceDistanceMetres: number;
    seedDistancesMetres: readonly number[];
  }>;
}

/**
 * Derive a bounded, connected source-index patch only where the posed garment
 * surface is actually behind the posed Body surface. The caller supplies the
 * exact raw source index on `body`; this helper never changes geometry.
 */
export function deriveBodyCoveragePatch(options: BodyCoveragePatchOptions): BodyCoveragePatch {
  const { body, garment, sourceTriangleCount } = options;
  const index = body.geometry.getIndex();
  const maxGap = options.maxGarmentGapMetres ?? 0.04;
  const maxSurfaceDistance = options.maxSurfaceDistanceMetres ?? 0.08;
  const maxTriangles = options.maxTriangles ?? 220;
  if (!body.isSkinnedMesh || !garment.isSkinnedMesh || body.skeleton !== garment.skeleton) {
    throw new Error('Coverage patch requires Body and garment on the same actor skeleton');
  }
  if (!index || index.count % 3 !== 0 || index.count / 3 !== sourceTriangleCount) {
    throw new Error('Coverage patch requires the exact full source Body index');
  }
  const sourceIndex = index;
  const position = body.geometry.getAttribute('position');
  if (position.count === 0) throw new Error('Coverage patch source Body has no vertices');
  const sourceVertexAt = (offset: number): number => {
    const vertexId = sourceIndex.getX(offset);
    if (!Number.isInteger(vertexId) || vertexId < 0 || vertexId >= position.count) {
      throw new Error(`Coverage patch source index ${offset} references invalid vertex ${vertexId}`);
    }
    return vertexId;
  };
  if (!Number.isFinite(maxGap) || maxGap <= 0 || maxGap > 0.04) throw new Error('Garment gap must be in (0, 40mm]');
  if (!Number.isFinite(maxSurfaceDistance) || maxSurfaceDistance <= 0 || maxSurfaceDistance > 0.08) throw new Error('Surface radius must be in (0, 80mm]');
  if (!Number.isInteger(maxTriangles) || maxTriangles < options.seedTriangleIds.length || maxTriangles > 500) throw new Error('Coverage triangle bound is invalid');
  const seeds = [...new Set(options.seedTriangleIds)];
  if (!seeds.length || seeds.some((id) => !Number.isInteger(id) || id < 0 || id >= sourceTriangleCount)) {
    throw new Error('Coverage patch seed IDs are empty or outside the source index');
  }

  body.updateWorldMatrix(true, false);
  body.updateMatrixWorld(true);
  garment.updateWorldMatrix(true, false);
  garment.updateMatrixWorld(true);
  body.skeleton.update();
  garment.skeleton.update();

  const vertex = new THREE.Vector3();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const inward = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  raycaster.near = 0.00005;
  raycaster.far = maxGap;
  const centers = new Array<THREE.Vector3>(sourceTriangleCount);
  const edgeFaces = new Map<string, number[]>();

  // Exported GLTFs can duplicate vertices at UV seams. Use current posed
  // positions for edge connectivity so the flood can cross those exact seams.
  const pointKey = (point: THREE.Vector3) => `${Math.round(point.x * 100000)}:${Math.round(point.y * 100000)}:${Math.round(point.z * 100000)}`;
  const edgeKey = (x: string, y: string) => x < y ? `${x}|${y}` : `${y}|${x}`;
  for (let triangle = 0; triangle < sourceTriangleCount; triangle++) {
    const offset = triangle * 3;
    const ids: [number, number, number] = [sourceVertexAt(offset), sourceVertexAt(offset + 1), sourceVertexAt(offset + 2)];
    body.getVertexPosition(ids[0], a); a.applyMatrix4(body.matrixWorld); const p0 = pointKey(a);
    body.getVertexPosition(ids[1], b); b.applyMatrix4(body.matrixWorld); const p1 = pointKey(b);
    body.getVertexPosition(ids[2], c); c.applyMatrix4(body.matrixWorld); const p2 = pointKey(c);
    const edges: [string, string][] = [[p0, p1], [p1, p2], [p2, p0]];
    for (const [x, y] of edges) {
      const key = edgeKey(x, y);
      const faces = edgeFaces.get(key);
      if (faces) faces.push(triangle); else edgeFaces.set(key, [triangle]);
    }
    body.getVertexPosition(ids[0], a); a.applyMatrix4(body.matrixWorld);
    body.getVertexPosition(ids[1], b); b.applyMatrix4(body.matrixWorld);
    body.getVertexPosition(ids[2], c); c.applyMatrix4(body.matrixWorld);
    centers[triangle] = a.clone().add(b).add(c).multiplyScalar(1 / 3);
  }

  const neighbors = Array.from({ length: sourceTriangleCount }, () => new Set<number>());
  for (const faces of edgeFaces.values()) {
    for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
      const left = faces[i], right = faces[j];
      if (left === undefined || right === undefined) throw new Error('Coverage patch face adjacency is malformed');
      const leftNeighbors = neighbors[left], rightNeighbors = neighbors[right];
      if (!leftNeighbors || !rightNeighbors) throw new Error('Coverage patch adjacency references an invalid triangle');
      leftNeighbors.add(right);
      rightNeighbors.add(left);
    }
  }

  function garmentGap(triangle: number): number | null {
    const offset = triangle * 3;
    const i0 = sourceVertexAt(offset), i1 = sourceVertexAt(offset + 1), i2 = sourceVertexAt(offset + 2);
    body.getVertexPosition(i0, a); a.applyMatrix4(body.matrixWorld);
    body.getVertexPosition(i1, b); b.applyMatrix4(body.matrixWorld);
    body.getVertexPosition(i2, c); c.applyMatrix4(body.matrixWorld);
    normal.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
    if (normal.lengthSq() < 1e-14) return null;
    normal.normalize();
    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    // Triangle winding can be reversed in converted meshes. Check both sides:
    // the prior one-way inward cast started inside the body and missed cloth
    // covering its outside surface.
    let nearest = Infinity;
    for (const sign of [-1, 1]) {
      inward.copy(normal).multiplyScalar(sign);
      raycaster.set(centroid.clone().addScaledVector(inward, 0.0001), inward);
      raycaster.far = maxGap;
      const hit = raycaster.intersectObject(garment, false)[0];
      if (hit && hit.distance <= maxGap) nearest = Math.min(nearest, hit.distance);
    }
    return Number.isFinite(nearest) ? nearest : null;
  }

  const seedDistances = seeds.map((id) => garmentGap(id));
  if (seedDistances.some((distance) => distance === null)) {
    throw new Error(`At least one pixel-attributed seed is not covered by the active garment within ${maxGap}m: ${JSON.stringify({ seeds, distances: seedDistances })}`);
  }
  const paths = new Map<number, number>();
  const queue: number[] = [];
  for (const seed of seeds) { paths.set(seed, 0); queue.push(seed); }
  let testedTriangles = 0;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (current === undefined) continue;
    const currentPath = paths.get(current)!;
    const currentNeighbors = neighbors[current];
    const currentCenter = centers[current];
    if (!currentNeighbors || !currentCenter) throw new Error('Coverage patch queue references invalid source topology');
    for (const neighbor of currentNeighbors) {
      if (paths.has(neighbor)) continue;
      const neighborCenter = centers[neighbor];
      if (!neighborCenter) throw new Error(`Coverage patch neighbor ${neighbor} is outside source topology`);
      const nextPath = currentPath + currentCenter.distanceTo(neighborCenter);
      if (nextPath > maxSurfaceDistance) continue;
      testedTriangles++;
      if (garmentGap(neighbor) === null) continue;
      paths.set(neighbor, nextPath);
      queue.push(neighbor);
      if (paths.size > maxTriangles) throw new Error(`Connected covered patch exceeds ${maxTriangles} source triangles; refusing an unbounded hide`);
    }
  }
  return Object.freeze({
    triangleIds: Object.freeze([...paths.keys()].sort((x, y) => x - y)),
    metrics: Object.freeze({
      seedTriangleIds: Object.freeze(seeds),
      testedTriangles,
      coveredTriangles: paths.size,
      maxGarmentGapMetres: maxGap,
      maxSurfaceDistanceMetres: maxSurfaceDistance,
      seedDistancesMetres: Object.freeze(seedDistances as number[]),
    }),
  });
}
