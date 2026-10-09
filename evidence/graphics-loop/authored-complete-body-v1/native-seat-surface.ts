import * as THREE from 'three';

/** A bounded, actor-owned sampling set for posterior pelvis contact. */
export interface NativeSeatSurfaceProbe {
  readonly metrics: Readonly<{
    candidateVertices: number;
    sourceIndexedVertices: number;
    candidateVerticesByMesh: Readonly<Record<string, number>>;
    sourceIndexedVerticesByMesh: Readonly<Record<string, number>>;
    supportBoneNames: readonly string[];
    minimumRelevantWeight: number;
    posteriorRegion: Readonly<{ hipLocal: readonly [number, number, number]; forwardLocal: readonly [number, number, number];
      lateralLocal: readonly [number, number, number]; rearwardAtLeast: number; lateralAbsAtMost: number;
      verticalFromHip: readonly [number, number]; hipsMustDominateLegWeights: true }>;
  }>;
  /** World-space bounds of the cached anatomical region in the current evaluated pose. */
  sample(): Readonly<{ minY: number; maxY: number }>;
}

const SEAT_SUPPORT_BONES = [
  'mixamorigHips',
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

function rootLocalBonePosition(root: THREE.Object3D, name: string, inverseRoot: THREE.Matrix4): THREE.Vector3 {
  let found: THREE.Bone | undefined;
  root.traverse((node) => { if (node.isBone && node.name === name) found = node as THREE.Bone; });
  if (!found) fail(`actor is missing ${name}`);
  return found.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot);
}

/**
 * Cache actual indexed Body/outfit vertices in a posterior pelvis envelope and dominated by the
 * Hips influence. Upper-leg-only and distal thigh vertices are excluded: those move during the
 * solver's foot correction and cannot be used as the butt/seat reference.
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
  root.updateWorldMatrix(true, false);
  root.updateMatrixWorld(true);
  for (const mesh of meshes) mesh.skeleton.update();
  const inverseRoot = root.matrixWorld.clone().invert();
  const hipLocal = rootLocalBonePosition(root, 'mixamorigHips', inverseRoot);
  const leftUpLeg = rootLocalBonePosition(root, 'mixamorigLeftUpLeg', inverseRoot);
  const rightUpLeg = rootLocalBonePosition(root, 'mixamorigRightUpLeg', inverseRoot);
  const leftFoot = rootLocalBonePosition(root, 'mixamorigLeftFoot', inverseRoot);
  const rightFoot = rootLocalBonePosition(root, 'mixamorigRightFoot', inverseRoot);
  const leftToe = rootLocalBonePosition(root, 'mixamorigLeftToeBase', inverseRoot);
  const rightToe = rootLocalBonePosition(root, 'mixamorigRightToeBase', inverseRoot);
  const forward = leftToe.clone().sub(leftFoot).add(rightToe.clone().sub(rightFoot));
  forward.y = 0;
  if (forward.lengthSq() < 1e-8) fail('actor rest pose does not provide a horizontal forward axis');
  forward.normalize();
  const lateral = rightUpLeg.clone().sub(leftUpLeg);
  lateral.y = 0;
  if (lateral.lengthSq() < 1e-8) fail('actor rest pose does not provide a horizontal pelvic axis');
  lateral.normalize();
  const thighLength = (leftUpLeg.distanceTo(rootLocalBonePosition(root, 'mixamorigLeftLeg', inverseRoot))
    + rightUpLeg.distanceTo(rootLocalBonePosition(root, 'mixamorigRightLeg', inverseRoot))) * 0.5;
  if (!(thighLength > 0.1 && Number.isFinite(thighLength))) fail('invalid measured proximal thigh length');
  const halfPelvisWidth = leftUpLeg.distanceTo(rightUpLeg) * 0.5;
  const posteriorRegion = Object.freeze({ hipLocal: hipLocal.toArray() as [number, number, number],
    forwardLocal: forward.toArray() as [number, number, number], lateralLocal: lateral.toArray() as [number, number, number],
    rearwardAtLeast: 0, lateralAbsAtMost: halfPelvisWidth * 1.5,
    verticalFromHip: [-thighLength * 0.5, 0] as [number, number], hipsMustDominateLegWeights: true as const });
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
    const hipIndex = getRelevantBoneIndices(mesh)[0]!;
    const leftLegIndex = mesh.skeleton.bones.findIndex((bone) => bone.name === 'mixamorigLeftUpLeg');
    const rightLegIndex = mesh.skeleton.bones.findIndex((bone) => bone.name === 'mixamorigRightUpLeg');
    if (leftLegIndex < 0 || rightLegIndex < 0) fail(`${mesh.name} is missing proximal thigh bones`);
    const used = indexedVertices(mesh);
    const candidates: number[] = [];
    const referencePoint = new THREE.Vector3();
    for (const vertex of used) {
      let hipsWeight = 0, leftThighWeight = 0, rightThighWeight = 0;
      for (let channel = 0; channel < 4; channel++) {
        const boneIndex = skinIndex.getComponent(vertex, channel);
        const weight = skinWeight.getComponent(vertex, channel);
        if (!Number.isFinite(weight) || weight < 0) fail(`${mesh.name} vertex ${vertex} has an invalid skin weight`);
        if (weight > 0 && (!Number.isInteger(boneIndex) || boneIndex < 0 || boneIndex >= mesh.skeleton.bones.length)) {
          fail(`${mesh.name} vertex ${vertex} has an invalid positive-weight bone index`);
        }
        if (boneIndex === hipIndex) hipsWeight += weight;
        else if (boneIndex === leftLegIndex) leftThighWeight += weight;
        else if (boneIndex === rightLegIndex) rightThighWeight += weight;
      }
      if (hipsWeight < minimumRelevantWeight || hipsWeight < leftThighWeight + rightThighWeight) continue;
      mesh.getVertexPosition(vertex, referencePoint);
      referencePoint.applyMatrix4(mesh.matrixWorld).applyMatrix4(inverseRoot).sub(hipLocal);
      const rearward = -referencePoint.dot(forward);
      const lateralOffset = Math.abs(referencePoint.dot(lateral));
      const verticalOffset = referencePoint.y;
      if (rearward >= posteriorRegion.rearwardAtLeast && lateralOffset <= posteriorRegion.lateralAbsAtMost
        && verticalOffset >= posteriorRegion.verticalFromHip[0] && verticalOffset <= posteriorRegion.verticalFromHip[1]) {
        candidates.push(vertex);
      }
    }
    const frozenVertices = Uint32Array.from(candidates);
    samples.push({ mesh, vertices: frozenVertices });
    sourceIndexedVertices += used.size;
    candidateVertices += candidates.length;
    sourceIndexedVerticesByMesh[mesh.name] = used.size;
    candidateVerticesByMesh[mesh.name] = candidates.length;
  }
  if (!candidateVertices) fail('no indexed posterior pelvis vertices passed the anatomical support envelope');
  if (candidateVertices > maximumCandidates) {
    fail(`seat support region has ${candidateVertices} candidates; limit is ${maximumCandidates}`);
  }

  const point = new THREE.Vector3();
  return {
    metrics: Object.freeze({ candidateVertices, sourceIndexedVertices,
      candidateVerticesByMesh: Object.freeze(candidateVerticesByMesh),
      sourceIndexedVerticesByMesh: Object.freeze(sourceIndexedVerticesByMesh),
      supportBoneNames: SEAT_SUPPORT_BONES, minimumRelevantWeight, posteriorRegion }),
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
