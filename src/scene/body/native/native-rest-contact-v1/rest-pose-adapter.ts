import * as THREE from 'three';
import type { FootContact } from '../../foot-contact.ts';
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
}

export interface NativeRestPoseResult {
  readonly pose: NativeRestPose;
  readonly propId: string;
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
  if (minimumShift > maximumShift) throw new Error(`Native ${pose} prop profile cannot support the sampled posterior regions with one pelvis correction`);
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
    apply(pose, support, applyMappedSourceFrame, sampleParentLocalContacts, solveHostFeet) {
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
      if (pose === 'soak' || pose === 'wash') solveHostFeet?.(support.surface);
      let correctionTotal = 0;
      let correctionMagnitude = 0;
      let measurement = measure(support.surface, sampleParentLocalContacts);
      if (pose === 'lie' || pose === 'soak') {
        for (let pass = 0; pass < MAX_CORRECTION_PASSES; pass++) {
          const shift = correctionIntoContactBand(pose, measurement);
          if (Math.abs(shift) <= 0.0002) break;
          const remaining = MAX_HIPS_CORRECTION_METRES - correctionMagnitude;
          if (remaining <= 0.0002 || Math.abs(shift) > remaining + 1e-6) {
            throw new Error(`Native ${pose} posterior contact exceeds the bounded pelvis correction`);
          }
          shiftHipsWorldY(shift);
          correctionTotal += shift;
          correctionMagnitude += Math.abs(shift);
          if (pose === 'soak') solveHostFeet?.(support.surface);
          measurement = measure(support.surface, sampleParentLocalContacts);
        }
      }
      if (!measurement.supported) throw new Error(`Native ${pose} contact failed: ${measurement.reason ?? 'host surface is not supported'}`);
      return Object.freeze({ pose, propId: support.surface.id,
        hipsWorldCorrection: correctionTotal, measurement });
    },
    dispose() { disposed = true; active = null; },
  };
}
