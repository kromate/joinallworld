import * as THREE from 'three';

export interface NativeNeutralPose {
  /** Restore the captured family-corrected rig, then pose it for upright standing. */
  apply(): void;
  /** Restore every captured bone transform without disposing the controller. */
  restore(): void;
  /** Restore the actor and release this controller. */
  dispose(): void;
}

type BoneState = {
  readonly bone: THREE.Bone;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly scale: THREE.Vector3;
};

type Segment = readonly [parent: string, child: string, direction: THREE.Vector3];

function requiredBone(bones: ReadonlyMap<string, THREE.Bone>, name: string): THREE.Bone {
  const bone = bones.get(name);
  if (!bone) throw new Error(`Native neutral pose requires bone ${name}`);
  return bone;
}

function normalizedDirection(value: THREE.Vector3, name: string): THREE.Vector3 {
  if (!value.toArray().every(Number.isFinite) || value.lengthSq() < 1e-8) {
    throw new Error(`Native neutral pose has a degenerate ${name} axis`);
  }
  return value.normalize();
}

/**
 * Capture the prepared, family-corrected actor once. Applying this pose only rotates
 * existing bones; it leaves their translations, lengths, the actor root and all meshes intact.
 */
export function createNativeNeutralPose(root: THREE.Group): NativeNeutralPose {
  const bones = new Map<string, THREE.Bone>();
  root.traverse((node) => {
    if (node instanceof THREE.Bone) {
      const bone = node;
      if (bones.has(bone.name)) throw new Error(`Native neutral pose has duplicate bone ${bone.name}`);
      bones.set(bone.name, bone);
    }
  });

  const names = [
    'mixamorigHips', 'mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2', 'mixamorigNeck', 'mixamorigHead',
    'mixamorigLeftShoulder', 'mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigLeftHand',
    'mixamorigRightShoulder', 'mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand',
    'mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigLeftFoot', 'mixamorigLeftToeBase',
    'mixamorigRightUpLeg', 'mixamorigRightLeg', 'mixamorigRightFoot', 'mixamorigRightToeBase',
  ];
  for (const name of names) requiredBone(bones, name);

  root.updateWorldMatrix(true, false);
  root.updateMatrixWorld(true);
  const states: BoneState[] = [...bones.values()].map((bone) => ({
    bone,
    position: bone.position.clone(),
    quaternion: bone.quaternion.clone(),
    scale: bone.scale.clone(),
  }));
  const inverseRoot = root.matrixWorld.clone().invert();
  // Head geometry faces forward in the corrected authored rest frame. Aiming
  // the neck/head joint line vertically must not rotate the face up with that line.
  const head = requiredBone(bones, 'mixamorigHead');
  const headActorRotation = root.getWorldQuaternion(new THREE.Quaternion()).invert()
    .multiply(head.getWorldQuaternion(new THREE.Quaternion())).normalize();
  const localPoint = (bone: THREE.Bone): THREE.Vector3 =>
    bone.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot);

  // Derive actor-facing axes from the corrected skeleton's own shoulder/foot anchors.
  // The vertical target remains the actor-local up axis even if the bind torso leans.
  const up = new THREE.Vector3(0, 1, 0);
  const forward = localPoint(requiredBone(bones, 'mixamorigLeftToeBase'))
    .sub(localPoint(requiredBone(bones, 'mixamorigLeftFoot')))
    .add(localPoint(requiredBone(bones, 'mixamorigRightToeBase'))
      .sub(localPoint(requiredBone(bones, 'mixamorigRightFoot'))))
    .multiplyScalar(0.5);
  forward.addScaledVector(up, -forward.dot(up));
  normalizedDirection(forward, 'forward');
  const right = localPoint(requiredBone(bones, 'mixamorigRightShoulder'))
    .sub(localPoint(requiredBone(bones, 'mixamorigLeftShoulder')));
  right.addScaledVector(up, -right.dot(up)).addScaledVector(forward, -right.dot(forward));
  normalizedDirection(right, 'right');

  const down = up.clone().negate();
  const segments: Segment[] = [
    ['mixamorigHips', 'mixamorigSpine', up.clone()],
    ['mixamorigSpine', 'mixamorigSpine1', up.clone()],
    ['mixamorigSpine1', 'mixamorigSpine2', up.clone()],
    ['mixamorigSpine2', 'mixamorigNeck', up.clone()],
    ['mixamorigNeck', 'mixamorigHead', up.clone()],
  ];

  for (const [side, sign] of [['Left', -1], ['Right', 1]] as const) {
    const outward = right.clone().multiplyScalar(sign);
    const upperArm = down.clone().addScaledVector(outward, 0.26).addScaledVector(forward, -0.025).normalize();
    const forearm = down.clone().addScaledVector(outward, 0.055).addScaledVector(forward, 0.075).normalize();
    segments.push(
      // Preserve the captured clavicle: Shoulder -> Arm is not the upper arm.
      [`mixamorig${side}Arm`, `mixamorig${side}ForeArm`, upperArm],
      [`mixamorig${side}ForeArm`, `mixamorig${side}Hand`, forearm],
    );

    // A small opposing knee bend keeps the standing legs relaxed while retaining
    // the authored segment lengths and a stable two-foot stance.
    const thigh = down.clone().addScaledVector(outward, 0.018).addScaledVector(forward, 0.035).normalize();
    const calf = down.clone().addScaledVector(outward, 0.008).addScaledVector(forward, -0.035).normalize();
    segments.push(
      [`mixamorig${side}UpLeg`, `mixamorig${side}Leg`, thigh],
      [`mixamorig${side}Leg`, `mixamorig${side}Foot`, calf],
      [`mixamorig${side}Foot`, `mixamorig${side}ToeBase`, forward.clone()],
    );
  }

  const worldDelta = new THREE.Quaternion();
  const desiredWorld = new THREE.Vector3();
  let disposed = false;
  let neutralStates: BoneState[] | undefined;

  function updateWorld(): void {
    root.updateWorldMatrix(true, false);
    root.updateMatrixWorld(true);
  }

  function restore(): void {
    if (disposed) return;
    for (const state of states) {
      state.bone.position.copy(state.position);
      state.bone.quaternion.copy(state.quaternion);
      state.bone.scale.copy(state.scale);
      state.bone.updateMatrix();
    }
    updateWorld();
  }

  function aim(segment: Segment): void {
    const [parentName, childName, actorDirection] = segment;
    const parent = requiredBone(bones, parentName);
    const child = requiredBone(bones, childName);
    if (child.parent !== parent) throw new Error(`Native neutral pose expected ${parentName} to parent ${childName}`);
    if (!parent.parent) throw new Error(`Native neutral pose bone ${parentName} has no parent`);

    updateWorld();
    const start = parent.getWorldPosition(new THREE.Vector3());
    const end = child.getWorldPosition(new THREE.Vector3());
    const currentDirection = end.sub(start).normalize();
    if (currentDirection.lengthSq() < 0.9) throw new Error(`Native neutral pose has a degenerate ${parentName}/${childName} segment`);

    desiredWorld.copy(actorDirection).transformDirection(root.matrixWorld).normalize();
    worldDelta.setFromUnitVectors(currentDirection, desiredWorld);
    const targetWorldRotation = worldDelta.multiply(parent.getWorldQuaternion(new THREE.Quaternion()));
    const parentWorldRotation = parent.parent.getWorldQuaternion(new THREE.Quaternion());
    parent.quaternion.copy(parentWorldRotation.invert().multiply(targetWorldRotation).normalize());
    updateWorld();
  }

  return {
    apply(): void {
      if (disposed) throw new Error('Native neutral pose is disposed');
      if (neutralStates) {
        for (const state of neutralStates) {
          state.bone.position.copy(state.position);
          state.bone.quaternion.copy(state.quaternion);
          state.bone.scale.copy(state.scale);
          state.bone.updateMatrix();
        }
        updateWorld();
        return;
      }
      restore();
      for (const segment of segments) aim(segment);
      if (!head.parent) throw new Error('Native neutral pose head has no parent');
      const headWorldRotation = root.getWorldQuaternion(new THREE.Quaternion()).multiply(headActorRotation);
      head.quaternion.copy(head.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(headWorldRotation).normalize());
      updateWorld();
      // Native segment lengths and neutral local rotations are invariant under
      // actor movement. Do not rerun the complete aiming pass on each idle frame.
      neutralStates = states.map(({ bone }) => ({ bone, position: bone.position.clone(),
        quaternion: bone.quaternion.clone(), scale: bone.scale.clone() }));
    },
    restore,
    dispose(): void {
      if (disposed) return;
      restore();
      disposed = true;
    },
  };
}
