import * as THREE from 'three';
import type { NativeWristSourceFrame } from './native-source-sampler.ts';

export interface NativeHeadOrientationController {
  apply(frame: NativeWristSourceFrame): void;
  restore(): void;
  dispose(): void;
}

function requireHeadParent(head: THREE.Bone): THREE.Object3D {
  const parent = head.parent;
  if (!parent) throw new Error('Head orientation bone mixamorigHead has no parent');
  return parent;
}

/** Applies measured source head rotation relative to its corrected rest orientation. */
export function createNativeHeadOrientationController(
  root: THREE.Object3D,
  sourceRestHeadRotation: THREE.Quaternion,
): NativeHeadOrientationController {
  if (!sourceRestHeadRotation || ![sourceRestHeadRotation.x, sourceRestHeadRotation.y,
    sourceRestHeadRotation.z, sourceRestHeadRotation.w].every(Number.isFinite)
    || sourceRestHeadRotation.lengthSq() < 1e-12) throw new Error('Invalid source rest head rotation');
  const candidate = root.getObjectByName('mixamorigHead');
  if (!(candidate instanceof THREE.Bone)) throw new Error('Head orientation requires native bone mixamorigHead');
  const head: THREE.Bone = candidate;
  const headParent = requireHeadParent(head);
  const bindRotation = head.quaternion.clone();
  root.updateWorldMatrix(true, true);
  const rootWorldInverse = root.getWorldQuaternion(new THREE.Quaternion()).invert();
  const bindRootRotation = rootWorldInverse.clone().multiply(head.getWorldQuaternion(new THREE.Quaternion())).normalize();
  const restInverse = sourceRestHeadRotation.clone().normalize().invert();
  const sourceDelta = new THREE.Quaternion();
  const desiredRootRotation = new THREE.Quaternion();
  const parentRootRotation = new THREE.Quaternion();
  let disposed = false;

  function restore(): void {
    if (disposed) return;
    head.quaternion.copy(bindRotation);
    head.updateMatrix();
    head.updateWorldMatrix(false, true);
  }

  function apply(frame: NativeWristSourceFrame): void {
    if (disposed) throw new Error('Head orientation controller is disposed');
    const source = frame.headRotation;
    if (!source || ![source.x, source.y, source.z, source.w].every(Number.isFinite) || source.lengthSq() < 1e-12) {
      throw new Error('Source frame is missing a valid head rotation');
    }
    if (head.parent !== headParent) throw new Error('Native head orientation bone was reparented');
    // These are root-relative world orientations: the source delta acts on the left.
    sourceDelta.copy(source).multiply(restInverse).normalize();
    desiredRootRotation.copy(sourceDelta).multiply(bindRootRotation).normalize();
    root.getWorldQuaternion(rootWorldInverse).invert();
    headParent.getWorldQuaternion(parentRootRotation).premultiply(rootWorldInverse).normalize();
    head.quaternion.copy(parentRootRotation.invert().multiply(desiredRootRotation)).normalize();
    head.updateMatrix();
    head.updateWorldMatrix(false, true);
  }

  return Object.freeze({ apply, restore, dispose() { if (disposed) return; restore(); disposed = true; } });
}
