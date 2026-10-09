import * as THREE from 'three';
import type { NativeSourceFrame, NativeSourceJoint, SourceLandmarks } from './native-clip-solver.ts';

export interface DirectionRetargetOptions {
  readonly sourceRest: SourceLandmarks;
  readonly floorY: number;
}

export interface DirectionRetargetResult {
  readonly clipName: string;
  readonly sourceHipTranslation: readonly [number, number, number];
  readonly statureRatio: number;
  readonly footSoleMinY: Readonly<{ left: number; right: number }>;
  readonly footRootShiftY: number;
  readonly maxDirectionErrorRadians: number;
  readonly directionErrorsRadians: Readonly<Record<string, number>>;
  readonly segmentLengthMaxErrorMeters: number;
}

export interface NativeDirectionRetargeter {
  apply(frame: NativeSourceFrame, floorY?: number): DirectionRetargetResult;
  restore(): void;
  dispose(): void;
  readonly metrics: Readonly<{ sourceTorsoLength: number; targetTorsoLength: number; statureRatio: number; footCandidates: Readonly<{ left: number; right: number }> }>;
}

const PAIRS: readonly (readonly [NativeSourceJoint, NativeSourceJoint, string, string])[] = [
  ['Hips','Spine','mixamorigHips','mixamorigSpine'], ['Spine','Spine1','mixamorigSpine','mixamorigSpine1'],
  ['Spine1','Spine2','mixamorigSpine1','mixamorigSpine2'], ['Spine2','Neck','mixamorigSpine2','mixamorigNeck'],
  ['Neck','Head','mixamorigNeck','mixamorigHead'],
  ['LeftShoulder','LeftArm','mixamorigLeftShoulder','mixamorigLeftArm'],
  ['LeftArm','LeftForeArm','mixamorigLeftArm','mixamorigLeftForeArm'],
  ['LeftForeArm','LeftHand','mixamorigLeftForeArm','mixamorigLeftHand'],
  ['RightShoulder','RightArm','mixamorigRightShoulder','mixamorigRightArm'],
  ['RightArm','RightForeArm','mixamorigRightArm','mixamorigRightForeArm'],
  ['RightForeArm','RightHand','mixamorigRightForeArm','mixamorigRightHand'],
  ['LeftUpLeg','LeftLeg','mixamorigLeftUpLeg','mixamorigLeftLeg'],
  ['LeftLeg','LeftFoot','mixamorigLeftLeg','mixamorigLeftFoot'],
  ['LeftFoot','LeftToeBase','mixamorigLeftFoot','mixamorigLeftToeBase'],
  ['RightUpLeg','RightLeg','mixamorigRightUpLeg','mixamorigRightLeg'],
  ['RightLeg','RightFoot','mixamorigRightLeg','mixamorigRightFoot'],
  ['RightFoot','RightToeBase','mixamorigRightFoot','mixamorigRightToeBase'],
];

type Basis = { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 };
type BoneTransform = { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };

function requiredBone(root: THREE.Object3D, name: string): THREE.Bone {
  const bone = root.getObjectByName(name) as THREE.Bone | null;
  if (!bone?.isBone) throw new Error(`Direction retarget requires native bone ${name}`);
  return bone;
}

function vector(value: readonly number[]): THREE.Vector3 {
  if (value.length !== 3 || !value.every(Number.isFinite)) throw new Error('Landmark must be a finite 3-vector');
  return new THREE.Vector3(value[0]!, value[1]!, value[2]!);
}

function basisFrom(points: Readonly<Record<NativeSourceJoint, THREE.Vector3>>): Basis {
  const up = points.Head.clone().sub(points.Hips).normalize();
  const forward = points.LeftToeBase.clone().sub(points.LeftFoot)
    .add(points.RightToeBase.clone().sub(points.RightFoot)).multiplyScalar(0.5);
  forward.addScaledVector(up, -forward.dot(up)).normalize();
  const right = points.RightShoulder.clone().sub(points.LeftShoulder);
  right.addScaledVector(up, -right.dot(up)).addScaledVector(forward, -right.dot(forward)).normalize();
  if ([up, forward, right].some((axis) => axis.lengthSq() < 0.9)) throw new Error('Degenerate anatomical rest basis');
  return { right, up, forward };
}

function pointsFromLandmarks(landmarks: SourceLandmarks): Record<NativeSourceJoint, THREE.Vector3> {
  return Object.fromEntries(Object.keys(landmarks).map((key) => [key, vector(landmarks[key as NativeSourceJoint])])) as Record<NativeSourceJoint, THREE.Vector3>;
}

/** Map one measured source segment direction through the two rigs' measured rest anatomical bases. */
export function mapSourceSegmentDirection(
  sourceRestLandmarks: SourceLandmarks,
  targetRestLandmarks: SourceLandmarks,
  sourceParent: NativeSourceJoint,
  sourceChild: NativeSourceJoint,
  poseLandmarks: SourceLandmarks,
): THREE.Vector3 {
  const sourceRest = pointsFromLandmarks(sourceRestLandmarks), targetRest = pointsFromLandmarks(targetRestLandmarks);
  const sourcePose = pointsFromLandmarks(poseLandmarks);
  const sourceBasis = basisFrom(sourceRest), targetBasis = basisFrom(targetRest);
  const direction = sourcePose[sourceChild].clone().sub(sourcePose[sourceParent]).normalize();
  if (direction.lengthSq() < 0.9) throw new Error(`Degenerate source segment ${sourceParent}/${sourceChild}`);
  return targetBasis.right.clone().multiplyScalar(direction.dot(sourceBasis.right))
    .addScaledVector(targetBasis.up, direction.dot(sourceBasis.up))
    .addScaledVector(targetBasis.forward, direction.dot(sourceBasis.forward)).normalize();
}

function rootLocalPosition(root: THREE.Object3D, node: THREE.Object3D, inverseRoot: THREE.Matrix4): THREE.Vector3 {
  return node.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot.copy(root.matrixWorld).invert());
}

/**
 * Experimental direction-only retargeter. Unlike global landmark IK it never moves intermediate
 * joints to the source's proportions: it aims each native parent toward the mapped source segment
 * direction while retaining that actor's own bone translations/lengths. This is an offline
 * comparison tool, not wired into the runtime.
 */
export function createNativeDirectionRetargeter(root: THREE.Group, options: DirectionRetargetOptions): NativeDirectionRetargeter {
  if (!Number.isFinite(options.floorY)) throw new Error('Direction retarget floor must be finite');
  const sourceRest = pointsFromLandmarks(options.sourceRest);
  const sourceBasis = basisFrom(sourceRest);
  const bones = new Map<string, THREE.Bone>();
  for (const [, , parent, child] of PAIRS) {
    bones.set(parent, requiredBone(root, parent));
    bones.set(child, requiredBone(root, child));
  }
  const transforms = new Map<THREE.Bone, BoneTransform>();
  for (const bone of new Set(bones.values())) transforms.set(bone, { position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() });
  const bodyMeshes: THREE.SkinnedMesh[] = [];
  root.traverse((node) => { const mesh = node as THREE.SkinnedMesh; if (mesh.isSkinnedMesh && mesh.name === 'Body') bodyMeshes.push(mesh); });
  if (bodyMeshes.length !== 1) throw new Error(`Expected one native Body mesh; found ${bodyMeshes.length}`);
  const body = bodyMeshes[0]!;
  const position = body.geometry.getAttribute('position');
  const indices = body.geometry.getAttribute('skinIndex');
  const weights = body.geometry.getAttribute('skinWeight');
  if (!position || !indices || !weights || position.count !== indices.count || indices.count !== weights.count) {
    throw new Error('Body must have aligned position and skin attributes');
  }
  const footBoneIds: Record<'left' | 'right', Set<number>> = { left: new Set(), right: new Set() };
  body.skeleton.bones.forEach((bone, index) => {
    if (bone.name === 'mixamorigLeftFoot' || bone.name === 'mixamorigLeftToeBase') footBoneIds.left.add(index);
    if (bone.name === 'mixamorigRightFoot' || bone.name === 'mixamorigRightToeBase') footBoneIds.right.add(index);
  });
  const footCandidates: Record<'left' | 'right', number[]> = { left: [], right: [] };
  for (let i = 0; i < indices.count; i++) {
    for (const side of ['left','right'] as const) {
      let influence = 0;
      for (let lane = 0; lane < 4; lane++) if (footBoneIds[side].has(indices.getComponent(i, lane))) influence += weights.getComponent(i, lane);
      if (influence > 1e-5) footCandidates[side].push(i);
    }
  }
  if (!footCandidates.left.length || !footCandidates.right.length) throw new Error('Body has no weighted sole candidates');

  const rootInverse = new THREE.Matrix4(), rootRotation = new THREE.Quaternion();
  const current = new THREE.Vector3(), desired = new THREE.Vector3(), worldDelta = new THREE.Quaternion();
  const currentWorld = new THREE.Quaternion(), parentWorld = new THREE.Quaternion();
  const vertex = new THREE.Vector3();
  const targetRest = {} as Record<NativeSourceJoint, THREE.Vector3>;
  const rootHip = requiredBone(root, 'mixamorigHips');
  const updateWorld = () => { root.updateWorldMatrix(true, false); root.updateMatrixWorld(true); };
  updateWorld();
  for (const [sourceJoint, , targetBone] of PAIRS) targetRest[sourceJoint] = rootLocalPosition(root, bones.get(targetBone)!, rootInverse);
  const lastSourceJoint = PAIRS.at(-1)![1];
  targetRest[lastSourceJoint] = rootLocalPosition(root, bones.get(PAIRS.at(-1)![3])!, rootInverse);
  // Ensure every source joint gets an exact target-rest anchor, including the opposite limb end points.
  for (const [sourceParent, sourceChild, targetParent, targetChild] of PAIRS) {
    targetRest[sourceParent] ??= rootLocalPosition(root, bones.get(targetParent)!, rootInverse);
    targetRest[sourceChild] ??= rootLocalPosition(root, bones.get(targetChild)!, rootInverse);
  }
  const targetBasis = basisFrom(targetRest);
  const sourceTorsoLength = sourceRest.Head.distanceTo(sourceRest.Hips);
  const targetTorsoLength = targetRest.Head.distanceTo(targetRest.Hips);
  if (!(sourceTorsoLength > 0.1 && targetTorsoLength > 0.1)) throw new Error('Invalid measured torso length');
  const statureRatio = targetTorsoLength / sourceTorsoLength;
  const restLengths = PAIRS.map(([, , parent, child]) => rootLocalPosition(root, bones.get(parent)!, rootInverse)
    .distanceTo(rootLocalPosition(root, bones.get(child)!, rootInverse)));
  let disposed = false;

  function restore(): void {
    if (disposed) return;
    for (const [bone, state] of transforms) { bone.position.copy(state.position); bone.quaternion.copy(state.quaternion); bone.scale.copy(state.scale); }
    updateWorld();
  }

  function mappedVector(sourceVector: THREE.Vector3): THREE.Vector3 {
    return targetBasis.right.clone().multiplyScalar(sourceVector.dot(sourceBasis.right))
      .addScaledVector(targetBasis.up, sourceVector.dot(sourceBasis.up))
      .addScaledVector(targetBasis.forward, sourceVector.dot(sourceBasis.forward));
  }
  function mappedDirection(sourceDirection: THREE.Vector3): THREE.Vector3 {
    return mappedVector(sourceDirection).normalize();
  }

  function setRootLocalBonePoint(bone: THREE.Bone, desiredRootPoint: THREE.Vector3): void {
    if (!bone.parent) throw new Error(`${bone.name} has no parent`);
    updateWorld();
    const world = desiredRootPoint.clone().applyMatrix4(root.matrixWorld);
    bone.parent.worldToLocal(world);
    bone.position.copy(world);
    updateWorld();
  }

  function aim(bone: THREE.Bone, child: THREE.Bone, targetRootDirection: THREE.Vector3): void {
    if (!bone.parent) throw new Error(`${bone.name} has no parent`);
    updateWorld();
    current.subVectors(child.getWorldPosition(new THREE.Vector3()), bone.getWorldPosition(new THREE.Vector3())).normalize();
    root.getWorldQuaternion(rootRotation);
    desired.copy(targetRootDirection).applyQuaternion(rootRotation).normalize();
    if (current.lengthSq() < 0.9 || desired.lengthSq() < 0.9) throw new Error(`Invalid direction for ${bone.name}`);
    worldDelta.setFromUnitVectors(current, desired);
    bone.getWorldQuaternion(currentWorld).premultiply(worldDelta);
    bone.parent.getWorldQuaternion(parentWorld);
    bone.quaternion.copy(parentWorld.invert().multiply(currentWorld).normalize());
    updateWorld();
  }

  function measureSoles(): { left: number; right: number } {
    updateWorld(); body.skeleton.update();
    const result = { left: Infinity, right: Infinity };
    for (const side of ['left','right'] as const) for (const index of footCandidates[side]) {
      body.getVertexPosition(index, vertex); body.localToWorld(vertex);
      result[side] = Math.min(result[side], vertex.y);
    }
    if (![result.left, result.right].every(Number.isFinite)) throw new Error('Invalid weighted sole samples');
    return result;
  }

  function apply(frame: NativeSourceFrame, floorY = options.floorY): DirectionRetargetResult {
    if (!Number.isFinite(floorY)) throw new Error('Direction retarget floor must be finite');
    if (disposed) throw new Error('Direction retargeter is disposed');
    restore();
    const sourcePose = pointsFromLandmarks(frame.landmarks);
    const hipDelta = mappedVector(sourcePose.Hips.clone().sub(sourceRest.Hips)).multiplyScalar(statureRatio);
    const restHip = targetRest.Hips;
    setRootLocalBonePoint(rootHip, restHip.clone().add(hipDelta));
    for (const [sourceParent, sourceChild, targetParent, targetChild] of PAIRS) {
      const sourceVector = sourcePose[sourceChild].clone().sub(sourcePose[sourceParent]);
      if (sourceVector.lengthSq() < 1e-8) throw new Error(`Degenerate source direction ${sourceParent}/${sourceChild}`);
      aim(bones.get(targetParent)!, bones.get(targetChild)!, mappedDirection(sourceVector));
    }
    const solesBefore = measureSoles();
    const shiftY = floorY - Math.min(solesBefore.left, solesBefore.right);
    const hipWorld = rootHip.getWorldPosition(new THREE.Vector3()); hipWorld.y += shiftY;
    rootHip.parent!.worldToLocal(hipWorld); rootHip.position.copy(hipWorld); updateWorld();
    const soles = measureSoles();
    const errors: Record<string, number> = {};
    let maxDirectionErrorRadians = 0;
    let segmentLengthMaxErrorMeters = 0;
    PAIRS.forEach(([sourceParent, sourceChild, targetParent, targetChild], index) => {
      const want = mappedDirection(sourcePose[sourceChild].clone().sub(sourcePose[sourceParent]));
      const have = rootLocalPosition(root, bones.get(targetChild)!, rootInverse)
        .sub(rootLocalPosition(root, bones.get(targetParent)!, rootInverse)).normalize();
      const error = want.angleTo(have);
      errors[`${sourceParent}->${sourceChild}`] = error;
      maxDirectionErrorRadians = Math.max(maxDirectionErrorRadians, error);
      const length = rootLocalPosition(root, bones.get(targetChild)!, rootInverse)
        .distanceTo(rootLocalPosition(root, bones.get(targetParent)!, rootInverse));
      segmentLengthMaxErrorMeters = Math.max(segmentLengthMaxErrorMeters, Math.abs(length - restLengths[index]!));
    });
    return Object.freeze({ clipName: frame.clipName, sourceHipTranslation: Object.freeze(hipDelta.toArray()) as readonly [number,number,number],
      statureRatio, footSoleMinY: Object.freeze(soles), footRootShiftY: shiftY,
      maxDirectionErrorRadians, directionErrorsRadians: Object.freeze(errors), segmentLengthMaxErrorMeters });
  }

  return Object.freeze({ apply, restore,
    metrics: Object.freeze({ sourceTorsoLength, targetTorsoLength, statureRatio,
      footCandidates: Object.freeze({ left: footCandidates.left.length, right: footCandidates.right.length }) }),
    dispose() { if (disposed) return; restore(); disposed = true; },
  });
}
