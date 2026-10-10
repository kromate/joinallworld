import * as THREE from 'three';
import type { NativeSourceWristRotations, NativeWristSourceFrame } from '../native-source-sampler.ts';
import { mapSourceWristOrientation } from './native-wrist-orientation.ts';

export interface NativeWristControllerResult {
  readonly leftSourceDeltaRadians: number;
  readonly rightSourceDeltaRadians: number;
  readonly maxHandOriginErrorMeters: number;
}

export interface NativeWristOrientationController {
  /** Apply after the native positional solver, before attaching/updating hand props. */
  apply(frame: NativeWristSourceFrame): NativeWristControllerResult;
  restore(): void;
  dispose(): void;
}

function requireBone(root: THREE.Object3D, name: string): THREE.Bone {
  const bone = root.getObjectByName(name) as THREE.Bone | null;
  if (!bone?.isBone) throw new Error(`Native wrist controller requires ${name}`);
  return bone;
}

function rootRelativeQuaternion(root: THREE.Object3D, bone: THREE.Bone): THREE.Quaternion {
  root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
  return root.getWorldQuaternion(new THREE.Quaternion()).invert()
    .multiply(bone.getWorldQuaternion(new THREE.Quaternion())).normalize();
}

function validateQuaternion(value: THREE.Quaternion, label: string): void {
  if (![value.x,value.y,value.z,value.w].every(Number.isFinite) || Math.abs(value.length() - 1) > 1e-5) {
    throw new Error(`Native wrist source has an invalid ${label} quaternion`);
  }
}

function captureSourceQuaternion(value: THREE.Quaternion, label: string): THREE.Quaternion {
  validateQuaternion(value, label);
  // The sampler reuses and mutates its frame quaternions on every sample. Keep an owned
  // baseline so a later source sample cannot silently redefine the controller's rest pose.
  return value.clone().normalize();
}

/**
 * Transfers measured source wrist articulation after positional IK. The frame is sampler-owned and
 * ephemeral: consume it synchronously before requesting another clip sample. This controller owns
 * only the two native hand local quaternions and never changes the solved wrist origins.
 */
export function createNativeWristOrientationController(
  root: THREE.Object3D,
  sourceRestWristRotations: NativeSourceWristRotations,
): NativeWristOrientationController {
  const sides = {
    left: { sourceForearm: captureSourceQuaternion(sourceRestWristRotations.forearm.left, 'left rest forearm'),
      sourceHand: captureSourceQuaternion(sourceRestWristRotations.hand.left, 'left rest hand'),
      targetForearm: requireBone(root,'mixamorigLeftForeArm'), targetHand: requireBone(root,'mixamorigLeftHand') },
    right: { sourceForearm: captureSourceQuaternion(sourceRestWristRotations.forearm.right, 'right rest forearm'),
      sourceHand: captureSourceQuaternion(sourceRestWristRotations.hand.right, 'right rest hand'),
      targetForearm: requireBone(root,'mixamorigRightForeArm'), targetHand: requireBone(root,'mixamorigRightHand') },
  };
  const rest = {} as Record<'left'|'right', { targetForearmRoot: THREE.Quaternion; targetHandLocal: THREE.Quaternion }>;
  for (const side of ['left','right'] as const) {
    validateQuaternion(sides[side].sourceForearm, `${side} rest forearm`);
    validateQuaternion(sides[side].sourceHand, `${side} rest hand`);
    rest[side] = { targetForearmRoot: rootRelativeQuaternion(root,sides[side].targetForearm),
      targetHandLocal: sides[side].targetHand.quaternion.clone().normalize() };
  }
  let disposed = false;

  function restore(): void {
    if (disposed) return;
    for (const side of ['left','right'] as const) sides[side].targetHand.quaternion.copy(rest[side].targetHandLocal);
    root.updateWorldMatrix(true,false); root.updateMatrixWorld(true);
  }

  function apply(frame: NativeWristSourceFrame): NativeWristControllerResult {
    if (disposed) throw new Error('Native wrist orientation controller is disposed');
    if (!frame.clipName || !(frame.duration > 0) || !Number.isFinite(frame.duration) || !frame.wristRotations) {
      throw new Error('Native wrist frame metadata is invalid or absent');
    }
    const originBefore = {
      left: sides.left.targetHand.getWorldPosition(new THREE.Vector3()),
      right: sides.right.targetHand.getWorldPosition(new THREE.Vector3()),
    };
    const deltas = { left: 0, right: 0 };
    for (const side of ['left','right'] as const) {
      const sourcePoseForearm = frame.wristRotations.forearm[side];
      const sourcePoseHand = frame.wristRotations.hand[side];
      validateQuaternion(sourcePoseForearm, `${side} pose forearm`);
      validateQuaternion(sourcePoseHand, `${side} pose hand`);
      const mapped = mapSourceWristOrientation({
        sourceRestForearmRoot: sides[side].sourceForearm,
        sourcePoseForearmRoot: sourcePoseForearm,
        sourceRestHandRoot: sides[side].sourceHand,
        sourcePoseHandRoot: sourcePoseHand,
        targetRestForearmRoot: rest[side].targetForearmRoot,
        targetRestHandLocal: rest[side].targetHandLocal,
      });
      sides[side].targetHand.quaternion.copy(mapped.local);
      deltas[side] = mapped.sourceDeltaRadians;
    }
    root.updateWorldMatrix(true,false); root.updateMatrixWorld(true);
    const maxHandOriginErrorMeters = Math.max(
      originBefore.left.distanceTo(sides.left.targetHand.getWorldPosition(new THREE.Vector3())),
      originBefore.right.distanceTo(sides.right.targetHand.getWorldPosition(new THREE.Vector3())),
    );
    if (!Number.isFinite(maxHandOriginErrorMeters) || maxHandOriginErrorMeters > 1e-7) {
      restore();
      throw new Error(`Wrist orientation changed a solved hand origin by ${maxHandOriginErrorMeters}m`);
    }
    return Object.freeze({ leftSourceDeltaRadians: deltas.left, rightSourceDeltaRadians: deltas.right, maxHandOriginErrorMeters });
  }

  return Object.freeze({ apply, restore, dispose() { if (!disposed) { restore(); disposed = true; } } });
}
