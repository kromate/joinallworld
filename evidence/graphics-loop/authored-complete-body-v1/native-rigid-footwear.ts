import * as THREE from 'three';

export interface RigidFootwearOptions {
  /** Root-local distance below each Foot joint used to exclude the sock/ankle transition. */
  readonly ankleOffsetMetres?: number;
  readonly minimumFootToeWeight?: number;
  readonly maximumOppositeFootWeight?: number;
  /** Report calf-bearing vertices above the preservation plane when their weight exceeds this. */
  readonly maximumCalfWeight?: number;
}

export interface RigidFootwearMetrics {
  readonly vertices: number;
  readonly classifiedVertices: number;
  readonly sourceAlreadyRigidVertices: number;
  readonly changedVertices: number;
  readonly selectedLeftVertices: number;
  readonly selectedRightVertices: number;
  readonly leftVertices: number;
  readonly rightVertices: number;
  readonly preservedSockVertices: number;
  readonly preservedCalfAbovePlaneVertices: number;
  readonly maximumPreservedCalfWeight: number;
  readonly maximumCalfWeightOnRigidVertices: number;
  readonly minimumPlaneClearanceMetres: number;
  readonly ambiguousVertices: number;
  readonly maximumRestDisplacementMetres: number;
  readonly originalSkinIndexBytes: number;
  readonly originalSkinWeightBytes: number;
}

export interface RigidFootwearController {
  readonly metrics: RigidFootwearMetrics;
  restore(): void;
  dispose(): void;
}

function invariant(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Rigid footwear: ${message}`);
}

function canonical(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^mixamorig/, '');
}

function findBone(root: THREE.Object3D, name: string): THREE.Bone {
  let result: THREE.Bone | undefined;
  root.traverse((node) => {
    if ((node as THREE.Bone).isBone && canonical(node.name) === name) {
      invariant(!result, `ambiguous bone ${name}`);
      result = node as THREE.Bone;
    }
  });
  invariant(result, `missing bone ${name}`);
  return result;
}

function boneIndex(mesh: THREE.SkinnedMesh, bone: THREE.Bone): number {
  const index = mesh.skeleton.bones.indexOf(bone);
  invariant(index >= 0, `bone ${bone.name} is not in the shoe skeleton`);
  return index;
}

function checkedWeight(attribute: THREE.BufferAttribute, vertex: number, lane: number): number {
  const value = attribute.getComponent(vertex, lane);
  invariant(Number.isFinite(value) && value >= 0, `invalid skin weight at vertex ${vertex}`);
  return value;
}

function updateActorSkinning(root: THREE.Object3D): void {
  // updateWorldMatrix alone skips SkinnedMesh's attached-bind inverse update in Three r180.
  root.updateWorldMatrix(true, false);
  root.updateMatrixWorld(true);
  root.traverse((node) => { if ((node as THREE.SkinnedMesh).isSkinnedMesh) (node as THREE.SkinnedMesh).skeleton.update(); });
}

/**
 * Optionally makes only the source-authored shoe shell rigid to its corresponding Foot bone.
 * This mutates actor-private shoe skin attributes only; body, source template and geometry
 * position/index/morph payloads remain untouched. Ambiguous lower-leg or cross-foot weights
 * fail closed before either attribute is replaced.
 */
export function refineRigidFootwear(
  actorRoot: THREE.Object3D,
  shoe: THREE.SkinnedMesh,
  options: RigidFootwearOptions = {},
): RigidFootwearController {
  const ankleOffset = options.ankleOffsetMetres ?? 0.055;
  const minFootToe = options.minimumFootToeWeight ?? 0.2;
  const maxOpposite = options.maximumOppositeFootWeight ?? 0.02;
  const maxCalf = options.maximumCalfWeight ?? 0.18;
  invariant(Number.isFinite(ankleOffset) && ankleOffset >= 0 && ankleOffset <= 0.12, 'ankle offset must be within 0–12 cm');
  invariant(minFootToe > 0 && minFootToe <= 1 && maxOpposite >= 0 && maxOpposite < minFootToe, 'invalid influence thresholds');
  invariant(maxCalf >= 0 && maxCalf < 1, 'invalid calf threshold');
  invariant(actorRoot === shoe || actorRoot.getObjectById(shoe.id) === shoe, 'shoe is not below the supplied actor root');
  invariant(shoe.parent, 'shoe must be attached before refinement');
  const skeleton = shoe.skeleton;
  const leftFoot = findBone(actorRoot, 'leftfoot'), rightFoot = findBone(actorRoot, 'rightfoot');
  const leftToe = findBone(actorRoot, 'lefttoebase'), rightToe = findBone(actorRoot, 'righttoebase');
  const leftLeg = findBone(actorRoot, 'leftleg'), rightLeg = findBone(actorRoot, 'rightleg');
  const leftFootIndex = boneIndex(shoe, leftFoot), rightFootIndex = boneIndex(shoe, rightFoot);
  const leftToeIndex = boneIndex(shoe, leftToe), rightToeIndex = boneIndex(shoe, rightToe);
  const leftLegIndex = boneIndex(shoe, leftLeg), rightLegIndex = boneIndex(shoe, rightLeg);
  const skinIndex = shoe.geometry.getAttribute('skinIndex');
  const skinWeight = shoe.geometry.getAttribute('skinWeight');
  const position = shoe.geometry.getAttribute('position');
  invariant(skinIndex instanceof THREE.BufferAttribute && skinWeight instanceof THREE.BufferAttribute && position instanceof THREE.BufferAttribute,
    'shoe requires regular position, skinIndex and skinWeight attributes');
  invariant(skinIndex.itemSize === 4 && skinWeight.itemSize === 4 && skinIndex.count === position.count && skinWeight.count === position.count,
    'shoe skin attribute layout is unsupported');
  invariant(!skinIndex.normalized, 'joint indices must remain non-normalized');
  invariant(skinIndex.array !== (shoe.userData.sourceSkinIndexArray as ArrayBufferView | undefined), 'shoe skin indices must be actor-private');

  updateActorSkinning(actorRoot);
  const rootInverse = actorRoot.matrixWorld.clone().invert();
  const leftFootY = leftFoot.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInverse).y;
  const rightFootY = rightFoot.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInverse).y;
  const sourceIndices = skinIndex.array.slice() as typeof skinIndex.array;
  const sourceWeights = skinWeight.array.slice() as typeof skinWeight.array;
  const nextIndices = sourceIndices.slice() as typeof sourceIndices;
  const nextWeights = sourceWeights.slice() as typeof sourceWeights;
  const candidates: Array<{ vertex: number; footIndex: number; side: 'left' | 'right'; rootY: number; calfWeight: number }> = [];
  let preservedSockVertices = 0, preservedCalfAbovePlaneVertices = 0, maximumPreservedCalfWeight = 0;
  let ambiguousVertices = 0;
  const diagnostic = { yMin: Infinity, yMax: -Infinity, footY: [leftFootY, rightFootY], underPlane: 0, lowWithFoot: 0, lowNoFoot: 0, maxFootToe: 0, maxCalf: 0, lowWithCalf: 0, calfRejected: 0, calfToFootBins: [0,0,0,0,0] };
  const local = new THREE.Vector3();
  const world = new THREE.Vector3();

  for (let vertex = 0; vertex < position.count; vertex++) {
    let left = 0, right = 0, leftCalf = 0, rightCalf = 0;
    for (let lane = 0; lane < 4; lane++) {
      const joint = Math.round(skinIndex.getComponent(vertex, lane));
      invariant(Number.isInteger(joint) && joint >= 0 && joint < skeleton.bones.length, `invalid joint at vertex ${vertex}`);
      const weight = checkedWeight(skinWeight, vertex, lane);
      if (joint === leftFootIndex || joint === leftToeIndex) left += weight;
      if (joint === rightFootIndex || joint === rightToeIndex) right += weight;
      if (joint === leftLegIndex) leftCalf += weight;
      if (joint === rightLegIndex) rightCalf += weight;
    }
    shoe.getVertexPosition(vertex, local);
    world.copy(local).applyMatrix4(shoe.matrixWorld).applyMatrix4(rootInverse);
    diagnostic.yMin = Math.min(diagnostic.yMin, world.y); diagnostic.yMax = Math.max(diagnostic.yMax, world.y);
    diagnostic.maxFootToe = Math.max(diagnostic.maxFootToe, left, right); diagnostic.maxCalf = Math.max(diagnostic.maxCalf, leftCalf, rightCalf);
    const leftRegion = world.y <= leftFootY - ankleOffset;
    const rightRegion = world.y <= rightFootY - ankleOffset;
    if (leftRegion || rightRegion) diagnostic.underPlane++;
    const isLeft = leftRegion && left >= minFootToe && right <= maxOpposite;
    const isRight = rightRegion && right >= minFootToe && left <= maxOpposite;
    if (!leftRegion && !rightRegion) {
      preservedSockVertices++;
      const calf = Math.max(leftCalf, rightCalf);
      if (calf > maxCalf) preservedCalfAbovePlaneVertices++;
      maximumPreservedCalfWeight = Math.max(maximumPreservedCalfWeight, calf);
      continue;
    }
    if (!isLeft && !isRight) {
      // Vertices above the ankle plane belong to the sock/leg transition. Lower vertices with
      // bilateral, weak, or opposite-foot support are ambiguous and must not be altered.
      if (world.y > Math.min(leftFootY, rightFootY) - ankleOffset) { preservedSockVertices++; continue; }
      if (Math.max(left, right) > 0) diagnostic.lowWithFoot++; else diagnostic.lowNoFoot++;
      if (Math.max(leftCalf, rightCalf) > maxCalf) diagnostic.lowWithCalf++;
      ambiguousVertices++;
      continue;
    }
    const calfWeight = isLeft ? leftCalf : rightCalf;
    const calfBin = Math.min(4, Math.floor(calfWeight / Math.max(isLeft ? left : right, 1e-6) * 2));
    diagnostic.calfToFootBins[calfBin] = (diagnostic.calfToFootBins[calfBin] ?? 0) + 1;
    // A calf blend is expected around the shoe ankle. The geometric plane is what protects
    // the sock: anything above it is retained byte-for-byte. Only foot-side ambiguity makes
    // the lower shell unsafe to rigidify.
    if (calfWeight > maxCalf) diagnostic.calfRejected++;
    const planeY = isLeft ? leftFootY - ankleOffset : rightFootY - ankleOffset;
    invariant(world.y <= planeY, `vertex ${vertex} with calf/foot skin lies above the rigidification plane`);
    candidates.push({ vertex, footIndex: isLeft ? leftFootIndex : rightFootIndex,
      side: isLeft ? 'left' : 'right', rootY: world.y, calfWeight });
  }
  invariant(ambiguousVertices === 0, `${ambiguousVertices} lower-shoe vertices have ambiguous foot/calf support; ${JSON.stringify(diagnostic)}`);
  invariant(candidates.some((item) => item.side === 'left') && candidates.some((item) => item.side === 'right'),
    `both shoe sides must have at least one unambiguous lower-foot vertex; classified ${candidates.length}/${position.count}`);

  const replacementIndex = new THREE.BufferAttribute(nextIndices, skinIndex.itemSize, skinIndex.normalized);
  const replacementWeight = new THREE.BufferAttribute(nextWeights, skinWeight.itemSize, skinWeight.normalized);
  for (const { vertex, footIndex } of candidates) {
    replacementIndex.setXYZW(vertex, footIndex, 0, 0, 0);
    replacementWeight.setXYZW(vertex, 1, 0, 0, 0);
  }
  const changedCandidates = candidates.filter(({ vertex }) =>
    Array.from({ length: 4 }, (_, lane) => lane).some((lane) =>
      skinIndex.getComponent(vertex, lane) !== replacementIndex.getComponent(vertex, lane)
      || Math.abs(skinWeight.getComponent(vertex, lane) - replacementWeight.getComponent(vertex, lane)) > 1e-7));
  const originalIndexAttribute = skinIndex;
  const originalWeightAttribute = skinWeight;
  const originalCandidateWorld = new Map<number, THREE.Vector3>();
  for (const { vertex } of candidates) originalCandidateWorld.set(vertex, shoe.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(shoe.matrixWorld).clone());
  let maxRestDisplacement = 0;
  if (changedCandidates.length > 0) {
    shoe.geometry.setAttribute('skinIndex', replacementIndex);
    shoe.geometry.setAttribute('skinWeight', replacementWeight);
    updateActorSkinning(actorRoot);
    for (const { vertex } of changedCandidates) {
      const after = shoe.getVertexPosition(vertex, new THREE.Vector3()).applyMatrix4(shoe.matrixWorld);
      maxRestDisplacement = Math.max(maxRestDisplacement, after.distanceTo(originalCandidateWorld.get(vertex)!));
    }
    if (!(maxRestDisplacement < 2e-5)) {
      shoe.geometry.setAttribute('skinIndex', originalIndexAttribute);
      shoe.geometry.setAttribute('skinWeight', originalWeightAttribute);
      invariant(false, `rigid rest pose differs by ${maxRestDisplacement.toFixed(6)} m`);
    }
    shoe.geometry.computeBoundingSphere();
    shoe.geometry.computeBoundingBox();
  }
  let restored = false;
  const metrics: RigidFootwearMetrics = Object.freeze({
    vertices: position.count,
    classifiedVertices: candidates.length,
    sourceAlreadyRigidVertices: candidates.length - changedCandidates.length,
    changedVertices: changedCandidates.length,
    leftVertices: changedCandidates.filter((item) => item.side === 'left').length,
    rightVertices: changedCandidates.filter((item) => item.side === 'right').length,
    selectedLeftVertices: candidates.filter((item) => item.side === 'left').length,
    selectedRightVertices: candidates.filter((item) => item.side === 'right').length,
    preservedSockVertices,
    preservedCalfAbovePlaneVertices,
    maximumPreservedCalfWeight,
    maximumCalfWeightOnRigidVertices: Math.max(0, ...candidates.map((item) => item.calfWeight)),
    minimumPlaneClearanceMetres: Math.min(...candidates.map((item) => Math.min(leftFootY, rightFootY) - ankleOffset - item.rootY)),
    ambiguousVertices,
    maximumRestDisplacementMetres: maxRestDisplacement,
    originalSkinIndexBytes: skinIndex.array.byteLength,
    originalSkinWeightBytes: skinWeight.array.byteLength,
  });
  const restore = (): void => {
    if (restored) return;
    restored = true;
    shoe.geometry.setAttribute('skinIndex', originalIndexAttribute);
    shoe.geometry.setAttribute('skinWeight', originalWeightAttribute);
    shoe.geometry.computeBoundingSphere();
    shoe.geometry.computeBoundingBox();
  };
  return { metrics, restore, dispose: restore };
}
