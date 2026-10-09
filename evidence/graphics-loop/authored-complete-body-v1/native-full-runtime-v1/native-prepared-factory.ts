import * as THREE from 'three';
import type { Kit } from '../../../../src/scene/kit.ts';
import { LOOK_OPTIONS, normalizeLook, type Look } from '../../../../src/scene/avatar-look.ts';
import { normalizeAvatarAppearance, avatarProportions } from '../../../../src/types/avatar.ts';
import type { SkinnedBody } from '../../../../src/scene/body/skinned.ts';
import type { BodyKey } from '../../../../src/scene/body/manifest.ts';
import type { WardrobeMetrics, WardrobePresentation } from '../../../../src/scene/wardrobe/renderer.ts';
import type { BodyPose } from '../../../../src/scene/body/poses.ts';
import type { FootContact, FootPoint, FootSolveResult } from '../../../../src/scene/body/foot-contact.ts';
import { createNativeFullRuntime, type NativeAppearanceScale, type NativeFullRuntime, type NativePoseSupport, type NativeSeat, type NativePlacement } from './native-full-runtime.ts';
import { completeCharacterKit } from '../assets.ts';
import { loadCompleteCharacter, type CompleteCharacter } from '../rig.ts';
import { applyNativeFamilyRigCorrection, type NativeFamilyRigCorrection } from '../native-family-rig-correction.ts';
import { applySkinMaterial } from '../skin-material.ts';
import { applyAuthoredPresentation, type AuthoredPresentation } from '../authored-presentation.ts';
import { applyAuthoredEyeMaterial } from '../eye-material.ts';
import { createNativeHandPoseController } from '../native-hand-pose.ts';
import { createNativeWristOrientationController } from '../native-wrist-orientation/native-wrist-controller.ts';
import { applyAuthoredFootwear, type AuthoredFootwear } from '../authored-footwear/presentation.ts';
import shoeHideMap from '../authored-footwear/out/shoes01-body-hide-map.json';
import { createAuthoredLookBridge } from '../authored-look-bridge.ts';
import { createNativeSourceLandmarkSampler, type NativeSourceLandmarkSampler, type NativeWristSourceFrame } from '../native-source-sampler.ts';
import { createNativeClipSolver, type NativeClipSolver, type NativeClipSupport } from '../native-clip-solver.ts';
import { createNativeDirectionRetargeter, type NativeDirectionRetargeter } from '../native-direction-retarget.ts';
import { createNativeSeatSurfaceProbe } from '../native-seat-surface.ts';
import { solveNativeSeatPose } from '../native-seat-pose-adapter.ts';
import { DOOR, INTO, OUT, SEATED, STAIRS, STILL, WORK_INTO, WORK_OUT } from '../../../../src/scene/body/poses.ts';

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
  if (support.kind === 'seat-anchor' || support.kind === 'diagnostic') return solverSupport(support);
  if (support.kind === 'flat-feet') {
    return isVerticalParent(root) && Number.isFinite(support.floorY) ? solverSupport(support)
      : { kind: 'body-contact-diagnostic', floorY: 0, diagnosticOnly: true };
  }
  return isVerticalParent(root) && Number.isFinite(support.leftFloorY) && Number.isFinite(support.rightFloorY)
    ? solverSupport(support)
    : { kind: 'body-contact-diagnostic', floorY: 0, diagnosticOnly: true };
}

interface SoleGroup { readonly side: 'left' | 'right'; readonly vertices: readonly number[] }

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
    const beforeFoot = leg.foot.quaternion.clone();
    aim(leg.thigh, knee.clone().sub(hip), wantedKnee.clone().sub(hip));
    const actualKnee = boneActorPoint(leg.calf), actualAnkle = boneActorPoint(leg.foot);
    aim(leg.calf, actualAnkle.clone().sub(actualKnee), targetAnkle.clone().sub(actualKnee));
    leg.foot.quaternion.copy(beforeFoot);
    updateActorWorld(actor);
    return Math.abs(reach - requested) > 0.001;
  }

  function solve(heightAt: (contact: FootContact) => number, mode: 'motion' | 'grounded' = 'motion'): FootSolveResult {
    if (disposed) throw new Error('Authored foot contacts are disposed');
    let limited = false;
    const desiredSoleY = new Map<'left' | 'right', number>();
    const correctedSides = new Set<'left' | 'right'>();
    let after = sample();
    // Weighted toe/sole vertices do not move as a perfectly rigid ankle point.
    // Re-sample and apply the remaining error a few times, while preserving the
    // actual ankle-to-sole offset on every pass.
    for (let pass = 0; pass < 4; pass++) {
      let passError = 0;
      for (const contact of after) {
        let targetY = mode === 'grounded' ? -Infinity : contact.y;
        for (const point of contact.points ?? [contact]) targetY = Math.max(targetY, heightAt(point));
        if (!Number.isFinite(targetY)) { limited = true; continue; }
        const amount = targetY - contact.y;
        if (mode === 'motion' && amount < -0.024) continue; // Preserve a deliberate swing foot.
        desiredSoleY.set(contact.side, targetY);
        passError = Math.max(passError, Math.abs(amount));
        if (Math.abs(amount) <= 0.0002) continue;
        const bounded = THREE.MathUtils.clamp(amount, mode === 'grounded' ? -0.12 : 0, 0.12);
        if (Math.abs(amount - bounded) > 0.001) limited = true;
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
    if (maxError > 0.004) limited = true;
    return Object.freeze({ corrected: correctedSides.size, maxError, limited });
  }

  return { sample, solve, dispose() { disposed = true; contacts.length = 0; } };
}

function createPosePort(root: THREE.Group, sampler: NativeSourceLandmarkSampler, solver: NativeClipSolver, directionRetargeter: NativeDirectionRetargeter | undefined, contacts: ReturnType<typeof createAuthoredFootContacts>, seatSurface: ReturnType<typeof createNativeSeatSurfaceProbe> | undefined, stairContactHeightAt: NativePreparedFactoryOptions['stairContactHeightAt'], hands: ReturnType<typeof createNativeHandPoseController>, wrists: ReturnType<typeof createNativeWristOrientationController>, resolveClip: (name: string) => string, onDirectionContactSolve: (result: FootSolveResult) => void) {
  const bones = new Map<string, THREE.Bone>();
  root.traverse((node) => { const bone = node as THREE.Bone; if (bone.isBone) bones.set(bone.name, bone); });
  const contactBones = ['mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigRightUpLeg', 'mixamorigRightLeg']
    .map((name) => bones.get(name))
    .filter((bone): bone is THREE.Bone => Boolean(bone));
  if (contactBones.length !== 4) throw new Error('Native authored contact checkpoint lacks thigh/calf bones');
  const contactBaseline = contactBones.map((bone) => ({ bone, position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), scale: new THREE.Vector3() }));
  let contactBaselineReady = false;
  let blend: { clip: string; fade: number; from: Map<THREE.Bone, { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }> } | null = null;
  function captureContactBaseline(): void {
    for (const saved of contactBaseline) {
      saved.position.copy(saved.bone.position);
      saved.quaternion.copy(saved.bone.quaternion);
      saved.scale.copy(saved.bone.scale);
    }
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
  return {
    apply(frame: NativeWristSourceFrame, context: Readonly<{ clip: string; seconds: number; pose: BodyPose; support: NativePoseSupport }>): boolean {
      if (frame.clipName !== resolveClip(context.clip)) return false;
      if (['lie', 'soak', 'wash'].includes(context.pose)) {
        throw new Error(`Native ${context.pose} remains unsupported; no validated body-surface support is installed`);
      }
      if (context.support.kind === 'stair-feet') {
        if (!stairContactHeightAt) throw new Error('Native stairs require an actual host stair-surface query');
        const seed = solver.applyFrame(frame, worldSupport(root, context.support));
        if (seed.supportStatus !== 'feet-supported') throw new Error(`Native stair source frame is unsupported (${seed.supportStatus})`);
      }
      if (directionRetargeter && context.support.kind === 'flat-feet') {
        const mappedSupport = worldSupport(root, context.support);
        if (mappedSupport.kind !== 'flat-feet') throw new Error(`Native direction retargeting rejected transformed floor support for ${context.pose}`);
        // Captured after family rest correction and before any pose. This keeps native bone
        // translations/lengths; actual shoe contacts, not the retargeter's body-sole estimate,
        // own the host floor correction below.
        directionRetargeter.apply(frame, mappedSupport.floorY);
      } else if (context.support.kind === 'seat-anchor') {
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
          const applied = solver.applyFrame(frame, solverSupport(context.support));
          if (applied.supportStatus !== 'seat-anchored-contact-unverified' || applied.seatFeetStatus !== 'supported') {
            throw new Error(`Native seated transition lacks seat/foot support (${applied.supportStatus}; feet=${applied.seatFeetStatus ?? 'missing'})`);
          }
        }
      } else if (context.support.kind !== 'stair-feet') {
        if (directionRetargeter) throw new Error(`Native direction retargeting does not support ${context.support.kind}`);
        const applied = solver.applyFrame(frame, worldSupport(root, context.support));
        if (applied.supportStatus !== 'feet-supported') {
          throw new Error(`Native ${context.pose} pose is not contact-supported (${applied.supportStatus}; clip ${frame.clipName})`);
        }
      }
      const support = context.support;
      let heightAt = support.kind === 'flat-feet'
        ? () => worldFloorToParent(root, support.floorY)
        : support.kind === 'stair-feet'
          ? (contact: FootContact) => worldFloorToParent(root, contact.side === 'left' ? support.leftFloorY : support.rightFloorY)
          : support.kind === 'seat-anchor' ? () => worldFloorToParent(root, support.floorY) : null;
      const solveAuthoredContacts = () => {
        if (!heightAt) return null;
        const mode = context.pose === 'walk' || context.pose === 'jog' || context.pose === 'dance' ? 'motion' : 'grounded';
        let result = contacts.solve(heightAt, mode);
        for (let pass = 0; pass < 2 && result.limited && result.maxError > 0.002; pass++) result = contacts.solve(heightAt, mode);
        if (directionRetargeter && (result.limited || result.maxError > 0.004)) {
          throw new Error(`Native direction ${context.pose} shoe contact failed (${result.maxError} m, limited=${result.limited})`);
        }
        if (mode === 'grounded' && (result.limited || result.maxError > 0.004)) {
          throw new Error(`Native ${context.pose} static sole support failed (${result.maxError} m, limited=${result.limited})`);
        }
        if (support.kind === 'stair-feet') {
          if (result.limited || result.maxError > 0.004) throw new Error(`Native stair sole correction failed (${result.maxError} m, limited=${result.limited})`);
          const finalContacts = contacts.sample();
          let grounded = false;
          for (const contact of finalContacts) for (const point of contact.points ?? [contact]) {
            const ground = heightAt!(point);
            const gap = point.y - ground;
            if (gap < -0.004) throw new Error(`Native stair shoe penetrates host surface by ${(-gap).toFixed(4)} m`);
            if (Math.abs(gap) <= 0.004) grounded = true;
          }
          if (!grounded) throw new Error('Native stair pose has no sole point supported by the host surface');
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
      solveAuthoredContacts();
      wrists.apply(frame);
      hands.apply(context.pose === 'walk' || context.pose === 'jog' ? 'walk' : ['cook','cookLow','eat','drink'].includes(context.pose) ? 'grip' : 'relaxed', context.seconds);
      return true;
    },
    beginTransition(clip: string, _from: NativePlacement, crossfadeSeconds: number): void {
      const from = new Map<THREE.Bone, { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }>();
      for (const bone of bones.values()) from.set(bone, { p: bone.position.clone(), q: bone.quaternion.clone(), s: bone.scale.clone() });
      blend = { clip, fade: Math.max(0.001, crossfadeSeconds), from };
    },
    endTransition(): void { blend = null; },
    restoreContactBaseline,
    restore(): void { directionRetargeter?.restore(); solver.restore(); blend = null; },
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
  let sampler: NativeSourceLandmarkSampler | undefined;
  let solver: NativeClipSolver | undefined;
  let contacts: ReturnType<typeof createAuthoredFootContacts> | undefined;
  let seatSurface: ReturnType<typeof createNativeSeatSurfaceProbe> | undefined;
  let hands: ReturnType<typeof createNativeHandPoseController> | undefined;
  let wrists: ReturnType<typeof createNativeWristOrientationController> | undefined;
  let directionRetargeter: NativeDirectionRetargeter | undefined;
  let actorDisposed = false;
  let unregisterFactoryClose: (() => boolean) | undefined;
  const clean = (errors: unknown[] = []): void => {
    if (actorDisposed) return;
    actorDisposed = true;
    const actions: (() => void)[] = [
      () => contacts?.dispose(),
      () => sampler?.dispose(),
      () => hands?.dispose(),
      () => wrists?.dispose(),
      () => solver?.dispose(),
      () => directionRetargeter?.dispose(),
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

    presentation = await applyAuthoredPresentation(character.object, initialLook, {
      kitOwner: kit,
      additionalBodyHideSets: [{
        asset: shoeHideMap.asset,
        bodySourceTriangleCount: shoeHideMap.bodySourceTriangleCount,
        triangleIds: shoeHideMap.sourceBodyTriangleIds,
      }],
    });
    checkKit();
    if (presentation.metrics.unsupported.length) {
      throw new Error(`Authored presentation rejected prepared look: ${presentation.metrics.unsupported.join('; ')}`);
    }

    footwear = await applyAuthoredFootwear(character.object, { kitOwner: kit });
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
    hands = createNativeHandPoseController(character.object);
    wrists = createNativeWristOrientationController(character.object, sampler.restWristRotations);
    solver = createNativeClipSolver(character.object, { sourceRest: sampler.restLandmarks, footSurface: footwear.object });
    const bounds = solver.measureBodyBounds();
    const standingHeight = bounds.bodyMaxY - bounds.bodyMinY;
    if (!Number.isFinite(standingHeight) || standingHeight < 1.2 || standingHeight > 2.6) {
      throw new Error(`Measured authored standing body height is out of range: ${standingHeight}`);
    }
    contacts = createAuthoredFootContacts(character.object, footwear.object);

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
    const posePort = createPosePort(character.object, sampler, solver, directionRetargeter, contacts, seatSurface,
      options.stairContactHeightAt, hands, wrists, resolveClip, (result) => { lastDirectionContactSolve = result; });
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
        'Lie, soak, and wash remain unsupported because no tested bed, tub, or wash-station surface adapter is installed.',
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

export const NATIVE_PREPARED_POSE_COVERAGE: readonly BodyPose[] = Object.freeze(['idle', 'walk', 'interact', 'cook', 'eat', 'drink']);
export const NATIVE_PREPARED_TRANSITION_COVERAGE: readonly string[] = Object.freeze([
  WORK_INTO.bucket!, WORK_INTO.cook!, WORK_INTO.cookLow!, WORK_INTO.eat!, WORK_INTO.drink!, WORK_INTO.homeDoor!,
  WORK_OUT.bucket!, WORK_OUT.cook!, WORK_OUT.cookLow!, WORK_OUT.eat!, WORK_OUT.drink!, DOOR,
]);
/** Conditional capabilities require a host callback which samples the actual visible furniture/terrain. */
export const NATIVE_PREPARED_CONDITIONAL_CONTACT_COVERAGE = Object.freeze({
  poses: Object.freeze(['sit']), transitions: Object.freeze([INTO.sit!, OUT.sit!, STAIRS.up, STAIRS.down]),
});
