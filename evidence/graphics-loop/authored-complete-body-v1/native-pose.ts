import * as THREE from 'three';

export type NativePose = 'idle' | 'walk';

export interface NativePoseSnapshot {
  readonly pose: NativePose;
  readonly seconds: number;
  readonly hips: readonly [number, number, number];
  readonly head: readonly [number, number, number];
  readonly hands: Readonly<Record<'left' | 'right', readonly [number, number, number]>>;
  readonly handsBelowShoulders: Readonly<Record<'left' | 'right', number>>;
  readonly feet: Readonly<Record<'left' | 'right', readonly [number, number, number]>>;
}

export interface NativePoseMetrics extends NativePoseSnapshot {
  readonly bodyMinY: number;
  readonly bodyMaxY: number;
}

export interface NativePoseController {
  /** Apply a deterministic native-rig pose; no mixer or background frame loop is created. */
  apply(seconds: number, pose: NativePose): NativePoseSnapshot;
  /** Expensive diagnostic over deformed Body vertices; never called by apply(). */
  measure(): Pick<NativePoseMetrics, 'bodyMinY' | 'bodyMaxY'>;
  /** Restore every captured local transform exactly. */
  restore(): void;
  dispose(): void;
}

const BONES = [
  'mixamorigHips', 'mixamorigHead',
  'mixamorigLeftShoulder', 'mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigLeftHand',
  'mixamorigRightShoulder', 'mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand',
  'mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigLeftFoot', 'mixamorigLeftToeBase',
  'mixamorigRightUpLeg', 'mixamorigRightLeg', 'mixamorigRightFoot', 'mixamorigRightToeBase',
] as const;

type LocalPose = { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };
type Side = 'left' | 'right';

function requireBone(root: THREE.Group, name: string): THREE.Bone {
  const bone = root.getObjectByName(name) as THREE.Bone | null;
  if (!bone?.isBone) throw new Error(`Native pose requires authored bone ${name}`);
  return bone;
}

/**
 * A small native-rig pose layer for the authored 52-joint model. It deliberately does not transfer
 * quaternions from the old clip-pack rig: the two rigs have incompatible rest axes. Segment directions
 * are calibrated from this actor's actual joint positions, then converted to local bone rotations.
 */
export function createNativePoseController(root: THREE.Group): NativePoseController {
  const bones = new Map(BONES.map((name) => [name, requireBone(root, name)]));
  const rest = new Map<THREE.Bone, LocalPose>();
  root.traverse((node) => {
    if ((node as THREE.Bone).isBone) rest.set(node as THREE.Bone, {
      position: node.position.clone(), quaternion: node.quaternion.clone(), scale: node.scale.clone(),
    });
  });
  const bodyMeshes: THREE.SkinnedMesh[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh && mesh.name === 'Body') bodyMeshes.push(mesh);
  });
  if (bodyMeshes.length !== 1) throw new Error(`Native pose expects one Body mesh; got ${bodyMeshes.length}`);

  const bonePoint = new THREE.Vector3();
  const childPoint = new THREE.Vector3();
  const currentDirection = new THREE.Vector3();
  const targetDirection = new THREE.Vector3();
  const delta = new THREE.Quaternion();
  const worldRotation = new THREE.Quaternion();
  const parentRotation = new THREE.Quaternion();
  const inverseParentRotation = new THREE.Quaternion();
  const rootRotation = new THREE.Quaternion();
  const forwardAxis = new THREE.Vector3();
  const lateralAxis = new THREE.Vector3();
  const downAxis = new THREE.Vector3(0, -1, 0);
  const vertex = new THREE.Vector3();
  const rootInverse = new THREE.Matrix4();
  let disposed = false;

  function reset(): void {
    for (const [node, value] of rest) {
      node.position.copy(value.position);
      node.quaternion.copy(value.quaternion);
      node.scale.copy(value.scale);
    }
    root.updateMatrixWorld(true);
  }

  function point(name: string, target = new THREE.Vector3()): THREE.Vector3 {
    return bones.get(name)!.getWorldPosition(target);
  }

  function directionFromParent(boneName: string, childName: string, target: THREE.Vector3): THREE.Vector3 {
    const bone = bones.get(boneName)!;
    const parent = bone.parent;
    if (!parent) throw new Error(`Native pose bone ${boneName} has no parent`);
    root.updateMatrixWorld(true);
    bone.getWorldPosition(bonePoint);
    bones.get(childName)!.getWorldPosition(childPoint);
    currentDirection.subVectors(childPoint, bonePoint).normalize();
    root.getWorldQuaternion(rootRotation);
    targetDirection.copy(target).normalize().applyQuaternion(rootRotation);
    delta.setFromUnitVectors(currentDirection, targetDirection);
    bone.getWorldQuaternion(worldRotation);
    worldRotation.premultiply(delta);
    parent.getWorldQuaternion(parentRotation);
    inverseParentRotation.copy(parentRotation).invert();
    bone.quaternion.copy(inverseParentRotation.multiply(worldRotation)).normalize();
    root.updateMatrixWorld(true);
    return targetDirection;
  }

  function anatomicalAxes(): { forward: THREE.Vector3; lateral: THREE.Vector3 } {
    root.updateMatrixWorld(true);
    const leftShoulder = point('mixamorigLeftShoulder');
    const rightShoulder = point('mixamorigRightShoulder');
    const leftFoot = point('mixamorigLeftFoot');
    const leftToe = point('mixamorigLeftToeBase');
    const rightFoot = point('mixamorigRightFoot');
    const rightToe = point('mixamorigRightToeBase');
    rootInverse.copy(root.matrixWorld).invert();
    leftShoulder.applyMatrix4(rootInverse); rightShoulder.applyMatrix4(rootInverse);
    leftFoot.applyMatrix4(rootInverse); leftToe.applyMatrix4(rootInverse);
    rightFoot.applyMatrix4(rootInverse); rightToe.applyMatrix4(rootInverse);
    lateralAxis.subVectors(rightShoulder, leftShoulder).setY(0).normalize();
    forwardAxis.addVectors(leftToe.sub(leftFoot), rightToe.sub(rightFoot)).setY(0).normalize();
    if (lateralAxis.lengthSq() < 0.9 || forwardAxis.lengthSq() < 0.9) {
      throw new Error('Native pose could not derive anatomical axes from authored shoulders and toes');
    }
    return { forward: forwardAxis.clone(), lateral: lateralAxis.clone() };
  }

  function applyArms(walkSwing: number): void {
    const { forward, lateral } = anatomicalAxes();
    for (const side of ['left', 'right'] as const) {
      const upper = side === 'left' ? 'mixamorigLeftArm' : 'mixamorigRightArm';
      const forearm = side === 'left' ? 'mixamorigLeftForeArm' : 'mixamorigRightForeArm';
      const hand = side === 'left' ? 'mixamorigLeftHand' : 'mixamorigRightHand';
      // Relax the native A-pose by aiming upper arms down and slightly out from the torso.
      // Lateral and forward axes come from the authored shoulders and toe bases, not assumed Z-up axes.
      const swingSign = side === 'left' ? -1 : 1;
      const outward = lateral.clone().multiplyScalar(side === 'left' ? -1 : 1);
      const upperDirection = downAxis.clone().addScaledVector(outward, 0.11).addScaledVector(forward, swingSign * walkSwing);
      const forearmDirection = downAxis.clone().addScaledVector(outward, 0.035).addScaledVector(forward, swingSign * walkSwing * 0.35);
      directionFromParent(upper, forearm, upperDirection);
      directionFromParent(forearm, hand, forearmDirection);
      // Keep hand/finger rests intact; no source clip contains finger tracks.
    }
  }

  function applyLegs(phase: number): void {
    const { forward } = anatomicalAxes();
    for (const side of ['left', 'right'] as const) {
      const upper = side === 'left' ? 'mixamorigLeftUpLeg' : 'mixamorigRightUpLeg';
      const knee = side === 'left' ? 'mixamorigLeftLeg' : 'mixamorigRightLeg';
      const calf = side === 'left' ? 'mixamorigLeftLeg' : 'mixamorigRightLeg';
      const foot = side === 'left' ? 'mixamorigLeftFoot' : 'mixamorigRightFoot';
      const angle = Math.sin(phase + (side === 'left' ? 0 : Math.PI)) * 0.30;
      const kneeFlex = Math.max(0, Math.sin(phase + (side === 'left' ? 0 : Math.PI))) * 0.22;
      directionFromParent(upper, knee, downAxis.clone().multiplyScalar(Math.cos(angle)).addScaledVector(forward, Math.sin(angle)));
      directionFromParent(calf, foot, downAxis.clone().multiplyScalar(Math.cos(kneeFlex)).addScaledVector(forward, -Math.sin(kneeFlex)));
      // Keep the foot-to-toe authored axis and foot rest orientation unchanged.
    }
  }

  function snapshot(pose: NativePose, seconds: number): NativePoseSnapshot {
    root.updateMatrixWorld(true);
    const get = (name: string) => point(name).toArray() as [number, number, number];
    const leftShoulder = point('mixamorigLeftShoulder');
    const rightShoulder = point('mixamorigRightShoulder');
    const leftHand = point('mixamorigLeftHand');
    const rightHand = point('mixamorigRightHand');
    return Object.freeze({
      pose, seconds,
      hips: get('mixamorigHips'), head: get('mixamorigHead'),
      hands: Object.freeze({ left: leftHand.toArray() as [number, number, number], right: rightHand.toArray() as [number, number, number] }),
      handsBelowShoulders: Object.freeze({ left: leftShoulder.y - leftHand.y, right: rightShoulder.y - rightHand.y }),
      feet: Object.freeze({ left: get('mixamorigLeftFoot'), right: get('mixamorigRightFoot') }),
    });
  }

  function measure(): Pick<NativePoseMetrics, 'bodyMinY' | 'bodyMaxY'> {
    root.updateMatrixWorld(true);
    let minY = Infinity, maxY = -Infinity;
    const mesh = bodyMeshes[0]!;
    const position = mesh.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) {
      mesh.getVertexPosition(i, vertex);
      mesh.localToWorld(vertex);
      minY = Math.min(minY, vertex.y);
      maxY = Math.max(maxY, vertex.y);
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) throw new Error('Native pose produced non-finite body bounds');
    return Object.freeze({ bodyMinY: minY, bodyMaxY: maxY });
  }

  function apply(seconds: number, pose: NativePose): NativePoseSnapshot {
    if (disposed) throw new Error('Native pose controller is disposed');
    if (!Number.isFinite(seconds)) throw new Error('Native pose time must be finite');
    reset();
    const phase = pose === 'walk' ? (seconds * Math.PI * 2) % (Math.PI * 2) : 0;
    applyArms(pose === 'walk' ? Math.sin(phase) * 0.18 : 0);
    if (pose === 'walk') applyLegs(phase);
    return snapshot(pose, seconds);
  }

  function restore(): void {
    if (disposed) return;
    reset();
  }

  return {
    apply,
    measure,
    restore,
    dispose() { if (!disposed) { reset(); disposed = true; } },
  };
}
