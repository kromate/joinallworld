import * as THREE from 'three';

export type NativeSourcePoseName = 'jog' | 'dance' | 'lie';
export type NativeRuntimePoseName = 'jog' | 'dance';
export type NativeSourceSupport = { readonly floorY: number; readonly contact: 'feet' | 'body' };
export type NativeSourceJoint =
  | 'Hips' | 'Spine' | 'Spine1' | 'Spine2' | 'Neck' | 'Head'
  | 'LeftShoulder' | 'LeftArm' | 'LeftForeArm' | 'LeftHand'
  | 'RightShoulder' | 'RightArm' | 'RightForeArm' | 'RightHand'
  | 'LeftUpLeg' | 'LeftLeg' | 'LeftFoot' | 'LeftToeBase'
  | 'RightUpLeg' | 'RightLeg' | 'RightFoot' | 'RightToeBase';
export type Landmark = readonly [number, number, number];
export type SourceLandmarks = Readonly<Record<NativeSourceJoint, Landmark>>;
export interface NativeSourceFrame {
  readonly clipName: string;
  readonly duration: number;
  readonly landmarks: SourceLandmarks;
}
export interface NativeSourcePoseSnapshot {
  readonly pose: NativeSourcePoseName;
  readonly clipName: string;
  readonly seconds: number;
  readonly clipSeconds: number;
  readonly support: NativeSourceSupport;
  readonly bodyMinY?: number;
  readonly bodyMaxY?: number;
  readonly contactMinY: number;
  // Offline body-contact diagnostics do not sample feet.
  readonly footSoleMinY?: Readonly<Record<'left' | 'right', number>>;
  readonly reach: Readonly<Record<'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg', {
    requested: number; clamped: number; maximum: number; wasClamped: boolean;
  }>>;
}
export interface NativeSourcePoseController {
  /** Runtime candidate: samples old clip positions and solves feet-supported jog/dance. */
  apply(seconds: number, pose: NativeRuntimePoseName, support: NativeSourceSupport & { readonly contact: 'feet' }): NativeSourcePoseSnapshot;
  /** Full-body scan for offline inspection; do not call this from a render/update loop. */
  measureBodyBounds(): Readonly<{ bodyMinY: number; bodyMaxY: number }>;
  /** Lie remains diagnostic-only until a proven bounded body-contact set exists. */
  applyDiagnosticLie(seconds: number, support: NativeSourceSupport & { readonly contact: 'body' }): NativeSourcePoseSnapshot;
  restore(): void;
  dispose(): void;
  readonly metrics: Readonly<{ sourceTorsoLength: number; targetTorsoLength: number; statureRatio: number; footCandidateVertices: Readonly<Record<Side, number>>; supportCandidateVertices: number }>;
}
export interface NativeSourcePoseOptions {
  readonly sourceRest: SourceLandmarks;
  readonly clipDurations: Readonly<Record<'jog' | 'dance' | 'lie-down', number>>;
  readonly sampleSource: (clipName: 'jog' | 'dance' | 'lie-down', seconds: number) => NativeSourceFrame;
}

const JOINT_MAP: Readonly<Record<NativeSourceJoint, string>> = Object.freeze({
  Hips: 'mixamorigHips', Spine: 'mixamorigSpine', Spine1: 'mixamorigSpine1', Spine2: 'mixamorigSpine2',
  Neck: 'mixamorigNeck', Head: 'mixamorigHead',
  LeftShoulder: 'mixamorigLeftShoulder', LeftArm: 'mixamorigLeftArm', LeftForeArm: 'mixamorigLeftForeArm', LeftHand: 'mixamorigLeftHand',
  RightShoulder: 'mixamorigRightShoulder', RightArm: 'mixamorigRightArm', RightForeArm: 'mixamorigRightForeArm', RightHand: 'mixamorigRightHand',
  LeftUpLeg: 'mixamorigLeftUpLeg', LeftLeg: 'mixamorigLeftLeg', LeftFoot: 'mixamorigLeftFoot', LeftToeBase: 'mixamorigLeftToeBase',
  RightUpLeg: 'mixamorigRightUpLeg', RightLeg: 'mixamorigRightLeg', RightFoot: 'mixamorigRightFoot', RightToeBase: 'mixamorigRightToeBase',
});
const TORSO_PAIRS: readonly (readonly [NativeSourceJoint, NativeSourceJoint])[] = [
  ['Hips', 'Spine'], ['Spine', 'Spine1'], ['Spine1', 'Spine2'], ['Spine2', 'Neck'], ['Neck', 'Head'],
];
const REST_NAMES = Object.values(JOINT_MAP);
type Transform = { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };
type FrameBasis = { right: THREE.Vector3; up: THREE.Vector3; forward: THREE.Vector3 };
type Side = 'left' | 'right';
type ChainReach = { requested: number; clamped: number; maximum: number; wasClamped: boolean };

function requireBone(root: THREE.Group, name: string): THREE.Bone {
  const bone = root.getObjectByName(name) as THREE.Bone | null;
  if (!bone?.isBone) throw new Error(`Native source pose requires authored joint ${name}`);
  return bone;
}

function vector(value: Landmark): THREE.Vector3 { return new THREE.Vector3(value[0], value[1], value[2]); }

function frameFrom(points: Readonly<Record<NativeSourceJoint, THREE.Vector3>>): FrameBasis {
  const up = points.Head.clone().sub(points.Hips).normalize();
  let forward = points.LeftToeBase.clone().sub(points.LeftFoot).add(
    points.RightToeBase.clone().sub(points.RightFoot)).multiplyScalar(0.5);
  forward.addScaledVector(up, -forward.dot(up)).normalize();
  let right = points.RightShoulder.clone().sub(points.LeftShoulder);
  right.addScaledVector(up, -right.dot(up)).addScaledVector(forward, -right.dot(forward)).normalize();
  if (up.lengthSq() < 0.9 || forward.lengthSq() < 0.9 || right.lengthSq() < 0.9) {
    throw new Error('Cannot construct anatomical forward/side/up frame from source/native landmarks');
  }
  return { right, up, forward };
}

function pointsFromLandmarks(frame: SourceLandmarks): Record<NativeSourceJoint, THREE.Vector3> {
  return Object.fromEntries(Object.keys(JOINT_MAP).map((name) => [name, vector(frame[name as NativeSourceJoint])])) as Record<NativeSourceJoint, THREE.Vector3>;
}

/**
 * Retargets sampled old-clip joint positions, never their incompatible local quaternions. Source
 * offsets are expressed in source right/up/forward coordinates, scaled by the measured native vs
 * source torso length, and then solved onto this actor's own segment lengths.
 */
export function createNativeSourcePoseController(root: THREE.Group, options: NativeSourcePoseOptions): NativeSourcePoseController {
  const bones = new Map(Object.values(JOINT_MAP).map((name) => [name, requireBone(root, name)]));
  const transforms = new Map<THREE.Bone, Transform>();
  for (const name of REST_NAMES) {
    const bone = bones.get(name)!;
    transforms.set(bone, { position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() });
  }
  const body = (() => {
    const meshes: THREE.SkinnedMesh[] = [];
    root.traverse((node) => { const mesh = node as THREE.SkinnedMesh; if (mesh.isSkinnedMesh && mesh.name === 'Body') meshes.push(mesh); });
    if (meshes.length !== 1) throw new Error(`Native source pose expects one Body mesh; got ${meshes.length}`);
    return meshes[0]!;
  })();
  const skinIndices = body.geometry.getAttribute('skinIndex');
  const skinWeights = body.geometry.getAttribute('skinWeight');
  if (!skinIndices || !skinWeights || skinIndices.count !== skinWeights.count) {
    throw new Error('Native source pose body is missing aligned skin indices/weights');
  }
  const footCandidates: Record<Side, number[]> = { left: [], right: [] };
  const footBoneIds: Record<Side, Set<number>> = { left: new Set(), right: new Set() };
  body.skeleton.bones.forEach((bone, index) => {
    if (bone.name === 'mixamorigLeftFoot' || bone.name === 'mixamorigLeftToeBase') footBoneIds.left.add(index);
    if (bone.name === 'mixamorigRightFoot' || bone.name === 'mixamorigRightToeBase') footBoneIds.right.add(index);
  });
  for (let i = 0; i < skinIndices.count; i++) {
    let leftWeight = 0, rightWeight = 0;
    for (let c = 0; c < 4; c++) {
      const boneIndex = skinIndices.getComponent(i, c), weight = skinWeights.getComponent(i, c);
      if (footBoneIds.left.has(boneIndex)) leftWeight += weight;
      if (footBoneIds.right.has(boneIndex)) rightWeight += weight;
    }
    if (leftWeight > 1e-5) footCandidates.left.push(i);
    if (rightWeight > 1e-5) footCandidates.right.push(i);
  }
  if (!footCandidates.left.length || !footCandidates.right.length) throw new Error('Native source pose could not precompute both foot/toe support sets');
  const supportVertices = [...new Set([...footCandidates.left, ...footCandidates.right])].sort((a, b) => a - b);
  const supportSlotByVertex = new Int32Array(skinIndices.count).fill(-1);
  supportVertices.forEach((vertexIndex, slot) => { supportSlotByVertex[vertexIndex] = slot; });
  const footSlots: Record<Side, number[]> = {
    left: footCandidates.left.map((vertexIndex) => supportSlotByVertex[vertexIndex]!),
    right: footCandidates.right.map((vertexIndex) => supportSlotByVertex[vertexIndex]!),
  };
  const supportBefore = new Float64Array(supportVertices.length);
  const supportProbe = new Float64Array(supportVertices.length);
  const supportAfter = new Float64Array(supportVertices.length);
  const bodyBefore = new Float64Array(skinIndices.count);
  const bodyProbe = new Float64Array(skinIndices.count);
  const bodyAfter = new Float64Array(skinIndices.count);
  const bodyVertexSlots = new Uint32Array(skinIndices.count);
  for (let i = 0; i < bodyVertexSlots.length; i++) bodyVertexSlots[i] = i;
  const supportVertexSlots = new Uint32Array(supportVertices.length);
  for (let i = 0; i < supportVertexSlots.length; i++) supportVertexSlots[i] = i;
  const supportProbeDistance = 0.01;
  const sourceRest = pointsFromLandmarks(options.sourceRest);
  const sourceFrame = frameFrom(sourceRest);
  const rootInverse = new THREE.Matrix4();
  const rootRotation = new THREE.Quaternion();
  const currentDirection = new THREE.Vector3(), desiredDirection = new THREE.Vector3();
  const currentWorldRotation = new THREE.Quaternion(), parentWorldRotation = new THREE.Quaternion();
  const inverseParentRotation = new THREE.Quaternion(), worldDelta = new THREE.Quaternion();
  const worldPoint = new THREE.Vector3(), localPoint = new THREE.Vector3(), desiredWorldPoint = new THREE.Vector3();
  const rootHipRest = new THREE.Vector3();
  const vertex = new THREE.Vector3();
  const restPoints = {} as Record<NativeSourceJoint, THREE.Vector3>;
  let disposed = false;

  function updateWorld(): void { root.updateWorldMatrix(true, true); }
  function localBonePoint(name: NativeSourceJoint, target = new THREE.Vector3()): THREE.Vector3 {
    updateWorld();
    return bones.get(JOINT_MAP[name])!.getWorldPosition(target).applyMatrix4(rootInverse.copy(root.matrixWorld).invert());
  }
  for (const name of Object.keys(JOINT_MAP) as NativeSourceJoint[]) restPoints[name] = localBonePoint(name);
  const targetFrame = frameFrom(restPoints);
  const targetTorsoLength = restPoints.Head.distanceTo(restPoints.Hips);
  const sourceTorsoLength = sourceRest.Head.distanceTo(sourceRest.Hips);
  if (!(targetTorsoLength > 0.1 && sourceTorsoLength > 0.1)) throw new Error('Native/source torso length is degenerate');
  const statureRatio = targetTorsoLength / sourceTorsoLength;
  rootHipRest.copy(restPoints.Hips);

  function resetBones(): void {
    for (const [bone, transform] of transforms) {
      bone.position.copy(transform.position); bone.quaternion.copy(transform.quaternion); bone.scale.copy(transform.scale);
    }
    updateWorld();
  }

  function mapVector(source: THREE.Vector3): THREE.Vector3 {
    return targetFrame.right.clone().multiplyScalar(source.dot(sourceFrame.right))
      .addScaledVector(targetFrame.up, source.dot(sourceFrame.up))
      .addScaledVector(targetFrame.forward, source.dot(sourceFrame.forward)).multiplyScalar(statureRatio);
  }

  function mapPoint(sourcePose: Record<NativeSourceJoint, THREE.Vector3>, name: NativeSourceJoint): THREE.Vector3 {
    return rootHipRest.clone().add(mapVector(sourcePose[name].clone().sub(sourceRest.Hips)));
  }

  function placeHipsAt(rootLocalPoint: THREE.Vector3): void {
    const hip = bones.get(JOINT_MAP.Hips)!;
    const parent = hip.parent;
    if (!parent) throw new Error('Native hips joint has no parent');
    updateWorld();
    desiredWorldPoint.copy(rootLocalPoint).applyMatrix4(root.matrixWorld);
    parent.worldToLocal(desiredWorldPoint);
    hip.position.copy(desiredWorldPoint);
    updateWorld();
  }

  function aim(name: NativeSourceJoint, childName: NativeSourceJoint, directionInRoot: THREE.Vector3): void {
    const bone = bones.get(JOINT_MAP[name])!, child = bones.get(JOINT_MAP[childName])!;
    const parent = bone.parent;
    if (!parent) throw new Error(`Native joint ${name} has no parent`);
    updateWorld();
    bone.getWorldPosition(worldPoint); child.getWorldPosition(localPoint);
    currentDirection.subVectors(localPoint, worldPoint).normalize();
    root.getWorldQuaternion(rootRotation);
    desiredDirection.copy(directionInRoot).normalize().applyQuaternion(rootRotation);
    if (currentDirection.lengthSq() < 0.9 || desiredDirection.lengthSq() < 0.9) throw new Error(`Degenerate source direction ${name}/${childName}`);
    worldDelta.setFromUnitVectors(currentDirection, desiredDirection);
    bone.getWorldQuaternion(currentWorldRotation).premultiply(worldDelta);
    parent.getWorldQuaternion(parentWorldRotation);
    bone.quaternion.copy(inverseParentRotation.copy(parentWorldRotation).invert().multiply(currentWorldRotation)).normalize();
    updateWorld();
  }

  function solveChain(side: Side, kind: 'arm' | 'leg', endpointRoot: THREE.Vector3, elbowRoot: THREE.Vector3): ChainReach {
    const upper = kind === 'arm' ? `mixamorig${side === 'left' ? 'Left' : 'Right'}Arm` : `mixamorig${side === 'left' ? 'Left' : 'Right'}UpLeg`;
    const middle = kind === 'arm' ? `mixamorig${side === 'left' ? 'Left' : 'Right'}ForeArm` : `mixamorig${side === 'left' ? 'Left' : 'Right'}Leg`;
    const end = kind === 'arm' ? `mixamorig${side === 'left' ? 'Left' : 'Right'}Hand` : `mixamorig${side === 'left' ? 'Left' : 'Right'}Foot`;
    const upperBone = bones.get(upper)!, middleBone = bones.get(middle)!, endBone = bones.get(end)!;
    updateWorld();
    const rootInv = rootInverse.copy(root.matrixWorld).invert();
    const start = upperBone.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInv);
    const mid = middleBone.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInv);
    const finish = endBone.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInv);
    const firstLength = start.distanceTo(mid), secondLength = mid.distanceTo(finish);
    if (!(firstLength > 0.01 && secondLength > 0.01)) throw new Error(`Degenerate ${side} ${kind} chain`);
    const requestedVector = endpointRoot.clone().sub(start), requested = requestedVector.length();
    const maximum = firstLength + secondLength - 0.002;
    const minimum = Math.abs(firstLength - secondLength) + 0.002;
    const clamped = THREE.MathUtils.clamp(requested, minimum, maximum);
    const direction = requested > 1e-8 ? requestedVector.multiplyScalar(1 / requested) : finish.clone().sub(start).normalize();
    const along = (firstLength * firstLength - secondLength * secondLength + clamped * clamped) / (2 * clamped);
    const height = Math.sqrt(Math.max(0, firstLength * firstLength - along * along));
    const pole = elbowRoot.clone().sub(start).addScaledVector(direction, -elbowRoot.clone().sub(start).dot(direction));
    if (pole.lengthSq() < 1e-8) pole.copy(targetFrame.forward);
    pole.normalize();
    const midTarget = start.clone().addScaledVector(direction, along).addScaledVector(pole, height);
    aim(kind === 'arm' ? (side === 'left' ? 'LeftArm' : 'RightArm') : (side === 'left' ? 'LeftUpLeg' : 'RightUpLeg'),
      kind === 'arm' ? (side === 'left' ? 'LeftForeArm' : 'RightForeArm') : (side === 'left' ? 'LeftLeg' : 'RightLeg'),
      midTarget.sub(start));
    updateWorld();
    const actualMid = middleBone.getWorldPosition(new THREE.Vector3()).applyMatrix4(rootInverse.copy(root.matrixWorld).invert());
    aim(kind === 'arm' ? (side === 'left' ? 'LeftForeArm' : 'RightForeArm') : (side === 'left' ? 'LeftLeg' : 'RightLeg'),
      kind === 'arm' ? (side === 'left' ? 'LeftHand' : 'RightHand') : (side === 'left' ? 'LeftFoot' : 'RightFoot'),
      endpointRoot.clone().sub(actualMid));
    return { requested, clamped, maximum, wasClamped: Math.abs(requested - clamped) > 1e-5 };
  }

  function mapPose(frame: NativeSourceFrame): Record<NativeSourceJoint, THREE.Vector3> {
    const points = pointsFromLandmarks(frame.landmarks);
    return Object.fromEntries((Object.keys(JOINT_MAP) as NativeSourceJoint[]).map((name) => [name, mapPoint(points, name)])) as Record<NativeSourceJoint, THREE.Vector3>;
  }

  function sampleBodyY(out: Float64Array): { bodyMinY: number; bodyMaxY: number } {
    updateWorld();
    body.skeleton.update();
    const position = body.geometry.getAttribute('position');
    if (!position) throw new Error('Native source pose body is missing positions');
    let bodyMinY = Infinity, bodyMaxY = -Infinity;
    for (let i = 0; i < position.count; i++) {
      body.getVertexPosition(i, vertex); body.localToWorld(vertex);
      out[i] = vertex.y;
      bodyMinY = Math.min(bodyMinY, vertex.y); bodyMaxY = Math.max(bodyMaxY, vertex.y);
    }
    if (![bodyMinY, bodyMaxY].every(Number.isFinite)) throw new Error('Native source pose produced non-finite body bounds');
    return { bodyMinY, bodyMaxY };
  }

  function measureBodyBounds(): { bodyMinY: number; bodyMaxY: number } {
    return sampleBodyY(bodyAfter);
  }

  function sampleFeetY(out: Float64Array): { contactMinY: number; footSoleMinY: Record<Side, number> } {
    updateWorld();
    body.skeleton.update();
    for (let slot = 0; slot < supportVertices.length; slot++) {
      body.getVertexPosition(supportVertices[slot]!, vertex); body.localToWorld(vertex); out[slot] = vertex.y;
    }
    const soles: Record<Side, number> = { left: Infinity, right: Infinity };
    for (const side of ['left', 'right'] as const) {
      for (const slot of footSlots[side]) {
        soles[side] = Math.min(soles[side], out[slot]!);
      }
    }
    const contactMinY = Math.min(soles.left, soles.right);
    if (![soles.left, soles.right, contactMinY].every(Number.isFinite)) throw new Error('Native source pose produced invalid foot/toe support');
    return { contactMinY, footSoleMinY: soles };
  }

  function requiredWorldShift(before: Float64Array, probe: Float64Array, indices: Iterable<number>, floorY: number): number {
    let minimumShift = -Infinity, maximumShift = Infinity;
    for (const index of indices) {
      const y = before[index]!, response = (probe[index]! - y) / supportProbeDistance;
      if (response > 1e-5) minimumShift = Math.max(minimumShift, (floorY - y) / response);
      else if (response < -1e-5) maximumShift = Math.min(maximumShift, (floorY - y) / response);
      else if (y < floorY - 0.001) throw new Error(`Support vertex ${index} cannot be moved with the pelvis`);
    }
    if (!Number.isFinite(minimumShift) || minimumShift > maximumShift + 1e-4) throw new Error(`No feasible pelvis shift supports this pose (${minimumShift}..${maximumShift})`);
    return minimumShift;
  }

  function shiftHipsWorldY(deltaY: number): void {
    const hip = bones.get(JOINT_MAP.Hips)!;
    const parent = hip.parent;
    if (!parent) throw new Error('Native hips joint has no parent');
    updateWorld();
    const worldPoint = hip.getWorldPosition(new THREE.Vector3());
    worldPoint.y += deltaY;
    parent.worldToLocal(worldPoint);
    hip.position.copy(worldPoint);
    updateWorld();
  }

  function applyPose(seconds: number, pose: NativeSourcePoseName, support: NativeSourceSupport, diagnostic: boolean): NativeSourcePoseSnapshot {
    if (disposed) throw new Error('Native source pose controller is disposed');
    if (!Number.isFinite(seconds) || !Number.isFinite(support.floorY)) throw new Error('Native source pose time/support must be finite');
    if ((!diagnostic && support.contact !== 'feet') || (diagnostic && support.contact !== 'body')) throw new Error('Unsupported native source contact type for this pose path');
    resetBones();
    const clipName = pose === 'lie' ? 'lie-down' : pose;
    const duration = options.clipDurations[clipName];
    if (!(duration > 0) || !Number.isFinite(duration)) throw new Error(`Source pose has invalid ${clipName} duration`);
    const clipSeconds = pose === 'lie' ? THREE.MathUtils.clamp(seconds, 0, duration) : THREE.MathUtils.euclideanModulo(seconds, duration);
    const sampled = options.sampleSource(clipName, clipSeconds);
    if (sampled.clipName !== clipName || Math.abs(sampled.duration - duration) > 1e-5) throw new Error(`Source sampler returned invalid ${clipName} clip metadata`);
    const sourcePose = pointsFromLandmarks(sampled.landmarks);
    const mapped = mapPose(sampled);
    const hips = bones.get(JOINT_MAP.Hips)!;
    const sourceHipDelta = sourcePose.Hips.clone().sub(sourceRest.Hips);
    placeHipsAt(rootHipRest.clone().add(mapVector(sourceHipDelta)));

    for (const [parent, child] of TORSO_PAIRS) aim(parent, child, mapped[child].clone().sub(mapped[parent]));
    const reach = {} as Record<'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg', ChainReach>;
    reach.leftArm = solveChain('left', 'arm', mapped.LeftHand, mapped.LeftForeArm);
    reach.rightArm = solveChain('right', 'arm', mapped.RightHand, mapped.RightForeArm);
    reach.leftLeg = solveChain('left', 'leg', mapped.LeftFoot, mapped.LeftLeg);
    reach.rightLeg = solveChain('right', 'leg', mapped.RightFoot, mapped.RightLeg);
    aim('LeftFoot', 'LeftToeBase', mapped.LeftToeBase.clone().sub(mapped.LeftFoot));
    aim('RightFoot', 'RightToeBase', mapped.RightToeBase.clone().sub(mapped.RightFoot));

    const initialMetrics = diagnostic ? sampleBodyY(bodyBefore) : sampleFeetY(supportBefore);
    const initialContactY = diagnostic ? (initialMetrics as { bodyMinY: number }).bodyMinY
      : (initialMetrics as { contactMinY: number }).contactMinY;
    shiftHipsWorldY(supportProbeDistance);
    if (diagnostic) sampleBodyY(bodyProbe); else sampleFeetY(supportProbe);
    shiftHipsWorldY(-supportProbeDistance);
    const requestedWorldShift = diagnostic
      ? requiredWorldShift(bodyBefore, bodyProbe, bodyVertexSlots, support.floorY)
      : requiredWorldShift(supportBefore, supportProbe, supportVertexSlots, support.floorY);
    shiftHipsWorldY(requestedWorldShift);
    const supportMetrics = diagnostic ? sampleBodyY(bodyAfter) : sampleFeetY(supportAfter);
    const contactMinY = diagnostic ? (supportMetrics as { bodyMinY: number }).bodyMinY
      : (supportMetrics as { contactMinY: number }).contactMinY;
    if (Math.abs(contactMinY - support.floorY) > 0.001) throw new Error(`Native source-pose support did not converge: before ${initialContactY}, required shift ${requestedWorldShift}, after ${contactMinY}`);
    const bodyBounds = diagnostic ? supportMetrics as { bodyMinY: number; bodyMaxY: number } : undefined;
    const footMetrics = diagnostic ? undefined : supportMetrics as { contactMinY: number; footSoleMinY: Record<Side, number> };
    return Object.freeze({ pose, clipName, seconds, clipSeconds, support: Object.freeze({ ...support }),
      ...(bodyBounds ? { bodyMinY: bodyBounds.bodyMinY, bodyMaxY: bodyBounds.bodyMaxY } : {}), contactMinY,
      ...(footMetrics ? { footSoleMinY: Object.freeze(footMetrics.footSoleMinY) } : {}), reach: Object.freeze(reach) });
  }

  function apply(seconds: number, pose: NativeRuntimePoseName, support: NativeSourceSupport & { readonly contact: 'feet' }): NativeSourcePoseSnapshot {
    return applyPose(seconds, pose, support, false);
  }
  function applyDiagnosticLie(seconds: number, support: NativeSourceSupport & { readonly contact: 'body' }): NativeSourcePoseSnapshot {
    return applyPose(seconds, 'lie', support, true);
  }
  function restore(): void { if (!disposed) resetBones(); }
  return { apply, applyDiagnosticLie, measureBodyBounds, restore,
    metrics: Object.freeze({ sourceTorsoLength, targetTorsoLength, statureRatio,
      footCandidateVertices: Object.freeze({ left: footCandidates.left.length, right: footCandidates.right.length }),
      supportCandidateVertices: supportVertices.length }),
    dispose() { if (!disposed) { resetBones(); disposed = true; } } };
}
