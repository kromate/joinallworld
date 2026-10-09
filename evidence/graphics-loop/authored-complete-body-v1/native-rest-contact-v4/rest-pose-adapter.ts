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
    solveHostFeet?: (surface: NativeRestPropSurface) => void,
    phase?: 'still' | 'transition',
  ): NativeRestPoseResult;
  dispose(): void;
}

const CONTACT_GAP_METRES = 0.018;
const MAX_PENETRATION_METRES = 0.004;
const MAX_HIPS_CORRECTION_METRES = 0.08;
const MAX_CORRECTION_PASSES = 4;

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

function correctionIntoContactBand(pose: NativeRestPose, measure: NativeRestContactMeasure): number {
  const gaps = requiredRegions(pose, measure);
  if (!gaps.length) return 0;
  if (gaps.some((gap) => !Number.isFinite(gap))) throw new Error(`Native ${pose} has no measured posterior prop contact`);
  // A single pelvis translation can work only when all required sampled regions share a
  // non-penetrating contact interval. This rejects incompatible bed/tub profiles rather than
  // moving the actor until one region looks good while another cuts through the prop.
  const minimumShift = Math.max(...gaps.map((gap) => -MAX_PENETRATION_METRES - gap));
  const maximumShift = Math.min(...gaps.map((gap) => CONTACT_GAP_METRES - gap));
  if (minimumShift > maximumShift) throw new Error(`Native ${pose} prop profile cannot support the sampled posterior regions with one pelvis correction; shiftInterval=[${minimumShift},${maximumShift}], gaps=${JSON.stringify(gaps)}`);
  return THREE.MathUtils.clamp(0, minimumShift, maximumShift);
}

/**
 * Applies a bounded, measured prop contact correction after a named source frame is mapped.
 * It never changes the actor root/host placement and never claims whole-mesh collision proof.
 */
export function createNativeRestPoseAdapter(
  root: THREE.Group,
  hips: THREE.Bone,
  probe: NativeRestContactProbe,
): NativeRestPoseAdapter {
  if (!hips.isBone || !hips.parent || root.getObjectById(hips.id) !== hips) {
    throw new Error('Native rest adapter requires the actor-owned Hips bone');
  }
  const hipsParent = (() => {
    const parent = hips.parent;
    if (!parent) throw new Error('Native rest adapter requires a movable Hips bone');
    return parent;
  })();
  let active: NativeRestPropSurface | null = null;
  let disposed = false;
  const worldHip = new THREE.Vector3();

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
    return JSON.stringify({ propId: surface.id, pose: surface.pose, mappedFrame, hipsWorldCorrection: correction, measurement: measure });
  }

  function shiftHipsWorldY(delta: number): void {
    if (!Number.isFinite(delta)) throw new Error('Native rest correction is non-finite');
    root.updateWorldMatrix(true, false);
    root.updateMatrixWorld(true);
    hips.getWorldPosition(worldHip);
    worldHip.y += delta;
    hipsParent.worldToLocal(worldHip);
    hips.position.copy(worldHip);
    root.updateWorldMatrix(true, false);
    root.updateMatrixWorld(true);
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
    apply(pose, support, applyMappedSourceFrame, sampleParentLocalContacts, solveHostFeet, phase = 'still') {
      if (disposed) throw new Error('Native rest adapter is disposed');
      validateNativeRestPropSurface(support.surface);
      if (support.surface.pose !== pose) throw new Error(`Native ${pose} request does not match registered ${support.surface.pose} prop support`);
      if (active !== support.surface) throw new Error('Native rest prop must be registered before the pose is requested');
      if (typeof applyMappedSourceFrame !== 'function') throw new Error('Native rest pose requires a mapped source-frame application');
      if (typeof sampleParentLocalContacts !== 'function') throw new Error('Native rest pose requires fresh foot-contact samples');
      if (support.surface.pose === 'soak' || support.surface.pose === 'wash') {
        if (!solveHostFeet) throw new Error(`Native ${support.surface.pose} requires the actual host foot-surface solver`);
      }

      applyMappedSourceFrame();
      const mappedFrame = mappedFrameWitness();
      if (phase === 'transition') {
        const measurement = measure(support.surface, sampleParentLocalContacts);
        const contactGaps = [measurement.regions['pelvis-back'], measurement.regions['torso-back'], measurement.regions['head-back']]
          .filter((region) => region.sampled > 0)
          .flatMap((region) => [region.minimumGap]);
        if (contactGaps.some((gap) => !Number.isFinite(gap) || gap < -MAX_PENETRATION_METRES)) {
          throw new Error(`Native ${pose} transition penetrates its prop; evidence=${evidence(support.surface, measurement, mappedFrame, 0)}`);
        }
        const floorY = support.transitionFloorY;
        if (!Number.isFinite(floorY)) throw new Error(`Native ${pose} transition requires a finite world floor; evidence=${evidence(support.surface, measurement, mappedFrame, 0)}`);
        const contacts = worldContacts(root, sampleParentLocalContacts()).flatMap((contact) => contact.points ?? [contact]);
        const footGaps = contacts.map((contact) => contact.y - floorY!);
        if (footGaps.some((gap) => !Number.isFinite(gap) || gap < -MAX_PENETRATION_METRES)) {
          throw new Error(`Native ${pose} transition penetrates the floor; footGaps=${JSON.stringify(footGaps)}; evidence=${evidence(support.surface, measurement, mappedFrame, 0)}`);
        }
        root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
        const hipWorld = hips.getWorldPosition(new THREE.Vector3());
        const head = root.getObjectByName('mixamorigHead');
        if (!(head instanceof THREE.Bone)) throw new Error(`Native ${pose} transition requires the mapped head bone`);
        const headWorld = head.getWorldPosition(new THREE.Vector3());
        const actorScale = root.getWorldScale(new THREE.Vector3()).y;
        const upright = headWorld.y - hipWorld.y > Math.max(0.25, actorScale * 0.55);
        if (upright && !footGaps.some((gap) => Math.abs(gap) <= MAX_PENETRATION_METRES)) {
          throw new Error(`Native ${pose} upright transition has no planted foot; footGaps=${JSON.stringify(footGaps)}; hip=${hipWorld.toArray()}; head=${headWorld.toArray()}; evidence=${evidence(support.surface, measurement, mappedFrame, 0)}`);
        }
        return Object.freeze({ pose, propId: support.surface.id, phase, transitionValidated: true,
          hipsWorldCorrection: 0, measurement });
      }
      if (pose === 'soak' || pose === 'wash') solveHostFeet?.(support.surface);
      let correctionTotal = 0;
      let correctionMagnitude = 0;
      let measurement = measure(support.surface, sampleParentLocalContacts);
      if (pose === 'lie' || pose === 'soak') {
        for (let pass = 0; pass < MAX_CORRECTION_PASSES; pass++) {
          let shift: number;
          try { shift = correctionIntoContactBand(pose, measurement); }
          catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)}; evidence=${evidence(support.surface, measurement, mappedFrame, correctionTotal)}`); }
          if (Math.abs(shift) <= 0.0002) break;
          const remaining = MAX_HIPS_CORRECTION_METRES - correctionMagnitude;
          if (remaining <= 0.0002 || Math.abs(shift) > remaining + 1e-6) {
            throw new Error(`Native ${pose} posterior contact exceeds the bounded pelvis correction; requestedShift=${shift}, remainingCorrection=${remaining}; evidence=${evidence(support.surface, measurement, mappedFrame, correctionTotal)}`);
          }
          shiftHipsWorldY(shift);
          correctionTotal += shift;
          correctionMagnitude += Math.abs(shift);
          if (pose === 'soak') solveHostFeet?.(support.surface);
          measurement = measure(support.surface, sampleParentLocalContacts);
        }
      }
      if (!measurement.supported) throw new Error(`Native ${pose} contact failed: ${measurement.reason ?? 'host surface is not supported'}; evidence=${evidence(support.surface, measurement, mappedFrame, correctionTotal)}`);
      return Object.freeze({ pose, propId: support.surface.id, phase, transitionValidated: false,
        hipsWorldCorrection: correctionTotal, measurement });
    },
    dispose() { disposed = true; active = null; },
  };
}
