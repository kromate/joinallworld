import * as THREE from 'three';
import { createNativeBodySurfaceProbe } from './native-body-surface.ts';

export type NativeClipSupport =
  | { readonly kind: 'flat-feet'; readonly floorY: number }
  | { readonly kind: 'stair-feet'; readonly leftFloorY: number; readonly rightFloorY: number }
  | { readonly kind: 'seat-anchor'; readonly hipWorld: Landmark; readonly floorY: number }
  | { readonly kind: 'body-surface'; readonly surfaceY: number }
  | { readonly kind: 'body-contact-diagnostic'; readonly floorY: number; readonly diagnosticOnly: true };
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
export interface NativeClipApplyResult {
  readonly clipName: string;
  readonly support: NativeClipSupport;
  readonly supportStatus: 'feet-supported' | 'feet-residual-unresolved' | 'seat-anchored-contact-unverified' | 'body-contact-diagnostic-only' | 'body-surface-supported';
  readonly seatFeetStatus?: 'supported' | 'unreachable';
  readonly bodyMinY?: number;
  readonly bodyMaxY?: number;
  readonly contactMinY: number;
  readonly footSoleMinY: Readonly<Record<'left' | 'right', number>>;
  readonly reach: Readonly<Record<'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg', {
    requested: number; clamped: number; maximum: number; wasClamped: boolean;
  }>>;
}
export interface NativeClipSolver {
  /** Applies one actor-owned exact sampled clip frame. The frame must be consumed before the next sampler call. */
  applyFrame(frame: NativeSourceFrame, support: NativeClipSupport): NativeClipApplyResult;
  /** Full-body scan for offline inspection; do not call this from a render/update loop. */
  measureBodyBounds(): Readonly<{ bodyMinY: number; bodyMaxY: number }>;
  restore(): void;
  dispose(): void;
  readonly metrics: Readonly<{ sourceTorsoLength: number; targetTorsoLength: number; statureRatio: number; footCandidateVertices: Readonly<Record<Side, number>>; supportCandidateVertices: number; bodySurfaceCandidateVertices: number; bodySurfaceSourceVertices: number }>;
}
export interface NativeClipSolverOptions {
  readonly sourceRest: SourceLandmarks;
  /** Actual visible footwear surface, sharing the actor skeleton; defaults to Body. */
  readonly footSurface?: THREE.SkinnedMesh;
  readonly bodySurfaceMeshes?: readonly THREE.SkinnedMesh[];
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
 * Retargets sampled clip joint positions, never their incompatible local quaternions. Source
 * offsets are expressed in source right/up/forward coordinates, scaled by the measured native vs
 * source torso length, and then solved onto this actor's own segment lengths.
 */
export function createNativeClipSolver(root: THREE.Group, options: NativeClipSolverOptions): NativeClipSolver {
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
  const footSurface = options.footSurface ?? body;
  if (root.getObjectById(footSurface.id) !== footSurface
    || footSurface.skeleton.bones.length !== body.skeleton.bones.length
    || !footSurface.skeleton.bones.every((bone, index) => bone === body.skeleton.bones[index])) {
    throw new Error('Native foot surface must belong to the actor and share its exact skeleton');
  }
  const bodySurface = createNativeBodySurfaceProbe(root, options.bodySurfaceMeshes ?? [body]);
  const skinIndices = footSurface.geometry.getAttribute('skinIndex');
  const skinWeights = footSurface.geometry.getAttribute('skinWeight');
  if (!skinIndices || !skinWeights || skinIndices.count !== skinWeights.count) {
    throw new Error('Native source pose body is missing aligned skin indices/weights');
  }
  const footCandidates: Record<Side, number[]> = { left: [], right: [] };
  const footBoneIds: Record<Side, Set<number>> = { left: new Set(), right: new Set() };
  footSurface.skeleton.bones.forEach((bone, index) => {
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
  const supportAfter = new Float64Array(supportVertices.length);
  const bodyAfter = new Float64Array(body.geometry.getAttribute('position').count);
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

  function updateWorld(): void {
    root.updateWorldMatrix(true, false);
    root.updateMatrixWorld(true);
  }
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
      footSurface.getVertexPosition(supportVertices[slot]!, vertex); footSurface.localToWorld(vertex); out[slot] = vertex.y;
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

  function applyFrame(frame: NativeSourceFrame, support: NativeClipSupport): NativeClipApplyResult {
    if (disposed) throw new Error('Native source pose controller is disposed');
    if (!frame.clipName || !(frame.duration > 0) || !Number.isFinite(frame.duration)) throw new Error('Native clip frame metadata must be valid');
    if (support.kind === 'flat-feet' && !Number.isFinite(support.floorY)) throw new Error('Flat floor must be finite');
    if (support.kind === 'stair-feet' && ![support.leftFloorY, support.rightFloorY].every(Number.isFinite)) throw new Error('Stair support must be finite');
    if (support.kind === 'seat-anchor' && (![...support.hipWorld, support.floorY].every(Number.isFinite))) throw new Error('Seat anchor must be finite');
    if (support.kind === 'body-surface' && !Number.isFinite(support.surfaceY)) throw new Error('Body support plane must be finite');
    if (support.kind === 'body-contact-diagnostic' && (!support.diagnosticOnly || !Number.isFinite(support.floorY))) throw new Error('Body contact is diagnostic-only');
    resetBones();
    const sampled = frame;
    const sourcePose = pointsFromLandmarks(sampled.landmarks);
    const mapped = mapPose(sampled);
    const sourceHipDelta = sourcePose.Hips.clone().sub(sourceRest.Hips);
    placeHipsAt(rootHipRest.clone().add(mapVector(sourceHipDelta)));
    if (support.kind === 'seat-anchor') {
      updateWorld();
      const anchoredHip = new THREE.Vector3(...support.hipWorld).applyMatrix4(rootInverse.copy(root.matrixWorld).invert());
      const sourceHip = rootHipRest.clone().add(mapVector(sourceHipDelta));
      const anchorOffset = anchoredHip.clone().sub(sourceHip);
      for (const point of Object.values(mapped)) point.add(anchorOffset);
      placeHipsAt(anchoredHip);
    }

    for (const [parent, child] of TORSO_PAIRS) aim(parent, child, mapped[child].clone().sub(mapped[parent]));
    const reach = {} as Record<'leftArm' | 'rightArm' | 'leftLeg' | 'rightLeg', ChainReach>;
    reach.leftArm = solveChain('left', 'arm', mapped.LeftHand, mapped.LeftForeArm);
    reach.rightArm = solveChain('right', 'arm', mapped.RightHand, mapped.RightForeArm);
    const leftFoot = mapped.LeftFoot, rightFoot = mapped.RightFoot;
    // Stair levels are represented by distinct ankle targets. Flat standing uses the same exact
    // source foot landmarks; final surface residual is checked against cached weighted sole vertices.
    reach.leftLeg = solveChain('left', 'leg', leftFoot, mapped.LeftLeg);
    reach.rightLeg = solveChain('right', 'leg', rightFoot, mapped.RightLeg);
    aim('LeftFoot', 'LeftToeBase', mapped.LeftToeBase.clone().sub(mapped.LeftFoot));
    aim('RightFoot', 'RightToeBase', mapped.RightToeBase.clone().sub(mapped.RightFoot));

    if (support.kind === 'body-surface') {
      const before = bodySurface.sample();
      shiftHipsWorldY(support.surfaceY - before.minY);
      const after = bodySurface.sample(), feet = sampleFeetY(supportAfter);
      return Object.freeze({clipName:sampled.clipName,support:Object.freeze({...support}),supportStatus:'body-surface-supported' as const,
        bodyMinY:after.minY,bodyMaxY:after.maxY,contactMinY:after.minY,footSoleMinY:Object.freeze(feet.footSoleMinY),reach:Object.freeze(reach)});
    }
    let seatFeetStatus: 'supported' | 'unreachable' | undefined;
    if (support.kind === 'seat-anchor') {
      // Preserve the caller's pelvis anchor while fitting each ankle to its actual deformed sole.
      // A bounded correction reports reach failure instead of shifting the whole seated body.
      for (let pass = 0; pass < 3; pass++) {
        for (const side of ['left', 'right'] as const) {
          const soles = sampleFeetY(supportBefore);
          const ankleWorld = bones.get(side === 'left' ? JOINT_MAP.LeftFoot : JOINT_MAP.RightFoot)!.getWorldPosition(new THREE.Vector3());
          ankleWorld.y += support.floorY - soles.footSoleMinY[side];
          const ankleTarget = ankleWorld.applyMatrix4(rootInverse.copy(root.matrixWorld).invert());
          const knee = localBonePoint(side === 'left' ? 'LeftLeg' : 'RightLeg');
          reach[side === 'left' ? 'leftLeg' : 'rightLeg'] = solveChain(side, 'leg', ankleTarget, knee);
          aim(side === 'left' ? 'LeftFoot' : 'RightFoot', side === 'left' ? 'LeftToeBase' : 'RightToeBase', targetFrame.forward);
        }
      }
      const seatFeet = sampleFeetY(supportAfter);
      seatFeetStatus = Math.max(Math.abs(seatFeet.footSoleMinY.left - support.floorY), Math.abs(seatFeet.footSoleMinY.right - support.floorY)) <= .004 ? 'supported' : 'unreachable';
    }
    const diagnostic = support.kind === 'body-contact-diagnostic';
    const supported = support.kind === 'flat-feet' || support.kind === 'stair-feet';
    if (!supported) {
      const bounds = diagnostic ? sampleBodyY(bodyAfter) : undefined;
      const feet = sampleFeetY(supportAfter);
      return Object.freeze({ clipName: sampled.clipName, support: Object.freeze({ ...support }),
        supportStatus: diagnostic ? 'body-contact-diagnostic-only' as const : 'seat-anchored-contact-unverified' as const,
        ...(seatFeetStatus ? {seatFeetStatus} : {}),
        ...(bounds ? { bodyMinY: bounds.bodyMinY, bodyMaxY: bounds.bodyMaxY } : {}),
        contactMinY: feet.contactMinY, footSoleMinY: Object.freeze(feet.footSoleMinY), reach: Object.freeze(reach) });
    }
    const metrics = sampleFeetY(supportBefore);
    // Use the actual deformed weighted sole candidates, not ankle height, to choose contact.
    const planted: Side = metrics.footSoleMinY.left <= metrics.footSoleMinY.right ? 'left' : 'right';
    const floorY = support.kind === 'flat-feet' ? support.floorY : support[planted === 'left' ? 'leftFloorY' : 'rightFloorY'];
    const plantedY = metrics.footSoleMinY[planted];
    const requestedWorldShift = floorY - plantedY;
    shiftHipsWorldY(requestedWorldShift);
    const supportMetrics = sampleFeetY(supportAfter);
    const leftFloor = support.kind === 'flat-feet' ? support.floorY : support.leftFloorY;
    const rightFloor = support.kind === 'flat-feet' ? support.floorY : support.rightFloorY;
    const residual = Math.min(supportMetrics.footSoleMinY.left - leftFloor, supportMetrics.footSoleMinY.right - rightFloor);
    const status = Math.abs(supportMetrics.footSoleMinY[planted] - floorY) <= 0.004 && residual >= -0.004
      ? 'feet-supported' as const : 'feet-residual-unresolved' as const;
    return Object.freeze({ clipName: sampled.clipName, support: Object.freeze({ ...support }),
      supportStatus: status, contactMinY: supportMetrics.contactMinY,
      footSoleMinY: Object.freeze(supportMetrics.footSoleMinY), reach: Object.freeze(reach) });
  }
  function restore(): void { if (!disposed) resetBones(); }
  return { applyFrame, measureBodyBounds, restore,
    metrics: Object.freeze({ sourceTorsoLength, targetTorsoLength, statureRatio,
      footCandidateVertices: Object.freeze({ left: footCandidates.left.length, right: footCandidates.right.length }),
      supportCandidateVertices: supportVertices.length, bodySurfaceCandidateVertices: bodySurface.candidateCount, bodySurfaceSourceVertices: bodySurface.sourceVertexCount }),
    dispose() { if (!disposed) { resetBones(); disposed = true; } } };
}
