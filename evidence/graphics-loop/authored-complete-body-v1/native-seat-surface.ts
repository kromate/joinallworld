import * as THREE from 'three';

/** A bounded, actor-owned sampling set for pelvis and proximal-thigh seat contact. */
export interface NativeSeatSurfaceProbe {
  readonly metrics: Readonly<{
    candidateVertices: number;
    sourceIndexedVertices: number;
    candidateVerticesByMesh: Readonly<Record<string, number>>;
    sourceIndexedVerticesByMesh: Readonly<Record<string, number>>;
    supportBoneNames: readonly string[];
    minimumRelevantWeight: number;
  }>;
  /** World-space bounds of the cached anatomical region in the current evaluated pose. */
  sample(): Readonly<{ minY: number; maxY: number }>;
}

const SEAT_SUPPORT_BONES = [
  'mixamorigHips',
  'mixamorigLeftUpLeg',
  'mixamorigRightUpLeg',
] as const;
const DEFAULT_RELEVANT_WEIGHT = 0.15;
const DEFAULT_MAX_CANDIDATES = 4096;

function fail(message: string): never {
  throw new Error(`Native seat surface: ${message}`);
}

function visibleInTree(mesh: THREE.Object3D): boolean {
  for (let node: THREE.Object3D | null = mesh; node; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

function indexedVertices(mesh: THREE.SkinnedMesh): Set<number> {
  const geometry = mesh.geometry;
  const index = geometry.index;
  if (!index) fail(`${mesh.name} must have indexed geometry`);
  const start = Math.max(0, geometry.drawRange.start ?? 0);
  const count = Number.isFinite(geometry.drawRange.count) ? geometry.drawRange.count : index.count;
  const end = Math.min(index.count, start + count);
  const used = new Set<number>();
  for (let i = start; i < end; i++) {
    const vertex = index.getX(i);
    if (!Number.isInteger(vertex) || vertex < 0 || vertex >= geometry.getAttribute('position').count) {
      fail(`${mesh.name} index ${i} references invalid vertex ${vertex}`);
    }
    used.add(vertex);
  }
  if (!used.size) fail(`${mesh.name} has no currently indexed vertices`);
  return used;
}

function getRelevantBoneIndices(mesh: THREE.SkinnedMesh): readonly number[] {
  const bones = mesh.skeleton.bones;
  return SEAT_SUPPORT_BONES.map((name) => {
    const index = bones.findIndex((bone) => bone.name === name);
    if (index < 0) fail(`${mesh.name} is missing support bone ${name}`);
    return index;
  });
}

/**
 * Cache actual indexed Body/outfit vertices whose authored skin support belongs to the pelvis or
 * proximal thighs. This is a deterministic region definition, not proof of contact between samples.
 * Pass only the currently visible Body and seated outfit; feet, lower legs, shoes, and hair are
 * deliberately outside this seat-region probe.
 */
export function createNativeSeatSurfaceProbe(
  root: THREE.Object3D,
  meshes: readonly THREE.SkinnedMesh[],
  options: Readonly<{ minimumRelevantWeight?: number; maximumCandidates?: number }> = {},
): NativeSeatSurfaceProbe {
  const minimumRelevantWeight = options.minimumRelevantWeight ?? DEFAULT_RELEVANT_WEIGHT;
  const maximumCandidates = options.maximumCandidates ?? DEFAULT_MAX_CANDIDATES;
  if (!Number.isFinite(minimumRelevantWeight) || minimumRelevantWeight <= 0 || minimumRelevantWeight > 1) {
    fail('minimumRelevantWeight must be finite and in (0, 1]');
  }
  if (!Number.isInteger(maximumCandidates) || maximumCandidates < 1 || maximumCandidates > DEFAULT_MAX_CANDIDATES) {
    fail(`maximumCandidates must be an integer in [1, ${DEFAULT_MAX_CANDIDATES}]`);
  }
  if (!meshes.length || meshes.length > 3) fail('expected Body and at most two currently visible clothing meshes');
  const sourceIndexedVerticesByMesh: Record<string, number> = {};
  const candidateVerticesByMesh: Record<string, number> = {};
  const samples: Array<{ mesh: THREE.SkinnedMesh; vertices: Uint32Array }> = [];
  const referenceBones = meshes[0]!.skeleton.bones;
  let sourceIndexedVertices = 0;
  let candidateVertices = 0;

  for (const mesh of meshes) {
    if (!mesh.isSkinnedMesh || root.getObjectById(mesh.id) !== mesh) fail(`${mesh.name} is not an actor-owned SkinnedMesh`);
    if (!visibleInTree(mesh)) fail(`${mesh.name} is not visible in the actor hierarchy`);
    const position = mesh.geometry.getAttribute('position');
    const skinIndex = mesh.geometry.getAttribute('skinIndex');
    const skinWeight = mesh.geometry.getAttribute('skinWeight');
    if (!position || !skinIndex || !skinWeight || position.count !== skinIndex.count || position.count !== skinWeight.count) {
      fail(`${mesh.name} needs aligned position/skinIndex/skinWeight attributes`);
    }
    if (mesh.skeleton.bones.length !== referenceBones.length || !mesh.skeleton.bones.every((bone, i) => bone === referenceBones[i])) {
      fail(`${mesh.name} does not share the actor's exact skeleton and influence order`);
    }
    const relevant = new Set(getRelevantBoneIndices(mesh));
    const used = indexedVertices(mesh);
    const candidates: number[] = [];
    for (const vertex of used) {
      let totalWeight = 0;
      for (let channel = 0; channel < 4; channel++) {
        const boneIndex = skinIndex.getComponent(vertex, channel);
        const weight = skinWeight.getComponent(vertex, channel);
        if (!Number.isFinite(weight) || weight < 0) fail(`${mesh.name} vertex ${vertex} has an invalid skin weight`);
        if (weight > 0 && (!Number.isInteger(boneIndex) || boneIndex < 0 || boneIndex >= mesh.skeleton.bones.length)) {
          fail(`${mesh.name} vertex ${vertex} has an invalid positive-weight bone index`);
        }
        if (relevant.has(boneIndex)) totalWeight += weight;
      }
      if (totalWeight >= minimumRelevantWeight) candidates.push(vertex);
    }
    if (!candidates.length) fail(`${mesh.name} has no indexed pelvis/proximal-thigh support vertices`);
    const frozenVertices = Uint32Array.from(candidates);
    samples.push({ mesh, vertices: frozenVertices });
    sourceIndexedVertices += used.size;
    candidateVertices += candidates.length;
    sourceIndexedVerticesByMesh[mesh.name] = used.size;
    candidateVerticesByMesh[mesh.name] = candidates.length;
  }
  if (candidateVertices > maximumCandidates) {
    fail(`seat support region has ${candidateVertices} candidates; limit is ${maximumCandidates}`);
  }

  const point = new THREE.Vector3();
  return {
    metrics: Object.freeze({ candidateVertices, sourceIndexedVertices,
      candidateVerticesByMesh: Object.freeze(candidateVerticesByMesh),
      sourceIndexedVerticesByMesh: Object.freeze(sourceIndexedVerticesByMesh),
      supportBoneNames: SEAT_SUPPORT_BONES, minimumRelevantWeight }),
    sample() {
      root.updateWorldMatrix(true, false);
      root.updateMatrixWorld(true);
      let minY = Infinity;
      let maxY = -Infinity;
      for (const { mesh, vertices } of samples) {
        if (!visibleInTree(mesh)) continue;
        mesh.skeleton.update();
        for (const vertex of vertices) {
          mesh.getVertexPosition(vertex, point);
          mesh.localToWorld(point);
          if (!Number.isFinite(point.y)) fail(`${mesh.name} vertex ${vertex} produced a non-finite world position`);
          minY = Math.min(minY, point.y);
          maxY = Math.max(maxY, point.y);
        }
      }
      if (!Number.isFinite(minY) || !Number.isFinite(maxY)) fail('no visible seat-support vertices were sampled');
      return Object.freeze({ minY, maxY });
    },
  };
}

/** The vertical pelvis-anchor correction suggested by one measured pose. */
export function seatAnchorDelta(seatTopY: number, measuredSeatMinimumY: number): number {
  if (![seatTopY, measuredSeatMinimumY].every(Number.isFinite)) fail('seat top and sampled minimum must be finite');
  return seatTopY - measuredSeatMinimumY;
}
