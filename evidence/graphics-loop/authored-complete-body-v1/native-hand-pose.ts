import * as THREE from 'three';

export type NativeHandMode = 'relaxed' | 'walk' | 'grip';
export type NativeHandSide = 'left' | 'right';

export interface NativeHandPoseSnapshot {
  readonly mode: NativeHandMode;
  readonly seconds: number;
  readonly palmGap: Readonly<Record<NativeHandSide, number>>;
  readonly fingertipPositions: Readonly<Record<NativeHandSide, Readonly<Record<string, readonly [number, number, number]>>>>;
  readonly maxJointDeltaRadians: number;
}

export interface NativeHandPoseController {
  /** Apply after the body/action pose for this frame. No clock, mixer, or RAF is created. */
  apply(mode: NativeHandMode, seconds: number): NativeHandPoseSnapshot;
  restore(): void;
  dispose(): void;
}

type Digit = 'Thumb' | 'Index' | 'Middle' | 'Ring' | 'Pinky';
type FingerState = { side: NativeHandSide; digit: Digit; bones: THREE.Bone[]; rest: THREE.Quaternion[] };
type LocalPose = { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };

const SIDES: readonly NativeHandSide[] = ['left', 'right'];
const DIGITS: readonly Digit[] = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const HAND = { left: 'mixamorigLeftHand', right: 'mixamorigRightHand' } as const;
const ANGLES: Readonly<Record<NativeHandMode, Readonly<Record<Digit, readonly [number, number, number]>>>> = Object.freeze({
  relaxed: Object.freeze({
    Thumb: [0.07, 0.10, 0.07], Index: [0.10, 0.14, 0.10], Middle: [0.12, 0.16, 0.12],
    Ring: [0.14, 0.17, 0.13], Pinky: [0.16, 0.18, 0.14],
  }),
  walk: Object.freeze({
    Thumb: [0.09, 0.12, 0.08], Index: [0.12, 0.17, 0.12], Middle: [0.14, 0.19, 0.14],
    Ring: [0.16, 0.20, 0.15], Pinky: [0.18, 0.21, 0.16],
  }),
  grip: Object.freeze({
    Thumb: [0.28, 0.48, 0.32], Index: [0.54, 0.78, 0.58], Middle: [0.61, 0.86, 0.66],
    Ring: [0.67, 0.91, 0.70], Pinky: [0.72, 0.94, 0.72],
  }),
});

function needBone(root: THREE.Group, name: string): THREE.Bone {
  const bone = root.getObjectByName(name) as THREE.Bone | null;
  if (!bone?.isBone) throw new Error(`Native hand pose requires authored bone ${name}`);
  return bone;
}

function worldPoint(bone: THREE.Bone, target = new THREE.Vector3()): THREE.Vector3 {
  return bone.getWorldPosition(target);
}

/** Native-axis hand posing for the authored GLB's 30 finger bones. It captures only fingers, so
 * caller body poses, arm transforms, placement, and shared template geometry remain untouched. */
export function createNativeHandPoseController(root: THREE.Group): NativeHandPoseController {
  const hands = Object.fromEntries(SIDES.map((side) => [side, needBone(root, HAND[side])])) as Record<NativeHandSide, THREE.Bone>;
  const fingers: FingerState[] = [];
  const allFingerBones = new Set<THREE.Bone>();
  for (const side of SIDES) for (const digit of DIGITS) {
    const bones = [1, 2, 3].map((joint) => needBone(root, `${HAND[side]}${digit}${joint}`));
    bones.forEach((bone) => allFingerBones.add(bone));
    fingers.push({ side, digit, bones, rest: bones.map((bone) => bone.quaternion.clone()) });
  }
  if (allFingerBones.size !== 30) throw new Error(`Expected 30 distinct authored finger joints; found ${allFingerBones.size}`);

  const worldAxis = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const towardPalm = new THREE.Vector3();
  const palmCenter = new THREE.Vector3();
  const handCenter = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const currentWorld = new THREE.Quaternion();
  const parentWorld = new THREE.Quaternion();
  const desiredWorld = new THREE.Quaternion();
  const inverseParent = new THREE.Quaternion();
  const delta = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const rootInverse = new THREE.Matrix4();
  let disposed = false;

  function resetFingers(): void {
    for (const state of fingers) state.bones.forEach((bone, index) => bone.quaternion.copy(state.rest[index]!));
    root.updateWorldMatrix(true, true);
  }

  function palmAnchor(side: NativeHandSide): THREE.Vector3 {
    const suffix = side === 'left' ? 'Left' : 'Right';
    const metacarpals = ['Index', 'Middle', 'Ring', 'Pinky'].map((digit) => needBone(root, `mixamorig${suffix}Hand${digit}1`));
    handCenter.copy(worldPoint(hands[side]));
    palmCenter.set(0, 0, 0);
    for (const bone of metacarpals) palmCenter.add(worldPoint(bone, position));
    return palmCenter.multiplyScalar(0.25).lerp(handCenter, 0.45);
  }

  function bendAxis(state: FingerState, joint: number, anchor: THREE.Vector3): THREE.Vector3 {
    const bone = state.bones[joint]!;
    const start = worldPoint(bone, position);
    const next = joint < 2 ? worldPoint(state.bones[joint + 1]!, new THREE.Vector3())
      : worldPoint(state.bones[joint - 1]!, new THREE.Vector3());
    if (joint === 2) direction.subVectors(start, next).normalize();
    else direction.subVectors(next, start).normalize();
    towardPalm.subVectors(anchor, start).addScaledVector(direction, -towardPalm.dot(direction));
    if (towardPalm.lengthSq() < 1e-8) {
      // Degenerate only for a joint exactly over the palm anchor; use the live palm normal as a
      // stable flexion plane, which is derived from this actor's knuckle layout below.
      towardPalm.copy(normal).addScaledVector(direction, -normal.dot(direction));
    }
    worldAxis.crossVectors(direction, towardPalm).normalize();
    if (worldAxis.lengthSq() < 0.9) throw new Error(`Cannot derive bend axis for ${state.side}/${state.digit}/${joint + 1}`);
    return worldAxis;
  }

  function derivePalmNormal(side: NativeHandSide): THREE.Vector3 {
    const prefix = side === 'left' ? 'mixamorigLeftHand' : 'mixamorigRightHand';
    const index = needBone(root, `${prefix}Index1`), pinky = needBone(root, `${prefix}Pinky1`), middle = needBone(root, `${prefix}Middle1`);
    const wrist = worldPoint(hands[side], new THREE.Vector3());
    const across = worldPoint(pinky, new THREE.Vector3()).sub(worldPoint(index, new THREE.Vector3())).normalize();
    const along = worldPoint(middle, new THREE.Vector3()).sub(wrist).normalize();
    normal.crossVectors(across, along).normalize();
    if (normal.lengthSq() < 0.9) throw new Error(`Cannot derive ${side} palm plane from authored joints`);
    return normal;
  }

  function applyAngle(bone: THREE.Bone, axis: THREE.Vector3, radians: number): void {
    const parent = bone.parent;
    if (!parent) throw new Error(`Finger joint ${bone.name} has no parent`);
    root.updateWorldMatrix(true, true);
    bone.getWorldQuaternion(currentWorld);
    parent.getWorldQuaternion(parentWorld);
    delta.setFromAxisAngle(axis, radians);
    desiredWorld.copy(delta).multiply(currentWorld);
    bone.quaternion.copy(inverseParent.copy(parentWorld).invert().multiply(desiredWorld)).normalize();
    root.updateWorldMatrix(true, true);
  }

  function maxJointDelta(): number {
    let max = 0;
    for (const state of fingers) state.bones.forEach((bone, index) => {
      max = Math.max(max, bone.quaternion.angleTo(state.rest[index]!));
    });
    return max;
  }

  function snapshot(mode: NativeHandMode, seconds: number): NativeHandPoseSnapshot {
    const gaps = {} as Record<NativeHandSide, number>;
    const tips = {} as Record<NativeHandSide, Record<string, readonly [number, number, number]>>;
    root.updateWorldMatrix(true, true);
    rootInverse.copy(root.matrixWorld).invert();
    for (const side of SIDES) {
      const anchor = palmAnchor(side).applyMatrix4(rootInverse);
      let gap = 0;
      tips[side] = {};
      for (const state of fingers.filter((item) => item.side === side)) {
        const tip = worldPoint(state.bones[2]!, new THREE.Vector3()).applyMatrix4(rootInverse);
        gap += tip.distanceTo(anchor);
        tips[side][state.digit] = tip.toArray() as [number, number, number];
      }
      gaps[side] = gap / DIGITS.length;
    }
    return Object.freeze({
      mode, seconds, palmGap: Object.freeze(gaps), fingertipPositions: Object.freeze(tips),
      maxJointDeltaRadians: maxJointDelta(),
    });
  }

  return {
    apply(mode, seconds) {
      if (disposed) throw new Error('Native hand pose controller is disposed');
      if (!(mode in ANGLES)) throw new Error(`Unsupported native hand mode: ${String(mode)}`);
      if (!Number.isFinite(seconds)) throw new Error('Native hand pose time must be finite');
      resetFingers();
      for (const side of SIDES) {
        const anchor = palmAnchor(side);
        derivePalmNormal(side);
        for (const state of fingers) {
          if (state.side !== side) continue;
          const angles = ANGLES[mode][state.digit];
          for (let joint = 0; joint < 3; joint++) {
            const walkPulse = mode === 'walk' ? 0.035 * Math.sin(seconds * Math.PI * 2 + (state.side === 'left' ? 0 : Math.PI)) : 0;
            const angle = THREE.MathUtils.clamp(angles[joint]! + walkPulse, 0, 1.1);
            applyAngle(state.bones[joint]!, bendAxis(state, joint, anchor), angle);
          }
        }
      }
      return snapshot(mode, seconds);
    },
    restore() { resetFingers(); },
    dispose() {
      if (disposed) return;
      resetFingers();
      disposed = true;
    },
  };
}
