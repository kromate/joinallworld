import * as THREE from 'three';
import { createNativePoseController, type NativePoseSnapshot } from './native-pose.ts';

export type NativeActionPose = 'idle' | 'walk' | 'sit' | 'interact' | 'cook' | 'eat' | 'drink';
export type NativeActionSupport = { readonly kind: 'floor' } | { readonly kind: 'seat'; readonly top: number; readonly floorY: number };

export interface NativeActionSnapshot extends Omit<NativePoseSnapshot, 'pose'> {
  readonly pose: NativeActionPose;
  readonly shoulders: Readonly<Record<'left' | 'right', readonly [number, number, number]>>;
  readonly knees: Readonly<Record<'left' | 'right', readonly [number, number, number]>>;
  readonly seatTop?: number;
  readonly seatFloorY?: number;
  readonly pelvisSeatClearance?: number;
  readonly handTargetError: Readonly<Partial<Record<'left' | 'right', number>>>;
  readonly handTargetDistance: Readonly<Partial<Record<'left' | 'right', number>>>;
  readonly handClearance: Readonly<Partial<Record<'left' | 'right', number>>>;
  readonly footTargetError: Readonly<Partial<Record<'left' | 'right', number>>>;
}

export interface NativeActionController {
  /** Host-driven deterministic pose sample. `seat.top` is in the actor root's local units. */
  apply(seconds: number, pose: NativeActionPose, support: NativeActionSupport): NativeActionSnapshot;
  /** Full skinned body/clothing bounds and arm-vs-torso surface proxy; diagnostics only. */
  measure(): { readonly bodyMinY: number; readonly bodyMaxY: number; readonly armSurfaceOutsideTorso: Readonly<Record<'left' | 'right', number>>; readonly handToBodySupportVertex: Readonly<Record<'left' | 'right', number>>; readonly footSoleMinY: Readonly<Record<'left' | 'right', number>> };
  restore(): void;
  dispose(): void;
}

export interface NativeActionOptions {
  /** Fixed root-local clearance for experiments; omitted uses a quarter of the measured torso envelope width. */
  readonly armClearance?: number;
}

const ACTIONS = new Set<NativeActionPose>(['idle', 'walk', 'sit', 'interact', 'cook', 'eat', 'drink']);
const DOWN = new THREE.Vector3(0, -1, 0);
const BONES = [
  'mixamorigHips', 'mixamorigSpine2', 'mixamorigNeck', 'mixamorigHead',
  'mixamorigLeftShoulder', 'mixamorigLeftArm', 'mixamorigLeftForeArm', 'mixamorigLeftHand',
  'mixamorigRightShoulder', 'mixamorigRightArm', 'mixamorigRightForeArm', 'mixamorigRightHand',
  'mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigLeftFoot', 'mixamorigLeftToeBase',
  'mixamorigRightUpLeg', 'mixamorigRightLeg', 'mixamorigRightFoot', 'mixamorigRightToeBase',
] as const;
const TORSO_SUPPORT = new Set(['mixamorigHips', 'mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2', 'mixamorigNeck', 'mixamorigHead', 'mixamorigLeftShoulder', 'mixamorigRightShoulder']);

function needBone(root: THREE.Group, name: string): THREE.Bone {
  const bone = root.getObjectByName(name) as THREE.Bone | null;
  if (!bone?.isBone) throw new Error(`Native actions require authored bone ${name}`);
  return bone;
}

export function createNativeActionController(root: THREE.Group, options: NativeActionOptions = {}): NativeActionController {
  const fixedArmClearance = options.armClearance;
  if (fixedArmClearance !== undefined && (!Number.isFinite(fixedArmClearance) || fixedArmClearance < 0 || fixedArmClearance > 0.25)) throw new Error('Arm clearance must be between 0 and 0.25 root units');
  const native = createNativePoseController(root);
  const bones = new Map<string, THREE.Bone>(BONES.map(name => [name, needBone(root, name)]));
  const bodyMeshes: THREE.SkinnedMesh[] = [];
  root.traverse(node => { const mesh = node as THREE.SkinnedMesh; if (mesh.isSkinnedMesh) bodyMeshes.push(mesh); });
  if (bodyMeshes.filter(mesh => mesh.name === 'Body').length !== 1) throw new Error('Native actions expect exactly one Body mesh');
  const rootInverse = new THREE.Matrix4();
  const rootRotation = new THREE.Quaternion();
  const current = new THREE.Vector3(), desired = new THREE.Vector3(), delta = new THREE.Quaternion();
  const world = new THREE.Quaternion(), parentWorld = new THREE.Quaternion(), inverseParent = new THREE.Quaternion();
  const vertex = new THREE.Vector3(), rootPoint = new THREE.Vector3();
  const torsoProfile = new Map<number, { min: number; max: number; count: number }>();
  const profileLateral = new THREE.Vector3();
  const footSoleOffsets: Record<'left' | 'right', number> = { left: 0, right: 0 };
  let disposed = false;

  function point(name: string): THREE.Vector3 {
    return bones.get(name)!.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInverse.copy(root.matrixWorld).invert());
  }

  function axes(): { forward: THREE.Vector3; lateral: THREE.Vector3 } {
    root.updateMatrixWorld(true);
    const local = (name: string) => bones.get(name)!.getWorldPosition(new THREE.Vector3())
      .applyMatrix4(rootInverse.copy(root.matrixWorld).invert());
    const lateral = local('mixamorigRightShoulder').sub(local('mixamorigLeftShoulder')).setY(0).normalize();
    const forward = local('mixamorigLeftToeBase').sub(local('mixamorigLeftFoot'))
      .add(local('mixamorigRightToeBase').sub(local('mixamorigRightFoot'))).setY(0).normalize();
    if (lateral.lengthSq() < 0.9 || forward.lengthSq() < 0.9) throw new Error('Cannot derive authored forward/lateral axes');
    return { forward, lateral };
  }

  function profileKey(y: number): number { return Math.round(y * 20); }

  function collectTorsoProfile(): void {
    torsoProfile.clear();
    root.updateMatrixWorld(true);
    profileLateral.copy(axes().lateral);
    const inverse = rootInverse.copy(root.matrixWorld).invert();
    for (const mesh of bodyMeshes) {
      const indices = mesh.geometry.getAttribute('skinIndex');
      const weights = mesh.geometry.getAttribute('skinWeight');
      if (!indices || !weights || indices.count !== weights.count) continue;
      for (let i = 0; i < indices.count; i++) {
        let torsoWeight = 0;
        for (let c = 0; c < 4; c++) {
          const boneIndex = indices.getComponent(i, c);
          const bone = mesh.skeleton.bones[boneIndex];
          if (bone && TORSO_SUPPORT.has(bone.name)) torsoWeight += weights.getComponent(i, c);
        }
        if (torsoWeight < 0.5) continue;
        mesh.getVertexPosition(i, vertex);
        mesh.localToWorld(vertex);
        rootPoint.copy(vertex).applyMatrix4(inverse);
        const key = profileKey(rootPoint.y), prior = torsoProfile.get(key);
        const lateralValue = rootPoint.dot(profileLateral);
        if (prior) {
          prior.min = Math.min(prior.min, lateralValue);
          prior.max = Math.max(prior.max, lateralValue);
          prior.count++;
        } else torsoProfile.set(key, { min: lateralValue, max: lateralValue, count: 1 });
      }
    }
    if (torsoProfile.size < 4) throw new Error('Cannot measure torso clearance from skinned Body/clothing vertices');
  }

  function torsoBoundsAt(y: number): { min: number; max: number } {
    const key = profileKey(y);
    let nearest: { distance: number; key: number } | undefined;
    for (const [sampleKey] of torsoProfile) {
      const distance = Math.abs(sampleKey - key);
      if (distance > 3) continue;
      if (!nearest || distance < nearest.distance) nearest = { distance, key: sampleKey };
    }
    if (!nearest) throw new Error(`No torso surface band near hand height ${y.toFixed(3)}`);
    const band = torsoProfile.get(nearest.key);
    if (!band) throw new Error(`No torso envelope near hand height ${y.toFixed(3)}`);
    return { min: band.min, max: band.max };
  }

  function placeHandOutsideTorso(side: 'left' | 'right', outward: THREE.Vector3): number {
    const wrist = point(side === 'left' ? 'mixamorigLeftHand' : 'mixamorigRightHand');
    const envelope = torsoBoundsAt(wrist.y);
    const padding = fixedArmClearance ?? Math.max(0.025, (envelope.max - envelope.min) * 0.30);
    const boundary = side === 'left' ? envelope.min : envelope.max;
    const desired = side === 'left' ? boundary - padding : boundary + padding;
    wrist.addScaledVector(profileLateral, desired - wrist.dot(profileLateral));
    solveArm(side, wrist, outward);
    return padding;
  }

  function measureFootSoleOffset(side: 'left' | 'right'): number {
    const names = new Set(side === 'left' ? ['mixamorigLeftFoot', 'mixamorigLeftToeBase'] : ['mixamorigRightFoot', 'mixamorigRightToeBase']);
    let minY = Infinity;
    for (const mesh of bodyMeshes) {
      const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
      if (!indices || !weights) continue;
      for (let i = 0; i < indices.count; i++) {
        let footWeight = 0;
        for (let c = 0; c < 4; c++) if (names.has(mesh.skeleton.bones[indices.getComponent(i, c)]?.name ?? '')) footWeight += weights.getComponent(i, c);
        if (footWeight < 0.5) continue;
        mesh.getVertexPosition(i, vertex); mesh.localToWorld(vertex);
        rootPoint.copy(vertex).applyMatrix4(rootInverse.copy(root.matrixWorld).invert());
        minY = Math.min(minY, rootPoint.y);
      }
    }
    const foot = point(side === 'left' ? 'mixamorigLeftFoot' : 'mixamorigRightFoot');
    if (!Number.isFinite(minY)) throw new Error(`No weighted ${side} foot sole vertices`);
    // The extreme weighted sole sample shifts about 0.1–0.2mm under the seated two-bone solve.
    // This measured bias keeps both pinned family meshes on the explicit floor plane.
    return foot.y - minY + 0.0002;
  }

  function aimSegment(parentName: string, childName: string, directionRoot: THREE.Vector3): void {
    root.updateMatrixWorld(true);
    const bone = bones.get(parentName)!, parent = bone.parent;
    if (!parent) throw new Error(`Native action bone ${parentName} has no parent`);
    const start = bone.getWorldPosition(new THREE.Vector3());
    const end = bones.get(childName)!.getWorldPosition(new THREE.Vector3());
    current.subVectors(end, start).normalize();
    root.getWorldQuaternion(rootRotation);
    desired.copy(directionRoot).normalize().applyQuaternion(rootRotation);
    delta.setFromUnitVectors(current, desired);
    bone.getWorldQuaternion(world).premultiply(delta);
    parent.getWorldQuaternion(parentWorld);
    bone.quaternion.copy(inverseParent.copy(parentWorld).invert().multiply(world)).normalize();
    root.updateMatrixWorld(true);
  }

  function solveArm(side: 'left' | 'right', target: THREE.Vector3, outward: THREE.Vector3): number {
    const upperName = side === 'left' ? 'mixamorigLeftArm' : 'mixamorigRightArm';
    const forearmName = side === 'left' ? 'mixamorigLeftForeArm' : 'mixamorigRightForeArm';
    const handName = side === 'left' ? 'mixamorigLeftHand' : 'mixamorigRightHand';
    const shoulder = point(upperName), elbow = point(forearmName), wrist = point(handName);
    const upperLength = shoulder.distanceTo(elbow), forearmLength = elbow.distanceTo(wrist);
    const toTarget = target.clone().sub(shoulder);
    const maxReach = upperLength + forearmLength - 0.002;
    const minReach = Math.abs(upperLength - forearmLength) + 0.002;
    const requested = toTarget.length();
    const reach = THREE.MathUtils.clamp(requested, minReach, maxReach);
    const direction = toTarget.normalize();
    const endpoint = shoulder.clone().addScaledVector(direction, reach);
    let pole = outward.clone().addScaledVector(direction, -outward.dot(direction)).normalize();
    if (pole.lengthSq() < 0.9) pole = axes().forward.addScaledVector(direction, -axes().forward.dot(direction)).normalize();
    const along = (upperLength * upperLength - forearmLength * forearmLength + reach * reach) / (2 * reach);
    const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
    const elbowTarget = shoulder.clone().addScaledVector(direction, along).addScaledVector(pole, height);
    aimSegment(upperName, forearmName, elbowTarget.sub(shoulder));
    const newElbow = point(forearmName);
    aimSegment(forearmName, handName, endpoint.sub(newElbow));
    return point(handName).distanceTo(target);
  }

  function setLegDirections(forward: THREE.Vector3, thighForward: number, kneeFlex: number): void {
    for (const side of ['left', 'right'] as const) {
      const upper = side === 'left' ? 'mixamorigLeftUpLeg' : 'mixamorigRightUpLeg';
      const knee = side === 'left' ? 'mixamorigLeftLeg' : 'mixamorigRightLeg';
      const calf = knee;
      const foot = side === 'left' ? 'mixamorigLeftFoot' : 'mixamorigRightFoot';
      aimSegment(upper, knee, DOWN.clone().multiplyScalar(Math.cos(thighForward)).addScaledVector(forward, Math.sin(thighForward)));
      aimSegment(calf, foot, DOWN.clone().multiplyScalar(Math.cos(kneeFlex)).addScaledVector(forward, -Math.sin(kneeFlex)));
    }
  }

  function solveLeg(side: 'left' | 'right', target: THREE.Vector3, forward: THREE.Vector3): number {
    const upperName = side === 'left' ? 'mixamorigLeftUpLeg' : 'mixamorigRightUpLeg';
    const kneeName = side === 'left' ? 'mixamorigLeftLeg' : 'mixamorigRightLeg';
    const footName = side === 'left' ? 'mixamorigLeftFoot' : 'mixamorigRightFoot';
    const hip = point(upperName), knee = point(kneeName), foot = point(footName);
    const upperLength = hip.distanceTo(knee), lowerLength = knee.distanceTo(foot);
    const toTarget = target.clone().sub(hip), requested = toTarget.length();
    const maxReach = upperLength + lowerLength - 0.002;
    const minReach = Math.abs(upperLength - lowerLength) + 0.002;
    const reach = THREE.MathUtils.clamp(requested, minReach, maxReach);
    const direction = toTarget.normalize(), endpoint = hip.clone().addScaledVector(direction, reach);
    let pole = forward.clone().addScaledVector(direction, -forward.dot(direction)).normalize();
    if (pole.lengthSq() < 0.9) pole = axes().lateral.clone().multiplyScalar(side === 'left' ? -1 : 1);
    const along = (upperLength * upperLength - lowerLength * lowerLength + reach * reach) / (2 * reach);
    const height = Math.sqrt(Math.max(0, upperLength * upperLength - along * along));
    const kneeTarget = hip.clone().addScaledVector(direction, along).addScaledVector(pole, height);
    aimSegment(upperName, kneeName, kneeTarget.sub(hip));
    const newKnee = point(kneeName);
    aimSegment(kneeName, footName, endpoint.sub(newKnee));
    return point(footName).distanceTo(target);
  }

  function snapshot(pose: NativeActionPose, seconds: number, targets: Partial<Record<'left' | 'right', number>>, targetDistances: Partial<Record<'left' | 'right', number>>, handClearance: Partial<Record<'left' | 'right', number>>, footTargets: Partial<Record<'left' | 'right', number>>, seatSupport?: { top: number; floorY: number }): NativeActionSnapshot {
    root.updateMatrixWorld(true);
    const get = (name: string) => point(name).toArray() as [number, number, number];
    const hips = point('mixamorigHips');
    const leftShoulder = point('mixamorigLeftShoulder'), rightShoulder = point('mixamorigRightShoulder');
    const leftHand = point('mixamorigLeftHand'), rightHand = point('mixamorigRightHand');
    return Object.freeze({
      pose, seconds,
      hips: hips.toArray() as [number, number, number], head: get('mixamorigHead'),
      shoulders: Object.freeze({ left: leftShoulder.toArray() as [number, number, number], right: rightShoulder.toArray() as [number, number, number] }),
      hands: Object.freeze({ left: leftHand.toArray() as [number, number, number], right: rightHand.toArray() as [number, number, number] }),
      handsBelowShoulders: Object.freeze({ left: leftShoulder.y - leftHand.y, right: rightShoulder.y - rightHand.y }),
      feet: Object.freeze({ left: get('mixamorigLeftFoot'), right: get('mixamorigRightFoot') }),
      knees: Object.freeze({ left: get('mixamorigLeftLeg'), right: get('mixamorigRightLeg') }),
      handTargetError: Object.freeze(targets),
      handTargetDistance: Object.freeze(targetDistances),
      handClearance: Object.freeze(handClearance),
      footTargetError: Object.freeze(footTargets),
      ...(seatSupport ? { seatTop: seatSupport.top, seatFloorY: seatSupport.floorY, pelvisSeatClearance: hips.y - seatSupport.top } : {}),
    });
  }

  function apply(seconds: number, pose: NativeActionPose, support: NativeActionSupport): NativeActionSnapshot {
    if (disposed) throw new Error('Native action controller is disposed');
    if (!Number.isFinite(seconds)) throw new Error('Native action time must be finite');
    if (!ACTIONS.has(pose)) throw new Error(`Unsupported native action pose: ${String(pose)}`);
    if (pose === 'sit') {
      if (support.kind !== 'seat' || !Number.isFinite(support.top) || !Number.isFinite(support.floorY)) throw new Error('Native sit requires finite seat and floor heights');
    } else if (support.kind !== 'floor') {
      throw new Error(`${pose} requires floor support in this native action slice`);
    }
    native.apply(seconds, pose === 'walk' ? 'walk' : 'idle');
    const { forward, lateral } = axes();
    const errors: Partial<Record<'left' | 'right', number>> = {};
    const targetDistances: Partial<Record<'left' | 'right', number>> = {};
    const handClearance: Partial<Record<'left' | 'right', number>> = {};
    const footErrors: Partial<Record<'left' | 'right', number>> = {};

    if (pose === 'idle' || pose === 'walk') {
      // Female body morphs widen the torso enough to hide the source A-pose's hanging arms.
      // Move only the wrist target past the measured torso/clothing envelope, then solve the real arm chain.
      for (const side of ['left', 'right'] as const) {
        const outward = lateral.clone().multiplyScalar(side === 'left' ? -1 : 1);
        handClearance[side] = placeHandOutsideTorso(side, outward);
      }
      if (pose === 'walk') {
        const phase = seconds * Math.PI * 2;
        setLegDirections(forward, 0.30 * Math.sin(phase), Math.max(0, Math.sin(phase)) * 0.22);
      }
    } else if (pose === 'sit') {
      const hip = bones.get('mixamorigHips')!;
      hip.position.y = support.top + 0.10;
      root.updateMatrixWorld(true);
      for (const side of ['left', 'right'] as const) {
        const foot = point(side === 'left' ? 'mixamorigLeftFoot' : 'mixamorigRightFoot');
        const target = foot.clone().addScaledVector(forward, 0.22);
        target.y = support.floorY + footSoleOffsets[side];
        footErrors[side] = solveLeg(side, target, forward);
        aimSegment(side === 'left' ? 'mixamorigLeftFoot' : 'mixamorigRightFoot',
          side === 'left' ? 'mixamorigLeftToeBase' : 'mixamorigRightToeBase', forward);
      }
      // A modest forward trunk lean shortens the real shoulder-to-knee distance; clavicles stay in native rest.
      aimSegment('mixamorigSpine2', 'mixamorigNeck', forward.clone().multiplyScalar(0.32).add(new THREE.Vector3(0, 0.95, 0)));
      const hips = point('mixamorigHips');
      // Native arm reach cannot span the knee's full horizontal offset while the pelvis stays on this seat.
      // Rest hands on the proximal thighs; report their separate distance to the knee landmarks.
      const leftTarget = hips.clone().addScaledVector(forward, 0.18).addScaledVector(DOWN, -0.10).addScaledVector(lateral, -0.08);
      const rightTarget = hips.clone().addScaledVector(forward, 0.18).addScaledVector(DOWN, -0.10).addScaledVector(lateral, 0.08);
      targetDistances.left = point('mixamorigLeftArm').distanceTo(leftTarget);
      targetDistances.right = point('mixamorigRightArm').distanceTo(rightTarget);
      errors.left = solveArm('left', leftTarget, lateral.clone().multiplyScalar(-1));
      errors.right = solveArm('right', rightTarget, lateral);
    } else if (pose === 'interact') {
      const shoulder = point('mixamorigRightArm');
      const target = shoulder.clone().addScaledVector(forward, 0.40).addScaledVector(DOWN, 0.08).addScaledVector(lateral, 0.10);
      targetDistances.right = point('mixamorigRightArm').distanceTo(target);
      errors.right = solveArm('right', target, lateral);
    } else if (pose === 'cook') {
      const hips = point('mixamorigHips');
      for (const side of ['left', 'right'] as const) {
        const outward = lateral.clone().multiplyScalar(side === 'left' ? -1 : 1);
        const target = hips.clone().addScaledVector(forward, 0.30).addScaledVector(DOWN, -0.27).addScaledVector(outward, 0.16);
        targetDistances[side] = point(side === 'left' ? 'mixamorigLeftArm' : 'mixamorigRightArm').distanceTo(target);
        errors[side] = solveArm(side, target, outward);
      }
    } else if (pose === 'eat' || pose === 'drink') {
      const head = point('mixamorigHead');
      const mouthProxy = head.clone().addScaledVector(forward, pose === 'drink' ? 0.13 : 0.10).addScaledVector(DOWN, 0.15);
      targetDistances.right = point('mixamorigRightArm').distanceTo(mouthProxy);
      errors.right = solveArm('right', mouthProxy, lateral);
      const hips = point('mixamorigHips');
      const leftTarget = hips.clone().addScaledVector(forward, 0.20).addScaledVector(DOWN, -0.12);
      targetDistances.left = point('mixamorigLeftArm').distanceTo(leftTarget);
      errors.left = solveArm('left', leftTarget, lateral.clone().multiplyScalar(-1));
    }
    return snapshot(pose, seconds, errors, targetDistances, handClearance, footErrors, support.kind === 'seat' ? { top: support.top, floorY: support.floorY } : undefined);
  }

  native.apply(0, 'idle');
  collectTorsoProfile();
  const { forward: soleForward } = axes();
  aimSegment('mixamorigLeftFoot', 'mixamorigLeftToeBase', soleForward);
  aimSegment('mixamorigRightFoot', 'mixamorigRightToeBase', soleForward);
  footSoleOffsets.left = measureFootSoleOffset('left');
  footSoleOffsets.right = measureFootSoleOffset('right');
  native.restore();

  function measure() {
    root.updateMatrixWorld(true);
    let minY = Infinity, maxY = -Infinity;
    const outside = { left: 0, right: 0 }, totals = { left: 0, right: 0 };
    const handPoints = { left: point('mixamorigLeftHand'), right: point('mixamorigRightHand') };
    const nearestSq = { left: Infinity, right: Infinity };
    const footSoleMinY = { left: Infinity, right: Infinity };
    const supportBones = new Set([...TORSO_SUPPORT, 'mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigRightUpLeg', 'mixamorigRightLeg']);
    for (const mesh of bodyMeshes) {
      const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
      if (!indices || !weights) continue;
      for (let i = 0; i < indices.count; i++) {
        let bodySupportWeight = 0;
        const footWeight = { left: 0, right: 0 };
        for (let c = 0; c < 4; c++) {
          const supportBone = mesh.skeleton.bones[indices.getComponent(i, c)];
          if (supportBone && supportBones.has(supportBone.name)) bodySupportWeight += weights.getComponent(i, c);
          if (supportBone?.name === 'mixamorigLeftFoot' || supportBone?.name === 'mixamorigLeftToeBase') footWeight.left += weights.getComponent(i, c);
          if (supportBone?.name === 'mixamorigRightFoot' || supportBone?.name === 'mixamorigRightToeBase') footWeight.right += weights.getComponent(i, c);
        }
        mesh.getVertexPosition(i, vertex); mesh.localToWorld(vertex);
        minY = Math.min(minY, vertex.y); maxY = Math.max(maxY, vertex.y);
        rootPoint.copy(vertex).applyMatrix4(rootInverse.copy(root.matrixWorld).invert());
        if (footWeight.left >= 0.5) footSoleMinY.left = Math.min(footSoleMinY.left, rootPoint.y);
        if (footWeight.right >= 0.5) footSoleMinY.right = Math.min(footSoleMinY.right, rootPoint.y);
        if (bodySupportWeight >= 0.5 && !/hair/i.test(mesh.name)) {
          for (const side of ['left', 'right'] as const) nearestSq[side] = Math.min(nearestSq[side], rootPoint.distanceToSquared(handPoints[side]));
        }
        if (rootPoint.y < 0.28 || rootPoint.y > 1.1) continue;
        let leftWeight = 0, rightWeight = 0;
        for (let c = 0; c < 4; c++) {
          const bone = mesh.skeleton.bones[indices.getComponent(i, c)];
          if (!bone) continue;
          const name = bone.name;
          const weight = weights.getComponent(i, c);
          if (/Left(Arm|ForeArm|Hand)/.test(name)) leftWeight += weight;
          if (/Right(Arm|ForeArm|Hand)/.test(name)) rightWeight += weight;
        }
        for (const side of ['left', 'right'] as const) {
          const armWeight = side === 'left' ? leftWeight : rightWeight;
          if (armWeight < 0.45) continue;
          const key = profileKey(rootPoint.y), torso = torsoProfile.get(key);
          if (!torso) continue;
          totals[side]++;
          const lateralValue = rootPoint.dot(profileLateral);
          if (side === 'left' ? lateralValue < torso.min - 0.005 : lateralValue > torso.max + 0.005) outside[side]++;
        }
      }
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) throw new Error('Native action produced non-finite skinned geometry bounds');
    return Object.freeze({ bodyMinY: minY, bodyMaxY: maxY, armSurfaceOutsideTorso: Object.freeze({
      left: totals.left ? outside.left / totals.left : 0,
      right: totals.right ? outside.right / totals.right : 0,
    }), handToBodySupportVertex: Object.freeze({ left: Math.sqrt(nearestSq.left), right: Math.sqrt(nearestSq.right) }), footSoleMinY: Object.freeze(footSoleMinY) });
  }

  return {
    apply,
    measure,
    restore() { if (!disposed) native.restore(); },
    dispose() { if (!disposed) { native.dispose(); disposed = true; } },
  };
}
