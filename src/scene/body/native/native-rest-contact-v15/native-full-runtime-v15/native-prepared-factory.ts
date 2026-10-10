import * as THREE from 'three';
import type { Kit } from '../../../../kit.ts';
import { LOOK_OPTIONS, normalizeLook, type Look } from '../../../../characters.ts';
import { normalizeAvatarAppearance, avatarProportions } from '../../../../../types/avatar.ts';
import type { SkinnedBody } from '../../../skinned.ts';
import type { BodyKey } from '../../../manifest.ts';
import type { WardrobeMetrics, WardrobePresentation } from '../../../../wardrobe/renderer.ts';
import type { BodyPose } from '../../../poses.ts';
import type { FootContact, FootPoint, FootSolveResult } from '../../../foot-contact.ts';
import { createNativeFullRuntime, type NativeAppearanceScale, type NativeFullRuntime, type NativePoseSupport, type NativeSeat, type NativePlacement } from './native-full-runtime.ts';
import { completeCharacterKit } from '../../assets-fetch-v6.ts';
import { loadCompleteCharacter, type CompleteCharacter } from '../../rig.ts';
import { applyNativeFamilyRigCorrection, type NativeFamilyRigCorrection } from '../../native-family-rig-correction.ts';
import { applySkinMaterial } from '../../skin-material.ts';
import { applyAuthoredPresentation, type AuthoredPresentation } from '../../authored-presentation.ts';
import { applyAuthoredEyeMaterial } from '../../eye-material.ts';
import { createNativeHandPoseController } from '../../native-hand-pose.ts';
import { createNativeWristOrientationController } from '../../native-wrist-orientation/native-wrist-controller.ts';
import { createNativeHeadOrientationController } from '../../native-head-orientation.ts';
import { applyAuthoredFootwear, type AuthoredFootwear } from '../../authored-footwear/presentation.ts';
import { applyAuthoredClothingPacket, authoredBodyCoverageHideSet, type AuthoredClothingPacketLease } from '../../native-full-runtime-v1/apply-authored-clothing-packet-v1.ts';
import shoeHideMap from '../../authored-footwear/out/shoes01-body-hide-map.json';
import { createAuthoredLookBridge } from '../../authored-look-bridge.ts';
import { createNativeSourceLandmarkSampler, type NativeSourceLandmarkSampler, type NativeWristSourceFrame } from '../../native-source-sampler.ts';
import { createNativeClipSolver, type NativeClipSolver, type NativeClipSupport } from '../../native-clip-solver.ts';
import { createNativeDirectionRetargeter, type NativeDirectionRetargeter } from '../../native-direction-retarget.ts';
import { createNativeNeutralPose, type NativeNeutralPose } from '../../native-neutral-pose.ts';
import { createNativeSeatSurfaceProbe } from '../../native-seat-surface.ts';
import { solveNativeSeatPose } from '../../native-seat-pose-adapter.ts';
import { createNativeRestContactProbe } from '../native-rest-contact.ts';
import { createNativeRestPoseAdapter, type NativePropRestSupport, type NativeRestPose } from '../rest-pose-adapter.ts';
import { DOOR, INTO, OUT, SEATED, STAIRS, STILL, WORK_INTO, WORK_OUT } from '../../../poses.ts';

export interface NativePreparedFactoryOptions {
  /** Existing actor resource owner. Templates are cached by this Kit and released with it. */
  readonly kit: Kit;
  readonly look: unknown;
  readonly seed: string;
  readonly sceneScale: number;
  /** Experimental retarget choice. `landmarks` remains the default until direction-mode pixels pass review. */
  readonly retargetMode?: 'landmarks' | 'directions';
  /** Seat callback receives parent-local host coordinates and must return support in world coordinates. */
  readonly seatSupport?: (seat: NativeSeat, actor: THREE.Group) => NativePoseSupport;
  /** Query the actual host stair surface at a deformed sole contact in actor-parent coordinates; null means unsupported. */
  readonly stairContactHeightAt?: (contact: FootContact, actor: THREE.Group) => number | null;
  /** Object-use callback receives parent-local host coordinates and must return support in world coordinates. */
  readonly workSupport?: (placement: NativePlacement, actor: THREE.Group) => NativePoseSupport;
  /** The host selects/ registers the real bed, mat, tub or shower before requesting this pose. */
  readonly restSupport?: (pose: NativeRestPose, actor: THREE.Group) => NativePropRestSupport | null;
}

export interface NativePreparedMetrics {
  readonly bodyKey: BodyKey;
  readonly standingHeightMetres: number;
  readonly familyCorrection: NativeFamilyRigCorrection['metrics'];
  readonly authoredBodyTriangles: number;
  readonly clothingTriangles: number;
  readonly hairTriangles: number;
  readonly shoeTriangles: number;
  readonly sourceClipCount: number;
  readonly retargetMode: 'landmarks' | 'directions';
  readonly wardrobeWarnings: readonly string[];
  readonly contactSource: 'authored-footwear-sole';
  readonly contactLimitations: readonly string[];
}

export interface NativePreparedSkinnedBody extends SkinnedBody {
  readonly preparedMetrics: NativePreparedMetrics;
  /** Result of the most recent direction-mode pose's internal authored-shoe solve. */
  readonly lastDirectionContactSolve: FootSolveResult | null;
}

const BONE_ALIASES = Object.freeze({
  Head: 'mixamorigHead', Hips: 'mixamorigHips',
  hand_l: 'mixamorigLeftHand', hand_r: 'mixamorigRightHand',
});
const REQUIRED_LOOK_FIELDS = ['body', 'hair', 'outfit', 'fabric', 'skin', 'hairColor', 'outfitColor', 'bottomsColor', 'accessories', 'face', 'expression'] as const;
const GAME_SKIN: Readonly<Record<string, string>> = Object.freeze({
  skin1: '#e0ac7e', skin2: '#c98e62', skin3: '#b0764c', skin4: '#96603c',
  skin5: '#7a4a2c', skin6: '#5e3620', skin7: '#3f2416',
});
const HAIR_STYLE_ASSETS = new Map([
  ['lowcut', 'short02'], ['low-cut', 'short02'], ['fade', 'short02'], ['classic', 'short02'],
  ['afro', 'afro01'], ['curls', 'afro01'],
]);

function requireCompleteLook(input: unknown, seed: string): Look {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Native prepared body requires a complete saved look');
  const raw = input as Record<string, unknown>;
  const missing = REQUIRED_LOOK_FIELDS.filter((field) => !Object.hasOwn(raw, field));
  if (missing.length) throw new Error(`Native prepared body look is incomplete: ${missing.join(', ')}`);
  if (raw.body !== 'man' && raw.body !== 'woman') throw new Error(`Unsupported authored body family ${String(raw.body)}`);
  if (typeof raw.hair !== 'string' || !LOOK_OPTIONS.hair[raw.body].includes(raw.hair)) throw new Error(`Unsupported authored hairstyle ${String(raw.hair)}`);
  if (typeof raw.outfit !== 'string' || !LOOK_OPTIONS.outfit[raw.body].includes(raw.outfit)) throw new Error(`Unsupported authored outfit ${String(raw.outfit)}`);
  if (raw.fabric !== 'plain') throw new Error(`Unsupported authored fabric ${String(raw.fabric)}`);
  if (!Array.isArray(raw.accessories) || raw.accessories.length !== 0) throw new Error('Authored presentation does not support accessories');
  if (raw.wearables !== undefined && (!Array.isArray(raw.wearables) || raw.wearables.length !== 0)) {
    throw new Error('Authored presentation does not support wearables');
  }
  for (const [name, palette] of [
    ['skin', LOOK_OPTIONS.skin], ['hairColor', LOOK_OPTIONS.hairColor], ['outfitColor', LOOK_OPTIONS.outfitColor], ['bottomsColor', LOOK_OPTIONS.outfitColor],
  ] as const) {
    const value = raw[name];
    const numericSkin = name === 'skin' && typeof value === 'string' && /^skin[1-7]$/.test(value);
    if (typeof value !== 'string' || (!/^#[0-9a-f]{6}$/i.test(value) && !numericSkin && !palette.some((swatch) => swatch.id === value.toLowerCase()))) {
      throw new Error(`Unsupported authored ${name} color`);
    }
  }
  if (typeof raw.face !== 'string' || !LOOK_OPTIONS.face.includes(raw.face as typeof LOOK_OPTIONS.face[number])) {
    throw new Error(`Unsupported authored face ${String(raw.face)}`);
  }
  if (typeof raw.expression !== 'string' || !LOOK_OPTIONS.expression.includes(raw.expression as typeof LOOK_OPTIONS.expression[number])) {
    throw new Error(`Unsupported authored expression ${String(raw.expression)}`);
  }
  if (raw.appearance !== undefined) {
    if (!raw.appearance || typeof raw.appearance !== 'object' || Array.isArray(raw.appearance)) throw new Error('Unsupported authored appearance');
    const appearance = raw.appearance as Record<string, unknown>;
    if (appearance.height !== 'average' || appearance.build !== 'average' || appearance.ageAppearance !== 'adult') {
      throw new Error('Authored presentation supports adult, average height and build only');
    }
  }
  const normalizedInput: Record<string, unknown> = { ...raw };
  if (typeof raw.skin === 'string' && GAME_SKIN[raw.skin]) normalizedInput.skin = GAME_SKIN[raw.skin];
  const normalized = normalizeLook(normalizedInput, seed);
  assertLookSupported(normalized);
  return normalized;
}

function assertLookSupported(look: Look): void {
  if (look.body !== 'man' && look.body !== 'woman') throw new Error(`Unsupported authored body family ${String(look.body)}`);
  if (look.outfit !== 'casual' && look.outfit !== 'office') throw new Error(`Unsupported authored outfit ${look.outfit}`);
  if (look.fabric !== 'plain') throw new Error(`Unsupported authored fabric ${look.fabric}`);
  if (!HAIR_STYLE_ASSETS.has(look.hair)) throw new Error(`Unsupported authored hairstyle ${look.hair}`);
  if (look.accessories.length !== 0 || (look.wearables?.length ?? 0) !== 0) throw new Error('Authored presentation does not support accessories or wearables');
  const appearance = normalizeAvatarAppearance(look.appearance);
  if (appearance.height !== 'average' || appearance.build !== 'average' || appearance.ageAppearance !== 'adult') {
    throw new Error('Authored presentation supports adult, average height and build only');
  }
}

function appearanceScale(look: Look): NativeAppearanceScale {
  const value = avatarProportions(look.appearance);
  return { height: value.height, width: value.width, depth: value.depth };
}

function bodyMetricsFor(presentation: AuthoredPresentation): WardrobeMetrics {
  // WardrobeMetrics describes the clothing overlay. Shoes remain a separate authored accessory draw.
  return Object.freeze({
    triangles: presentation.metrics.outfitTriangles,
    hiddenTriangles: presentation.metrics.hiddenBodyTriangles,
    addedDrawCalls: presentation.metrics.outfitTriangles === 0 ? 0 : 1,
    bytes: presentation.metrics.bodyMaskIndexBytes + presentation.metrics.outfitGeometryBytes,
    itemTriangles: Object.freeze({ authoredOutfit: presentation.metrics.outfitTriangles }),
  });
}

function solverSupport(support: NativePoseSupport): NativeClipSupport {
  switch (support.kind) {
    case 'flat-feet': return { kind: 'flat-feet', floorY: support.floorY };
    case 'stair-feet': return { kind: 'stair-feet', leftFloorY: support.leftFloorY, rightFloorY: support.rightFloorY };
    case 'seat-anchor': return { kind: 'seat-anchor', hipWorld: support.hipWorld, floorY: support.floorY };
    case 'prop-rest': return { kind: 'body-contact-diagnostic', floorY: 0, diagnosticOnly: true };
    case 'diagnostic': return { kind: 'body-contact-diagnostic', floorY: support.floorY, diagnosticOnly: true };
  }
}

function isVerticalParent(root: THREE.Object3D): boolean {
  const parent = root.parent;
  if (!parent) return true;
  parent.updateWorldMatrix(true, false);
  const up = new THREE.Vector3(0, 1, 0).transformDirection(parent.matrixWorld);
  return up.y > 0.99999 && Math.abs(up.x) < 1e-5 && Math.abs(up.z) < 1e-5;
}

function parentFloorToWorld(root: THREE.Object3D, y: number): number {
  if (!isVerticalParent(root)) return NaN;
  const point = new THREE.Vector3(0, y, 0);
  if (root.parent) point.applyMatrix4(root.parent.matrixWorld);
  return point.y;
}

function worldFloorToParent(root: THREE.Object3D, y: number): number {
  if (!isVerticalParent(root)) return NaN;
  const point = new THREE.Vector3(0, y, 0);
  if (root.parent) point.applyMatrix4(root.parent.matrixWorld.clone().invert());
  return point.y;
}

/** Update the actor first, then dispatch matrixWorld through SkinnedMesh overrides. */
function updateActorWorld(actor: THREE.Group): void {
  actor.updateWorldMatrix(true, false);
  actor.updateMatrixWorld(true);
}

function worldSupport(root: THREE.Object3D, support: NativePoseSupport): NativeClipSupport {
  if (support.kind === 'seat-anchor' || support.kind === 'prop-rest' || support.kind === 'diagnostic') return solverSupport(support);
  if (support.kind === 'flat-feet') {
    return isVerticalParent(root) && Number.isFinite(support.floorY) ? solverSupport(support)
      : { kind: 'body-contact-diagnostic', floorY: 0, diagnosticOnly: true };
  }
  return isVerticalParent(root) && Number.isFinite(support.leftFloorY) && Number.isFinite(support.rightFloorY)
    ? solverSupport(support)
    : { kind: 'body-contact-diagnostic', floorY: 0, diagnosticOnly: true };
}

interface SoleGroup { readonly side: 'left' | 'right'; readonly vertices: readonly number[] }
interface ContactSolveDiagnostics {
  readonly limitedReasons: readonly Readonly<Record<string, number | string>>[];
  readonly unresolvedReasons: readonly string[];
  readonly pelvisPasses: readonly Readonly<{ requestedLowering: number; appliedLowering: number; cumulativeLowering: number }>[];
  readonly finalSolePoints: readonly Readonly<{ side: 'left' | 'right'; index: number; y: number; floorY: number; gap: number }>[];
  readonly finalLegReach: readonly Readonly<{ side: 'left' | 'right'; upperLength: number; lowerLength: number; actualAnkleReach: number; requestedAnkleReach: number; maximumReach: number; extensionRatio: number }>[];
}
interface DetailedFootSolveResult extends FootSolveResult { readonly diagnostics: ContactSolveDiagnostics }

/**
 * The legacy foot controller reads raw position and skin attributes, then applies skinning a second time.
 * This actor-local replacement caches a small footwear sole set once and samples each deformed vertex exactly
 * once through SkinnedMesh.getVertexPosition (morphs + skin), before converting to parent/scene coordinates.
 */
function createAuthoredFootContacts(actor: THREE.Group, shoes: THREE.SkinnedMesh) {
  const skeleton = shoes.skeleton;
  const definitions = [
    { side: 'left' as const, names: ['mixamorigLeftFoot', 'mixamorigLeftToeBase'] },
    { side: 'right' as const, names: ['mixamorigRightFoot', 'mixamorigRightToeBase'] },
  ];
  const skinIndex = shoes.geometry.getAttribute('skinIndex');
  const skinWeight = shoes.geometry.getAttribute('skinWeight');
  const position = shoes.geometry.getAttribute('position');
  if (!skinIndex || !skinWeight || !position || skinIndex.count !== position.count || skinWeight.count !== position.count) {
    throw new Error('Authored footwear is missing aligned position and skin attributes');
  }
  const groups: SoleGroup[] = definitions.map(({ side, names }) => {
    const joints = new Set<number>();
    skeleton.bones.forEach((bone, index) => { if (names.includes(bone.name)) joints.add(index); });
    if (joints.size !== names.length) throw new Error(`Authored footwear is missing ${side} foot joints`);
    const candidates: number[] = [];
    const point = new THREE.Vector3();
    let minY = Infinity;
    for (let vertex = 0; vertex < position.count; vertex++) {
      let footWeight = 0;
      for (let lane = 0; lane < 4; lane++) if (joints.has(Math.round(skinIndex.getComponent(vertex, lane)))) footWeight += skinWeight.getComponent(vertex, lane);
      if (footWeight < 0.55) continue;
      point.fromBufferAttribute(position, vertex);
      if (point.y < minY) minY = point.y;
      candidates.push(vertex);
    }
    if (!candidates.length || !Number.isFinite(minY)) throw new Error(`Authored footwear has no ${side} sole vertices`);
    const threshold = minY + 0.018;
    const vertices = candidates.filter((vertex) => position.getY(vertex) <= threshold);
    if (!vertices.length) throw new Error(`Authored footwear ${side} sole selection is empty`);
    return { side, vertices: Object.freeze(vertices) };
  });

  const local = new THREE.Vector3();
  const world = new THREE.Vector3();
  const parentPoint = new THREE.Vector3();
  const actorInverse = new THREE.Matrix4();
  const contacts: FootContact[] = [];
  let disposed = false;

  function sample(): readonly FootContact[] {
    if (disposed) throw new Error('Authored foot contacts are disposed');
    updateActorWorld(actor);
    const parent = actor.parent;
  const result: FootContact[] = [];
    for (const group of groups) {
      let lowest = Infinity;
      const values: FootPoint[] = [];
      for (const vertex of group.vertices) {
        shoes.getVertexPosition(vertex, local);
        world.copy(local).applyMatrix4(shoes.matrixWorld);
        if (parent) parentPoint.copy(world).applyMatrix4(parent.matrixWorld.clone().invert());
        else parentPoint.copy(world);
        values.push(Object.freeze({ side: group.side, x: parentPoint.x, y: parentPoint.y, z: parentPoint.z }));
        if (parentPoint.y < lowest) lowest = parentPoint.y;
      }
      const threshold = lowest + 0.0025;
      const supportPoints = values.filter((point) => point.y <= threshold);
      if (!supportPoints.length) continue;
      const average = supportPoints.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y, z: sum.z + point.z }), { x: 0, y: 0, z: 0 });
      result.push(Object.freeze({
        side: group.side,
        x: average.x / supportPoints.length,
        y: lowest,
        z: average.z / supportPoints.length,
        points: Object.freeze(values),
      }));
    }
    contacts.splice(0, contacts.length, ...result);
    return Object.freeze([...contacts]);
  }

  const legs = definitions.map(({ side }) => {
    const suffix = side === 'left' ? 'Left' : 'Right';
    const thigh = skeleton.bones.find((bone) => bone.name === `mixamorig${suffix}UpLeg`);
    const calf = skeleton.bones.find((bone) => bone.name === `mixamorig${suffix}Leg`);
    const foot = skeleton.bones.find((bone) => bone.name === `mixamorig${suffix}Foot`);
    if (!thigh || !calf || !foot) throw new Error(`Native foot solve lacks ${side} leg bones`);
    return { side, thigh, calf, foot };
  });
  const { bone: hips, parent: hipsParent } = (() => {
    const bone = skeleton.bones.find((candidate) => candidate.name === 'mixamorigHips');
    if (!bone?.parent) throw new Error('Authored foot solve lacks a movable pelvis bone');
    return { bone, parent: bone.parent };
  })();
  let baselineHipWorldY: number | null = null;
  function captureBaseline(): void {
    baselineHipWorldY = boneActorPoint(hips).y;
  }

  function pointInActor(x: number, y: number, z: number): THREE.Vector3 {
    const point = new THREE.Vector3(x, y, z);
    if (actor.parent) {
      actor.parent.updateWorldMatrix(true, false);
      point.applyMatrix4(actor.parent.matrixWorld);
    }
    updateActorWorld(actor);
    return point.applyMatrix4(actorInverse.copy(actor.matrixWorld).invert());
  }
  function boneActorPoint(bone: THREE.Bone): THREE.Vector3 {
    updateActorWorld(actor);
    bone.getWorldPosition(world);
    return world.clone().applyMatrix4(actorInverse.copy(actor.matrixWorld).invert());
  }
  function aim(bone: THREE.Bone, currentAxis: THREE.Vector3, targetAxis: THREE.Vector3): void {
    const rootWorldQ = actor.getWorldQuaternion(new THREE.Quaternion());
    const inverseRootQ = rootWorldQ.invert();
    const boneRootQ = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(inverseRootQ);
    const delta = new THREE.Quaternion().setFromUnitVectors(currentAxis.clone().normalize(), targetAxis.clone().normalize());
    const targetRootQ = delta.multiply(boneRootQ);
    const parent = bone.parent;
    const parentRootQ = parent ? parent.getWorldQuaternion(new THREE.Quaternion()).premultiply(inverseRootQ) : new THREE.Quaternion();
    bone.quaternion.copy(parentRootQ.invert().multiply(targetRootQ));
    updateActorWorld(actor);
  }
  function fitLeg(leg: typeof legs[number], targetAnkle: THREE.Vector3): boolean {
    updateActorWorld(actor);
    const hip = boneActorPoint(leg.thigh), knee = boneActorPoint(leg.calf), ankle = boneActorPoint(leg.foot);
    const upper = hip.distanceTo(knee), lower = knee.distanceTo(ankle);
    const targetVector = targetAnkle.clone().sub(hip), requested = targetVector.length();
    if (upper < 0.015 || lower < 0.015 || requested < 1e-5) return true;
    const reach = THREE.MathUtils.clamp(requested, Math.abs(upper - lower) + 0.002, upper + lower - 0.0005);
    const direction = targetVector.normalize();
    const pole = knee.clone().sub(hip).addScaledVector(direction, -knee.clone().sub(hip).dot(direction));
    if (pole.lengthSq() < 1e-8) pole.set(leg.side === 'left' ? -1 : 1, 0, 0).addScaledVector(direction, -direction.x * (leg.side === 'left' ? -1 : 1));
    pole.normalize();
    const cosine = THREE.MathUtils.clamp((upper * upper + reach * reach - lower * lower) / (2 * upper * reach), -1, 1);
    const wantedKnee = hip.clone().addScaledVector(direction, upper * cosine).addScaledVector(pole, upper * Math.sqrt(Math.max(0, 1 - cosine * cosine)));
    // IK rotates the thigh and calf parents. Preserve the foot's world-space
    // orientation so its authored sole plane does not tilt with those rotations.
    const beforeFootWorld = leg.foot.getWorldQuaternion(new THREE.Quaternion());
    aim(leg.thigh, knee.clone().sub(hip), wantedKnee.clone().sub(hip));
    const actualKnee = boneActorPoint(leg.calf), actualAnkle = boneActorPoint(leg.foot);
    aim(leg.calf, actualAnkle.clone().sub(actualKnee), targetAnkle.clone().sub(actualKnee));
    const footParentWorld = leg.foot.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
    leg.foot.quaternion.copy(footParentWorld.invert().multiply(beforeFootWorld));
    updateActorWorld(actor);
    return Math.abs(reach - requested) > 0.001;
  }

  function wouldExceedLegReach(contact: FootContact, targetY: number, leg: typeof legs[number]): boolean {
    const sole = pointInActor(contact.x, contact.y, contact.z);
    const correctedSole = pointInActor(contact.x, targetY, contact.z);
    const targetAnkle = boneActorPoint(leg.foot).add(correctedSole.sub(sole));
    const hip = boneActorPoint(leg.thigh), knee = boneActorPoint(leg.calf), ankle = boneActorPoint(leg.foot);
    const maximumReach = hip.distanceTo(knee) + knee.distanceTo(ankle);
    return targetAnkle.distanceTo(hip) > maximumReach + 0.001;
  }

  function shiftPelvisParentY(deltaY: number): void {
    if (!isVerticalParent(actor)) throw new Error('Grounded pelvis correction requires a vertical actor parent');
    updateActorWorld(actor);
    const parent = actor.parent;
    let worldDeltaY = deltaY;
    if (parent) {
      parent.updateWorldMatrix(true, false);
      const origin = new THREE.Vector3(0, 0, 0).applyMatrix4(parent.matrixWorld);
      const offset = new THREE.Vector3(0, deltaY, 0).applyMatrix4(parent.matrixWorld).sub(origin);
      worldDeltaY = offset.y;
    }
    const worldHip = hips.getWorldPosition(new THREE.Vector3());
    worldHip.y += worldDeltaY;
    hipsParent.worldToLocal(worldHip);
    hips.position.copy(worldHip);
    updateActorWorld(actor);
  }

  function solve(heightAt: (contact: FootContact) => number, mode: 'motion' | 'grounded' | 'transition' = 'motion'): DetailedFootSolveResult {
    if (disposed) throw new Error('Authored foot contacts are disposed');
    let limited = false;
    const limitedReasons: Array<Readonly<Record<string, number | string>>> = [];
    const pelvisPasses: Array<{ requestedLowering: number; appliedLowering: number; cumulativeLowering: number }> = [];
    const desiredSoleY = new Map<'left' | 'right', number>();
    const correctedSides = new Set<'left' | 'right'>();
    updateActorWorld(actor);
    let pelvisCorrection = baselineHipWorldY === null ? 0
      : Math.max(0, baselineHipWorldY - hips.getWorldPosition(new THREE.Vector3()).y);
    let after = sample();
    // Entry/exit and stair frames intentionally lift one foot. Choose the sole with
    // the closest actual sample to its measured support as the planted side; keep
    // the swing side animated. The sole center can be far from its lowest toe/heel
    // sample on a stair edge, so it is not a reliable phase-grounding measurement.
    const transitionSide = mode === 'transition'
      ? after.map((contact) => {
        let distance = Infinity;
        for (const point of contact.points ?? [contact]) {
          const supportY = heightAt(point);
          if (Number.isFinite(supportY)) distance = Math.min(distance, Math.abs(point.y - supportY));
        }
        return { side: contact.side, distance };
      }).sort((a, b) => a.distance - b.distance || a.side.localeCompare(b.side))[0]?.side
      : undefined;
    function supportTargetY(contact: FootContact): number {
      // Translate the current sole by its worst signed surface gap. The highest
      // tread alone is not the target for a tilted sole whose vertices differ in Y.
      let correction = -Infinity;
      for (const point of contact.points ?? [contact]) correction = Math.max(correction, heightAt(point) - point.y);
      return contact.y + correction;
    }
    function alreadySupported(contact: FootContact): boolean {
      let minimumGap = Infinity;
      for (const point of contact.points ?? [contact]) {
        const gap = point.y - heightAt(point);
        if (!Number.isFinite(gap) || gap < 0) return false;
        minimumGap = Math.min(minimumGap, gap);
      }
      if (minimumGap > 0.004) return false;
      const targetY = supportTargetY(contact);
      if (!Number.isFinite(targetY)) return false;
      const sole = pointInActor(contact.x, contact.y, contact.z);
      const targetSole = pointInActor(contact.x, targetY, contact.z);
      const leg = legs.find((candidate) => candidate.side === contact.side)!;
      const targetAnkle = boneActorPoint(leg.foot).add(targetSole.sub(sole));
      const hip = boneActorPoint(leg.thigh), knee = boneActorPoint(leg.calf), ankle = boneActorPoint(leg.foot);
      const maximumReach = hip.distanceTo(knee) + knee.distanceTo(ankle);
      // A visually grounded sole still needs the bounded pelvis correction when
      // its requested support ankle would exceed the measured leg length.
      return hip.distanceTo(targetAnkle) <= maximumReach + 0.002;
    }
    // Weighted toe/sole vertices do not move as a perfectly rigid ankle point.
    // Re-sample and apply the remaining error a few times, while preserving the
    // actual ankle-to-sole offset on every pass.
    for (let pass = 0; pass < 4; pass++) {
      let passError = 0;
      if ((mode === 'grounded' || mode === 'transition') && isVerticalParent(actor)) {
        let requiredLowering = 0;
        for (const contact of after) {
          if (mode === 'transition' && contact.side !== transitionSide) continue;
          // Preserve a planted sole already above support and inside the accepted
          // 4 mm band; no pelvis correction is needed, and all samples are clear.
          if (alreadySupported(contact)) continue;
          const targetY = supportTargetY(contact);
          if (!Number.isFinite(targetY) || targetY >= contact.y - 0.0002) continue;
          const leg = legs.find((candidate) => candidate.side === contact.side)!;
          if (wouldExceedLegReach(contact, targetY, leg)) {
            const sole = pointInActor(contact.x, contact.y, contact.z);
            const correctedSole = pointInActor(contact.x, targetY, contact.z);
            const targetAnkle = boneActorPoint(leg.foot).add(correctedSole.sub(sole));
            const hip = boneActorPoint(leg.thigh), knee = boneActorPoint(leg.calf), ankle = boneActorPoint(leg.foot);
            const reachExcess = targetAnkle.distanceTo(hip) - hip.distanceTo(knee) - knee.distanceTo(ankle) + 0.001;
            requiredLowering = Math.max(requiredLowering, Math.min(contact.y - targetY, Math.max(0.001, reachExcess)));
          }
        }
        if (requiredLowering > 0.0002) {
          const remaining = Math.max(0, 0.08 - pelvisCorrection);
          const lowering = Math.min(requiredLowering, remaining);
          if (lowering > 0.0002) {
            // The source frame's ankles are beyond leg extension. Lower only the pelvis bone,
            // preserving actor placement and limb segment lengths, then resample before IK.
            shiftPelvisParentY(-lowering);
            pelvisCorrection += lowering;
            after = sample();
            if (lowering + 0.001 < requiredLowering) {
              limited = true;
              limitedReasons.push(Object.freeze({ code: 'pelvis-lowering-cap', requestedLowering: requiredLowering, appliedLowering: lowering, remainingBudget: remaining }));
            }
            pelvisPasses.push(Object.freeze({ requestedLowering: requiredLowering, appliedLowering: lowering, cumulativeLowering: pelvisCorrection }));
            continue;
          }
          limited = true;
          limitedReasons.push(Object.freeze({ code: 'pelvis-lowering-budget-exhausted', requestedLowering: requiredLowering, cumulativeLowering: pelvisCorrection }));
        }
      }
      for (const contact of after) {
        const planted = mode !== 'transition' || contact.side === transitionSide;
        const points = contact.points ?? [contact];
        if (planted && alreadySupported(contact)) {
          desiredSoleY.set(contact.side, contact.y);
          continue;
        }
        let targetY = mode === 'grounded' || mode === 'transition' && planted ? -Infinity : contact.y;
        if (planted) {
          const supportY = supportTargetY(contact);
          targetY = mode === 'motion' ? Math.max(targetY, supportY) : supportY;
        } else if (mode === 'transition') {
          // Preserve the animated swing height unless any sampled part of that sole
          // penetrates the measured floor. In that case lift it only enough to clear
          // the lowest sample; never push the swing foot down to plant it.
          let minimumGap = Infinity;
          for (const point of points) minimumGap = Math.min(minimumGap, point.y - heightAt(point));
          if (!Number.isFinite(minimumGap)) {
            limited = true;
            limitedReasons.push(Object.freeze({ code: 'missing-or-nonfinite-transition-sole-sample', side: contact.side, minimumGap }));
            continue;
          }
          if (minimumGap < 0) targetY += -minimumGap;
        }
        if (!Number.isFinite(targetY)) {
          limited = true;
          limitedReasons.push(Object.freeze({ code: 'missing-or-nonfinite-support-height', side: contact.side, value: targetY }));
          continue;
        }
        const amount = targetY - contact.y;
        if (mode === 'motion' && amount < -0.024) continue; // Preserve a deliberate swing foot.
        desiredSoleY.set(contact.side, targetY);
        passError = Math.max(passError, Math.abs(amount));
        if (Math.abs(amount) <= 0.0002) continue;
        const minimumCorrection = mode === 'motion' || mode === 'transition' && !planted ? 0 : -0.12;
        const bounded = THREE.MathUtils.clamp(amount, minimumCorrection, 0.12);
        if (Math.abs(amount - bounded) > 0.001) {
          limited = true;
          limitedReasons.push(Object.freeze({ code: 'per-pass-foot-correction-cap', side: contact.side, requested: amount, applied: bounded }));
        }
        // IK targets the ankle, not the sole. Preserve the current ankle-to-sole
        // vector and translate it by the support delta in actor space.
        const sole = pointInActor(contact.x, contact.y, contact.z);
        const correctedSole = pointInActor(contact.x, contact.y + bounded, contact.z);
        const leg = legs.find((candidate) => candidate.side === contact.side)!;
        const targetAnkle = boneActorPoint(leg.foot).add(correctedSole.sub(sole));
        fitLeg(leg, targetAnkle);
        correctedSides.add(contact.side);
      }
      after = sample();
      if (passError <= 0.002) break;
    }
    let maxError = 0;
    for (const contact of after) {
      const targetY = desiredSoleY.get(contact.side);
      if (targetY === undefined) continue;
      maxError = Math.max(maxError, Math.abs(contact.y - targetY));
    }
    if (maxError > 0.004) {
      limited = true;
      limitedReasons.push(Object.freeze({ code: 'final-sole-target-error', maximum: maxError, threshold: 0.004 }));
    }
    const finalContacts = sample();
    const finalSolePoints: ContactSolveDiagnostics['finalSolePoints'][number][] = [];
    const finalLegReach: ContactSolveDiagnostics['finalLegReach'][number][] = [];
    for (const contact of finalContacts) {
      const targetY = supportTargetY(contact);
      const points = contact.points ?? [contact];
      points.forEach((point, index) => {
        const floorY = heightAt(point);
        finalSolePoints.push(Object.freeze({ side: contact.side, index, y: point.y, floorY, gap: point.y - floorY }));
      });
      const leg = legs.find((candidate) => candidate.side === contact.side)!;
      const hip = boneActorPoint(leg.thigh), knee = boneActorPoint(leg.calf), ankle = boneActorPoint(leg.foot);
      const upperLength = hip.distanceTo(knee), lowerLength = knee.distanceTo(ankle);
      const currentSole = pointInActor(contact.x, contact.y, contact.z);
      const targetSole = pointInActor(contact.x, targetY, contact.z);
      const requestedAnkle = ankle.clone().add(targetSole.sub(currentSole));
      const requestedAnkleReach = hip.distanceTo(requestedAnkle);
      const actualAnkleReach = hip.distanceTo(ankle);
      const maximumReach = upperLength + lowerLength;
      finalLegReach.push(Object.freeze({ side: contact.side, upperLength, lowerLength, actualAnkleReach,
        requestedAnkleReach, maximumReach, extensionRatio: requestedAnkleReach / maximumReach }));
    }
    const capCodes = new Set(['per-pass-foot-correction-cap', 'pelvis-lowering-cap', 'pelvis-lowering-budget-exhausted']);
    const historicalCapsOnly = limitedReasons.length > 0 && limitedReasons.every((reason) => capCodes.has(String(reason.code)));
    const unresolvedReasons: string[] = [];
    if (limitedReasons.some((reason) => !capCodes.has(String(reason.code)))) unresolvedReasons.push('non-cap-limitation');
    if (!Number.isFinite(maxError) || maxError > 0.004) unresolvedReasons.push('final-target-residual');
    if (!finalSolePoints.length || finalSolePoints.some((point) => !Number.isFinite(point.gap) || point.gap < -0.004)) {
      unresolvedReasons.push('missing-or-penetrating-final-sole');
    }
    const groundedSides = new Set(finalSolePoints.filter((point) => Math.abs(point.gap) <= 0.004).map((point) => point.side));
    if (mode === 'grounded' && (!groundedSides.has('left') || !groundedSides.has('right'))) unresolvedReasons.push('grounded-side-missing');
    if (mode === 'transition' && !groundedSides.size) unresolvedReasons.push('transition-planted-side-missing');
    if (finalLegReach.some((leg) => ![leg.actualAnkleReach, leg.requestedAnkleReach, leg.maximumReach].every(Number.isFinite)
      || (groundedSides.has(leg.side) && (leg.actualAnkleReach > leg.maximumReach + 0.002 || leg.requestedAnkleReach > leg.maximumReach + 0.002)))) {
      unresolvedReasons.push('final-leg-reach');
    }
    const finalLimited = unresolvedReasons.length > 0 || limited && !historicalCapsOnly;
    const diagnostics = Object.freeze({ limitedReasons: Object.freeze(limitedReasons), pelvisPasses: Object.freeze(pelvisPasses),
      unresolvedReasons: Object.freeze(unresolvedReasons), finalSolePoints: Object.freeze(finalSolePoints), finalLegReach: Object.freeze(finalLegReach) });
    return Object.freeze({ corrected: correctedSides.size, maxError, limited: finalLimited, diagnostics });
  }

  return { sample, solve, captureBaseline, dispose() { disposed = true; contacts.length = 0; } };
}

function createPosePort(root: THREE.Group, sampler: NativeSourceLandmarkSampler, solver: NativeClipSolver, directionRetargeter: NativeDirectionRetargeter | undefined, neutralPose: NativeNeutralPose, contacts: ReturnType<typeof createAuthoredFootContacts>, seatSurface: ReturnType<typeof createNativeSeatSurfaceProbe> | undefined, restAdapter: ReturnType<typeof createNativeRestPoseAdapter> | undefined, stairContactHeightAt: NativePreparedFactoryOptions['stairContactHeightAt'], hands: ReturnType<typeof createNativeHandPoseController>, wrists: ReturnType<typeof createNativeWristOrientationController>, headOrientation: ReturnType<typeof createNativeHeadOrientationController>, resolveClip: (name: string) => string, onDirectionContactSolve: (result: FootSolveResult) => void) {
  const bones = new Map<string, THREE.Bone>();
  root.traverse((node) => { const bone = node as THREE.Bone; if (bone.isBone) bones.set(bone.name, bone); });
  // Grounded IK may translate the pelvis when the source legs are already at
  // full extension. Include it in the checkpoint so repeated host solves
  // always start from the same sampled pose instead of accumulating drift.
  const contactBones = ['mixamorigHips', 'mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigRightUpLeg', 'mixamorigRightLeg']
    .map((name) => bones.get(name))
    .filter((bone): bone is THREE.Bone => Boolean(bone));
  if (contactBones.length !== 5) throw new Error('Native authored contact checkpoint lacks hips/thigh/calf bones');
  const contactBaseline = contactBones.map((bone) => ({ bone, position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3() }));
  let contactBaselineReady = false;
  let blend: { clip: string; fade: number; from: Map<THREE.Bone, { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }> } | null = null;
  function captureContactBaseline(): void {
    for (const saved of contactBaseline) {
      saved.position.copy(saved.bone.position);
      saved.quaternion.copy(saved.bone.quaternion);
      saved.scale.copy(saved.bone.scale);
    }
    contacts.captureBaseline();
    contactBaselineReady = true;
  }
  function restoreContactBaseline(): boolean {
    if (!contactBaselineReady) return false;
    for (const saved of contactBaseline) {
      saved.bone.position.copy(saved.position);
      saved.bone.quaternion.copy(saved.quaternion);
      saved.bone.scale.copy(saved.scale);
    }
    updateActorWorld(root);
    return true;
  }
  function solvePropFeet(surface: NativePropRestSupport['surface'], transitionFloorY?: number): FootSolveResult {
    const worldAt = (contact: FootContact) => {
      const worldPoint = new THREE.Vector3(contact.x, contact.y, contact.z);
      if (root.parent) {
        root.parent.updateWorldMatrix(true, false);
        worldPoint.applyMatrix4(root.parent.matrixWorld);
      }
      return worldPoint;
    };
    const heightAt = (contact: FootContact): number => {
      if (Number.isFinite(transitionFloorY)) return worldFloorToParent(root, transitionFloorY!);
      updateActorWorld(root);
      const worldPoint = worldAt(contact);
      const worldY = surface.surfaceYAt(worldPoint.x, worldPoint.z);
      if (worldY === null || !Number.isFinite(worldY)) throw new Error(`Native ${surface.pose} host surface is missing beneath ${contact.side} foot`);
      const parentY = worldFloorToParent(root, worldY);
      if (!Number.isFinite(parentY)) throw new Error(`Native ${surface.pose} host surface cannot be transformed to actor-parent space`);
      return parentY;
    };
    let result = contacts.solve(heightAt, 'grounded');
    for (let pass = 0; pass < 3 && result.limited && result.maxError > 0.002; pass++) result = contacts.solve(heightAt, 'grounded');
    const measuredBySide: Record<'left' | 'right', { min: number; count: number }> = {
      left: { min: Infinity, count: 0 }, right: { min: Infinity, count: 0 },
    };
    let worstPenetration = 0;
    for (const contact of contacts.sample()) for (const point of contact.points ?? [contact]) {
      const ground = heightAt(point);
      const gap = point.y - ground;
      const side = measuredBySide[point.side];
      side.count++;
      side.min = Math.min(side.min, gap);
      worstPenetration = Math.min(worstPenetration, gap);
    }
    const finalContactError = Math.max(
      Math.abs(measuredBySide.left.min), Math.abs(measuredBySide.right.min),
    );
    const capOnly = result.diagnostics.limitedReasons.length > 0 && result.diagnostics.limitedReasons.every((reason) =>
      reason.code === 'per-pass-foot-correction-cap' || reason.code === 'pelvis-lowering-cap' || reason.code === 'pelvis-lowering-budget-exhausted');
    const measuredConverged = measuredBySide.left.count > 0 && measuredBySide.right.count > 0
      && finalContactError <= 0.004 && worstPenetration >= -0.004;
    if (result.diagnostics.unresolvedReasons.length > 0 || (!capOnly && result.limited) || !measuredConverged || result.maxError > 0.004) {
      updateActorWorld(root);
      const finalContacts = contacts.sample().flatMap((contact) => contact.points ?? [contact]).map((contact) => {
        const world = worldAt(contact);
        const supportY = surface.surfaceYAt(world.x, world.z);
        return { side: contact.side, parentPoint: [contact.x, contact.y, contact.z], worldPoint: world.toArray(), supportY,
          gap: supportY === null ? null : world.y - supportY };
      });
      const bones = Object.fromEntries(['mixamorigHips', 'mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigLeftFoot',
        'mixamorigRightUpLeg', 'mixamorigRightLeg', 'mixamorigRightFoot'].map((name) => {
        const bone = root.getObjectByName(name);
        return [name, bone ? { local: bone.position.toArray(), world: bone.getWorldPosition(new THREE.Vector3()).toArray() } : null];
      }));
      throw new Error(`Native ${surface.pose} foot support failed (${result.maxError} m, limited=${result.limited}); diagnostics=${JSON.stringify({ result, contacts: finalContacts, bones, actorRoot: root.getWorldPosition(new THREE.Vector3()).toArray() })}`);
    }
    return result;
  }
  return {
    apply(frame: NativeWristSourceFrame, context: Readonly<{ clip: string; seconds: number; pose: BodyPose; support: NativePoseSupport; contactPhase: 'still' | 'transition'; restAnchorBlend: number }>): boolean | Readonly<{ accepted: true; rootWorldCorrection?: number; rootWorldCorrectionXZ?: readonly [number, number] }> {
      delete root.userData.nativeRestContact;
      if (frame.clipName !== resolveClip(context.clip)) return false;
      let rootWorldCorrection = 0;
      let rootWorldCorrectionXZ: readonly [number, number] | undefined;
      const restSupport = context.support.kind === 'prop-rest' ? context.support : null;
      const requestedRest = context.pose === 'lie' || context.pose === 'soak' || context.pose === 'wash';
      if (requestedRest && (!restSupport || restSupport.surface.pose !== context.pose)) {
        throw new Error(`Native ${context.pose} requires an actual matching prop-rest support`);
      }
      if (restSupport && !restAdapter) throw new Error(`Native ${restSupport.surface.pose} has no constructed visible body/wardrobe contact probe`);
      let restPrepared = false;
      let restApplied = false;
      if (restSupport) {
        const mapped = solver.applyFrame(frame, solverSupport(restSupport));
        if (mapped.supportStatus !== 'body-contact-diagnostic-only') {
          throw new Error(`Native ${restSupport.surface.pose} source frame was not applied in diagnostic mapping mode`);
        }
        restPrepared = true;
      }
      if (!restSupport && (context.pose === 'lie' || context.pose === 'soak' || context.pose === 'wash')) {
        throw new Error(`Native ${context.pose} remains unsupported without its real prop surface`);
      }
      if (!restPrepared && context.support.kind === 'stair-feet') {
        if (!stairContactHeightAt) throw new Error('Native stairs require an actual host stair-surface query');
        const seed = solver.applyFrame(frame, worldSupport(root, context.support));
        if (seed.supportStatus !== 'feet-supported') throw new Error(`Native stair source frame is unsupported (${seed.supportStatus})`);
      }
      if (!restPrepared && directionRetargeter && context.support.kind === 'flat-feet') {
        const mappedSupport = worldSupport(root, context.support);
        if (mappedSupport.kind !== 'flat-feet') throw new Error(`Native direction retargeting rejected transformed floor support for ${context.pose}`);
        // Captured after family rest correction and before any pose. This keeps native bone
        // translations/lengths; actual shoe contacts, not the retargeter's body-sole estimate,
        // own the host floor correction below.
        if (context.pose === 'idle' && context.clip === 'idle') {
          neutralPose.apply();
          // Translate the complete native rig to its actual authored shoe sole. This
          // preserves limb lengths; the ordinary strict contact/reach solver still runs.
          updateActorWorld(root);
          const floorParentY = worldFloorToParent(root, context.support.floorY);
          const points = contacts.sample().flatMap((contact) => contact.points ?? [contact]);
          const soleParentY = Math.min(...points.map((point) => point.y));
          const hips = bones.get('mixamorigHips');
          if (!hips?.parent || !Number.isFinite(soleParentY)) throw new Error('Native standing pose has no measured shoe support');
          const parentOrigin = new THREE.Vector3();
          const parentOffset = new THREE.Vector3(0, floorParentY - soleParentY, 0);
          if (root.parent) {
            parentOrigin.applyMatrix4(root.parent.matrixWorld);
            parentOffset.applyMatrix4(root.parent.matrixWorld).sub(parentOrigin);
          }
          const hipWorld = hips.getWorldPosition(new THREE.Vector3()).add(parentOffset);
          hips.position.copy(hips.parent.worldToLocal(hipWorld));
          updateActorWorld(root);
        } else directionRetargeter.apply(frame, mappedSupport.floorY);
      } else if (!restPrepared && context.support.kind === 'seat-anchor') {
        if (!seatSurface) throw new Error('Native sit requires a cached visible posterior body-and-clothing surface');
        if (context.pose === 'sit' && context.clip === 'sit') {
          solveNativeSeatPose({
            frame,
            seatTopWorld: [context.support.hipWorld[0], context.support.seatTopY, context.support.hipWorld[2]],
            floorY: context.support.floorY,
            solver,
            surface: seatSurface,
          });
        } else {
          // Keep the source transition's own early pose/root trajectory. Pull the hip
          // toward the measured host seat only as the authored clip progresses; anchoring
          // every entry/exit frame at the final sitting hip makes the feet unreachable.
          const sourceMapped = solver.applyFrame(frame, { kind: 'body-contact-diagnostic', floorY: context.support.floorY, diagnosticOnly: true });
          if (sourceMapped.supportStatus !== 'body-contact-diagnostic-only') {
            throw new Error(`Native seated transition source frame was not mapped (${sourceMapped.supportStatus})`);
          }
          updateActorWorld(root);
          const sourceHipWorld = bones.get('mixamorigHips')!.getWorldPosition(new THREE.Vector3());
          const phase = THREE.MathUtils.clamp(context.seconds / frame.duration, 0, 1);
          const seatBlend = phase * phase * (3 - 2 * phase);
          const seatHipWorld = sourceHipWorld.lerp(new THREE.Vector3(...context.support.hipWorld), seatBlend);
          const applied = solver.applyFrame(frame, { kind: 'seat-anchor', hipWorld: seatHipWorld.toArray() as [number, number, number], floorY: context.support.floorY });
          if (applied.supportStatus !== 'seat-anchored-contact-unverified') {
            throw new Error(`Native seated transition lacks its measured seat anchor (${applied.supportStatus}; feet=${applied.seatFeetStatus ?? 'missing'})`);
          }
          // The seat plane is a one-sided bound during entry/exit: the body may remain
          // above the seat until the clip reaches its seated endpoint, but may never pass
          // through the measured seat surface.
        }
      } else if (!restPrepared && context.support.kind !== 'stair-feet' && context.support.kind !== 'flat-feet'
        && context.support.kind !== 'prop-rest') {
        if (directionRetargeter) throw new Error(`Native direction retargeting does not support ${context.support.kind}`);
        const applied = solver.applyFrame(frame, worldSupport(root, context.support));
        if (applied.supportStatus !== 'feet-supported') {
          throw new Error(`Native ${context.pose} pose is not contact-supported (${applied.supportStatus}; clip ${frame.clipName})`);
        }
      } else if (!restPrepared && !directionRetargeter && context.support.kind === 'flat-feet') {
        const applied = solver.applyFrame(frame, worldSupport(root, context.support));
        if (applied.supportStatus !== 'feet-supported') throw new Error(`Native ${context.pose} pose is not contact-supported (${applied.supportStatus})`);
      }
      // Normal direction motion uses the measured source head quaternion. Furniture
      // and stairs keep their existing pose/contact witnesses unchanged.
      if (directionRetargeter && context.support.kind === 'flat-feet') headOrientation.apply(frame);
      const support = context.support;
      let heightAt = support.kind === 'flat-feet'
        ? () => worldFloorToParent(root, support.floorY)
        : support.kind === 'stair-feet'
          ? (contact: FootContact) => worldFloorToParent(root, contact.side === 'left' ? support.leftFloorY : support.rightFloorY)
          : support.kind === 'seat-anchor' ? () => worldFloorToParent(root, support.floorY) : null;
      const solveAuthoredContacts = () => {
        if (!heightAt) return null;
        const seatTransition = context.contactPhase === 'transition' && support.kind === 'seat-anchor';
        const stairStride = support.kind === 'stair-feet' && ['walk', 'jog'].includes(context.pose);
        const mode = seatTransition || stairStride ? 'transition'
          : context.pose === 'walk' || context.pose === 'jog' || context.pose === 'dance' ? 'motion' : 'grounded';
        let result = contacts.solve(heightAt, mode);
        for (let pass = 0; pass < 2 && result.limited && result.maxError > 0.002; pass++) result = contacts.solve(heightAt, mode);
        const finalPoints = contacts.sample().flatMap((contact) => (contact.points ?? [contact]).map((point) => ({ side: contact.side, point })));
        const gaps = finalPoints.map(({ side, point }) => ({ side, gap: point.y - heightAt!(point) }));
        if (gaps.some(({ gap }) => !Number.isFinite(gap) || gap < -0.004)) {
          throw new Error(`Native ${context.pose} sole penetrates its measured support; gaps=${JSON.stringify(gaps)}`);
        }
        const supportedSides = new Set(gaps.filter(({ gap }) => Math.abs(gap) <= 0.004).map(({ side }) => side));
        if (seatTransition && seatSurface && support.kind === 'seat-anchor') {
          const posterior = seatSurface.sample();
          const seatGap = posterior.minY - support.seatTopY;
          if (!Number.isFinite(seatGap) || seatGap < -0.004) {
            throw new Error(`Native sit transition penetrates its measured seat (${seatGap} m; phase=${context.seconds / frame.duration})`);
          }
        }
        const needsBoth = mode === 'grounded' && !seatTransition;
        if ((needsBoth && (!supportedSides.has('left') || !supportedSides.has('right')))
          || (seatTransition && supportedSides.size === 0)
          || (support.kind === 'stair-feet' && supportedSides.size === 0)) {
          throw new Error(`Native ${context.pose} has insufficient phase grounding; supported=${[...supportedSides]}; gaps=${JSON.stringify(gaps)}`);
        }
        const supportedReach = result.diagnostics.finalLegReach.filter((leg) => supportedSides.has(leg.side));
        if (supportedReach.some((leg) => leg.requestedAnkleReach > leg.maximumReach + 0.002
          || leg.actualAnkleReach > leg.maximumReach + 0.002)) {
          throw new Error(`Native ${context.pose} planted foot exceeds measured leg reach; reach=${JSON.stringify(supportedReach)}`);
        }
        const capOnly = result.diagnostics.limitedReasons.length > 0 && result.diagnostics.limitedReasons.every((reason) =>
          reason.code === 'per-pass-foot-correction-cap' || reason.code === 'pelvis-lowering-cap' || reason.code === 'pelvis-lowering-budget-exhausted');
        if (result.maxError > 0.004 || (result.limited && !capOnly)) {
          throw new Error(`Native ${context.pose} shoe contact failed (${result.maxError} m, limited=${result.limited}, capOnly=${capOnly}); diagnostics=${JSON.stringify(result.diagnostics)}`);
        }
        if (support.kind === 'stair-feet') {
          if (!gaps.length) throw new Error('Native stair pose has no actual shoe samples');
        }
        if (directionRetargeter) onDirectionContactSolve(result);
        return result;
      };
      const crossfading = Boolean(blend && blend.clip === context.clip);
      if (crossfading && blend) {
        const amount = THREE.MathUtils.smoothstep(context.seconds, 0, blend.fade);
        for (const [bone, source] of blend.from) {
          bone.position.lerpVectors(source.p, bone.position.clone(), amount);
          bone.quaternion.slerpQuaternions(source.q, bone.quaternion.clone(), amount);
          bone.scale.lerpVectors(source.s, bone.scale.clone(), amount);
        }
        updateActorWorld(root);
      }
      if (restPrepared && restSupport) {
        // A new mapped/crossfaded source frame starts a new pelvis correction budget.
        // A previous idle or rest frame is not this frame's native baseline.
        contacts.captureBaseline();
        const unregister = restAdapter!.register(restSupport);
        try {
          // The exact frame has already been mapped and crossfaded above; the adapter now
          // measures/corrects that final current pose without resampling it.
          const restResult = restAdapter!.apply(restSupport.surface.pose, restSupport, () => {}, () => contacts.sample(),
            (surface, floorY) => solvePropFeet(surface, floorY), context.contactPhase, context.restAnchorBlend);
          root.userData.nativeRestContact = Object.freeze({ pose: restResult.pose, propId: restResult.propId,
            phase: restResult.phase, transitionValidated: restResult.transitionValidated, measurement: restResult.measurement });
          rootWorldCorrection = restResult.rootWorldCorrection;
          rootWorldCorrectionXZ = restResult.rootWorldCorrectionXZ;
          restApplied = true;
        } finally { unregister(); }
      }
      if (support.kind === 'stair-feet') {
        if (!stairContactHeightAt) throw new Error('Native stairs require an actual host stair-surface query');
        // Query every actual sole point after source pose and transition crossfade. Reapplying the
        // source frame here would erase the crossfade before terrain correction.
        const sampled = contacts.sample();
        for (const side of ['left', 'right'] as const) {
          const points = sampled.flatMap((contact) => contact.side === side ? (contact.points ?? [contact]) : []);
          if (!points.length) throw new Error(`Native stair contact has no ${side} shoe samples`);
          const heights = points.map((contact) => stairContactHeightAt(contact, root));
          const valid = heights.filter((value): value is number => value !== null && Number.isFinite(value));
          if (!valid.length) throw new Error(`Native stair surface is unavailable beneath the ${side} shoe`);
          if (valid.length !== points.length) throw new Error(`Native stair surface is incomplete beneath the ${side} shoe`);
        }
        heightAt = (contact: FootContact) => {
          const y = stairContactHeightAt(contact, root);
          if (y === null || !Number.isFinite(y)) throw new Error(`Native stair surface disappeared under ${contact.side} foot`);
          return y;
        };
      }
      // Keep an immutable pre-contact leg pose for host calls to solveFeet().
      // Each solve must start from the sampled/crossfaded animation pose, not
      // from a prior IK result, so repeated host solving is deterministic.
      captureContactBaseline();
      if (!restApplied) solveAuthoredContacts();
      if (!(directionRetargeter && context.pose === 'idle' && context.clip === 'idle' && support.kind === 'flat-feet')) wrists.apply(frame);
      hands.apply(context.pose === 'walk' || context.pose === 'jog' ? 'walk' : ['cook','cookLow','eat','drink'].includes(context.pose) ? 'grip' : 'relaxed', context.seconds);
      return Object.freeze({ accepted: true as const, rootWorldCorrection,
        ...(rootWorldCorrectionXZ ? { rootWorldCorrectionXZ } : {}) });
    },
    beginTransition(clip: string, _from: NativePlacement, crossfadeSeconds: number): void {
      const from = new Map<THREE.Bone, { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }>();
      for (const bone of bones.values()) from.set(bone, { p: bone.position.clone(), q: bone.quaternion.clone(), s: bone.scale.clone() });
      blend = { clip, fade: Math.max(0.001, crossfadeSeconds), from };
    },
    endTransition(): void { blend = null; },
    restoreContactBaseline,
    restore(): void { directionRetargeter?.restore(); solver.restore(); neutralPose.restore(); headOrientation.restore(); blend = null; },
  };
}

function mapWardrobe(presentation: AuthoredPresentation): WardrobeMetrics {
  return bodyMetricsFor(presentation);
}

/**
 * Prepare a real authored actor behind the existing scene SkinnedBody contract. This factory intentionally admits
 * only the authored adult/average casual or office look. It does not claim support for the remaining legacy wardrobe.
 */
export async function prepareNativeSkinnedBody(options: NativePreparedFactoryOptions): Promise<NativePreparedSkinnedBody> {
  const { kit, seed } = options;
  if (!Number.isFinite(options.sceneScale) || options.sceneScale <= 0) throw new Error('Scene scale must be positive and finite');
  const retargetMode = options.retargetMode ?? 'landmarks';
  if (retargetMode !== 'landmarks' && retargetMode !== 'directions') throw new Error(`Unsupported native retarget mode ${String(retargetMode)}`);
  const initialLook = requireCompleteLook(options.look, seed);
  let kitClosed = false;
  let runtime: NativeFullRuntime | undefined;
  let character: CompleteCharacter | undefined;
  let correction: NativeFamilyRigCorrection | undefined;
  let skin: Awaited<ReturnType<typeof applySkinMaterial>> | undefined;
  let presentation: AuthoredPresentation | undefined;
  let eyes: ReturnType<typeof applyAuthoredEyeMaterial> | undefined;
  let footwear: AuthoredFootwear | undefined;
  let clothingPacket: AuthoredClothingPacketLease | undefined;
  let sampler: NativeSourceLandmarkSampler | undefined;
  let solver: NativeClipSolver | undefined;
  let contacts: ReturnType<typeof createAuthoredFootContacts> | undefined;
  let seatSurface: ReturnType<typeof createNativeSeatSurfaceProbe> | undefined;
  let restAdapter: ReturnType<typeof createNativeRestPoseAdapter> | undefined;
  let hands: ReturnType<typeof createNativeHandPoseController> | undefined;
  let wrists: ReturnType<typeof createNativeWristOrientationController> | undefined;
  let headOrientation: ReturnType<typeof createNativeHeadOrientationController> | undefined;
  let directionRetargeter: NativeDirectionRetargeter | undefined;
  let neutralPose: NativeNeutralPose | undefined;
  let actorDisposed = false;
  let unregisterFactoryClose: (() => boolean) | undefined;
  const clean = (errors: unknown[] = []): void => {
    if (actorDisposed) return;
    actorDisposed = true;
    const actions: (() => void)[] = [
      () => contacts?.dispose(),
      () => restAdapter?.dispose(),
      () => sampler?.dispose(),
      () => hands?.dispose(),
      () => wrists?.dispose(),
      () => headOrientation?.dispose(),
      () => solver?.dispose(),
      () => directionRetargeter?.dispose(),
      () => neutralPose?.dispose(),
      () => clothingPacket?.dispose(),
      () => footwear?.dispose(),
      () => presentation?.dispose(),
      () => eyes?.dispose(),
      () => skin?.dispose(),
      () => correction?.restore(),
      () => character?.dispose(),
      () => { unregisterFactoryClose?.(); unregisterFactoryClose = undefined; },
    ];
    for (const action of actions) try { action(); } catch (error) { errors.push(error); }
  };
  const checkKit = (): void => { if (kitClosed) throw new Error('Native prepared body Kit was disposed during preparation'); };
  unregisterFactoryClose = kit.onDispose(() => {
    kitClosed = true;
    if (runtime) runtime.dispose();
    else clean();
  });

  try {
    checkKit();
    const characterKit = completeCharacterKit(kit);
    character = await loadCompleteCharacter(characterKit, initialLook, seed);
    checkKit();

    // Must be the first actor mutation after the authored clone and its family morph are prepared.
    correction = applyNativeFamilyRigCorrection(character.object);
    checkKit();

    skin = await applySkinMaterial(character.object, initialLook.body, initialLook.skin, kit);
    checkKit();

    const clothingKey = initialLook.body === 'woman'
      ? initialLook.outfit === 'office' ? 'female-office' : 'female-casual'
      : initialLook.outfit === 'office' ? 'male-office' : 'male-casual';
    const packetLook = { ...initialLook, appearance: normalizeAvatarAppearance(initialLook.appearance) };
    const bodyCoverage = authoredBodyCoverageHideSet(clothingKey, packetLook);
    presentation = await applyAuthoredPresentation(character.object, initialLook, {
      kitOwner: kit,
      additionalBodyHideSets: [{
        asset: shoeHideMap.asset,
        bodySourceTriangleCount: shoeHideMap.bodySourceTriangleCount,
        triangleIds: shoeHideMap.sourceBodyTriangleIds,
      }, ...(bodyCoverage ? [bodyCoverage] : [])],
    });
    checkKit();
    if (presentation.metrics.unsupported.length) {
      throw new Error(`Authored presentation rejected prepared look: ${presentation.metrics.unsupported.join('; ')}`);
    }

    footwear = await applyAuthoredFootwear(character.object, { kitOwner: kit });
    checkKit();
    clothingPacket = await applyAuthoredClothingPacket(footwear.object, clothingKey, packetLook);
    checkKit();
    eyes = applyAuthoredEyeMaterial(character.object);

    const body = character.object.getObjectByName('Body') as THREE.SkinnedMesh | null;
    if (!body?.isSkinnedMesh) throw new Error('Prepared authored actor has no Body SkinnedMesh');
    if (options.seatSupport) {
      const clothingName = initialLook.outfit === 'office' ? 'Authored office suit' : 'Authored casual suit';
      const clothing = character.object.getObjectByName(clothingName) as THREE.SkinnedMesh | null;
      if (!clothing?.isSkinnedMesh || !clothing.visible) throw new Error(`Native sit requires visible ${clothingName} geometry`);
      seatSurface = createNativeSeatSurfaceProbe(character.object, [body, clothing]);
    }
    const motion = await characterKit.authoredCharacterAssets.loadMotionRig();
    checkKit();
    sampler = createNativeSourceLandmarkSampler(motion.root.clone(true), motion.clips);
    // Capture the corrected family rest basis before any pose application or actor-specific look mutation.
    if (retargetMode === 'directions') {
      directionRetargeter = createNativeDirectionRetargeter(character.object, { sourceRest: sampler.restLandmarks, floorY: 0 });
    }
    neutralPose = createNativeNeutralPose(character.object);
    hands = createNativeHandPoseController(character.object);
    wrists = createNativeWristOrientationController(character.object, sampler.restWristRotations);
    headOrientation = createNativeHeadOrientationController(character.object, sampler.restHeadRotation);
    solver = createNativeClipSolver(character.object, { sourceRest: sampler.restLandmarks, footSurface: footwear.object });
    const bounds = solver.measureBodyBounds();
    const standingHeight = bounds.bodyMaxY - bounds.bodyMinY;
    if (!Number.isFinite(standingHeight) || standingHeight < 1.2 || standingHeight > 2.6) {
      throw new Error(`Measured authored standing body height is out of range: ${standingHeight}`);
    }
    contacts = createAuthoredFootContacts(character.object, footwear.object);
    if (options.restSupport) {
      const clothingName = initialLook.outfit === 'office' ? 'Authored office suit' : 'Authored casual suit';
      const clothing = character.object.getObjectByName(clothingName) as THREE.SkinnedMesh | null;
      const hips = character.object.getObjectByName('mixamorigHips') as THREE.Bone | null;
      if (!clothing?.isSkinnedMesh || !clothing.visible || !hips?.isBone) {
        throw new Error('Native prop-rest support requires visible authored clothing and the actor Hips bone');
      }
      const restProbe = createNativeRestContactProbe(character.object, [body, clothing, footwear.object]);
      restAdapter = createNativeRestPoseAdapter(character.object, hips, restProbe);
    }

    const initialBridgeLook = initialLook;
    const lookBridge = createAuthoredLookBridge({
      character: {
        body: initialLook.body,
        isReady: () => !kitClosed && !actorDisposed,
        updateIdentity: (look, nextSeed) => !kitClosed && !actorDisposed && character!.updateIdentity(look, nextSeed),
        setExpression: (expression, seconds) => character!.setExpression(expression, seconds),
      },
      skin: { isReady: () => Boolean(skin) && !actorDisposed, setColor: (color) => skin!.setColor(color) },
      presentation: {
        isReady: () => Boolean(presentation) && !actorDisposed,
        setColors: (top, bottom, hairColor) => presentation!.setColors(top, bottom, hairColor),
      },
      initialLook: initialBridgeLook,
      seed,
    });

    const appearance = (look: Look): NativeAppearanceScale => appearanceScale(look);
    const supportsLook = (look: Look): boolean => {
      try {
        assertLookSupported(look);
        const current = lookBridge.currentLook;
        const sameStructural = look.body === current.body && look.hair === current.hair && look.outfit === current.outfit
          && look.fabric === current.fabric && look.accessories.length === current.accessories.length
          && look.accessories.every((value, index) => value === current.accessories[index])
          && JSON.stringify(normalizeAvatarAppearance(look.appearance)) === JSON.stringify(normalizeAvatarAppearance(current.appearance));
        return sameStructural && look.body === initialLook.body;
      } catch { return false; }
    };
    function resolveClip(name: string): string {
      const feminine = `${name}-female`;
      if (initialLook.body === 'woman' && sampler!.durations.has(feminine)) return feminine;
      return name;
    }
    const source = {
      has(name: string): boolean { return sampler!.durations.has(resolveClip(name)); },
      duration(name: string): number { return sampler!.durations.get(resolveClip(name)) ?? NaN; },
      sample(name: string, seconds: number): NativeWristSourceFrame | null {
        const actual = resolveClip(name);
        if (!sampler!.durations.has(actual)) return null;
        return sampler!.sampleClip(actual, seconds, 'clamp');
      },
    };
    let lastDirectionContactSolve: FootSolveResult | null = null;
    const posePort = createPosePort(character.object, sampler, solver, directionRetargeter, neutralPose, contacts, seatSurface, restAdapter,
      options.stairContactHeightAt, hands, wrists, headOrientation, resolveClip, (result) => { lastDirectionContactSolve = result; });
    const native = createNativeFullRuntime({
      actor: {
        object: character.object,
        family: character.metrics.bodyKey,
        standingHeight,
        boneAliases: BONE_ALIASES,
        dispose: clean,
      },
      source,
      pose: posePort,
      look: {
        prepare(value, nextSeed) {
          const wanted = requireCompleteLook(value, typeof nextSeed === 'string' ? nextSeed : seed);
          if (!supportsLook(wanted)) throw new Error('Prepared authored body cannot change this structural look');
          return wanted;
        },
        family(value) { return value.body === 'man' ? 'male' : 'female'; },
        appearance,
      },
      presentation: {
        canSet: (_value) => false,
        set: (_value) => false,
        canWear: supportsLook,
        commit(candidate) {
          const result = lookBridge.apply(candidate, seed);
          return result.accepted;
        },
        get wardrobe() { return mapWardrobe(presentation!); },
        get wardrobeError() { return presentation!.metrics.unsupported.length ? presentation!.metrics.unsupported.join('; ') : null; },
        dispose: () => presentation?.dispose(),
      },
      contacts,
      toWorldFloor: (parentY) => parentFloorToWorld(character!.object, parentY),
      seatContact: (seat) => {
        const support = options.seatSupport?.(seat, character!.object);
        if (!support || support.kind !== 'seat-anchor' || ![...support.hipWorld, support.seatTopY, support.floorY].every(Number.isFinite)) {
          return { kind: 'diagnostic', floorY: seat.floorY };
        }
        if (Math.abs(support.seatTopY - seat.topWorldY) > 0.01) {
          return { kind: 'diagnostic', floorY: support.floorY };
        }
        return support;
      },
      stairContact: options.stairContactHeightAt
        ? ({ floorY }) => ({ kind: 'stair-feet', leftFloorY: floorY, rightFloorY: floorY })
        : undefined,
      workContact: (placement) => options.workSupport?.(placement, character!.object)
        ?? { kind: 'flat-feet', floorY: parentFloorToWorld(character!.object, placement.y) },
      restContact: options.restSupport
        ? (pose) => options.restSupport!(pose, character!.object)
          ?? { kind: 'diagnostic', floorY: parentFloorToWorld(character!.object, character!.object.position.y) }
        : undefined,
      initialLook,
      sceneScale: options.sceneScale,
      lift: 0,
      sitContact: 0,
      sitBack: 0,
    });
    runtime = native;
    checkKit();

    const preparedMetrics: NativePreparedMetrics = Object.freeze({
      bodyKey: character.metrics.bodyKey,
      standingHeightMetres: standingHeight,
      familyCorrection: correction.metrics,
      authoredBodyTriangles: character.metrics.triangleCount,
      clothingTriangles: presentation.metrics.outfitTriangles,
      hairTriangles: presentation.metrics.hairTriangles,
      shoeTriangles: footwear.metrics.triangles,
      sourceClipCount: sampler.durations.size,
      retargetMode,
      wardrobeWarnings: footwear.metrics.warnings,
      contactSource: 'authored-footwear-sole',
      contactLimitations: Object.freeze([
        'Sitting is available only when the host supplies a measured chair top and floor; the cached posterior body-and-clothing surface must converge within 1 mm and both feet must be supported.',
        options.restSupport
          ? 'Lie, soak, and wash require matching host-registered bed/mat/tub/shower geometry; the adapter checks sampled visible posterior/sole/head points and is not a whole-mesh collision proof.'
          : 'Lie, soak, and wash remain unsupported until the host supplies an actual bed/mat/tub/shower surface callback.',
        'Stairs require a host query of the actual terrain beneath the deformed authored shoe soles; unknown or unreachable surfaces reject the pose.',
        'Host must call solveFeet after pose sampling; this factory does not own a frame loop.',
      ]),
    });

    // Fresh object with live getters; it is structurally checked against the real legacy interface.
    const result: NativePreparedSkinnedBody = {
      object: native.object,
      key: character.metrics.bodyKey,
      get scale() { return native.scale; },
      get scaleX() { return native.scaleX; },
      get scaleZ() { return native.scaleZ; },
      get strideScale() { return native.strideScale; },
      get wardrobe() { return native.wardrobe; },
      get wardrobeError() { return native.wardrobeError; },
      setPresentation(value) { return native.setPresentation(value); },
      sampleFootContacts() { return native.sampleFootContacts(); },
      solveFeet(heightAt) {
        posePort.restoreContactBaseline();
        const mode = ['walk', 'jog', 'dance'].includes(native.pose) ? 'motion' : 'grounded';
        let solved = native.solveFeet(heightAt, mode);
        for (let pass = 0; pass < 2 && solved.limited && solved.maxError > 0.002; pass++) solved = native.solveFeet(heightAt, mode);
        if (directionRetargeter) lastDirectionContactSolve = solved;
        return solved;
      },
      get easing() { return native.easing; },
      get pose() { return native.pose; },
      get seated() { return native.seated; },
      show(pose: BodyPose, animate = false) { native.show(pose, animate); },
      sampleUse(pose: BodyPose, seconds: number) { native.sampleUse(pose, seconds); },
      enter(animate: boolean) { native.enter(animate); },
      stride(phase: number, jog: boolean, climb?: number) { native.stride(phase, jog, climb); },
      step(dt: number) { return native.step(dt); },
      settle() { native.settle(); },
      place(x: number, y: number, z: number, ry: number) { native.place(x, y, z, ry); },
      sitOn(x: number, top: number, z: number, ry: number) { native.sitOn(x, top, z, ry); },
      workOn(x: number, floor: number, z: number, ry: number) { native.workOn(x, floor, z, ry); },
      fit(sceneScale: number) { native.fit(sceneScale); },
      wear(look: unknown, nextSeed?: unknown) { return native.wear(look, nextSeed); },
      dispose() { native.dispose(); },
      preparedMetrics,
      get lastDirectionContactSolve() { return lastDirectionContactSolve; },
    } satisfies NativePreparedSkinnedBody;
    // A second compile-time assignment is intentional: this catches legacy callers' exact interface drift.
    const legacyAssignable: SkinnedBody = result;
    void legacyAssignable;
    return result;
  } catch (error) {
    runtime?.dispose();
    if (!runtime) clean();
    unregisterFactoryClose?.();
    unregisterFactoryClose = undefined;
    throw error;
  }
}

export const NATIVE_PREPARED_POSE_COVERAGE: readonly BodyPose[] = Object.freeze(['idle', 'walk', 'jog', 'sit', 'interact', 'dance', 'lie', 'soak', 'wash', 'bucket', 'cook', 'cookLow', 'eat', 'drink', 'homeDoor']);
export const NATIVE_PREPARED_TRANSITION_COVERAGE: readonly string[] = Object.freeze([
  WORK_INTO.bucket!, WORK_INTO.cook!, WORK_INTO.cookLow!, WORK_INTO.eat!, WORK_INTO.drink!, WORK_INTO.homeDoor!,
  WORK_OUT.bucket!, WORK_OUT.cook!, WORK_OUT.cookLow!, WORK_OUT.eat!, WORK_OUT.drink!, DOOR,
]);
/** Conditional capabilities require a host callback which samples the actual visible furniture/terrain. */
export const NATIVE_PREPARED_CONDITIONAL_CONTACT_COVERAGE = Object.freeze({
  poses: Object.freeze(['sit', 'lie', 'soak', 'wash']),
  transitions: Object.freeze([INTO.sit!, OUT.sit!, INTO.lie!, OUT.lie!, INTO.soak!, OUT.soak!, WORK_INTO.wash!, WORK_OUT.wash!, STAIRS.up, STAIRS.down]),
});

/** Pure preflight for the factory's complete-look contract. Does not load assets or mutate the input. */
export function supportsNativeLook(input: unknown, seed: string): boolean {
  try { requireCompleteLook(input, seed); return true; } catch { return false; }
}

/** Whether the factory's stable pose table covers the requested legacy pose set. */
export function supportsNativePoses(poses: readonly BodyPose[]): boolean {
  const supported = new Set<BodyPose>(NATIVE_PREPARED_POSE_COVERAGE);
  return poses.every((pose) => supported.has(pose));
}

