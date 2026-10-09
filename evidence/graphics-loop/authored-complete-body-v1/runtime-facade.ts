import * as THREE from 'three';
import { normalizeLook } from '../../../src/scene/avatar-look.ts';
import type { Look } from '../../../src/scene/avatar-look.ts';
import type { Kit } from '../../../src/scene/kit.ts';
import type { CompleteCharacter, CompleteCharacterExpression } from './rig.ts';
import type { NativeActionController, NativeActionPose, NativeActionSnapshot, NativeActionSupport } from './native-actions.ts';

/** The narrow native-action surface currently implemented by native-actions.ts. */
export type AuthoredRuntimePose = NativeActionPose;
export const AUTHORED_RUNTIME_POSES: readonly AuthoredRuntimePose[] = Object.freeze<AuthoredRuntimePose[]>([
  'idle', 'walk', 'sit', 'interact', 'cook', 'eat', 'drink',
]);

export interface AuthoredLookAdmission {
  readonly bodyKeys: readonly ('male' | 'female')[];
  /** Exact asset/presentation check, including hairstyle, outfit, accessories and wearables. */
  unsupportedFields(look: Look): readonly string[];
}

export interface AuthoredLookBridge {
  /** Return every unsupported field before mutation. Empty means applyLook can commit atomically. */
  unsupportedFields(next: Look): readonly string[];
  /** Update actor-private state atomically after a successful preflight; throw only before mutation. */
  applyLook(next: Look): void;
}

export interface AuthoredRuntimeParts {
  /** A prepared, private-skeleton actor. Ownership transfers only when createAuthoredRuntimeFacade succeeds. */
  readonly character: CompleteCharacter;
  /** Controller already bound to character.object. It must not own or dispose the actor root. */
  readonly actions: NativeActionController;
  /** Capability check for the exact prepared asset/presentation combination, including hair/outfit/accessories. */
  readonly unsupportedLookFields: (look: Look) => readonly string[];
  /** Optional transactional look updater. Without one, look changes are explicitly rejected. */
  readonly lookBridge?: AuthoredLookBridge;
  /** Disposes actor-private presentation geometry/materials; shared Kit templates remain Kit-owned. */
  readonly disposePresentation?: () => void;
}

export type AuthoredRuntimeFailureCode =
  | 'kit-disposed'
  | 'body-family-change-requires-reload'
  | 'unsupported-initial-look'
  | 'unsupported-look'
  | 'look-updater-unavailable'
  | 'unsupported-pose'
  | 'invalid-support'
  | 'disposed';

export interface AuthoredRuntimeFailure {
  readonly ok: false;
  readonly code: AuthoredRuntimeFailureCode;
  readonly message: string;
  readonly fields?: readonly string[];
}

export interface AuthoredRuntimeSuccess {
  readonly ok: true;
  readonly actor: AuthoredRuntimeFacade;
}

export interface AuthoredRuntimeFacade {
  /** Placement wrapper containing the prepared model; caller owns scene attachment. */
  readonly object: THREE.Group;
  readonly look: Look;
  readonly seed: unknown;
  readonly capabilities: readonly AuthoredRuntimePose[];
  readonly aliases: Readonly<Record<'head' | 'leftHand' | 'rightHand', THREE.Object3D>>;
  /** Actual posed bones for gaze/prop migration. The named alias objects below are locators, not bones. */
  readonly bones: Readonly<Record<'head' | 'leftHand' | 'rightHand', THREE.Bone>>;
  readonly cleanupErrors: readonly string[];
  /** Host-driven only; this method creates no timer, mixer loop, or RAF callback. */
  sample(seconds: number, pose: string, support: NativeActionSupport): NativeActionSnapshot | AuthoredRuntimeFailure;
  setExpression(expression: CompleteCharacterExpression, seconds: number): AuthoredRuntimeFailure | { readonly ok: true };
  /** Same-family updates are preflighted before mutation; family changes return reload-required. */
  setLook(next: unknown, seed?: unknown): AuthoredRuntimeFailure | { readonly ok: true; readonly look: Look };
  /** Uniform scale derived from the complete actor's measured mesh bounds, never a legacy body manifest. */
  fitToHeight(targetHeight: number): number | AuthoredRuntimeFailure;
  place(x: number, y: number, z: number, yaw: number): AuthoredRuntimeFailure | { readonly ok: true };
  dispose(): void;
}

const LEGACY_ANCHOR_BONES = Object.freeze({
  head: 'mixamorigHead',
  leftHand: 'mixamorigLeftHand',
  rightHand: 'mixamorigRightHand',
});

function failure(code: AuthoredRuntimeFailureCode, message: string, fields?: readonly string[]): AuthoredRuntimeFailure {
  return { ok: false, code, message, ...(fields ? { fields: [...fields] } : {}) };
}

function immutableLook(look: Look): Look {
  const appearance = look.appearance && typeof look.appearance === 'object'
    ? Object.freeze({ ...look.appearance })
    : look.appearance;
  return Object.freeze({
    ...look,
    accessories: Object.freeze([...look.accessories]),
    ...(look.wearables ? { wearables: Object.freeze([...look.wearables]) } : {}),
    ...(appearance ? { appearance } : {}),
  }) as unknown as Look;
}

/** Shared pre-load admission check for creator, player and NPC callers. A failed check selects the
 * caller's current runtime unchanged; it never strips unsupported look fields or picks another body. */
export function assessAuthoredLook(
  requestedLook: unknown,
  seed: unknown,
  admission: AuthoredLookAdmission,
): { readonly ok: true; readonly look: Look } | AuthoredRuntimeFailure {
  const look = normalizeLook(requestedLook, seed);
  const bodyKey = look.body === 'woman' ? 'female' : 'male';
  if (!admission.bodyKeys.includes(bodyKey)) {
    return failure('unsupported-initial-look', `Authored ${bodyKey} body family is unavailable.`, ['body']);
  }
  let unsupported: string[];
  try {
    unsupported = [...admission.unsupportedFields(look)];
  } catch (error) {
    return failure('unsupported-initial-look', 'Authored look capability check failed.', [
      `capability-check:${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  const age = look.appearance && typeof look.appearance === 'object'
    ? (look.appearance as { ageAppearance?: unknown }).ageAppearance
    : undefined;
  if (age !== undefined && age !== 'adult') unsupported.push(`ageAppearance:${String(age)}`);
  if (unsupported.length) return failure('unsupported-initial-look', 'Authored actor cannot represent every requested look field.', unsupported);
  return { ok: true, look };
}

export function supportsAuthoredPose(pose: string): pose is AuthoredRuntimePose {
  return AUTHORED_RUNTIME_POSES.includes(pose as AuthoredRuntimePose);
}

function addAnchor(root: THREE.Group, boneName: string, aliasName: string): THREE.Object3D {
  const bone = root.getObjectByName(boneName);
  if (!bone || !(bone as THREE.Bone).isBone) throw new Error(`Authored rig is missing anchor bone ${boneName}`);
  const existing = root.getObjectByName(aliasName);
  if (existing) throw new Error(`Authored rig already contains legacy alias ${aliasName}`);
  const anchor = new THREE.Object3D();
  anchor.name = aliasName;
  anchor.userData.authoredAnchorAlias = true;
  bone.add(anchor);
  return anchor;
}

function measuredActorHeight(root: THREE.Group): number {
  root.updateMatrixWorld(true);
  const actorInverse = root.matrixWorld.clone().invert();
  const skeletons = new Set<THREE.Skeleton>();
  root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) skeletons.add(mesh.skeleton);
  });
  skeletons.forEach((skeleton) => skeleton.update());
  const bounds = new THREE.Box3().makeEmpty();
  const point = new THREE.Vector3();
  let sampled = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const position = mesh.geometry.getAttribute('position');
    if (!position) throw new Error(`Cannot measure mesh ${mesh.name || '(unnamed)'} without positions`);
    for (let index = 0; index < position.count; index++) {
      // SkinnedMesh.getVertexPosition includes current morph and bone deformation. This is a one-off
      // fit measurement, not work repeated in the host's per-frame loop.
      mesh.getVertexPosition(index, point);
      mesh.localToWorld(point).applyMatrix4(actorInverse);
      bounds.expandByPoint(point);
      sampled++;
    }
  });
  if (!sampled || bounds.isEmpty()) return 0;
  return bounds.max.y - bounds.min.y;
}

/**
 * Wrap already-prepared native actor parts without adding another loader/cache. The caller keeps
 * ownership until this function returns `{ok:true}`; on a capability rejection no supplied component
 * is mutated or disposed, so the existing runtime can remain mounted. A Kit that is already disposed
 * invokes its cleanup callback immediately, so that case releases the prepared candidate and rejects.
 */
export function createAuthoredRuntimeFacade(
  kit: Pick<Kit, 'onDispose'>,
  requestedLook: unknown,
  requestedSeed: unknown,
  parts: AuthoredRuntimeParts,
): AuthoredRuntimeSuccess | AuthoredRuntimeFailure {
  const admitted = assessAuthoredLook(requestedLook, requestedSeed, {
    bodyKeys: [parts.character.metrics.bodyKey],
    unsupportedFields: parts.unsupportedLookFields,
  });
  if (!admitted.ok) return admitted;
  const look = immutableLook(admitted.look);
  if (parts.character.metrics.body !== look.body || parts.character.metrics.bodyKey !== (look.body === 'woman' ? 'female' : 'male')) {
    return failure('unsupported-initial-look', 'Prepared body geometry does not match the canonical look family.', ['body-family-does-not-match-loaded-actor']);
  }
  if (parts.character.metrics.unsupportedAppearance.length) {
    return failure('unsupported-initial-look', 'Prepared authored appearance cannot represent the requested age/body profile.', parts.character.metrics.unsupportedAppearance);
  }

  const wrapper = new THREE.Group();
  wrapper.name = 'authored-runtime-placement';
  const priorParent = parts.character.object.parent;
  if (priorParent) return failure('unsupported-initial-look', 'Prepared actor is already mounted; facade requires exclusive placement ownership.', ['actor-already-has-parent']);

  for (const [alias, boneName] of Object.entries(LEGACY_ANCHOR_BONES)) {
    if (!parts.character.object.getObjectByName(boneName)) {
      return failure('unsupported-initial-look', `Prepared rig is missing required ${alias} anchor bone ${boneName}.`, [boneName]);
    }
    const oldAlias = alias === 'head' ? 'Head' : alias === 'leftHand' ? 'hand_l' : 'hand_r';
    if (parts.character.object.getObjectByName(oldAlias)) {
      return failure('unsupported-initial-look', `Prepared rig already contains legacy alias ${oldAlias}.`, [oldAlias]);
    }
  }
  const actualBones = {
    head: parts.character.object.getObjectByName(LEGACY_ANCHOR_BONES.head) as THREE.Bone,
    leftHand: parts.character.object.getObjectByName(LEGACY_ANCHOR_BONES.leftHand) as THREE.Bone,
    rightHand: parts.character.object.getObjectByName(LEGACY_ANCHOR_BONES.rightHand) as THREE.Bone,
  };

  let standingHeight = 0;
  try {
    // Fit measurements use one canonical standing sample captured before this actor is published.
    // Later fits reuse it, independent of seat pose, parent transform or wrapper rotation/scale.
    parts.actions.apply(0, 'idle', { kind: 'floor' });
    standingHeight = measuredActorHeight(parts.character.object);
    if (!Number.isFinite(standingHeight) || standingHeight <= 1e-5) {
      parts.actions.restore();
      return failure('invalid-support', 'Could not measure a finite standing authored actor height.');
    }
  } catch (error) {
    try { parts.actions.restore(); } catch { /* retain the primary measurement failure */ }
    return failure('invalid-support', `Standing fit preparation failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  const aliases: AuthoredRuntimeFacade['aliases'] = {
    head: addAnchor(parts.character.object, LEGACY_ANCHOR_BONES.head, 'Head'),
    leftHand: addAnchor(parts.character.object, LEGACY_ANCHOR_BONES.leftHand, 'hand_l'),
    rightHand: addAnchor(parts.character.object, LEGACY_ANCHOR_BONES.rightHand, 'hand_r'),
  };
  wrapper.add(parts.character.object);
  let disposed = false;
  let unregisterKit: (() => boolean) | undefined;
  let currentLook = look;
  const cleanupErrors: string[] = [];

  const facade: AuthoredRuntimeFacade = {
    object: wrapper,
    get look() { return currentLook; },
    seed: requestedSeed,
    capabilities: AUTHORED_RUNTIME_POSES,
    aliases,
    bones: actualBones,
    get cleanupErrors() { return [...cleanupErrors]; },
    sample(seconds, pose, support) {
      if (disposed) return failure('disposed', 'Cannot sample a disposed authored actor.');
      if (!supportsAuthoredPose(pose)) {
        return failure('unsupported-pose', `Pose “${pose}” is not implemented by the native authored controller.`, [pose]);
      }
      if (!Number.isFinite(seconds)) return failure('invalid-support', 'Pose time must be finite.');
      if (!support || typeof support !== 'object') return failure('invalid-support', 'A valid floor or seat support is required.');
      if (pose === 'sit') {
        if (support.kind !== 'seat' || !Number.isFinite(support.top) || !Number.isFinite(support.floorY)) {
          return failure('invalid-support', 'The sit pose requires a finite seat top and floor height.');
        }
      } else if (support.kind !== 'floor') {
        return failure('invalid-support', `${pose} requires floor support; seat support is only valid for sit.`);
      }
      return parts.actions.apply(seconds, pose as AuthoredRuntimePose, support);
    },
    setExpression(expression, seconds) {
      if (disposed) return failure('disposed', 'Cannot change expression on a disposed authored actor.');
      if (!Number.isFinite(seconds)) return failure('invalid-support', 'Expression time must be finite.');
      parts.character.setExpression(expression, seconds);
      return { ok: true };
    },
    setLook(next, seed = requestedSeed) {
      if (disposed) return failure('disposed', 'Cannot change the look of a disposed authored actor.');
      const normalized = immutableLook(normalizeLook(next, seed));
      if (normalized.body !== currentLook.body) {
        return failure('body-family-change-requires-reload', 'A body-family change needs a new prepared actor; the current actor remains intact.', ['body']);
      }
      let unsupportedFromPrepared: readonly string[];
      try {
        unsupportedFromPrepared = parts.unsupportedLookFields(normalized);
      } catch (error) {
        return failure('unsupported-look', `Prepared-look capability check failed: ${error instanceof Error ? error.message : String(error)}`, ['capability-check']);
      }
      if (unsupportedFromPrepared.length) {
        return failure('unsupported-look', 'The prepared asset/presentation cannot represent every requested look field; the current look is unchanged.', unsupportedFromPrepared);
      }
      if (!parts.lookBridge) return failure('look-updater-unavailable', 'This prepared actor has no transactional same-actor look updater.', ['look']);
      let unsupported: readonly string[];
      try {
        unsupported = parts.lookBridge.unsupportedFields(normalized);
      } catch (error) {
        return failure('unsupported-look', `Look capability check failed: ${error instanceof Error ? error.message : String(error)}`, ['capability-check']);
      }
      if (unsupported.length) return failure('unsupported-look', 'The authored actor cannot represent every requested look field; the current look is unchanged.', unsupported);
      try {
        parts.lookBridge.applyLook(normalized);
        parts.character.setExpression(normalized.expression, 0);
      } catch (error) {
        return failure('unsupported-look', `Atomic look update failed: ${error instanceof Error ? error.message : String(error)}`, ['apply']);
      }
      currentLook = normalized;
      return { ok: true, look: currentLook };
    },
    fitToHeight(targetHeight) {
      if (disposed) return failure('disposed', 'Cannot fit a disposed authored actor.');
      if (!Number.isFinite(targetHeight) || targetHeight <= 0) return failure('invalid-support', 'Target actor height must be positive and finite.');
      const sourceHeight = standingHeight;
      if (!Number.isFinite(sourceHeight) || sourceHeight <= 1e-5) return failure('invalid-support', 'Measured authored mesh bounds have no usable height.');
      const factor = targetHeight / sourceHeight;
      wrapper.scale.setScalar(factor);
      wrapper.updateMatrixWorld(true);
      return factor;
    },
    place(x, y, z, yaw) {
      if (disposed) return failure('disposed', 'Cannot place a disposed authored actor.');
      if (![x, y, z, yaw].every(Number.isFinite)) return failure('invalid-support', 'Placement coordinates and yaw must be finite.');
      wrapper.position.set(x, y, z);
      wrapper.rotation.set(0, yaw, 0);
      wrapper.updateMatrixWorld(true);
      return { ok: true };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unregisterKit?.();
      unregisterKit = undefined;
      wrapper.remove(parts.character.object);
      const clean = (label: string, dispose: () => void) => {
        try { dispose(); } catch (error) {
          cleanupErrors.push(`${label}:${error instanceof Error ? error.message : String(error)}`);
        }
      };
      clean('actions', () => parts.actions.dispose());
      if (parts.disposePresentation) clean('presentation', parts.disposePresentation);
      clean('character', () => parts.character.dispose());
      aliases.head.removeFromParent();
      aliases.leftHand.removeFromParent();
      aliases.rightHand.removeFromParent();
    },
  };

  unregisterKit = kit.onDispose(() => facade.dispose());
  if (disposed) return failure('kit-disposed', 'Kit was already disposed; prepared actor was immediately released.');
  return { ok: true, actor: facade };
}
