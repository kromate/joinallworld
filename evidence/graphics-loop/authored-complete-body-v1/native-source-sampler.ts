import * as THREE from 'three';
import type { NativeSourceFrame, NativeSourceJoint, SourceLandmarks } from './native-source-pose.ts';

export type LegacyPoseClip = 'jog' | 'dance' | 'lie-down';
export type NativeSourceWristSide = 'left' | 'right';
export interface NativeSourceWristRotations {
  readonly forearm: Readonly<Record<NativeSourceWristSide, THREE.Quaternion>>;
  readonly hand: Readonly<Record<NativeSourceWristSide, THREE.Quaternion>>;
}
/** Source frame subtype; the base positional frame interface remains unchanged. */
export interface NativeWristSourceFrame extends NativeSourceFrame {
  /** Mutable, sampler-owned values. Consume before requesting another sample. */
  readonly wristRotations: NativeSourceWristRotations;
}
export interface NativeSourceLandmarkSampler {
  readonly restLandmarks: SourceLandmarks;
  /** Root-relative rest quaternions for the source forearm and hand bones. */
  readonly restWristRotations: NativeSourceWristRotations;
  readonly durations: ReadonlyMap<string, number>;
  /** Reuses one mixer, its actions and one mutable frame object; consume before the next sample. */
  sample(clipName: LegacyPoseClip, seconds: number): NativeWristSourceFrame;
  /** Samples any exact clip-pack name; caller must explicitly choose looping or clamping. */
  sampleClip(clipName: string, seconds: number, timeMode: 'loop' | 'clamp'): NativeWristSourceFrame;
  dispose(): void;
}

const SOURCE_NAMES: Readonly<Record<NativeSourceJoint, string>> = Object.freeze({
  Hips: 'pelvis', Spine: 'spine_01', Spine1: 'spine_02', Spine2: 'spine_03', Neck: 'neck_01', Head: 'Head',
  LeftShoulder: 'clavicle_l', LeftArm: 'upperarm_l', LeftForeArm: 'lowerarm_l', LeftHand: 'hand_l',
  RightShoulder: 'clavicle_r', RightArm: 'upperarm_r', RightForeArm: 'lowerarm_r', RightHand: 'hand_r',
  LeftUpLeg: 'thigh_l', LeftLeg: 'calf_l', LeftFoot: 'foot_l', LeftToeBase: 'ball_l',
  RightUpLeg: 'thigh_r', RightLeg: 'calf_r', RightFoot: 'foot_r', RightToeBase: 'ball_r',
});
const CLIPS: readonly LegacyPoseClip[] = ['jog', 'dance', 'lie-down'];
type LocalTransform = { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 };

/** A private, actor-owned source hierarchy is required because sampling mutates animated nodes. */
export function createNativeSourceLandmarkSampler(
  sourceRoot: THREE.Object3D,
  clips: readonly THREE.AnimationClip[],
): NativeSourceLandmarkSampler {
  const byName = new Map(clips.map((clip) => [clip.name, clip]));
  const clipMap = new Map<string, THREE.AnimationClip>();
  for (const clip of clips) {
    if (!clip.name || clipMap.has(clip.name)) throw new Error(`Duplicate or empty clip name ${clip.name}`);
    if (!(clip.duration > 0) || !Number.isFinite(clip.duration)) throw new Error(`Invalid source clip duration ${clip.name}`);
    clipMap.set(clip.name, clip);
  }
  for (const name of CLIPS) {
    const clip = byName.get(name);
    if (!clip || !(clip.duration > 0) || !Number.isFinite(clip.duration)) throw new Error(`Missing valid source clip ${name}`);
  }
  const joints = new Map<NativeSourceJoint, THREE.Object3D>();
  for (const [joint, name] of Object.entries(SOURCE_NAMES) as [NativeSourceJoint, string][]) {
    const node = sourceRoot.getObjectByName(name);
    if (!node) throw new Error(`Source landmark node missing: ${name}`);
    joints.set(joint, node);
  }
  const rest = new Map<THREE.Object3D, LocalTransform>();
  sourceRoot.traverse((node) => rest.set(node, { p: node.position.clone(), q: node.quaternion.clone(), s: node.scale.clone() }));
  const mixer = new THREE.AnimationMixer(sourceRoot);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const [name, clip] of clipMap) actions.set(name, mixer.clipAction(clip));
  let activeAction: THREE.AnimationAction | undefined;
  const inverseRoot = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const targetRootRotation = new THREE.Quaternion();
  const targetNodeRotation = new THREE.Quaternion();
  let disposed = false;

  const mutableLandmarks = Object.fromEntries(Object.keys(SOURCE_NAMES).map((joint) => [joint, [0, 0, 0]])) as Record<NativeSourceJoint, [number, number, number]>;
  const restLandmarksMutable = Object.fromEntries(Object.entries(SOURCE_NAMES).map(([joint, name]) => {
    sourceRoot.updateWorldMatrix(true, true);
    const node = sourceRoot.getObjectByName(name)!;
    const p = node.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverseRoot.copy(sourceRoot.matrixWorld).invert());
    return [joint, p.toArray()];
  })) as Record<NativeSourceJoint, [number, number, number]>;
  const restLandmarks = Object.freeze(restLandmarksMutable) as SourceLandmarks;
  const wristNodes = {
    left: { forearm: joints.get('LeftForeArm')!, hand: joints.get('LeftHand')! },
    right: { forearm: joints.get('RightForeArm')!, hand: joints.get('RightHand')! },
  };
  function rootRelativeRotation(node: THREE.Object3D, target: THREE.Quaternion): THREE.Quaternion {
    sourceRoot.getWorldQuaternion(targetRootRotation).invert();
    node.getWorldQuaternion(targetNodeRotation);
    return target.copy(targetRootRotation).multiply(targetNodeRotation).normalize();
  }
  const restWristRotations: NativeSourceWristRotations = Object.freeze({
    forearm: Object.freeze({ left: new THREE.Quaternion(), right: new THREE.Quaternion() }),
    hand: Object.freeze({ left: new THREE.Quaternion(), right: new THREE.Quaternion() }),
  });
  sourceRoot.updateWorldMatrix(true, true);
  for (const side of ['left', 'right'] as const) {
    rootRelativeRotation(wristNodes[side].forearm, restWristRotations.forearm[side]);
    rootRelativeRotation(wristNodes[side].hand, restWristRotations.hand[side]);
  }
  const mutableWristRotations: NativeSourceWristRotations = {
    forearm: { left: new THREE.Quaternion(), right: new THREE.Quaternion() },
    hand: { left: new THREE.Quaternion(), right: new THREE.Quaternion() },
  };
  const frame: NativeWristSourceFrame = {
    clipName: '', duration: 0,
    landmarks: mutableLandmarks as SourceLandmarks,
    wristRotations: mutableWristRotations,
  };

  function restoreNodes(): void {
    for (const [node, value] of rest) {
      node.position.copy(value.p); node.quaternion.copy(value.q); node.scale.copy(value.s);
    }
    sourceRoot.updateWorldMatrix(true, true);
  }

  function sampleClip(clipName: string, seconds: number, timeMode: 'loop' | 'clamp'): NativeWristSourceFrame {
    if (disposed) throw new Error('Native source landmark sampler is disposed');
    if (timeMode !== 'loop' && timeMode !== 'clamp') throw new Error(`Unsupported source clip time mode ${String(timeMode)}`);
    const clip = clipMap.get(clipName), action = actions.get(clipName);
    if (!clip || !action || !Number.isFinite(seconds)) throw new Error(`Invalid source sample ${clipName}@${seconds}`);
    activeAction?.stop();
    restoreNodes();
    action.reset().setEffectiveWeight(1).play();
    activeAction = action;
    const sampleTime = timeMode === 'loop' ? THREE.MathUtils.euclideanModulo(seconds, clip.duration)
      : THREE.MathUtils.clamp(seconds, 0, clip.duration);
    action.setLoop(timeMode === 'loop' ? THREE.LoopRepeat : THREE.LoopOnce, timeMode === 'loop' ? Infinity : 1);
    action.clampWhenFinished = timeMode === 'clamp';
    mixer.setTime(sampleTime);
    sourceRoot.updateWorldMatrix(true, true);
    inverseRoot.copy(sourceRoot.matrixWorld).invert();
    for (const [joint, node] of joints) {
      node.getWorldPosition(position).applyMatrix4(inverseRoot);
      const target = mutableLandmarks[joint];
      target[0] = position.x; target[1] = position.y; target[2] = position.z;
    }
    for (const side of ['left', 'right'] as const) {
      rootRelativeRotation(wristNodes[side].forearm, mutableWristRotations.forearm[side]);
      rootRelativeRotation(wristNodes[side].hand, mutableWristRotations.hand[side]);
    }
    return Object.assign(frame, { clipName, duration: clip.duration });
  }
  function sample(clipName: LegacyPoseClip, seconds: number): NativeWristSourceFrame {
    return sampleClip(clipName, seconds, clipName === 'lie-down' ? 'clamp' : 'loop');
  }

  return {
    restLandmarks,
    restWristRotations,
    durations: new Map([...clipMap].map(([name, clip]) => [name, clip.duration])),
    sample,
    sampleClip,
    dispose() {
      if (disposed) return;
      mixer.stopAllAction(); activeAction = undefined; mixer.uncacheRoot(sourceRoot); restoreNodes(); disposed = true;
    },
  };
}
