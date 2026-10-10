import * as THREE from 'three';
import type { NativeSourceFrame, NativeSourceJoint, SourceLandmarks } from './native-source-pose.ts';

type GestureSegment = readonly [NativeSourceJoint, NativeSourceJoint, string, string];
const ARM_SEGMENTS: readonly GestureSegment[] = [
  ['LeftShoulder', 'LeftArm', 'mixamorigLeftShoulder', 'mixamorigLeftArm'],
  ['LeftArm', 'LeftForeArm', 'mixamorigLeftArm', 'mixamorigLeftForeArm'],
  ['LeftForeArm', 'LeftHand', 'mixamorigLeftForeArm', 'mixamorigLeftHand'],
  ['RightShoulder', 'RightArm', 'mixamorigRightShoulder', 'mixamorigRightArm'],
  ['RightArm', 'RightForeArm', 'mixamorigRightArm', 'mixamorigRightForeArm'],
  ['RightForeArm', 'RightHand', 'mixamorigRightForeArm', 'mixamorigRightHand'],
];
const FRAME_JOINTS: readonly NativeSourceJoint[] = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'LeftShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand',
  'RightShoulder', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
];

export interface NativeInteractionGestureController {
  /** Apply one measured source frame to the six native shoulder/arm/forearm segments. */
  apply(frame: NativeSourceFrame): void;
  /** Restore the arm rotations captured from the corrected native rest pose. */
  restore(): void;
  dispose(): void;
}

export interface NativeInteractionGestureOptions {
  /** Original measured source rest frame; used only to define the source anatomical basis. */
  readonly sourceRestLandmarks: SourceLandmarks;
  /** Explicit measured source idle/neutral frame that the native corrected rest should represent. */
  readonly sourceNeutralLandmarks: SourceLandmarks;
}

type Basis = { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 };
type ArmState = { bone: THREE.Bone; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };

function requiredBone(root: THREE.Group, name: string): THREE.Bone {
  const found = root.getObjectByName(name);
  if (!(found instanceof THREE.Bone)) throw new Error(`Native interaction gesture requires bone ${name}`);
  return found;
}

function pointsFrom(landmarks: SourceLandmarks): Record<NativeSourceJoint, THREE.Vector3> {
  const points = {} as Record<NativeSourceJoint, THREE.Vector3>;
  for (const joint of FRAME_JOINTS) {
    const value = landmarks[joint];
    if (!value || value.length !== 3 || !value.every(Number.isFinite)) {
      throw new Error(`Native interaction gesture requires finite ${joint} source landmark`);
    }
    points[joint] = new THREE.Vector3(value[0], value[1], value[2]);
  }
  return points;
}

function basis(points: Record<NativeSourceJoint, THREE.Vector3>): Basis {
  const up = points.Head.clone().sub(points.Hips).normalize();
  const forward = points.LeftToeBase.clone().sub(points.LeftFoot)
    .add(points.RightToeBase.clone().sub(points.RightFoot)).multiplyScalar(0.5);
  forward.addScaledVector(up, -forward.dot(up)).normalize();
  const right = points.RightShoulder.clone().sub(points.LeftShoulder);
  right.addScaledVector(up, -right.dot(up)).addScaledVector(forward, -right.dot(forward)).normalize();
  const determinant = right.dot(up.clone().cross(forward));
  if ([up, forward, right].some((axis) => !axis.toArray().every(Number.isFinite) || axis.lengthSq() < 0.9)
    || Math.abs(Math.abs(determinant) - 1) > 1e-4
    || Math.abs(right.dot(up)) > 1e-4 || Math.abs(right.dot(forward)) > 1e-4 || Math.abs(up.dot(forward)) > 1e-4) {
    throw new Error('Native interaction gesture cannot construct a measured anatomical basis');
  }
  return { right, up, forward };
}

function mapThroughBases(source: Basis, target: Basis, direction: THREE.Vector3): THREE.Vector3 {
  return target.right.clone().multiplyScalar(direction.dot(source.right))
    .addScaledVector(target.up, direction.dot(source.up))
    .addScaledVector(target.forward, direction.dot(source.forward)).normalize();
}

function unitSegment(
  points: Record<NativeSourceJoint, THREE.Vector3>, parent: NativeSourceJoint, child: NativeSourceJoint,
): THREE.Vector3 {
  const direction = points[child].clone().sub(points[parent]);
  if (!Number.isFinite(direction.lengthSq()) || direction.lengthSq() < 1e-10) {
    throw new Error(`Native interaction gesture has a degenerate ${parent}/${child} source segment`);
  }
  return direction.normalize();
}

function actorLocalPoint(root: THREE.Group, bone: THREE.Bone): THREE.Vector3 {
  root.updateWorldMatrix(true, true);
  return bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(root.matrixWorld.clone().invert());
}

/**
 * Retargets measured source upper-limb segment directions onto this actor's corrected rest axes.
 * It changes rotations on shoulder/arm/forearm bones only: no hips, torso, hand, leg, foot, or
 * joint translation/scale is authored here. Call after corrected native rest has been established.
 */
export function createNativeInteractionGestureController(
  root: THREE.Group,
  options: NativeInteractionGestureOptions,
): NativeInteractionGestureController {
  const sourceRest = pointsFrom(options.sourceRestLandmarks);
  const sourceNeutral = pointsFrom(options.sourceNeutralLandmarks);
  const sourceBasis = basis(sourceRest);
  const segments = ARM_SEGMENTS.map(([sourceParent, sourceChild, parentName, childName]) => ({
    sourceParent, sourceChild,
    parent: requiredBone(root, parentName),
    child: requiredBone(root, childName),
  }));
  const nativeRestPoints = {} as Record<NativeSourceJoint, THREE.Vector3>;
  for (const segment of segments) {
    nativeRestPoints[segment.sourceParent] = actorLocalPoint(root, segment.parent);
    nativeRestPoints[segment.sourceChild] = actorLocalPoint(root, segment.child);
  }
  // Anatomical basis anchors outside the arm chain are captured from the current corrected rig.
  const anchorNames: Readonly<Record<NativeSourceJoint, string>> = {
    Hips: 'mixamorigHips', Spine: 'mixamorigSpine', Spine1: 'mixamorigSpine1', Spine2: 'mixamorigSpine2',
    Neck: 'mixamorigNeck', Head: 'mixamorigHead',
    LeftShoulder: 'mixamorigLeftShoulder', LeftArm: 'mixamorigLeftArm', LeftForeArm: 'mixamorigLeftForeArm', LeftHand: 'mixamorigLeftHand',
    RightShoulder: 'mixamorigRightShoulder', RightArm: 'mixamorigRightArm', RightForeArm: 'mixamorigRightForeArm', RightHand: 'mixamorigRightHand',
    LeftUpLeg: 'mixamorigLeftUpLeg', LeftLeg: 'mixamorigLeftLeg', LeftFoot: 'mixamorigLeftFoot', LeftToeBase: 'mixamorigLeftToeBase',
    RightUpLeg: 'mixamorigRightUpLeg', RightLeg: 'mixamorigRightLeg', RightFoot: 'mixamorigRightFoot', RightToeBase: 'mixamorigRightToeBase',
  };
  for (const joint of FRAME_JOINTS) {
    if (nativeRestPoints[joint]) continue;
    nativeRestPoints[joint] = actorLocalPoint(root, requiredBone(root, anchorNames[joint]));
  }
  const nativeBasis = basis(nativeRestPoints);
  const targetRestDirections = ARM_SEGMENTS.map(([parent, child]) => unitSegment(nativeRestPoints, parent, child));
  // Bind T/A-pose and animation-neutral landmarks can differ substantially. Keep an explicit
  // measured neutral reference so source idle posture is not added on top of corrected native rest.
  const sourceNeutralDirections = ARM_SEGMENTS.map(([parent, child]) => mapThroughBases(sourceBasis, nativeBasis, unitSegment(sourceNeutral, parent, child)));
  // Capture only the six articulated parents; their child hand bones may have a separate wrist controller.
  const states: ArmState[] = [...new Set(segments.map((segment) => segment.parent))].map((bone) => ({
    bone, position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone(),
  }));
  const desiredDirection = new THREE.Vector3();
  const inverseParentMatrix = new THREE.Matrix4();
  const localChildOffset = new THREE.Vector3();
  let disposed = false;

  function restoreArm(): void {
    for (const state of states) {
      state.bone.position.copy(state.position);
      state.bone.quaternion.copy(state.quaternion);
      state.bone.scale.copy(state.scale);
    }
    root.updateWorldMatrix(true, true);
  }

  function aim(bone: THREE.Bone, child: THREE.Bone, directionInRoot: THREE.Vector3): void {
    if (!bone.parent) throw new Error(`Native interaction gesture bone ${bone.name} has no parent`);
    if (child.parent !== bone) throw new Error(`Native interaction gesture expected ${bone.name} to parent ${child.name}`);
    root.updateWorldMatrix(true, true);
    desiredDirection.copy(directionInRoot).transformDirection(root.matrixWorld);
    localChildOffset.copy(child.position).multiply(bone.scale).normalize();
    if (localChildOffset.lengthSq() < 0.9 || desiredDirection.lengthSq() < 0.9) {
      throw new Error(`Native interaction gesture has invalid direction for ${bone.name}`);
    }
    desiredDirection.transformDirection(inverseParentMatrix.copy(bone.parent.matrixWorld).invert());
    bone.quaternion.setFromUnitVectors(localChildOffset, desiredDirection).normalize();
    root.updateWorldMatrix(true, true);
  }

  return {
    apply(frame: NativeSourceFrame): void {
      if (disposed) throw new Error('Native interaction gesture controller is disposed');
      if (!frame.clipName || !Number.isFinite(frame.duration) || frame.duration <= 0) {
        throw new Error('Native interaction gesture requires a valid measured source frame');
      }
      const sourcePose = pointsFrom(frame.landmarks);
      // Validate and compute every target before mutating the native rig, so a rejected frame is atomic.
      const targets = ARM_SEGMENTS.map(([parent, child], index) => {
        const poseDirection = mapThroughBases(sourceBasis, nativeBasis, unitSegment(sourcePose, parent, child));
        const actorDelta = new THREE.Quaternion().setFromUnitVectors(sourceNeutralDirections[index]!, poseDirection);
        return targetRestDirections[index]!.clone().applyQuaternion(actorDelta).normalize();
      });
      restoreArm();
      segments.forEach((segment, index) => {
        aim(segment.parent, segment.child, targets[index]!);
      });
    },
    restore(): void { restoreArm(); },
    dispose(): void {
      if (disposed) return;
      restoreArm();
      disposed = true;
    },
  };
}
