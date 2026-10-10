import * as THREE from 'three';
import type { FootContact, FootSolveResult } from '../../foot-contact.ts';
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
    solveHostFeet?: (surface: NativeRestPropSurface, floorY?: number) => FootSolveResult | void,
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
const MAX_UPRIGHT_LIFT_SOLVES = 4;
const MAX_LIE_SPINE_ALIGNMENT_DEGREES = 12;
const MAX_LIE_NECK_ALIGNMENT_DEGREES = 25;
const MAX_LIE_HIPS_TILT_DEGREES = 90;

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

interface BonePoseState {
  readonly bone: THREE.Bone;
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
  readonly scale: THREE.Vector3;
}

function captureBonePose(root: THREE.Object3D): readonly BonePoseState[] {
  const pose: BonePoseState[] = [];
  root.traverse((node) => {
    if (node instanceof THREE.Bone) pose.push({ bone: node, position: node.position.clone(),
      quaternion: node.quaternion.clone(), scale: node.scale.clone() });
  });
  return Object.freeze(pose);
}

function restoreBonePose(pose: readonly BonePoseState[], root: THREE.Object3D): void {
  for (const saved of pose) {
    saved.bone.position.copy(saved.position);
    saved.bone.quaternion.copy(saved.quaternion);
    saved.bone.scale.copy(saved.scale);
  }
  root.updateWorldMatrix(true, false);
  root.updateMatrixWorld(true);
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

function lieBackInterval(measure: NativeRestContactMeasure): readonly [number, number] | null {
  const gaps = [measure.regions['pelvis-back'].minimumGap, measure.regions['torso-back'].minimumGap];
  if (gaps.some((gap) => !Number.isFinite(gap))) return null;
  const minimumShift = Math.max(...gaps.map((gap) => -MAX_PENETRATION_METRES - gap));
  const maximumShift = Math.min(...gaps.map((gap) => CONTACT_TARGET_GAP_METRES - gap));
  return minimumShift <= maximumShift ? [minimumShift, maximumShift] : null;
}

function rootCorrectionFor(pose: NativeRestPose, measure: NativeRestContactMeasure): number | null {
  const interval = correctionInterval(pose, measure);
  if (!interval) return null;
  return THREE.MathUtils.clamp(0, interval[0], interval[1]);
}

function washHeadCorrection(
  root: THREE.Group,
  surface: NativeRestPropSurface,
  blend: number,
  sampleContacts: () => readonly FootContact[],
  requireHeadZone: boolean,
  probe: NativeRestContactProbe,
): readonly [number, number] {
  const zone = surface.headZone;
  const anchor = zone?.anchorWorld?.();
  const head = root.getObjectByName('mixamorigHead');
  if (!zone || !anchor || !(head instanceof THREE.Bone)) {
    throw new Error('Native wash requires an exact host showerhead world anchor and mapped head bone');
  }
  if (!anchor.every(Number.isFinite)) throw new Error('Native wash showerhead anchor is non-finite');
  root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
  const initialHead = head.getWorldPosition(new THREE.Vector3());
  const fullDx = anchor[0] - initialHead.x, fullDz = anchor[2] - initialHead.z;
  if (Math.hypot(fullDx, fullDz) > MAX_REST_ROOT_SHIFT_METRES) {
    throw new Error(`Native wash head anchor correction is outside measured bounds: ${JSON.stringify([fullDx, fullDz])}`);
  }
  const rootStart = root.getWorldPosition(new THREE.Vector3());
  const startLocal = root.position.clone();
  function setFraction(fraction: number): void {
    const target = rootStart.clone();
    target.x += fullDx * fraction; target.z += fullDz * fraction;
    if (root.parent) {
      root.parent.updateWorldMatrix(true, false);
      root.parent.worldToLocal(target);
    }
    root.position.copy(target);
    root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
  }
  function feasible(fraction: number, needZone: boolean): boolean {
    setFraction(fraction);
    const result = probe.sample(surface, worldContacts(root, sampleContacts()));
    if (needZone && result.headInZone !== true) return false;
    if (result.footGaps.left.sampled === 0 || result.footGaps.right.sampled === 0
      || result.footGaps.left.minimumGap < -MAX_PENETRATION_METRES
      || result.footGaps.right.minimumGap < -MAX_PENETRATION_METRES) return false;
    const world = worldContacts(root, sampleContacts());
    return world.every((contact) => surface.surfaceYAt(contact.x, contact.z) !== null);
  }
  const maximumFraction = blend;
  const samples = Math.max(1, Math.ceil(maximumFraction * 128));
  let lastSafe = 0;
  let selected: number | null = null;
  let preceding = 0;
  for (let index = 0; index <= samples; index++) {
    const fraction = maximumFraction * index / samples;
    const safe = feasible(fraction, false);
    if (!safe) continue;
    lastSafe = fraction;
    if (feasible(fraction, true)) { selected = fraction; preceding = index ? maximumFraction * (index - 1) / samples : 0; break; }
  }
  if (selected === null) {
    if (requireHeadZone) {
      root.position.copy(startLocal); root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
      throw new Error(`Native wash cannot place the mapped head inside the source zone without losing actual shower-foot support (safeFraction=${lastSafe}, blend=${blend})`);
    }
    // Early transition frames may not have reached the source zone yet. Move only as
    // far as sampled foot support remains complete, then let the next frame continue.
    selected = lastSafe;
  } else {
    let low = preceding, high = selected;
    for (let step = 0; step < 16 && high - low > 1e-5; step++) {
      const middle = (low + high) * 0.5;
      if (feasible(middle, true)) high = middle; else low = middle;
    }
    selected = high;
    const directionLength = Math.hypot(fullDx, fullDz);
    const insetFraction = directionLength > 0 ? Math.min(maximumFraction - selected, 0.002 / directionLength) : 0;
    if (insetFraction > 0 && feasible(selected + insetFraction, true)) selected += insetFraction;
    else if (requireHeadZone && insetFraction > 0) {
      root.position.copy(startLocal); root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
      throw new Error('Native wash head-zone placement has no 2 mm inward margin with complete shower-foot support');
    }
  }
  setFraction(selected);
  const end = root.getWorldPosition(new THREE.Vector3());
  return Object.freeze([end.x - rootStart.x, end.z - rootStart.z] as const);
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
  // Rest-bend candidates are cached per registered prop and revalidated against each
  // newly mapped frame before reuse. This keeps repeated rest updates out of the search.
  const lieAlignmentCache = new Map<string, { hips: number; spine: number; neck: number }>();
  let lastLiftTrial: Readonly<Record<string, unknown>> | null = null;

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
    return JSON.stringify({ propId: surface.id, pose: surface.pose, mappedFrame, rootWorldCorrection: correction, measurement: measure, liftTrial: lastLiftTrial });
  }

  function liftTrialSnapshot(floorY: number, measure: NativeRestContactMeasure,
    sampleContacts: () => readonly FootContact[], footSolveResult?: FootSolveResult): Readonly<Record<string, unknown>> {
    root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
    const bones = ['mixamorigHips', 'mixamorigLeftUpLeg', 'mixamorigLeftLeg', 'mixamorigLeftFoot',
      'mixamorigRightUpLeg', 'mixamorigRightLeg', 'mixamorigRightFoot'];
    const positions = new Map<string, THREE.Vector3>();
    for (const name of bones) {
      const bone = root.getObjectByName(name);
      if (bone instanceof THREE.Bone) positions.set(name, bone.getWorldPosition(new THREE.Vector3()));
    }
    const segmentLengths = (side: 'Left' | 'Right') => {
      const hip = positions.get(`mixamorig${side}UpLeg`), knee = positions.get(`mixamorig${side}Leg`), ankle = positions.get(`mixamorig${side}Foot`);
      return hip && knee && ankle ? Object.freeze({ upper: hip.distanceTo(knee), lower: knee.distanceTo(ankle) }) : null;
    };
    const footGaps = new Map<'left' | 'right', number[]>();
    for (const contact of worldContacts(root, sampleContacts())) {
      const gaps = footGaps.get(contact.side) ?? [];
      gaps.push(...(contact.points ?? [contact]).map((point) => point.y - floorY));
      footGaps.set(contact.side, gaps);
    }
    const feet = Object.fromEntries((['left', 'right'] as const).map((side) => {
      const gaps = footGaps.get(side) ?? [];
      return [side, Object.freeze({ sampled: gaps.length,
        minimumGap: gaps.length ? Math.min(...gaps) : null,
        maximumGap: gaps.length ? Math.max(...gaps) : null,
        withinFourMillimetres: gaps.filter((gap) => Math.abs(gap) <= MAX_PENETRATION_METRES).length })];
    }));
    const solve = footSolveResult ? Object.freeze({ corrected: footSolveResult.corrected,
      maxError: footSolveResult.maxError, limited: footSolveResult.limited,
      ...('diagnostics' in footSolveResult ? { diagnostics: footSolveResult.diagnostics } : {}) }) : null;
    return Object.freeze({ floorY, rootWorld: Object.freeze(root.getWorldPosition(new THREE.Vector3()).toArray()),
      hipsWorld: positions.get('mixamorigHips')?.toArray() ?? null,
      segmentLengths: Object.freeze({ left: segmentLengths('Left'), right: segmentLengths('Right') }),
      regions: Object.freeze(Object.fromEntries(Object.entries(measure.regions).map(([name, region]) =>
        [name, Object.freeze({ sampled: region.sampled, minimumGap: region.minimumGap, maximumGap: region.maximumGap,
          minimumWitness: region.minimumWitness, maximumWitness: region.maximumWitness })]))),
      feet: Object.freeze(feet), footSolveResult: solve });
  }

  function compactTrialSnapshot(snapshot: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    const solve = snapshot.footSolveResult as FootSolveResult | null;
    return Object.freeze({ floorY: snapshot.floorY, rootWorld: snapshot.rootWorld, hipsWorld: snapshot.hipsWorld,
      segmentLengths: snapshot.segmentLengths, regions: snapshot.regions, feet: snapshot.feet,
      footSolveResult: solve ? Object.freeze({ corrected: solve.corrected, maxError: solve.maxError, limited: solve.limited }) : null });
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

  function alignFeetToProp(
    surface: NativeRestPropSurface,
    sampleContacts: () => readonly FootContact[],
    maximumShift: number,
  ): readonly [number, number] {
    if (!Number.isFinite(maximumShift) || maximumShift < 0 || maximumShift > MAX_REST_ROOT_SHIFT_METRES) {
      throw new Error('Native prop foot alignment has an invalid measured shift bound');
    }
    root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
    const rootStart = root.getWorldPosition(new THREE.Vector3());
    const localStart = root.position.clone();
    const parent = root.parent;
    function setOffset(dx: number, dz: number): void {
      const target = rootStart.clone().add(new THREE.Vector3(dx, 0, dz));
      if (parent) {
        parent.updateWorldMatrix(true, false);
        parent.worldToLocal(target);
      }
      root.position.copy(target);
      root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
    }
    function supported(dx: number, dz: number): boolean {
      setOffset(dx, dz);
      const contacts = worldContacts(root, sampleContacts());
      const sides = new Set(contacts.map((contact) => contact.side));
      return sides.has('left') && sides.has('right') && contacts.every((contact) => {
        const y = surface.surfaceYAt(contact.x, contact.z);
        return y !== null && Number.isFinite(y);
      });
    }
    const step = 0.04;
    const cells = Math.floor(maximumShift / step);
    const candidates: Array<readonly [number, number]> = [];
    for (let x = -cells; x <= cells; x++) for (let z = -cells; z <= cells; z++) {
      const dx = x * step, dz = z * step;
      if (Math.hypot(dx, dz) <= maximumShift + 1e-9) candidates.push([dx, dz]);
    }
    candidates.sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2);
    let selected: readonly [number, number] | null = null;
    for (const candidate of candidates) {
      if (supported(candidate[0], candidate[1])) { selected = candidate; break; }
    }
    if (selected) {
      let resolution = step * 0.5;
      for (let pass = 0; pass < 3; pass++, resolution *= 0.5) {
        const around = [-1, 0, 1].flatMap((x) => [-1, 0, 1].map((z) => [selected![0] + x * resolution, selected![1] + z * resolution] as const))
          .filter(([x, z]) => Math.hypot(x, z) <= maximumShift + 1e-9)
          .sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2);
        const refined = around.find(([x, z]) => supported(x, z));
        if (refined) selected = refined;
      }
    }
    if (!selected) {
      root.position.copy(localStart); root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
      throw new Error(`Native ${surface.pose} cannot place both actual shoe contact centers over the measured prop surface within ${maximumShift} m`);
    }
    setOffset(selected[0], selected[1]);
    const end = root.getWorldPosition(new THREE.Vector3());
    return Object.freeze([end.x - rootStart.x, end.z - rootStart.z] as const);
  }

  function alignLieSpine(
    surface: NativeRestPropSurface,
    sampleContacts: () => readonly FootContact[],
    initial: NativeRestContactMeasure,
    blend = 1,
  ): NativeRestContactMeasure {
    const supportedAfterAnchor = (candidate: NativeRestContactMeasure): boolean => {
      // An unaligned source frame can miss the mattress. It is an invalid search candidate;
      // rotate the body and remeasure before requiring final finite prop witnesses.
      if (!(['pelvis-back', 'torso-back', 'head-back'] as const).every((region) =>
        Number.isFinite(candidate.regions[region].minimumGap))) return false;
      const interval = correctionInterval('lie', candidate);
      if (!interval) return false;
      // The shape search produces an unanchored pose. Test the exact bounded root
      // correction on a temporary transform, then restore it; requiring `supported`
      // before this correction rejects every candidate whose pelvis starts outside
      // the prop band. The caller later applies this same correction and remeasures.
      if (blend < 1) return true;
      const correction = rootCorrectionFor('lie', candidate);
      if (correction === null || Math.abs(correction) > MAX_REST_ROOT_SHIFT_METRES) return false;
      const rootLocal = root.position.clone();
      try {
        if (Math.abs(correction) > 0) shiftRootWorldY(correction);
        const anchored = measure(surface, sampleContacts);
        return anchored.supported && Boolean(correctionInterval('lie', anchored));
      } finally {
        root.position.copy(rootLocal);
        root.updateWorldMatrix(true, false);
        root.updateMatrixWorld(true);
      }
    };
    const fitted = (candidate: NativeRestContactMeasure): boolean => supportedAfterAnchor(candidate);
    if (fitted(initial)) return initial;
    const spine = root.getObjectByName('mixamorigSpine');
    const neck = root.getObjectByName('mixamorigNeck');
    if (!(spine instanceof THREE.Bone) || !spine.parent || !(neck instanceof THREE.Bone) || !neck.parent) {
      throw new Error('Native lie needs mapped spine and neck bones for measured alignment');
    }
    const spineBone: THREE.Bone = spine;
    const neckBone: THREE.Bone = neck;
    const originalSpine = spine.quaternion.clone();
    const originalNeck = neck.quaternion.clone();
    const rootRight = new THREE.Vector3(1, 0, 0).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const coarseAngles = (maximum: number, step: number): number[] => {
      const values = [0];
      for (let angle = step; angle < maximum; angle += step) values.push(angle, -angle);
      if (values.every((value) => Math.abs(value) < maximum)) values.push(maximum, -maximum);
      return values;
    };
    function setWorldBend(bone: THREE.Bone, original: THREE.Quaternion, angleDegrees: number): void {
      const parentQ = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
      const localDelta = parentQ.clone().invert()
        .multiply(new THREE.Quaternion().setFromAxisAngle(rootRight, angleDegrees * Math.PI / 180))
        .multiply(parentQ);
      bone.quaternion.copy(localDelta.multiply(original)).normalize();
      root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
    }
    const originalHips = hips.quaternion.clone();
    let lastCandidate: NativeRestContactMeasure | null = null;
    // Read callback-updated state through a function so TypeScript's control-flow
    // analysis does not treat the closure assignment as unreachable after tryAngles.
    function latestCandidate(): NativeRestContactMeasure | null { return lastCandidate; }
    function tryAngles(hipsAngle: number, spineAngle: number, neckAngle: number): NativeRestContactMeasure | null {
      hips.quaternion.copy(originalHips);
      spineBone.quaternion.copy(originalSpine);
      neckBone.quaternion.copy(originalNeck);
      setWorldBend(hips, originalHips, hipsAngle * blend);
      setWorldBend(spineBone, originalSpine, spineAngle * blend);
      setWorldBend(neckBone, originalNeck, neckAngle * blend);
      const diagnostics = root.userData.nativeRestProbeDiagnostics as { searchCandidates?: number } | undefined;
      if (diagnostics) diagnostics.searchCandidates = (diagnostics.searchCandidates ?? 0) + 1;
      const candidate = measure(surface, sampleContacts);
      lastCandidate = candidate;
      if (!lieBackInterval(candidate) || !fitted(candidate)) return null;
      lieAlignmentCache.set(surface.id, { hips: hipsAngle, spine: spineAngle, neck: neckAngle });
      if (lieAlignmentCache.size > 8) lieAlignmentCache.delete(lieAlignmentCache.keys().next().value!);
      return candidate;
    }

    const cached = lieAlignmentCache.get(surface.id);
    if (cached) {
      const reused = tryAngles(cached.hips, cached.spine, cached.neck);
      if (reused) return reused;
      lieAlignmentCache.delete(surface.id);
    }

    // Estimate the Hips world bend that makes the mapped head-to-hip vector
    // horizontal in the actor's forward/vertical plane. Test the estimate and a
    // narrow neighborhood against actual sampled prop geometry and the exact root
    // anchor before falling back to the bounded coarse search.
    root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
    const rootQuaternion = root.getWorldQuaternion(new THREE.Quaternion());
    const rootForward = new THREE.Vector3(0, 0, 1).applyQuaternion(rootQuaternion);
    rootForward.addScaledVector(rootRight, -rootForward.dot(rootRight)).normalize();
    const mappedHips = hips.getWorldPosition(new THREE.Vector3());
    const mappedHead = root.getObjectByName('mixamorigHead')?.getWorldPosition(new THREE.Vector3());
    if (mappedHead) {
      const headToHip = mappedHead.sub(mappedHips);
      const projectedForward = headToHip.dot(rootForward);
      const rawHipsAngle = THREE.MathUtils.radToDeg(Math.atan2(headToHip.y, projectedForward));
      // A rearward head vector has the same horizontal axis at angle +/-180.
      // Choose the shortest bend before applying the bound, rather than flipping it forward.
      const shortestHipsAngle = rawHipsAngle > 90 ? rawHipsAngle - 180
        : rawHipsAngle < -90 ? rawHipsAngle + 180 : rawHipsAngle;
      const analyticHipsAngle = THREE.MathUtils.clamp(
        shortestHipsAngle, -MAX_LIE_HIPS_TILT_DEGREES, MAX_LIE_HIPS_TILT_DEGREES,
      );
      for (const offset of [0, 1, -1, 2, -2]) {
        const candidate = tryAngles(analyticHipsAngle + offset, 0, 0);
        if (candidate) return candidate;
      }
    }

    // Coarse coupled search remains the fallback. A successful sampled candidate is
    // cached and revalidated at each subsequent mapped frame, including transitions.
    for (const spineAngle of coarseAngles(MAX_LIE_SPINE_ALIGNMENT_DEGREES, 2)) {
      for (const neckAngle of coarseAngles(MAX_LIE_NECK_ALIGNMENT_DEGREES, 5)) {
        const candidate = tryAngles(0, spineAngle, neckAngle);
        if (candidate) return candidate;
      }
    }
    // Some released source clips map to an upright torso even for the named lie pose.
    // A pelvis/torso translation then cannot close the measured bed interval: the pelvis
    // is already inside the mattress while the torso and head remain far above it. Test a
    // whole-skeleton tilt at the Hips joint (the root of the articulated rig) before
    // rejecting. This preserves the actor root/yaw and every segment length; subsequent
    // measurements still enforce pelvis, torso, head-clearance and penetration limits.
    // Only test coupled spine/neck refinements for hips tilts that bring the back
    // into the measured contact interval. 10-degree hips steps cap this branch at
    // 19 * 5 * 7 = 665 candidates rather than the former tens of thousands.
    for (const hipsAngle of coarseAngles(MAX_LIE_HIPS_TILT_DEGREES, 10)) {
      if (hipsAngle === 0) continue;
      const base = tryAngles(hipsAngle, 0, 0);
      if (base) return base;
      const baseMeasure = latestCandidate();
      if (!baseMeasure || !lieBackInterval(baseMeasure)) continue;
      for (const spineAngle of coarseAngles(MAX_LIE_SPINE_ALIGNMENT_DEGREES, 6)) {
        for (const neckAngle of coarseAngles(MAX_LIE_NECK_ALIGNMENT_DEGREES, 10)) {
          const candidate = tryAngles(hipsAngle, spineAngle, neckAngle);
          if (candidate) return candidate;
        }
      }
    }
    hips.quaternion.copy(originalHips);
    spine.quaternion.copy(originalSpine);
    neck.quaternion.copy(originalNeck);
    root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
    if (blend < 1) return measure(surface, sampleContacts);
    throw new Error(`Native lie cannot fit pelvis/torso contact plus head clearance using combined spine (${MAX_LIE_SPINE_ALIGNMENT_DEGREES}°), neck (${MAX_LIE_NECK_ALIGNMENT_DEGREES}°), and Hips-root tilt (${MAX_LIE_HIPS_TILT_DEGREES}°) alignment`);
  }

  function measure(surface: NativeRestPropSurface, sampleContacts: () => readonly FootContact[]): NativeRestContactMeasure {
    const contacts = worldContacts(root, sampleContacts());
    const diagnostics = root.userData.nativeRestProbeDiagnostics as {
      probeCalls?: number; probeDurationMs?: number; maximumProbeMs?: number; surfaceQueries?: number;
    } | undefined;
    if (!diagnostics) return probe.sample(surface, contacts);
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const result = probe.sample(surface, contacts);
    const elapsedMs = Math.max(0, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt);
    const queriedVertices = (Object.values(result.regions) as NativeRestContactMeasure['regions'][keyof NativeRestContactMeasure['regions']][])
      .reduce((total, region) => total + region.sampled + region.supportMisses, 0);
    const queriedFeet = contacts.reduce((total, contact) => total + (contact.points?.length ?? 1), 0);
    diagnostics.probeCalls = (diagnostics.probeCalls ?? 0) + 1;
    diagnostics.probeDurationMs = (diagnostics.probeDurationMs ?? 0) + elapsedMs;
    diagnostics.maximumProbeMs = Math.max(diagnostics.maximumProbeMs ?? 0, elapsedMs);
    diagnostics.surfaceQueries = (diagnostics.surfaceQueries ?? 0) + queriedVertices + queriedFeet;
    return result;
  }

  function egressUprightLieFromProp(
    surface: NativeRestPropSurface,
    floorY: number,
    sampleContacts: () => readonly FootContact[],
    solveHostFeet: ((surface: NativeRestPropSurface, floorY?: number) => FootSolveResult | void) | undefined,
    mappedBones: readonly BonePoseState[],
    mappedRootLocal: THREE.Vector3,
    mappedRootWorld: THREE.Vector3,
    mappedFrame: Readonly<Record<string, unknown>>,
    phase: 'still' | 'transition',
    anchorBlend: number,
  ): readonly [number, number] {
    const parent = root.parent;
    function setOffset(dx: number, dz: number): void {
      const target = mappedRootWorld.clone().add(new THREE.Vector3(dx, 0, dz));
      if (parent) { parent.updateWorldMatrix(true, false); parent.worldToLocal(target); }
      root.position.copy(target);
      root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
    }
    function bodyClear(measurement: NativeRestContactMeasure): boolean {
      return (['pelvis-back', 'torso-back', 'head-back'] as const).every((region) => {
        const sample = measurement.regions[region];
        return sample.sampled === 0 || (Number.isFinite(sample.minimumGap) && sample.minimumGap >= -MAX_PENETRATION_METRES);
      });
    }
    function feetPlanted(): boolean {
      const contacts = worldContacts(root, sampleContacts()).flatMap((contact) => contact.points ?? [contact]);
      const gaps = contacts.map((contact) => contact.y - floorY);
      return gaps.length > 0 && gaps.every((gap) => Number.isFinite(gap) && gap >= -MAX_PENETRATION_METRES)
        && gaps.some((gap) => Math.abs(gap) <= MAX_PENETRATION_METRES);
    }
    function restoreMappedPose(): void {
      restoreBonePose(mappedBones, root);
      root.position.copy(mappedRootLocal);
      root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
    }
    function safeTrialSnapshot(measurement: NativeRestContactMeasure): Readonly<Record<string, unknown>> {
      try { return liftTrialSnapshot(floorY, measurement, sampleContacts); }
      catch (error) { return Object.freeze({ snapshotError: error instanceof Error ? error.message : String(error) }); }
    }
    const step = 0.08;
    const cells = Math.floor(MAX_REST_ROOT_SHIFT_METRES / step);
    const candidates: Array<readonly [number, number]> = [];
    for (let x = -cells; x <= cells; x++) for (let z = -cells; z <= cells; z++) {
      const dx = x * step, dz = z * step;
      if ((dx !== 0 || dz !== 0) && Math.hypot(dx, dz) <= MAX_REST_ROOT_SHIFT_METRES + 1e-9) candidates.push([dx, dz]);
    }
    candidates.sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2);
    const attempts: Readonly<Record<string, unknown>>[] = [];
    let lastSolverError: unknown;
    let hadSolverError = false;
    for (const [dx, dz] of candidates) {
      restoreMappedPose();
      setOffset(dx, dz);
      let candidate = measure(surface, sampleContacts);
      const bodyClearBeforeSolve = bodyClear(candidate);
      if (!bodyClearBeforeSolve) {
        attempts.push(Object.freeze({ dx, dz, bodyClearBeforeSolve,
          before: compactTrialSnapshot(liftTrialSnapshot(floorY, candidate, sampleContacts)), accepted: false }));
        continue;
      }
      const before = compactTrialSnapshot(liftTrialSnapshot(floorY, candidate, sampleContacts));
      // Mapped entry frames can have floating soles before IK. For each offset
      // whose actual posterior samples clear the bed, run the unchanged bounded
      // host solver and judge the resulting body and sole samples afterward.
      let footSolveResult: FootSolveResult | void;
      let planted: boolean;
      try {
        footSolveResult = solveHostFeet?.(surface, floorY);
        candidate = measure(surface, sampleContacts);
        planted = feetPlanted();
      } catch (error) {
        let failedMeasurement = candidate;
        let measurementError: string | undefined;
        try { failedMeasurement = measure(surface, sampleContacts); }
        catch (measureError) { measurementError = measureError instanceof Error ? measureError.message : String(measureError); }
        attempts.push(Object.freeze({ dx, dz, bodyClearBeforeSolve,
          before,
          after: compactTrialSnapshot(safeTrialSnapshot(failedMeasurement)), accepted: false,
          solverError: error instanceof Error ? error.message : String(error),
          ...(measurementError ? { measurementError } : {}) }));
        lastSolverError = error;
        hadSolverError = true;
        restoreMappedPose();
        continue;
      }
      const clear = bodyClear(candidate);
      attempts.push(Object.freeze({ dx, dz, bodyClearBeforeSolve,
        before,
        after: compactTrialSnapshot(liftTrialSnapshot(floorY, candidate, sampleContacts,
          footSolveResult && typeof footSolveResult === 'object' ? footSolveResult : undefined)),
        bodyRegionsClear: clear, floorFeetClearAndPlanted: planted, accepted: clear && planted }));
      if (clear && planted) {
        const end = root.getWorldPosition(new THREE.Vector3());
        lastLiftTrial = Object.freeze({ propId: surface.id, pose: surface.pose, phase, anchorBlend,
          mappedFrame, search: 'upright-lie-xz-egress', attempts: Object.freeze(attempts), accepted: true,
          selectedOffset: Object.freeze([dx, dz]) });
        const diagnostics = root.userData.nativeRestProbeDiagnostics;
        if (root.userData.nativeRestDiagnosticsEnabled === true && diagnostics && typeof diagnostics === 'object') {
          diagnostics.liftTrial = lastLiftTrial;
        }
        return Object.freeze([end.x - mappedRootWorld.x, end.z - mappedRootWorld.z] as const);
      }
      restoreMappedPose();
    }
    restoreMappedPose();
    lastLiftTrial = Object.freeze({ propId: surface.id, pose: surface.pose, phase, anchorBlend,
      mappedFrame, search: 'upright-lie-xz-egress', attempts: Object.freeze(attempts), accepted: false,
      ...(hadSolverError ? { solverError: lastSolverError instanceof Error ? lastSolverError.message : String(lastSolverError) } : {}) });
    const diagnostics = root.userData.nativeRestProbeDiagnostics;
    if (root.userData.nativeRestDiagnosticsEnabled === true && diagnostics && typeof diagnostics === 'object') {
      diagnostics.liftTrial = lastLiftTrial;
    }
    if (hadSolverError) throw lastSolverError;
    // A mapped partial-lie frame may still intersect the mattress at every
    // bounded XZ offset. Callers can record this pre-lift search and then try
    // the independent bounded vertical solver from the immutable mapped pose.
    return Object.freeze([0, 0] as const);
  }

  function minimumNonpenetratingLift(measurement: NativeRestContactMeasure): number {
    const gaps = (Object.values(measurement.regions) as NativeRestContactMeasure['regions'][keyof NativeRestContactMeasure['regions']][])
      .filter((region) => region.sampled > 0).map((region) => region.minimumGap);
    if (!gaps.length || gaps.some((gap) => !Number.isFinite(gap))) {
      throw new Error(`Native ${measurement.pose} has no finite prop-clearance samples`);
    }
    return Math.max(0, ...gaps.map((gap) => -0.003 - gap));
  }

  function bodyRegionsClear(measurement: NativeRestContactMeasure): boolean {
    return (['pelvis-back', 'torso-back', 'head-back'] as const).every((region) => {
      const sample = measurement.regions[region];
      return sample.sampled === 0 || (Number.isFinite(sample.minimumGap) && sample.minimumGap >= -MAX_PENETRATION_METRES);
    });
  }

  function floorFeetClearAndPlanted(floorY: number, sampleContacts: () => readonly FootContact[]): boolean {
    const contacts = worldContacts(root, sampleContacts()).flatMap((contact) => contact.points ?? [contact]);
    const gaps = contacts.map((contact) => contact.y - floorY);
    return gaps.length > 0 && gaps.every((gap) => Number.isFinite(gap) && gap >= -MAX_PENETRATION_METRES)
      && gaps.some((gap) => Math.abs(gap) <= MAX_PENETRATION_METRES);
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
      lastLiftTrial = null;
      if (disposed) throw new Error('Native rest adapter is disposed');
      // Opt-in, bounded last-apply diagnostics for remote performance reports. This
      // replaces one fixed-size object per call and is absent from normal runtime/UI.
      if (root.userData.nativeRestDiagnosticsEnabled === true) {
        root.userData.nativeRestProbeDiagnostics = {
          pose, probeCalls: 0, probeDurationMs: 0, maximumProbeMs: 0,
          surfaceQueries: 0, searchCandidates: 0,
          candidateVertices: probe.metrics.candidateVertices, capPerRegion: probe.metrics.capPerRegion,
        };
      }
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
        const hasPosteriorWitness = (['pelvis-back', 'torso-back', 'head-back'] as const).every((region) =>
          measurement.regions[region].sampled > 0 && Number.isFinite(measurement.regions[region].minimumGap));
        const propContactPhase = pose === 'lie' ? !upright && hasPosteriorWitness
          : pose === 'soak' ? !upright && anchorBlend >= 0.75 : anchorBlend >= 0.75;
        // Until the body actually reaches the prop, the floor still owns its planted foot.
        const floorContactPhase = upright || (pose === 'lie' && !propContactPhase);
        const mappedContactBones = pose === 'lie' && floorContactPhase ? captureBonePose(root) : Object.freeze([]);
        const mappedContactRootLocal = root.position.clone();
        root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
        const mappedContactRootWorld = root.getWorldPosition(new THREE.Vector3());
        let attemptedMappedEgress = false;
        if (floorContactPhase) {
          // The mapped upright/partial-lie frame can place the clothed posterior
          // through the mattress even when its Hips joint is at the bed surface.
          // Measure once before solving feet. If a vertical lift is needed, each
          // bounded candidate starts from this exact mapped bone pose and runs
          // floor IK once; repeated solves on an already-IK'd pose compound limb
          // changes and can move the clothed pelvis after the prior measurement.
          const needsLift = pose === 'lie' && (['pelvis-back', 'torso-back', 'head-back'] as const).some((region) => {
            const sample = measurement.regions[region];
            return sample.sampled > 0 && sample.minimumGap < -MAX_PENETRATION_METRES;
          });
          if (!needsLift) {
            solveHostFeet?.(support.surface, floorY!);
            measurement = measure(support.surface, sampleParentLocalContacts);
          } else {
            const rootLocal = mappedContactRootLocal.clone();
            const mappedBones = mappedContactBones;
            // Test the bounded horizontal egress from the exact mapped pose
            // before a vertical trial consumes the frame's pelvis budget.
            // If no horizontal candidate clears measured body and sole gates,
            // retain that evidence and continue with the existing lift solver.
            attemptedMappedEgress = true;
            let mappedEgressError: string | undefined;
            try {
              appliedRootCorrectionXZ = egressUprightLieFromProp(
                support.surface, floorY!, sampleParentLocalContacts, solveHostFeet,
                mappedContactBones, mappedContactRootLocal, mappedContactRootWorld,
                mappedFrame, phase, anchorBlend,
              );
            } catch (error) {
              mappedEgressError = error instanceof Error ? error.message : String(error);
            }
            const mappedEgressTrial = lastLiftTrial as Readonly<Record<string, unknown>> | null;
            const mappedEgressAccepted = mappedEgressTrial?.accepted === true;
            if (mappedEgressAccepted) measurement = measure(support.surface, sampleParentLocalContacts);
            const attempts: Readonly<Record<string, unknown>>[] = [];
            let cumulativeLift = 0;
            let trialMeasurement = measurement;
            let trialFeetPlanted = mappedEgressAccepted;
            let accepted = mappedEgressAccepted;
            for (let pass = 0; !accepted && pass < MAX_UPRIGHT_LIFT_SOLVES; pass++) {
              const requiredLift = minimumNonpenetratingLift(trialMeasurement);
              const targetLift = pass === 0 ? requiredLift : cumulativeLift + requiredLift;
              if (!(requiredLift > 0) || targetLift > MAX_REST_ROOT_SHIFT_METRES) break;
              restoreBonePose(mappedBones, root);
              root.position.copy(rootLocal);
              root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
              shiftRootWorldY(targetLift);
              const preSolveMeasurement = measure(support.surface, sampleParentLocalContacts);
              const before = liftTrialSnapshot(floorY!, preSolveMeasurement, sampleParentLocalContacts);
              let footSolveResult: FootSolveResult | void;
              try {
                footSolveResult = solveHostFeet?.(support.surface, floorY!);
              } catch (error) {
                const failedMeasurement = measure(support.surface, sampleParentLocalContacts);
                const failed = liftTrialSnapshot(floorY!, failedMeasurement, sampleParentLocalContacts);
                attempts.push(Object.freeze({ requestedLift: targetLift - cumulativeLift, cumulativeLift: targetLift,
                  before, after: failed, solverError: error instanceof Error ? error.message : String(error),
                  bodyRegionsClear: bodyRegionsClear(failedMeasurement), floorFeetClearAndPlanted: floorFeetClearAndPlanted(floorY!, sampleParentLocalContacts) }));
                lastLiftTrial = Object.freeze({ propId: support.surface.id, pose, phase, anchorBlend,
                  mappedFrame, attempts: Object.freeze(attempts), cumulativeLift: targetLift,
                  accepted: false, solverError: error instanceof Error ? error.message : String(error),
                  mappedPoseEgress: mappedEgressTrial, ...(mappedEgressError ? { mappedPoseEgressError: mappedEgressError } : {}) });
                const diagnostics = root.userData.nativeRestProbeDiagnostics;
                if (root.userData.nativeRestDiagnosticsEnabled === true && diagnostics && typeof diagnostics === 'object') {
                  diagnostics.liftTrial = lastLiftTrial;
                }
                restoreBonePose(mappedBones, root);
                root.position.copy(rootLocal);
                root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
                throw new Error(`Native lie floor solve rejected bounded lift trial; evidence=${JSON.stringify(lastLiftTrial)}`, { cause: error });
              }
              const nextMeasurement = measure(support.surface, sampleParentLocalContacts);
              trialFeetPlanted = floorFeetClearAndPlanted(floorY!, sampleParentLocalContacts);
              const after = liftTrialSnapshot(floorY!, nextMeasurement, sampleParentLocalContacts,
                footSolveResult && typeof footSolveResult === 'object' ? footSolveResult : undefined);
              const clear = bodyRegionsClear(nextMeasurement);
              attempts.push(Object.freeze({ requestedLift: targetLift - cumulativeLift, cumulativeLift: targetLift,
                before, after, bodyRegionsClear: clear, floorFeetClearAndPlanted: trialFeetPlanted }));
              trialMeasurement = nextMeasurement;
              cumulativeLift = targetLift;
              if (clear && trialFeetPlanted) {
                measurement = trialMeasurement;
                appliedRootCorrection = cumulativeLift;
                accepted = true;
                break;
              }
            }
            if (!accepted) {
              restoreBonePose(mappedBones, root);
              root.position.copy(rootLocal);
              root.updateWorldMatrix(true, false); root.updateMatrixWorld(true);
              solveHostFeet?.(support.surface, floorY!);
              measurement = measure(support.surface, sampleParentLocalContacts);
            }
            lastLiftTrial = Object.freeze({ propId: support.surface.id, pose, phase, anchorBlend,
              mappedFrame, attempts: Object.freeze(attempts), cumulativeLift,
              accepted, bodyRegionsClear: bodyRegionsClear(trialMeasurement), floorFeetClearAndPlanted: trialFeetPlanted,
              mappedPoseEgress: mappedEgressTrial, ...(mappedEgressError ? { mappedPoseEgressError: mappedEgressError } : {}) });
            const diagnostics = root.userData.nativeRestProbeDiagnostics;
            if (root.userData.nativeRestDiagnosticsEnabled === true && diagnostics && typeof diagnostics === 'object') {
              diagnostics.liftTrial = lastLiftTrial;
            }
          }
          if (!attemptedMappedEgress && pose === 'lie' && (['pelvis-back', 'torso-back', 'head-back'] as const).some((region) => {
            const sample = measurement.regions[region];
            return sample.sampled > 0 && sample.minimumGap < -MAX_PENETRATION_METRES;
          })) {
            appliedRootCorrectionXZ = egressUprightLieFromProp(
              support.surface, floorY!, sampleParentLocalContacts, solveHostFeet,
              mappedContactBones, mappedContactRootLocal, mappedContactRootWorld,
              mappedFrame, phase, anchorBlend,
            );
            measurement = measure(support.surface, sampleParentLocalContacts);
          }
        }
        if (propContactPhase) {
          if (pose === 'soak') {
            appliedRootCorrectionXZ = alignFeetToProp(support.surface, sampleParentLocalContacts, MAX_REST_ROOT_SHIFT_METRES);
            solveHostFeet?.(support.surface, floorY!);
            measurement = measure(support.surface, sampleParentLocalContacts);
          } else if (pose === 'wash') {
            appliedRootCorrectionXZ = washHeadCorrection(root, support.surface, anchorBlend,
              sampleParentLocalContacts, false, probe);
            solveHostFeet?.(support.surface, floorY!);
            measurement = measure(support.surface, sampleParentLocalContacts);
          }
          if (pose === 'lie' && anchorBlend > 0 && (!measurement.supported || !correctionInterval('lie', measurement))) {
            measurement = alignLieSpine(support.surface, sampleParentLocalContacts, measurement, anchorBlend);
          }
          const anchor = rootCorrectionFor(pose, measurement);
          const restAlignment = anchor === null ? 0 : anchor * anchorBlend;
          // An entry frame can be low enough for prop contact without being far enough
          // along the source clip to satisfy the complete rest predicate. Never leave a
          // visible sampled body region inside the bed while waiting for that pose fit.
          const clearanceLift = pose === 'lie' && !upright ? minimumNonpenetratingLift(measurement) : 0;
          const rootCorrection = Math.max(restAlignment, clearanceLift);
          if (Math.abs(rootCorrection) > 0.0002) {
            shiftRootWorldY(rootCorrection);
            if (pose === 'soak' || pose === 'wash' || upright) solveHostFeet?.(support.surface, upright ? floorY! : undefined);
            measurement = measure(support.surface, sampleParentLocalContacts);
          }
          const contactGaps = [measurement.regions['pelvis-back'], measurement.regions['torso-back'], measurement.regions['head-back']]
            .filter((region) => region.sampled > 0)
            .flatMap((region) => [region.minimumGap]);
          if (contactGaps.some((gap) => !Number.isFinite(gap) || gap < -MAX_PENETRATION_METRES)) {
            throw new Error(`Native ${pose} transition penetrates its prop; evidence=${evidence(support.surface, measurement, mappedFrame, rootCorrection)}`);
          }
          appliedRootCorrection += rootCorrection;
        }
        if (pose === 'lie' && (['pelvis-back', 'torso-back', 'head-back'] as const).some((region) =>
          measurement.regions[region].sampled > 0 && measurement.regions[region].minimumGap < -MAX_PENETRATION_METRES)) {
          throw new Error(`Native lie transition penetrates its prop before contact ownership; evidence=${evidence(support.surface, measurement, mappedFrame, appliedRootCorrection)}`);
        }
        const contacts = worldContacts(root, sampleParentLocalContacts()).flatMap((contact) => contact.points ?? [contact]);
        const footGaps = floorContactPhase ? contacts.map((contact) => contact.y - floorY!) : [];
        if (footGaps.some((gap) => !Number.isFinite(gap) || gap < -MAX_PENETRATION_METRES)) {
          throw new Error(`Native ${pose} transition penetrates the floor; footGaps=${JSON.stringify(footGaps)}; evidence=${evidence(support.surface, measurement, mappedFrame, appliedRootCorrection)}`);
        }
        if (floorContactPhase && !footGaps.some((gap) => Math.abs(gap) <= MAX_PENETRATION_METRES)) {
          throw new Error(`Native ${pose} upright transition has no planted foot; footGaps=${JSON.stringify(footGaps)}; hip=${hipWorld.toArray()}; head=${headWorld.toArray()}; evidence=${evidence(support.surface, measurement, mappedFrame, appliedRootCorrection)}`);
        }
        return Object.freeze({ pose, propId: support.surface.id, phase, transitionValidated: true,
          hipsWorldCorrection: 0, rootWorldCorrection: appliedRootCorrection,
          ...(appliedRootCorrectionXZ ? { rootWorldCorrectionXZ: appliedRootCorrectionXZ } : {}), measurement });
      }
      let appliedRootCorrectionXZ: readonly [number, number] | undefined;
      let measurement = measure(support.surface, sampleParentLocalContacts);
      let rootCorrection = 0;
      if (pose === 'soak') {
        appliedRootCorrectionXZ = alignFeetToProp(support.surface, sampleParentLocalContacts, MAX_REST_ROOT_SHIFT_METRES);
      }
      if (pose === 'wash') {
        solveHostFeet?.(support.surface);
        appliedRootCorrectionXZ = washHeadCorrection(root, support.surface, 1,
          sampleParentLocalContacts, true, probe);
        solveHostFeet?.(support.surface);
        measurement = measure(support.surface, sampleParentLocalContacts);
      } else if (pose === 'soak') {
        let settled = false;
        for (let pass = 0; pass < 6; pass++) {
          solveHostFeet?.(support.surface);
          measurement = measure(support.surface, sampleParentLocalContacts);
          const shift = rootCorrectionFor('soak', measurement);
          if (shift === null) throw new Error(`Native soak source pose cannot align its measured pelvis to the tub; evidence=${evidence(support.surface, measurement, mappedFrame, rootCorrection)}`);
          if (Math.abs(shift) <= 0.0002) { settled = true; break; }
          shiftRootWorldY(shift);
          rootCorrection += shift;
        }
        if (!settled) {
          solveHostFeet?.(support.surface);
          measurement = measure(support.surface, sampleParentLocalContacts);
          const remaining = rootCorrectionFor('soak', measurement);
          if (remaining === null || Math.abs(remaining) > 0.004) {
            throw new Error(`Native soak contact did not settle inside its unchanged posterior interval; remaining=${remaining}; evidence=${evidence(support.surface, measurement, mappedFrame, rootCorrection)}`);
          }
        }
        measurement = measure(support.surface, sampleParentLocalContacts);
      } else {
        measurement = measure(support.surface, sampleParentLocalContacts);
      }
      if (pose === 'lie') {
        if (!measurement.supported || !correctionInterval('lie', measurement)) {
          measurement = alignLieSpine(support.surface, sampleParentLocalContacts, measurement, 1);
        }
        const shift = rootCorrectionFor('lie', measurement);
        if (shift === null) throw new Error(`Native lie source pose cannot be aligned to both measured posterior regions; evidence=${evidence(support.surface, measurement, mappedFrame, 0)}`);
        if (Math.abs(shift) > 0.0002) {
          shiftRootWorldY(shift);
          rootCorrection += shift;
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
