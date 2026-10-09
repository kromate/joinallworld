import * as THREE from 'three';

export type NativeStaticSurfaceAccept = (hit: THREE.Intersection<THREE.Object3D>) => boolean;
export type NativeStaticSurfaceFallback = (
  worldX: number,
  worldZ: number,
  maximumWorldY: number,
  minimumWorldY: number,
  accepts: NativeStaticSurfaceAccept,
) => number | null;

export interface NativeStaticSurfaceQuery {
  (worldX: number, worldZ: number, maximumWorldY: number, minimumWorldY: number, accepts: NativeStaticSurfaceAccept): number | null;
  readonly mode: 'indexed' | 'raycaster';
  readonly triangleCount: number;
}

type Triangle = {
  readonly ax: number; readonly ay: number; readonly az: number;
  readonly bx: number; readonly by: number; readonly bz: number;
  readonly cx: number; readonly cy: number; readonly cz: number;
  readonly normalY: number;
  readonly ia: number; readonly ib: number; readonly ic: number;
  readonly faceNormalX: number; readonly faceNormalY: number; readonly faceNormalZ: number;
  readonly side: THREE.Side;
  readonly mesh: THREE.Mesh;
  readonly faceIndex: number;
  readonly materialIndex: number;
  readonly order: number;
};
type MeshStamp = {
  readonly mesh: THREE.Mesh;
  readonly geometry: THREE.BufferGeometry;
  readonly position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
  readonly positionVersion: number;
  readonly index: THREE.BufferAttribute | null;
  readonly indexVersion: number;
  readonly matrixWorld: readonly number[];
  readonly drawStart: number;
  readonly drawCount: number;
  readonly groups: string;
  readonly materials: readonly { readonly material: THREE.Material; readonly side: THREE.Side; readonly visible: boolean }[];
};
type SurfaceIndex = {
  readonly stamps: readonly MeshStamp[];
  readonly cells: ReadonlyMap<string, readonly Triangle[]>;
  readonly broad: readonly Triangle[];
  readonly triangleCount: number;
};

const CELL_SIZE = 0.25;
const MAX_CELL_ENTRIES_PER_TRIANGLE = 64;
const EDGE_EPSILON = 1e-9;
const indices = new WeakMap<THREE.Object3D, SurfaceIndex>();

function cellKey(x: number, z: number): string {
  return `${Math.floor(x / CELL_SIZE)},${Math.floor(z / CELL_SIZE)}`;
}

function materialList(mesh: THREE.Mesh): readonly THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function isDynamic(mesh: THREE.Mesh): boolean {
  return Boolean(mesh instanceof THREE.SkinnedMesh || mesh instanceof THREE.InstancedMesh
    || mesh.raycast !== THREE.Mesh.prototype.raycast
    || Object.values(mesh.geometry.morphAttributes).some((attributes) => attributes.length > 0));
}

function belongsTo(object: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = object; node; node = node.parent) if (node === ancestor) return true;
  return false;
}

function collectVisibleMeshes(host: THREE.Object3D, excluded?: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  host.traverseVisible((node) => {
    if (node instanceof THREE.Mesh && (!excluded || !belongsTo(node, excluded))) meshes.push(node);
  });
  return meshes;
}

function stamp(meshes: readonly THREE.Mesh[]): MeshStamp[] {
  return meshes.map((mesh) => {
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    const index = geometry.index;
    return {
      mesh, geometry, position, positionVersion: position instanceof THREE.InterleavedBufferAttribute ? position.data.version : position?.version ?? -1,
      index, indexVersion: index?.version ?? -1,
      matrixWorld: Object.freeze(mesh.matrixWorld.elements.slice()),
      drawStart: geometry.drawRange.start, drawCount: geometry.drawRange.count,
      groups: geometry.groups.map((group) => `${group.start}:${group.count}:${group.materialIndex}`).join('|'),
      materials: Object.freeze(materialList(mesh).map((material) => Object.freeze({ material, side: material.side, visible: material.visible }))),
    };
  });
}

function stampsEqual(previous: readonly MeshStamp[], current: readonly MeshStamp[]): boolean {
  if (previous.length !== current.length) return false;
  return current.every((next, index) => {
    const old = previous[index]!;
    return old.mesh === next.mesh && old.geometry === next.geometry && old.position === next.position
      && old.positionVersion === next.positionVersion && old.index === next.index && old.indexVersion === next.indexVersion
      && old.drawStart === next.drawStart && old.drawCount === next.drawCount && old.groups === next.groups
      && old.materials.length === next.materials.length
      && old.materials.every((material, at) => material.material === next.materials[at]!.material
        && material.side === next.materials[at]!.side && material.visible === next.materials[at]!.visible)
      && old.matrixWorld.every((value, at) => value === next.matrixWorld[at]);
  });
}

function addTriangle(cells: Map<string, Triangle[]>, broad: Triangle[], triangle: Triangle): void {
  const minX = Math.floor(Math.min(triangle.ax, triangle.bx, triangle.cx) / CELL_SIZE);
  const maxX = Math.floor(Math.max(triangle.ax, triangle.bx, triangle.cx) / CELL_SIZE);
  const minZ = Math.floor(Math.min(triangle.az, triangle.bz, triangle.cz) / CELL_SIZE);
  const maxZ = Math.floor(Math.max(triangle.az, triangle.bz, triangle.cz) / CELL_SIZE);
  const entries = (maxX - minX + 1) * (maxZ - minZ + 1);
  if (entries > MAX_CELL_ENTRIES_PER_TRIANGLE) { broad.push(triangle); return; }
  for (let x = minX; x <= maxX; x++) for (let z = minZ; z <= maxZ; z++) {
    const key = cellKey(x * CELL_SIZE, z * CELL_SIZE);
    const bucket = cells.get(key);
    if (bucket) bucket.push(triangle); else cells.set(key, [triangle]);
  }
}

function materialRanges(mesh: THREE.Mesh): readonly { start: number; end: number; material: THREE.Material; materialIndex: number }[] {
  const geometry = mesh.geometry;
  const fullCount = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
  const drawStart = Math.max(0, geometry.drawRange.start);
  const drawEnd = Number.isFinite(geometry.drawRange.count)
    ? Math.min(fullCount, drawStart + Math.max(0, geometry.drawRange.count)) : fullCount;
  const materials = materialList(mesh);
  const ranges: Array<{ start: number; end: number; material: THREE.Material; materialIndex: number }> = [];
  if (Array.isArray(mesh.material) && geometry.groups.length) {
    for (const group of geometry.groups) {
      const materialIndex = group.materialIndex ?? 0;
      const material = materials[materialIndex];
      if (!material || !material.visible) continue;
      const start = Math.max(drawStart, group.start);
      const end = Math.min(drawEnd, group.start + group.count);
      if (end - start >= 3) ranges.push({ start, end, material, materialIndex });
    }
  } else if (!Array.isArray(mesh.material) && materials[0]?.visible) {
    if (drawEnd - drawStart >= 3) ranges.push({ start: drawStart, end: drawEnd, material: materials[0]!, materialIndex: 0 });
  }
  return ranges;
}

function buildIndex(stamps: readonly MeshStamp[]): SurfaceIndex {
  const cells = new Map<string, Triangle[]>();
  const broad: Triangle[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let order = 0, triangleCount = 0;
  for (const snapshot of stamps) {
    const { mesh, geometry, position, index } = snapshot;
    if (!position) continue;
    for (const range of materialRanges(mesh)) {
      for (let offset = range.start; offset + 2 < range.end; offset += 3) {
        const ia = index ? index.getX(offset) : offset;
        const ib = index ? index.getX(offset + 1) : offset + 1;
        const ic = index ? index.getX(offset + 2) : offset + 2;
        const localA = new THREE.Vector3(position.getX(ia), position.getY(ia), position.getZ(ia));
        const localB = new THREE.Vector3(position.getX(ib), position.getY(ib), position.getZ(ib));
        const localC = new THREE.Vector3(position.getX(ic), position.getY(ic), position.getZ(ic));
        const faceNormal = localB.clone().sub(localA).cross(localC.clone().sub(localA)).normalize();
        a.set(position.getX(ia), position.getY(ia), position.getZ(ia)).applyMatrix4(mesh.matrixWorld);
        b.set(position.getX(ib), position.getY(ib), position.getZ(ib)).applyMatrix4(mesh.matrixWorld);
        c.set(position.getX(ic), position.getY(ic), position.getZ(ic)).applyMatrix4(mesh.matrixWorld);
        const normalY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
        if (Math.abs(normalY) <= 1e-14) { order++; continue; }
        const triangle: Triangle = {
          ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, cx: c.x, cy: c.y, cz: c.z,
          normalY: normalY * Math.sign(mesh.matrixWorld.determinant()), ia, ib, ic,
          faceNormalX: faceNormal.x, faceNormalY: faceNormal.y, faceNormalZ: faceNormal.z,
          side: range.material.side, mesh, faceIndex: Math.floor(offset / 3), materialIndex: range.materialIndex, order: order++,
        };
        addTriangle(cells, broad, triangle);
        triangleCount++;
      }
    }
  }
  return { stamps, cells, broad, triangleCount };
}

function hitY(triangle: Triangle, x: number, z: number): number | null {
  if ((triangle.side === THREE.FrontSide && triangle.normalY <= 0)
    || (triangle.side === THREE.BackSide && triangle.normalY >= 0)) return null;
  const denominator = (triangle.bz - triangle.cz) * (triangle.ax - triangle.cx)
    + (triangle.cx - triangle.bx) * (triangle.az - triangle.cz);
  if (Math.abs(denominator) <= 1e-14) return null;
  const u = ((triangle.bz - triangle.cz) * (x - triangle.cx) + (triangle.cx - triangle.bx) * (z - triangle.cz)) / denominator;
  const v = ((triangle.cz - triangle.az) * (x - triangle.cx) + (triangle.ax - triangle.cx) * (z - triangle.cz)) / denominator;
  const w = 1 - u - v;
  if (u < -EDGE_EPSILON || v < -EDGE_EPSILON || w < -EDGE_EPSILON) return null;
  return u * triangle.ay + v * triangle.by + w * triangle.cy;
}

function indexedQuery(index: SurfaceIndex): NativeStaticSurfaceQuery {
  const query = (worldX: number, worldZ: number, maximumWorldY: number, minimumWorldY: number, accepts: NativeStaticSurfaceAccept) => {
    if (![worldX, worldZ, maximumWorldY, minimumWorldY].every(Number.isFinite) || maximumWorldY <= minimumWorldY) return null;
    const candidates = index.cells.get(cellKey(worldX, worldZ));
    let bestY = -Infinity, bestOrder = Infinity;
    const point = new THREE.Vector3(worldX, 0, worldZ);
    const test = (triangle: Triangle) => {
      const y = hitY(triangle, worldX, worldZ);
      if (y === null || y < minimumWorldY || y > maximumWorldY || y < bestY) return;
      point.y = y;
      const hit: THREE.Intersection<THREE.Object3D> = {
        distance: maximumWorldY - y, point: point.clone(), object: triangle.mesh,
        faceIndex: triangle.faceIndex,
        face: {
          a: triangle.ia, b: triangle.ib, c: triangle.ic,
          normal: new THREE.Vector3(triangle.faceNormalX, triangle.faceNormalY, triangle.faceNormalZ),
          materialIndex: triangle.materialIndex,
        },
      };
      if (!accepts(hit)) return;
      if (y > bestY || (y === bestY && triangle.order < bestOrder)) { bestY = y; bestOrder = triangle.order; }
    };
    for (const triangle of candidates ?? []) test(triangle);
    for (const triangle of index.broad) test(triangle);
    return Number.isFinite(bestY) ? bestY : null;
  };
  return Object.assign(query, { mode: 'indexed' as const, triangleCount: index.triangleCount });
}

/** Reuses an exact static triangle index; dynamic meshes stay on the host Raycaster path. */
export function prepareNativeStaticSurfaceQuery(
  host: THREE.Object3D,
  fallback: NativeStaticSurfaceFallback,
  excluded?: THREE.Object3D,
): NativeStaticSurfaceQuery {
  host.updateWorldMatrix(true, true);
  const meshes = collectVisibleMeshes(host, excluded);
  if (meshes.some(isDynamic)) {
    const query = (x: number, z: number, maximum: number, minimum: number, accepts: NativeStaticSurfaceAccept) =>
      fallback(x, z, maximum, minimum, accepts);
    return Object.assign(query, { mode: 'raycaster' as const, triangleCount: 0 });
  }
  const current = stamp(meshes);
  const cached = indices.get(host);
  if (cached && stampsEqual(cached.stamps, current)) return indexedQuery(cached);
  const built = buildIndex(current);
  indices.set(host, built);
  return indexedQuery(built);
}
