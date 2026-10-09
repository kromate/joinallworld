import * as THREE from 'three';
import type { FootContact } from '../../../../src/scene/body/foot-contact.ts';
import {
  type NativeRestContactProbe,
  type NativeRestContactMeasure,
  type NativeRestPose,
  type NativeRestPropSurface,
  validateNativeRestPropSurface,
} from './native-rest-contact.ts';

export type { NativeRestPose } from './native-rest-contact.ts';

/** The prop must be registered by the host before it asks the body to enter a rest pose. */
export interface NativePropRestSupport {
  readonly kind: 'prop-rest';
  readonly surface: NativeRestPropSurface;
  /** World-space floor used only for safe upright entry/exit frames. */
  readonly transitionFloorY?: number;
}

export interface NativeRestPoseResult {
  readonly pose: NativeRestPose;
  readonly propId: string;
  readonly phase: 'still' | 'transition';
  readonly transitionValidated: boolean;
  readonly hipsWorldCorrection: number;
  readonly rootWorldCorrection: number;
  readonly rootWorldCorrectionXZ?: readonly [number, number];
  readonly measurement: NativeRestContactMeasure;
}

export interface NativeRestPoseAdapter {
  readonly activePropId: string | null;
  register(support: NativePropRestSupport): () => void;
  /** Call after the exact mapped source frame and host placement have been applied; the callback may be a no-op when a pose port already consumed that frame. */
  apply(
    pose: NativeRestPose,
    support: NativePropRestSupport,
    applyMappedSourceFrame: () => void,
    sampleParentLocalContacts: () => readonly FootContact[],
    solveHostFeet?: (surface: NativeRestPropSurface, floorY?: number) => void,
    phase?: 'still' | 'transition',
    anchorBlend?: number,
  ): NativeRestPoseResult;
  dispose(): void;
}

const CONTACT_GAP_METRES = 0.018;
// Aim inside the accepted contact interval so float rounding cannot leave an
// otherwise valid sampled region a few nanometres beyond the 18 mm boundary.
const CONTACT_TARGET_GAP_METRES = 0.0165;
const MAX_PENETRATION_METRES = 0.004;
const MAX_REST_ROOT_SHIFT_METRES = 0.35;
const MAX_LIE_SPINE_ALIGNMENT_DEGREES = 12;
const MAX_LIE_NECK_ALIGNMENT_DEGREES = 25;

function worldContacts(root: THREE.Object3D, contacts: readonly FootContact[]): readonly FootContact[] {
  root.updateWorldMatrix(true, false);
  const parent = root.parent;
  if (parent) parent.updateWorldMatrix(true, false);
  const transform = parent?.matrixWorld;
  if (!transform) return contacts;
  return contacts.map((contact) => {
    const point = new THREE.Vector3(contact.x, contact.y, contact.z).applyMatrix4(transform);
    const points = contact.points?.map((sample) => {
      const world = new THREE.Vector3(sample.x, sample.y, sample.z).applyMatrix4(transform);
      return Object.freeze({ ...sample, x: world.x, y: world.y, z: world.z });
    });
    return Object.freeze({ ...contact, x: point.x, y: point.y, z: point.z,
      ...(points ? { points: Object.freeze(points) } : {}) });
  });
}

function requiredRegions(pose: NativeRestPose, measure: NativeRestContactMeasure): readonly number[] {
  switch (pose) {
    case 'lie': return [measure.regions['pelvis-back'].minimumGap, measure.regions['torso-back'].minimumGap];
    case 'soak': return [measure.regions['pelvis-back'].minimumGap];
    case 'wash': return [];
  }
}

function correctionInterval(pose: NativeRestPose, measure: NativeRestContactMeasure): readonly [number, number] | null {
  const gaps = requiredRegions(pose, measure);
  if (!gaps.length) return [0, 0];
  if (gaps.some((gap) => !Number.isFinite(gap))) throw new Error(`Native ${pose} has no measured posterior prop contact`);
  const noPenetrationGaps = pose === 'lie'
    ? [...gaps, measure.regions['head-back'].minimumGap]
    : gaps;
  if (noPenetrationGaps.some((gap) => !Number.isFinite(gap))) throw new Error(`Native ${pose} has no finite posterior clearance witness`);
  // A single pelvis translation can work only when all required sampled regions share a
  // non-penetrating contact interval. This rejects incompatible bed/tub profiles rather than
  // moving the actor until one region looks good while another cuts through the prop.
  const minimumShift = Math.max(...noPenetrationGaps.map((gap) => -MAX_PENETRATION_METRES - gap));
  const maximumShift = Math.min(...gaps.map((gap) => CONTACT_TARGET_GAP_METRES - gap));
  return minimumShift <= maximumShift ? [minimumShift, maximumShift] : null;
}

function rootCorrectionFor(pose: NativeRestPose, measure: NativeRestContactMeasure): number | null {
  const interval = correctionInterval(pose, measure);
  if (!interval) return null;
  return THREE.MathUtils.clamp(0, interval[0], interval[1]);
}

function washHeadCorrection(root: THREE.Group, surface: NativeRestPropSurface, blend: number): readonly [number, number] {
  const zone = surface.headZone;
  const anchor = zone?.anchorWorld?.();
  const head = root.getObjectByName('mixamorigHead');
  if (!zone || !anchor || !(head instanceof THREE.Bone)) {
    throw new Error('Native wash requires an exact host showerhead world anchor and mapped head bone');
  }
  if (!anchor.every(Number.isFinite)) throw new Error('Native wash showerhead anchor is non-finite');
  root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
  const current = head.getWorldPosition(new THREE.Vector3());
  const dx = (anchor[0] - current.x) * blend;
  const dz = (anchor[2] - current.z) * blend;
  if (Math.hypot(dx, dz) > MAX_REST_ROOT_SHIFT_METRES) {
    throw new Error(`Native wash head anchor correction is outside measured bounds: ${JSON.stringify([dx, dz])}`);
  }
  if (Math.hypot(dx, dz) > 0.0002) {
    const target = root.getWorldPosition(new THREE.Vector3());
    target.x += dx; target.z += dz;
    if (root.parent) {
      root.parent.updateWorldMatrix(true, false);
      root.parent.worldToLocal(target);
    }
    root.position.copy(target);
    root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
  }
  return Object.freeze([dx, dz] as const);
}

/**
 * Applies a measured prop anchor after a named source frame is mapped. The returned world-Y
 * anchor is re-applied by the runtime when it restores host placement on the next frame; bone
 * translations remain the exact mapped source pose. This is sampled regional contact evidence,
 * not whole-mesh collision proof.
 */
export function createNativeRestPoseAdapter(
  root: THREE.Group,
  hips: THREE.Bone,
  probe: NativeRestContactProbe,
): NativeRestPoseAdapter {
  if (!hips.isBone || !hips.parent || root.getObjectById(hips.id) !== hips) {
    throw new Error('Native rest adapter requires the actor-owned Hips bone');
  }
  if (!hips.parent) throw new Error('Native rest adapter requires a movable Hips bone');
  let active: NativeRestPropSurface | null = null;
  let disposed = false;

  function mappedFrameWitness(): Readonly<Record<string, unknown>> {
    root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
    const names = ['mixamorigHips', 'mixamorigSpine', 'mixamorigSpine1', 'mixamorigSpine2', 'mixamorigNeck', 'mixamorigHead'];
    const bones = Object.fromEntries(names.map((name) => {
      const bone = root.getObjectByName(name);
      if (!(bone instanceof THREE.Bone)) return [name, null];
      const world = bone.getWorldPosition(new THREE.Vector3());
      return [name, Object.freeze({ local: Object.freeze(bone.position.toArray()), world: Object.freeze(world.toArray()), quaternion: Object.freeze(bone.quaternion.toArray()) })];
    }));
    const rootWorld = root.getWorldPosition(new THREE.Vector3());
    const hipsWorld = hips.getWorldPosition(new THREE.Vector3());
    return Object.freeze({ rootLocal: Object.freeze(root.position.toArray()), rootWorld: Object.freeze(rootWorld.toArray()),
      rootQuaternion: Object.freeze(root.getWorldQuaternion(new THREE.Quaternion()).toArray()),
      hipsLocal: Object.freeze(hips.position.toArray()), hipsWorld: Object.freeze(hipsWorld.toArray()), bones });
  }

  function evidence(surface: NativeRestPropSurface, measure: NativeRestContactMeasure, mappedFrame: Readonly<Record<string, unknown>>, correction: number) {
    return JSON.stringify({ propId: surface.id, pose: surface.pose, mappedFrame, rootWorldCorrection: correction, measurement: measure });
  }

  function shiftRootWorldY(delta: number): void {
    if (!Number.isFinite(delta) || Math.abs(delta) > MAX_REST_ROOT_SHIFT_METRES) {
      throw new Error(`Native rest root anchor correction is outside measured bounds: ${delta}`);
    }
    root.updateWorldMatrix(true, false);
    root.updateMatrixWorld(true);
    const world = root.getWorldPosition(new THREE.Vector3());
    world.y += delta;
    if (root.parent) {
      root.parent.updateWorldMatrix(true, false);
      root.parent.worldToLocal(world);
    }
    root.position.copy(world);
    root.updateWorldMatrix(true, false);
    root.updateMatrixWorld(true);
  }

  function alignLieSpine(
    surface: NativeRestPropSurface,
    sampleContacts: () => readonly FootContact[],
    initial: NativeRestContactMeasure,
    blend = 1,
  ): NativeRestContactMeasure {
    const interval = correctionInterval('lie', initial);
    if (interval) return initial;
    function searchBone(name: string, maximumDegrees: number): { bone: THREE.Bone; original: THREE.Quaternion; parentQInverse: THREE.Quaternion; parentQ: THREE.Quaternion; rootRight: THREE.Vector3; angle: number } | null {
      const bone = root.getObjectByName(name);
      if (!(bone instanceof THREE.Bone) || !bone.parent) return null;
      const original = bone.quaternion.clone();
      const rootRight = new THREE.Vector3(1, 0, 0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())).normalize();
      const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion());
      const parentQInverse = parentQ.clone().invert();
      for (let step = 1; step <= maximumDegrees * 2; step++) {
        const magnitude = step * 0.5;
        for (const sign of [-1, 1] as const) {
          const angle = sign * magnitude * Math.PI / 180;
          const worldDelta = new THREE.Quaternion().setFromAxisAngle(rootRight, angle);
          const localDelta = parentQInverse.clone().multiply(worldDelta).multiply(parentQ);
          bone.quaternion.copy(localDelta.multiply(original)).normalize();
          root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
          if (correctionInterval('lie', measure(surface, sampleContacts))) {
            return { bone, original, parentQInverse, parentQ, rootRight, angle };
          }
        }
      }
      bone.quaternion.copy(original);
      root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
      return null;
    }
    const spineAdjustment = searchBone('mixamorigSpine', MAX_LIE_SPINE_ALIGNMENT_DEGREES);
    const adjustment = spineAdjustment ?? searchBone('mixamorigNeck', MAX_LIE_NECK_ALIGNMENT_DEGREES);
    if (!adjustment) {
      throw new Error(`Native lie cannot fit pelvis, torso, and head clearance within ${MAX_LIE_SPINE_ALIGNMENT_DEGREES} degrees of spine or ${MAX_LIE_NECK_ALIGNMENT_DEGREES} degrees of neck alignment`);
    }
    const worldDelta = new THREE.Quaternion().setFromAxisAngle(adjustment.rootRight, adjustment.angle * blend);
    const localDelta = adjustment.parentQInverse.clone().multiply(worldDelta).multiply(adjustment.parentQ);
    adjustment.bone.quaternion.copy(localDelta.multiply(adjustment.original)).normalize();
    root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
    return measure(surface, sampleContacts);
  }

  function measure(surface: NativeRestPropSurface, sampleContacts: () => readonly FootContact[]): NativeRestContactMeasure {
    return probe.sample(surface, worldContacts(root, sampleContacts()));
  }

  return {
    get activePropId() { return active?.id ?? null; },
    register(support) {
      if (disposed) throw new Error('Native rest adapter is disposed');
      validateNativeRestPropSurface(support.surface);
      const previous = active;
      active = support.surface;
      let registered = true;
      return () => {
        if (!registered) return;
        registered = false;
        if (active === support.surface) active = previous;
      };
    },
    apply(pose, support, applyMappedSourceFrame, sampleParentLocalContacts, solveHostFeet, phase = 'still', anchorBlend = 1) {
      if (disposed) throw new Error('Native rest adapter is disposed');
      validateNativeRestPropSurface(support.surface);
      if (support.surface.pose !== pose) throw new Error(`Native ${pose} request does not match registered ${support.surface.pose} prop support`);
      if (active !== support.surface) throw new Error('Native rest prop must be registered before the pose is requested');
      if (typeof applyMappedSourceFrame !== 'function') throw new Error('Native rest pose requires a mapped source-frame application');
      if (typeof sampleParentLocalContacts !== 'function') throw new Error('Native rest pose requires fresh foot-contact samples');
      if (!Number.isFinite(anchorBlend) || anchorBlend < 0 || anchorBlend > 1) throw new Error('Native rest anchor blend must be between zero and one');
      if (support.surface.pose === 'soak' || support.surface.pose === 'wash') {
        if (!solveHostFeet) throw new Error(`Native ${support.surface.pose} requires the actual host foot-surface solver`);
      }

      applyMappedSourceFrame();
      const mappedFrame = mappedFrameWitness();
      if (phase === 'transition') {
        const floorY = support.transitionFloorY;
        if (!Number.isFinite(floorY)) throw new Error(`Native ${pose} transition requires a finite world floor; evidence=${JSON.stringify({ propId: support.surface.id, pose })}`);
        let measurement = measure(support.surface, sampleParentLocalContacts);
        root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
        const hipWorld = hips.getWorldPosition(new THREE.Vector3());
        const head = root.getObjectByName('mixamorigHead');
        if (!(head instanceof THREE.Bone)) throw new Error(`Native ${pose} transition requires the mapped head bone`);
        const headWorld = head.getWorldPosition(new THREE.Vector3());
        const actorScale = root.getWorldScale(new THREE.Vector3()).y;
        const upright = headWorld.y - hipWorld.y > Math.max(0.25, actorScale * 0.55);
        let appliedRootCorrection = 0;
        let appliedRootCorrectionXZ: readonly [number, number] | undefined;
        // A bed/tub/shower anchor is meaningful only once the mapped body has reached the
        // corresponding rest posture. Early upright entry frames are validated against the
        // actual floor; they must not be translated onto the prop before the source pose arrives.
        const propContactPhase = pose === 'lie' ? !upright : anchorBlend >= 0.75;
        if (upright) solveHostFeet?.(support.surface, floorY!);
        if (propContactPhase) {
          if (pose === 'wash') {
            appliedRootCorrectionXZ = washHeadCorrection(root, support.surface, anchorBlend);
            solveHostFeet?.(support.surface, floorY!);
            measurement = measure(support.surface, sampleParentLocalContacts);
          }
          if (pose === 'lie' && anchorBlend > 0 && !correctionInterval('lie', measurement)) {
            measurement = alignLieSpine(support.surface, sampleParentLocalContacts, measurement, anchorBlend);
          }
          const anchor = rootCorrectionFor(pose, measurement);
          const rootCorrection = anchor === null ? 0 : anchor * anchorBlend;
          if (Math.abs(rootCorrection) > 0.0002) {
            shiftRootWorldY(rootCorrection);
            if (upright) solveHostFeet?.(support.surface, floorY!);
            measurement = measure(support.surface, sampleParentLocalContacts);
          }
          const contactGaps = [measurement.regions['pelvis-back'], measurement.regions['torso-back'], measurement.regions['head-back']]
            .filter((region) => region.sampled > 0)
            .flatMap((region) => [region.minimumGap]);
          if (contactGaps.some((gap) => !Number.isFinite(gap) || gap < -MAX_PENETRATION_METRES)) {
            throw new Error(`Native ${pose} transition penetrates its prop; evidence=${evidence(support.surface, measurement, mappedFrame, rootCorrection)}`);
          }
          appliedRootCorrection = rootCorrection;
        }
        const contacts = worldContacts(root, sampleParentLocalContacts()).flatMap((contact) => contact.points ?? [contact]);
        const footGaps = upright ? contacts.map((contact) => contact.y - floorY!) : [];
        if (footGaps.some((gap) => !Number.isFinite(gap) || gap < -MAX_PENETRATION_METRES)) {
          throw new Error(`Native ${pose} transition penetrates the floor; footGaps=${JSON.stringify(footGaps)}; evidence=${evidence(support.surface, measurement, mappedFrame, appliedRootCorrection)}`);
        }
        if (upright && !footGaps.some((gap) => Math.abs(gap) <= MAX_PENETRATION_METRES)) {
          throw new Error(`Native ${pose} upright transition has no planted foot; footGaps=${JSON.stringify(footGaps)}; hip=${hipWorld.toArray()}; head=${headWorld.toArray()}; evidence=${evidence(support.surface, measurement, mappedFrame, appliedRootCorrection)}`);
        }
        return Object.freeze({ pose, propId: support.surface.id, phase, transitionValidated: true,
          hipsWorldCorrection: 0, rootWorldCorrection: appliedRootCorrection,
          ...(appliedRootCorrectionXZ ? { rootWorldCorrectionXZ: appliedRootCorrectionXZ } : {}), measurement });
      }
      let appliedRootCorrectionXZ: readonly [number, number] | undefined;
      if (pose === 'wash') {
        appliedRootCorrectionXZ = washHeadCorrection(root, support.surface, 1);
        solveHostFeet?.(support.surface);
      } else if (pose === 'soak') solveHostFeet?.(support.surface);
      let measurement = measure(support.surface, sampleParentLocalContacts);
      let rootCorrection = 0;
      if (pose === 'lie') {
        if (!correctionInterval('lie', measurement)) measurement = alignLieSpine(support.surface, sampleParentLocalContacts, measurement, 1);
        const shift = rootCorrectionFor('lie', measurement);
        if (shift === null) throw new Error(`Native lie source pose cannot be aligned to both measured posterior regions; evidence=${evidence(support.surface, measurement, mappedFrame, 0)}`);
        if (Math.abs(shift) > 0.0002) {
          shiftRootWorldY(shift);
          rootCorrection += shift;
          measurement = measure(support.surface, sampleParentLocalContacts);
        }
      } else if (pose === 'soak') {
        const shift = rootCorrectionFor('soak', measurement);
        if (shift === null) throw new Error(`Native soak source pose cannot align its measured pelvis to the tub; evidence=${evidence(support.surface, measurement, mappedFrame, 0)}`);
        if (Math.abs(shift) > 0.0002) {
          shiftRootWorldY(shift);
          rootCorrection += shift;
          solveHostFeet?.(support.surface);
          measurement = measure(support.surface, sampleParentLocalContacts);
        }
      }
      if (!measurement.supported) throw new Error(`Native ${pose} contact failed: ${measurement.reason ?? 'host surface is not supported'}; evidence=${evidence(support.surface, measurement, mappedFrame, rootCorrection)}`);
      return Object.freeze({ pose, propId: support.surface.id, phase, transitionValidated: false,
        hipsWorldCorrection: 0, rootWorldCorrection: rootCorrection,
        ...(appliedRootCorrectionXZ ? { rootWorldCorrectionXZ: appliedRootCorrectionXZ } : {}), measurement });
    },
    dispose() { disposed = true; active = null; },
  };
}
