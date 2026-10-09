import * as THREE from 'three';

export interface NativeBodySurfaceProbe {
  /** Number of distinct vertices referenced by the current visible index ranges. */
  readonly candidateCount: number;
  /** Exact number of indexed vertices examined per sample (compatibility name). */
  readonly sourceVertexCount: number;
  sample(): Readonly<{ minY: number; maxY: number }>;
  /** Diagnostic oracle comparison; deliberately uses Three's independent point API. */
  verifyAgainstThree(): Readonly<{ maxPositionError: number; minYError: number; maxYError: number; verticesChecked: number }>;
}

type MeshState = {
  mesh: THREE.SkinnedMesh;
  vertices: Uint32Array;
  activeKey: string;
  position: THREE.BufferAttribute | THREE.InterleavedBufferAttribute;
  morphKey: string;
  morphed: Float64Array;
  post: THREE.Matrix4;
};

function visibleInTree(mesh: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = mesh; node; node = node.parent) if (!node.visible) return false;
  return true;
}

function activeKey(mesh: THREE.SkinnedMesh): string {
  const geometry = mesh.geometry;
  const index = geometry.index;
  const drawStart = Math.max(0, Math.floor(geometry.drawRange.start || 0));
  const rawCount = geometry.drawRange.count;
  const drawEnd = Math.min(index?.count ?? geometry.getAttribute('position').count,
    Number.isFinite(rawCount) ? drawStart + Math.max(0, Math.floor(rawCount)) : Number.MAX_SAFE_INTEGER);
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return [index?.id ?? 'nonindexed', index?.version ?? 0, index?.count ?? -1, drawStart, drawEnd,
    ...geometry.groups.flatMap((group) => [group.start, group.count, group.materialIndex]),
    ...materials.map((material) => Number(material.visible))].join(':');
}

function activeVertices(mesh: THREE.SkinnedMesh): { key: string; vertices: Uint32Array } {
  const geometry = mesh.geometry;
  const index = geometry.index;
  const drawStart = Math.max(0, Math.floor(geometry.drawRange.start || 0));
  const rawCount = geometry.drawRange.count;
  const drawEnd = Math.min(index?.count ?? geometry.getAttribute('position').count,
    Number.isFinite(rawCount) ? drawStart + Math.max(0, Math.floor(rawCount)) : Number.MAX_SAFE_INTEGER);
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const ranges: Array<[number, number]> = [];

  if (geometry.groups.length) {
    for (const group of geometry.groups) {
      const material = materials[group.materialIndex ?? 0];
      if (!material || !material.visible) continue;
      const start = Math.max(drawStart, group.start);
      const end = Math.min(drawEnd, group.start + group.count);
      if (end > start) ranges.push([start, end]);
    }
  } else {
    if (materials.length !== 1) throw new Error(`${mesh.name}: array material requires explicit geometry groups`);
    if (materials[0]!.visible && drawEnd > drawStart) ranges.push([drawStart, drawEnd]);
  }

  const key = activeKey(mesh);
  const found = new Set<number>();
  if (index) {
    for (const [start, end] of ranges) for (let offset = start; offset < end; offset++) found.add(index.getX(offset));
  } else {
    for (const [start, end] of ranges) for (let vertex = start; vertex < end; vertex++) found.add(vertex);
  }
  const position = geometry.getAttribute('position');
  for (const vertex of found) if (!Number.isInteger(vertex) || vertex < 0 || vertex >= position.count) {
    throw new Error(`${mesh.name}: active index references invalid vertex ${vertex}`);
  }
  return { key, vertices: Uint32Array.from(found) };
}

function attributeSignature(attribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): string {
  return attribute instanceof THREE.InterleavedBufferAttribute
    ? `${attribute.data.uuid}:${attribute.offset}:${attribute.data.version}`
    : `${attribute.id}:${attribute.version}`;
}

function morphSignature(mesh: THREE.SkinnedMesh): string {
  const attrs = mesh.geometry.morphAttributes.position ?? [];
  const influences = mesh.morphTargetInfluences ?? [];
  return [attributeSignature(mesh.geometry.getAttribute('position')), Number(mesh.geometry.morphTargetsRelative),
    ...attrs.flatMap((attribute, index) => [attributeSignature(attribute), influences[index] ?? 0])].join(':');
}

/**
 * Exact indexed-vertex world bounds for the current pose. This mirrors the Three.js
 * SkinnedMesh sequence in batches: morph position, bindMatrix, four weighted bone
 * matrices, bindMatrixInverse, then mesh.matrixWorld. The Float32 skeleton palette
 * is intentionally used because it is the palette consumed by the GPU skinning path.
 */
export function createNativeBodySurfaceProbe(root: THREE.Group, meshes: readonly THREE.SkinnedMesh[]): NativeBodySurfaceProbe {
  if (!meshes.length || meshes.length > 8) throw new Error('Native body surface needs one to eight owned meshes');
  const states: MeshState[] = [];
  let sourceVertexCount = 0;

  for (const mesh of meshes) {
    if (root.getObjectById(mesh.id) !== mesh) throw new Error('Native body surface mesh must belong to the actor');
    const position = mesh.geometry.getAttribute('position');
    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    if (!position || !skinIndex || !skinWeight || position.count !== skinIndex.count || position.count !== skinWeight.count) {
      throw new Error(`${mesh.name}: native body surface needs aligned skin attributes`);
    }
    const active = activeVertices(mesh);
    if (!active.vertices.length) throw new Error(`${mesh.name}: no visible indexed vertices in drawRange/groups`);
    const morphed = new Float64Array(position.count * 3);
    states.push({ mesh, vertices: active.vertices, activeKey: active.key, position, morphKey: '', morphed, post: new THREE.Matrix4() });
    sourceVertexCount += position.count;
  }
  const candidateCount = states.reduce((sum, state) => sum + state.vertices.length, 0);
  const scratch = new THREE.Vector3();
  const oracleWorld = new THREE.Vector3();

  function refreshActive(state: MeshState): void {
    if (activeKey(state.mesh) !== state.activeKey) {
      const active = activeVertices(state.mesh);
      if (!active.vertices.length) throw new Error(`${state.mesh.name}: no visible indexed vertices in drawRange/groups`);
      state.activeKey = active.key;
      state.vertices = active.vertices;
    }
  }

  function refreshMorphed(state: MeshState): void {
    const mesh = state.mesh;
    const position = mesh.geometry.getAttribute('position');
    if (position.count !== state.position.count || position !== state.position) {
      throw new Error(`${mesh.name}: position attribute layout changed after probe creation`);
    }
    const key = morphSignature(mesh);
    if (key === state.morphKey) return;
    const targets = mesh.geometry.morphAttributes.position ?? [];
    const influences = mesh.morphTargetInfluences ?? [];
    const relative = mesh.geometry.morphTargetsRelative;
    for (let vertex = 0; vertex < position.count; vertex++) {
      const offset = vertex * 3;
      const x = position.getX(vertex), y = position.getY(vertex), z = position.getZ(vertex);
      let px = x, py = y, pz = z;
      for (let targetIndex = 0; targetIndex < targets.length; targetIndex++) {
        const influence = influences[targetIndex] ?? 0;
        if (influence === 0) continue;
        const target = targets[targetIndex]!;
        if (relative) {
          px += target.getX(vertex) * influence;
          py += target.getY(vertex) * influence;
          pz += target.getZ(vertex) * influence;
        } else {
          px += (target.getX(vertex) - x) * influence;
          py += (target.getY(vertex) - y) * influence;
          pz += (target.getZ(vertex) - z) * influence;
        }
      }
      state.morphed[offset] = px;
      state.morphed[offset + 1] = py;
      state.morphed[offset + 2] = pz;
    }
    state.morphKey = key;
  }

  function updateActor(): void {
    root.updateWorldMatrix(true, false);
    root.updateMatrixWorld(true);
    for (const state of states) {
      state.mesh.skeleton.update();
      refreshActive(state);
      refreshMorphed(state);
    }
  }

  function cachedPost(mesh: THREE.SkinnedMesh): readonly number[] {
    const state = states.find((entry) => entry.mesh === mesh)!;
    state.post.multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse);
    return state.post.elements;
  }

  return {
    candidateCount,
    sourceVertexCount,
    sample() {
      updateActor();
      let minY = Infinity, maxY = -Infinity, vertices = 0;
      for (const state of states) {
        if (!visibleInTree(state.mesh)) continue;
        const post = cachedPost(state.mesh);
        const bind = state.mesh.bindMatrix.elements;
        const skinIndex = state.mesh.geometry.getAttribute('skinIndex');
        const skinWeight = state.mesh.geometry.getAttribute('skinWeight');
        const boneMatrices = state.mesh.skeleton.boneMatrices;
        for (const vertex of state.vertices) {
          const offset = vertex * 3;
          const x = state.morphed[offset]!, y = state.morphed[offset + 1]!, z = state.morphed[offset + 2]!;
          const bx = bind[0]! * x + bind[4]! * y + bind[8]! * z + bind[12]!;
          const by = bind[1]! * x + bind[5]! * y + bind[9]! * z + bind[13]!;
          const bz = bind[2]! * x + bind[6]! * y + bind[10]! * z + bind[14]!;
          let sx = 0, sy = 0, sz = 0;
          for (let lane = 0; lane < 4; lane++) {
            const weight = skinWeight.getComponent(vertex, lane);
            if (weight === 0) continue;
            const boneIndex = skinIndex.getComponent(vertex, lane), m = boneIndex * 16;
            sx += (boneMatrices[m]! * bx + boneMatrices[m + 4]! * by + boneMatrices[m + 8]! * bz + boneMatrices[m + 12]!) * weight;
            sy += (boneMatrices[m + 1]! * bx + boneMatrices[m + 5]! * by + boneMatrices[m + 9]! * bz + boneMatrices[m + 13]!) * weight;
            sz += (boneMatrices[m + 2]! * bx + boneMatrices[m + 6]! * by + boneMatrices[m + 10]! * bz + boneMatrices[m + 14]!) * weight;
          }
          const worldY = post[1]! * sx + post[5]! * sy + post[9]! * sz + post[13]!;
          if (!Number.isFinite(worldY)) throw new Error(`${state.mesh.name}: non-finite world Y at vertex ${vertex}`);
          minY = Math.min(minY, worldY); maxY = Math.max(maxY, worldY); vertices++;
        }
      }
      if (!vertices || !Number.isFinite(minY) || !Number.isFinite(maxY)) throw new Error('Native body surface has no finite visible indexed vertices');
      return Object.freeze({ minY, maxY });
    },
    verifyAgainstThree() {
      updateActor();
      let maxPositionError = 0, exactMin = Infinity, exactMax = -Infinity, fastMin = Infinity, fastMax = -Infinity, verticesChecked = 0;
      for (const state of states) {
        if (!visibleInTree(state.mesh)) continue;
        const post = cachedPost(state.mesh);
        const bind = state.mesh.bindMatrix.elements;
        const skinIndex = state.mesh.geometry.getAttribute('skinIndex');
        const skinWeight = state.mesh.geometry.getAttribute('skinWeight');
        const boneMatrices = state.mesh.skeleton.boneMatrices;
        for (const vertex of state.vertices) {
          const offset = vertex * 3, x = state.morphed[offset]!, y = state.morphed[offset + 1]!, z = state.morphed[offset + 2]!;
          const bx = bind[0]! * x + bind[4]! * y + bind[8]! * z + bind[12]!;
          const by = bind[1]! * x + bind[5]! * y + bind[9]! * z + bind[13]!;
          const bz = bind[2]! * x + bind[6]! * y + bind[10]! * z + bind[14]!;
          let sx = 0, sy = 0, sz = 0;
          for (let lane = 0; lane < 4; lane++) {
            const weight = skinWeight.getComponent(vertex, lane);
            if (weight === 0) continue;
            const m = skinIndex.getComponent(vertex, lane) * 16;
            sx += (boneMatrices[m]! * bx + boneMatrices[m + 4]! * by + boneMatrices[m + 8]! * bz + boneMatrices[m + 12]!) * weight;
            sy += (boneMatrices[m + 1]! * bx + boneMatrices[m + 5]! * by + boneMatrices[m + 9]! * bz + boneMatrices[m + 13]!) * weight;
            sz += (boneMatrices[m + 2]! * bx + boneMatrices[m + 6]! * by + boneMatrices[m + 10]! * bz + boneMatrices[m + 14]!) * weight;
          }
          scratch.set(post[0]! * sx + post[4]! * sy + post[8]! * sz + post[12]!,
            post[1]! * sx + post[5]! * sy + post[9]! * sz + post[13]!,
            post[2]! * sx + post[6]! * sy + post[10]! * sz + post[14]!);
          state.mesh.getVertexPosition(vertex, oracleWorld);
          oracleWorld.applyMatrix4(state.mesh.matrixWorld);
          const error = scratch.distanceTo(oracleWorld);
          maxPositionError = Math.max(maxPositionError, error);
          fastMin = Math.min(fastMin, scratch.y); fastMax = Math.max(fastMax, scratch.y);
          exactMin = Math.min(exactMin, oracleWorld.y); exactMax = Math.max(exactMax, oracleWorld.y);
          verticesChecked++;
        }
      }
      return Object.freeze({ maxPositionError, minYError: Math.abs(fastMin - exactMin), maxYError: Math.abs(fastMax - exactMax), verticesChecked });
    },
  };
}
