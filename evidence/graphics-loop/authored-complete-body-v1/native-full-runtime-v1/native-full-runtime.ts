import type * as THREE from 'three';
import type { BodyPose } from '../../../../src/scene/body/poses.ts';
import { DOOR, INTO, OUT, SEATED, STILL, WORK_INTO, WORK_OUT, STAIRS } from '../../../../src/scene/body/poses.ts';
import type { FootContact, FootSolveResult } from '../../../../src/scene/body/foot-contact.ts';
import type { WardrobeMetrics, WardrobePresentation } from '../../../../src/scene/wardrobe/renderer.ts';

export interface NativePlacement { readonly x: number; readonly y: number; readonly z: number; readonly ry: number }
export interface NativeSeat {
  readonly x: number;
  readonly top: number;
  readonly topWorldY: number;
  readonly floorY: number;
  readonly z: number;
  readonly ry: number;
  readonly lying: boolean;
}
export interface NativeAppearanceScale { readonly height: number; readonly width: number; readonly depth: number }
export interface NativeStairContactInput {
  readonly phase: number;
  readonly climb: number;
  readonly standing: NativePlacement;
  readonly floorY: number;
}

/** A source sampler is already prepared by the host. `duration` must be finite and positive. */
export interface NativeSourceSampler<Frame = unknown> {
  has(clip: string): boolean;
  duration(clip: string): number;
  sample(clip: string, seconds: number): Frame | null;
}

/**
 * Host-driven pose application. `sample` must consume the exact named source clip at the requested time and
 * apply it to this prepared actor. It may retarget through a source-frame controller; no RAF/mixer is created here.
 */
export interface NativePosePort<Frame = unknown> {
  apply(frame: Frame, context: Readonly<{ clip: string; seconds: number; pose: BodyPose; support: NativePoseSupport }>): boolean;
  beginTransition(clip: string, from: NativePlacement, crossfadeSeconds: number): void;
  endTransition(pose: BodyPose): void;
  restore?(): void;
}
/** Floor heights and hip anchors supplied by a host contact callback are world-space values. */
export type NativePoseSupport =
  | Readonly<{ kind: 'flat-feet'; floorY: number }>
  | Readonly<{ kind: 'stair-feet'; leftFloorY: number; rightFloorY: number }>
  | Readonly<{ kind: 'seat-anchor'; hipWorld: readonly [number, number, number]; seatTopY: number; floorY: number }>
  | Readonly<{ kind: 'diagnostic'; floorY: number }>;

export interface NativePreparedActor {
  /** A private, fully loaded actor root. This module does not load or clone assets. */
  readonly object: THREE.Group;
  readonly family: string;
  /** Measured once from the prepared standing actor; meters in actor-local vertical units. */
  readonly standingHeight: number;
  /** Alias name -> actual authored bone name, e.g. Head -> mixamorigHead, hand_r -> mixamorigRightHand. */
  readonly boneAliases: Readonly<Record<string, string>>;
  /** Cleanup for this private actor instance. Shared templates, immutable geometries and caches stay host-owned. */
  dispose?(): void;
}

export interface NativeLookPort<Candidate = unknown> {
  /** Pure parse/normalize step. It must not mutate actor state. */
  prepare(look: unknown, seed?: unknown): Candidate;
  family(candidate: Candidate): string;
  appearance(candidate: Candidate): NativeAppearanceScale;
}
export interface NativePresentationPort<Candidate = unknown> {
  canSet(presentation: WardrobePresentation): boolean;
  set(presentation: WardrobePresentation): boolean;
  /** Pure validation; unsupported looks must be rejected here before `commit`. */
  canWear(candidate: Candidate): boolean;
  /** Atomic actor-local update; false must leave the actor unchanged. */
  commit(candidate: Candidate): boolean;
  readonly wardrobe: WardrobeMetrics;
  readonly wardrobeError: string | null;
  dispose?(): void;
}
export interface NativeContactPort {
  sample(): readonly FootContact[];
  solve(heightAt: (contact: FootContact) => number, mode?: 'motion' | 'grounded'): FootSolveResult;
}
export interface NativeFullRuntimeOptions<Candidate = unknown, Frame = unknown> {
  readonly actor: NativePreparedActor;
  readonly source: NativeSourceSampler<Frame>;
  readonly pose: NativePosePort<Frame>;
  readonly look: NativeLookPort<Candidate>;
  readonly presentation: NativePresentationPort<Candidate>;
  readonly contacts: NativeContactPort;
  readonly seatContact?: (seat: NativeSeat) => NativePoseSupport;
  /** Per-foot world-space stair levels; absent contact data deliberately rejects stair samples. */
  readonly stairContact?: (input: NativeStairContactInput) => NativePoseSupport;
  readonly workContact?: (placement: NativePlacement) => NativePoseSupport;
  /** Convert host parent-local floor coordinates to world Y for built-in support. */
  readonly toWorldFloor?: (parentLocalY: number) => number;
  readonly initialLook?: Candidate;
  readonly sceneScale: number;
  readonly lift?: number;
  readonly sitContact?: number;
  readonly sitBack?: number;
  readonly crossfadeSeconds?: number;
  readonly onDispose?: (dispose: () => void) => (() => void) | void;
}

export interface NativeFullRuntime {
  readonly object: THREE.Group;
  readonly key: string;
  readonly scale: number;
  readonly scaleX: number;
  readonly scaleZ: number;
  readonly strideScale: number;
  readonly wardrobe: WardrobeMetrics;
  readonly wardrobeError: string | null;
  readonly easing: boolean;
  readonly pose: BodyPose;
  readonly seated: boolean;
  setPresentation(presentation: WardrobePresentation): boolean;
  sampleFootContacts(): readonly FootContact[];
  solveFeet(heightAt: (contact: FootContact) => number, mode?: 'motion' | 'grounded'): FootSolveResult;
  show(pose: BodyPose, animate?: boolean): void;
  sampleUse(pose: BodyPose, seconds: number): void;
  enter(animate: boolean): void;
  stride(phase: number, jog: boolean, climb?: number): void;
  step(dt: number): boolean;
  settle(): void;
  place(x: number, y: number, z: number, ry: number): void;
  sitOn(x: number, top: number, z: number, ry: number): void;
  workOn(x: number, floor: number, z: number, ry: number): void;
  fit(sceneScale: number): void;
  wear(look: unknown, seed?: unknown): boolean;
  dispose(): void;
}

type Transition = { clip: string; time: number; length: number; then: BodyPose; previous: BodyPose; from: NativePlacement };
// Native source feet need explicit calibration; never reuse the old body's measured lift by default.
const DEFAULT_LIFT = 0;
const DEFAULT_SIT_CONTACT = 0.47;
const DEFAULT_SIT_BACK = 0.332;
const DEFAULT_CROSSFADE = 0.16;
const ANCHORED = new Set([...Object.values(INTO), ...Object.values(OUT), ...Object.values(WORK_INTO), ...Object.values(WORK_OUT)]);
const finite = (value: number, name: string): number => {
  if (!Number.isFinite(value)) throw new Error(`Native body ${name} must be finite`);
  return value;
};
function validAppearance(value: NativeAppearanceScale): void {
  if (![value.height, value.width, value.depth].every((part) => Number.isFinite(part) && part > 0 && part <= 2)) {
    throw new Error('Native body appearance scale is invalid');
  }
}

/**
 * Adapter from the old scene-facing SkinnedBody contract to an already-prepared native actor.
 * This is intentionally an injected runtime: it owns no loader, mixer, RAF, geometry scan, or actor resources.
 */
export function createNativeFullRuntime<Candidate = unknown, Frame = unknown>(options: NativeFullRuntimeOptions<Candidate, Frame>): NativeFullRuntime {
  const { actor, source, pose: posePort, look, presentation, contacts } = options;
  const object = actor.object;
  const requiredBones = new Set(Object.values(actor.boneAliases));
  if (!object || !Number.isFinite(actor.standingHeight) || actor.standingHeight <= 0 || !actor.family) throw new Error('Native body actor is not prepared');
  for (const [alias, target] of Object.entries(actor.boneAliases)) {
    const bone = object.getObjectByName(target) as THREE.Bone | null;
    if (!bone?.isBone || !alias) throw new Error(`Native body bone alias ${alias} -> ${target} is unavailable`);
    const shadowed = object.getObjectByName(alias);
    if (shadowed && shadowed !== bone) throw new Error(`Native body alias ${alias} would shadow a different authored object`);
  }
  if (requiredBones.size < 2) throw new Error('Native body bone alias table is incomplete');
  for (const name of Object.values(STILL).map(({ clip }) => clip)) requireClip(name);
  for (const name of [...Object.values(INTO), ...Object.values(OUT), ...Object.values(WORK_INTO), ...Object.values(WORK_OUT), DOOR, STAIRS.up, STAIRS.down]) requireClip(name);
  const initial = options.initialLook;
  if (initial !== undefined && (look.family(initial) !== actor.family || !presentation.canWear(initial))) {
    throw new Error('Native body initial look is unsupported by its prepared actor/presentation');
  }

  const lift = options.lift ?? DEFAULT_LIFT, sitContact = options.sitContact ?? DEFAULT_SIT_CONTACT;
  const sitBack = options.sitBack ?? DEFAULT_SIT_BACK, crossfade = options.crossfadeSeconds ?? DEFAULT_CROSSFADE;
  if (![lift, sitContact, sitBack].every(Number.isFinite) || lift < 0 || sitContact < 0 || sitBack < 0
    || !Number.isFinite(crossfade) || crossfade <= 0 || crossfade > 2) {
    throw new Error('Native body placement/transition constants are invalid');
  }
  let appearance: NativeAppearanceScale = initial === undefined ? { height: 1, width: 1, depth: 1 } : look.appearance(initial);
  validAppearance(appearance);
  let sceneScale = finite(options.sceneScale, 'scene scale');
  if (sceneScale <= 0) throw new Error('Native body scene scale must be positive');
  let scale = (2.45 * sceneScale / actor.standingHeight) * appearance.height;

  const savedLookup = object.getObjectByName;
  const aliasTargets = new Map(Object.entries(actor.boneAliases).map(([alias, target]) => [alias, object.getObjectByName(target)]));
  object.getObjectByName = (name: string): THREE.Object3D | undefined => {
    if (aliasTargets.has(name)) return aliasTargets.get(name) ?? undefined;
    return savedLookup.call(object, name) ?? undefined;
  };
  object.scale.set(scale * appearance.width, scale, scale * appearance.depth);
  let currentPose: BodyPose = 'idle';
  let transition: Transition | null = null;
  let strideClimb = 0;
  let stridePhase = 0;
  let standing: NativePlacement = { x: 0, y: 0, z: 0, ry: 0 };
  let working: NativePlacement | null = null;
  let seat: NativeSeat | null = null;
  let disposed = false;

  function requireClip(name: string): number {
    if (!source.has(name)) throw new Error(`Native body source is missing required named clip: ${name}`);
    const duration = source.duration(name);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Native body source clip has invalid duration: ${name}`);
    return duration;
  }
  function ensureOpen(): void { if (disposed) throw new Error('Native body runtime is disposed'); }
  function defaultFloor(y: number): NativePoseSupport {
    const floorY = options.toWorldFloor?.(y) ?? y;
    return Number.isFinite(floorY) ? { kind: 'flat-feet', floorY } : { kind: 'diagnostic', floorY: 0 };
  }
  function supportFor(poseName: BodyPose): NativePoseSupport {
    if (seat && SEATED.has(poseName)) return options.seatContact?.(seat) ?? { kind: 'diagnostic', floorY: options.toWorldFloor?.(standing.y) ?? standing.y };
    if (WORK_INTO[poseName] && working) return options.workContact?.(working) ?? defaultFloor(working.y);
    if (strideClimb) {
      const floorY = options.toWorldFloor?.(standing.y) ?? standing.y;
      if (!Number.isFinite(floorY)) return { kind: 'diagnostic', floorY: 0 };
      return options.stairContact?.({ phase: stridePhase, climb: strideClimb, standing: Object.freeze({ ...standing }), floorY })
        ?? { kind: 'diagnostic', floorY };
    }
    return defaultFloor(standing.y);
  }
  function supportForTransition(clip: string): NativePoseSupport {
    const seatedExit = Object.values(OUT).includes(clip);
    if (seat && (SEATED.has(currentPose) || seatedExit)) {
      return options.seatContact?.(seat) ?? { kind: 'diagnostic', floorY: standing.y };
    }
    const workExit = Object.values(WORK_OUT).includes(clip);
    if (working && (Boolean(WORK_INTO[currentPose]) || workExit)) {
      return options.workContact?.(working) ?? defaultFloor(working.y);
    }
    return supportFor(currentPose);
  }
  function sample(clip: string, time: number, poseName = currentPose, suppliedSupport?: NativePoseSupport): void {
    ensureOpen();
    // Placement is host state, so apply it before sampling and contact solving.
    // Otherwise the solver can use the previous root transform for this frame.
    put();
    const support = suppliedSupport ?? (transition?.clip === clip ? supportForTransition(clip) : supportFor(poseName));
    if ((poseName === 'sit' || transition?.clip === clip && (clip === INTO.sit || clip === OUT.sit))
      && support.kind !== 'seat-anchor') {
      throw new Error(`Native sit requires an actual seat support callback; got ${support.kind}`);
    }
    const duration = requireClip(clip);
    const t = Math.min(Math.max(finite(time, 'sample time'), 0), duration);
    const frame = source.sample(clip, t);
    if (frame === null || frame === undefined) throw new Error(`Native source sampler failed to return ${clip} at ${t}`);
    if (!posePort.apply(frame, Object.freeze({ clip, seconds: t, pose: poseName, support }))) {
      throw new Error(`Native pose port rejected sampled clip ${clip}`);
    }
  }
  function put(): void {
    const back = seat?.lying ? 0 : sitBack * scale * appearance.depth;
    const resting = seat ? {
      x: seat.x + Math.sin(seat.ry) * back,
      y: seat.lying ? seat.top : seat.top - sitContact * scale,
      z: seat.z + Math.cos(seat.ry) * back, ry: seat.ry,
    } : null;
    const floor = WORK_INTO[currentPose] && working ? working : standing;
    const target = SEATED.has(currentPose) && resting ? resting : { ...floor, y: floor.y + lift * scale };
    const current = transition;
    if (current && ANCHORED.has(current.clip)) {
      const t = current.time / current.length, eased = t * t * (3 - 2 * t), from = current.from;
      object.position.set(from.x + (target.x - from.x) * eased, from.y + (target.y - from.y) * eased, from.z + (target.z - from.z) * eased);
      const turn = Math.atan2(Math.sin(target.ry - from.ry), Math.cos(target.ry - from.ry));
      object.rotation.y = from.ry + turn * eased;
    } else {
      object.position.set(target.x, target.y, target.z);
      object.rotation.y = target.ry;
    }
  }
  function sampleStill(next: BodyPose): void {
    const config = STILL[next];
    sample(config.clip, requireClip(config.clip) * config.at, next);
  }
  function finish(): void {
    if (!transition) return;
    const { then, previous } = transition;
    transition = null;
    posePort.endTransition(then);
    try {
      sampleStill(then);
      put();
    } catch (error) {
      currentPose = previous;
      transition = null;
      posePort.endTransition(previous);
      try { sampleStill(previous); put(); } catch { /* retain the truthful previous state on rollback failure */ }
      throw error;
    }
  }
  function play(clip: string | undefined, previous: BodyPose = currentPose): void {
    if (!clip) { transition = null; posePort.endTransition(currentPose); sampleStill(currentPose); return; }
    const length = requireClip(clip);
    const from = { x: object.position.x, y: object.position.y, z: object.position.z, ry: object.rotation.y };
    posePort.beginTransition(clip, from, crossfade);
    transition = { clip, time: 0, length, then: currentPose, previous, from };
    sample(clip, 0, currentPose);
  }
  function changePose(next: BodyPose, animate: boolean): void {
    ensureOpen();
    if (next === 'sit' && supportFor('sit').kind !== 'seat-anchor') {
      throw new Error('Native sit requires an actual seat support callback');
    }
    if (next === currentPose && transition && animate) return;
    if (next === currentPose && !transition) { sampleStill(next); return; }
    const previous = currentPose;
    const previousClimb = strideClimb;
    const into = next !== previous ? INTO[next] ?? WORK_INTO[next] : undefined;
    const out = next !== previous && next !== 'walk' && next !== 'jog' ? OUT[previous] ?? WORK_OUT[previous] : undefined;
    if (next !== 'walk' && next !== 'jog') strideClimb = 0;
    currentPose = next;
    try { play(animate ? into ?? out : undefined, previous); }
    catch (error) {
      currentPose = previous; strideClimb = previousClimb; transition = null; posePort.endTransition(previous);
      try { sampleStill(previous); put(); } catch { /* preserve previous public state if source recovery also fails */ }
      throw error;
    }
  }

  let unregisterKitDispose: (() => void) | void;
  const body: NativeFullRuntime = {
    object, key: actor.family,
    get scale() { return scale; },
    get scaleX() { return scale * appearance.width; },
    get scaleZ() { return scale * appearance.depth; },
    get strideScale() { return appearance.height * appearance.depth; },
    get wardrobe() { return presentation.wardrobe; },
    get wardrobeError() { return presentation.wardrobeError; },
    get easing() { return transition !== null; },
    get pose() { return currentPose; },
    get seated() { return SEATED.has(currentPose) || SEATED.has(transition?.clip ?? ''); },
    setPresentation(next) {
      ensureOpen();
      if (!presentation.canSet(next)) return false;
      return presentation.set(next);
    },
    sampleFootContacts() { ensureOpen(); object.updateWorldMatrix(true, true); return contacts.sample(); },
    solveFeet(heightAt, mode = 'motion') {
      ensureOpen(); object.updateWorldMatrix(true, true);
      let result = contacts.solve(heightAt, mode);
      if (strideClimb) for (let pass = 0; pass < 3 && result.limited && result.maxError > 0.002; pass++) result = contacts.solve(heightAt);
      return result;
    },
    show(next, animate = false) { changePose(next, animate); },
    sampleUse(next, seconds) {
      ensureOpen(); if (transition) return;
      if (next === 'sit' && supportFor('sit').kind !== 'seat-anchor') throw new Error('Native sit requires an actual seat support callback');
      const previous = currentPose;
      const previousClimb = strideClimb;
      const { clip } = STILL[next], length = requireClip(clip);
      const wrapped = ((Math.max(0, finite(seconds, 'use time')) % length) + length) % length;
      strideClimb = 0;
      currentPose = next;
      try { sample(clip, wrapped, next); put(); }
      catch (error) {
        currentPose = previous; strideClimb = previousClimb; transition = null; posePort.endTransition(previous);
        try { sampleStill(previous); put(); } catch { /* preserve previous public state if source recovery also fails */ }
        throw error;
      }
    },
    enter(animate) { ensureOpen(); strideClimb = 0; currentPose = 'idle'; play(animate ? DOOR : undefined); },
    stride(phase, jog, climb = 0) {
      ensureOpen(); finite(phase, 'stride phase'); finite(climb, 'climb');
      const previousPose = currentPose, previousClimb = strideClimb, previousPhase = stridePhase;
      strideClimb = climb; stridePhase = phase; transition = null; posePort.endTransition(jog ? 'jog' : 'walk');
      currentPose = jog ? 'jog' : 'walk';
      const name = !climb ? currentPose : climb > 0 ? STAIRS.up : STAIRS.down, length = requireClip(name);
      const turn = phase / (2 * Math.PI), time = (turn - Math.floor(turn)) * length;
      try { sample(name, time, currentPose); }
      catch (error) {
        strideClimb = previousClimb; stridePhase = previousPhase; currentPose = previousPose; posePort.endTransition(previousPose);
        try { sampleStill(previousPose); put(); } catch { /* keep public pose truthful if recovery is unavailable */ }
        throw error;
      }
    },
    step(dt) {
      ensureOpen(); if (!transition) return false;
      transition.time += Math.max(finite(dt, 'step delta'), 0);
      if (transition.time >= transition.length) { finish(); return false; }
      try { sample(transition.clip, transition.time, currentPose); put(); return true; }
      catch (error) {
        const previous = transition.previous;
        transition = null; currentPose = previous; posePort.endTransition(previous);
        try { sampleStill(previous); put(); } catch { /* keep public pose truthful if recovery is unavailable */ }
        throw error;
      }
    },
    settle() { ensureOpen(); finish(); },
    place(x, y, z, ry) { ensureOpen(); standing = { x: finite(x, 'x'), y: finite(y, 'y'), z: finite(z, 'z'), ry: finite(ry, 'rotation') }; put(); },
    sitOn(x, top, z, ry) {
      ensureOpen();
      const seatTop = finite(top, 'seat top');
      const floorY = finite(options.toWorldFloor?.(standing.y) ?? standing.y, 'seat floor');
      const topWorldY = finite(options.toWorldFloor?.(seatTop) ?? seatTop, 'seat top world height');
      seat = { x: finite(x, 'seat x'), top: seatTop, topWorldY, floorY, z: finite(z, 'seat z'),
        ry: finite(ry, 'seat rotation'), lying: (transition?.clip ?? currentPose) === 'get-up' || currentPose === 'lie' };
      put();
    },
    workOn(x, floor, z, ry) { ensureOpen(); working = { x: finite(x, 'work x'), y: finite(floor, 'work floor'), z: finite(z, 'work z'), ry: finite(ry, 'work rotation') }; put(); },
    fit(nextSceneScale) {
      ensureOpen();
      const next = finite(nextSceneScale, 'scene scale');
      if (next <= 0) throw new Error('Native body scene scale must be positive');
      sceneScale = next;
      scale = (2.45 * sceneScale / actor.standingHeight) * appearance.height;
      object.scale.set(scale * appearance.width, scale, scale * appearance.depth); put();
    },
    wear(nextLook, seed) {
      ensureOpen();
      let next: Candidate, nextAppearance: NativeAppearanceScale;
      try {
        next = look.prepare(nextLook, seed);
        if (look.family(next) !== actor.family) return false;
        nextAppearance = look.appearance(next); validAppearance(nextAppearance);
        if (!presentation.canWear(next)) return false;
      } catch {
        return false;
      }
      if (!presentation.commit(next)) return false;
      appearance = nextAppearance;
      scale = (2.45 * sceneScale / actor.standingHeight) * appearance.height;
      object.scale.set(scale * appearance.width, scale, scale * appearance.depth); put();
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true; transition = null;
      const failures: unknown[] = [];
      for (const cleanup of [
        () => posePort.restore?.(), () => posePort.endTransition(currentPose),
        () => presentation.dispose?.(), () => { object.getObjectByName = savedLookup; },
        () => object.removeFromParent(), () => actor.dispose?.(),
        () => { if (typeof unregisterKitDispose === 'function') unregisterKitDispose(); },
      ]) {
        try { cleanup(); } catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, 'Native body cleanup failed');
    },
  };
  unregisterKitDispose = options.onDispose?.(() => body.dispose());
  if (disposed && typeof unregisterKitDispose === 'function') unregisterKitDispose();
  return body;
}
