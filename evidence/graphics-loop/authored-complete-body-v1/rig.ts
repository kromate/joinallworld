import * as THREE from 'three';
import { clone as cloneSkinnedHierarchy, retargetClip } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { normalizeLook } from '../../../src/scene/avatar-look.ts';
import type { Look } from '../../../src/scene/avatar-look.ts';
import { bodyTint } from '../../../src/scene/body/tint.ts';
import type { Kit } from '../../../src/scene/kit.ts';
import { normalizeAvatarAppearance } from '../../../src/types/avatar.ts';

export type CompleteCharacterPose = 'idle' | 'walk' | 'dance';
export type CompleteCharacterExpression = 'neutral' | 'smile' | 'grin' | 'talk' | 'blink';

/**
 * Loader boundary supplied by the integration layer. The authored root template is immutable and shared; sourceRig
 * is the clip-pack bone hierarchy with `skeleton` attached and the original animation tracks bound to its children.
 * The Kit owner remains responsible for the source GLB/clip cache and their shared geometry, material and textures.
 */
export interface CompleteCharacterAssets {
  loadTemplate(): Promise<THREE.Group>;
  loadMotionRig(): Promise<{ root: THREE.Object3D & { skeleton: THREE.Skeleton }; clips: readonly THREE.AnimationClip[] }>;
}

export type CompleteCharacterKit = Pick<Kit, 'onDispose'> & { readonly authoredCharacterAssets: CompleteCharacterAssets };

export interface CompleteCharacterMetrics {
  readonly body: Look['body'];
  readonly bodyKey: 'male' | 'female';
  readonly meshNames: readonly string[];
  readonly triangleCount: number;
  readonly jointCount: number;
  readonly retargetedClipNames: readonly CompleteCharacterPose[];
  readonly unsupportedAppearance: readonly string[];
  readonly morphNames: readonly string[];
}

export interface CompleteCharacter {
  /** Per-actor cloned root, in the GLB's native coordinate frame. Caller owns placement/presentation. */
  readonly object: THREE.Group;
  readonly metrics: CompleteCharacterMetrics;
  sample(seconds: number, pose: CompleteCharacterPose): void;
  setExpression(name: CompleteCharacterExpression, seconds: number): void;
  dispose(): void;
}

type Cache = {
  closed: boolean;
  promise: Promise<{ template: THREE.Group; clips: ReadonlyMap<CompleteCharacterPose, THREE.AnimationClip> }>;
  actors: Set<() => void>;
};

const caches = new WeakMap<CompleteCharacterKit, Cache>();
const REQUIRED_MESHES = ['Body', 'Eyes', 'Teeth', 'Tongue'] as const;
const BODY_JOINT_MAP: Readonly<Record<string, string>> = Object.freeze({
  mixamorigHips: 'pelvis',
  mixamorigSpine: 'spine_01',
  mixamorigSpine1: 'spine_02',
  mixamorigSpine2: 'spine_03',
  mixamorigNeck: 'neck_01',
  mixamorigHead: 'Head',
  mixamorigLeftShoulder: 'clavicle_l',
  mixamorigLeftArm: 'upperarm_l',
  mixamorigLeftForeArm: 'lowerarm_l',
  mixamorigLeftHand: 'hand_l',
  mixamorigRightShoulder: 'clavicle_r',
  mixamorigRightArm: 'upperarm_r',
  mixamorigRightForeArm: 'lowerarm_r',
  mixamorigRightHand: 'hand_r',
  mixamorigLeftUpLeg: 'thigh_l',
  mixamorigLeftLeg: 'calf_l',
  mixamorigLeftFoot: 'foot_l',
  mixamorigLeftToeBase: 'ball_l',
  mixamorigRightUpLeg: 'thigh_r',
  mixamorigRightLeg: 'calf_r',
  mixamorigRightFoot: 'foot_r',
  mixamorigRightToeBase: 'ball_r',
});

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Complete authored character: ${message}`);
}

function meshMaterials(mesh: THREE.Mesh): THREE.Material[] {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function actorMeshes(root: THREE.Group): THREE.SkinnedMesh[] {
  const meshes: THREE.SkinnedMesh[] = [];
  root.traverse((node) => {
    const mesh = node as THREE.SkinnedMesh;
    if (mesh.isSkinnedMesh) meshes.push(mesh);
  });
  const names = new Set(meshes.map((mesh) => mesh.name));
  for (const name of REQUIRED_MESHES) assert(names.has(name), `template is missing skinned mesh ${name}`);
  assert(meshes.length === REQUIRED_MESHES.length, `expected exactly four authored skinned meshes; got ${meshes.length}`);
  const skeleton = meshes[0]!.skeleton;
  // GLTFLoader may instantiate one Skeleton wrapper per glTF skin even when all four
  // skins point at the same node hierarchy. What matters is shared posed Bone objects.
  assert(meshes.every((mesh) => mesh.skeleton.bones.length === skeleton.bones.length
    && mesh.skeleton.bones.every((bone, index) => bone === skeleton.bones[index])),
  'authored mesh parts do not share the same posed bone objects');
  assert(skeleton.bones.length === 52, `expected 52 named joints; got ${skeleton.bones.length}`);
  return meshes;
}

function setMorph(mesh: THREE.SkinnedMesh, name: string, value: number): void {
  const index = mesh.morphTargetDictionary?.[name];
  const influences = mesh.morphTargetInfluences;
  if (Number.isInteger(index) && influences && index! >= 0 && index! < influences.length) influences[index!] = value;
}

function materialsForActor(meshes: readonly THREE.SkinnedMesh[], look: Look, seed: unknown): THREE.Material[] {
  const tint = bodyTint(look, seed);
  const owned: THREE.Material[] = [];
  for (const mesh of meshes) {
    const source = mesh.material;
    const cloned = meshMaterials(mesh).map((material) => {
      const next = material.clone();
      if (mesh.name === 'Body' && 'color' in next && next.color instanceof THREE.Color) {
        next.color.multiply(new THREE.Color().setRGB(tint.skin[0], tint.skin[1], tint.skin[2]));
      }
      owned.push(next);
      return next;
    });
    mesh.material = Array.isArray(source) ? cloned : cloned[0]!;
    mesh.frustumCulled = false;
  }
  return owned;
}

function staticMorphValues(look: Look): { values: Record<string, number>; unsupported: string[] } {
  const values: Record<string, number> = look.body === 'woman'
    ? { bodyFeminine: 1, bodyMasculine: 0 }
    : { bodyFeminine: 0, bodyMasculine: 1 };
  if (look.face === 'round') values.headRound = 0.72;
  else if (look.face === 'oval') values.headOval = 0.58;
  else { values.headOval = 0.22; values.jawNarrower = 0.42; }

  const appearance = normalizeAvatarAppearance(look.appearance);
  if (appearance.height === 'tall') values.heightTaller = 0.65;
  if (appearance.height === 'short') values.heightShorter = 0.65;
  if (appearance.build === 'broad') { values.bodyMuscular = 0.28; values.bodyHeavier = 0.2; }
  if (appearance.build === 'slim') values.bodyThinner = 0.42;
  const unsupported = appearance.ageAppearance === 'adult' ? [] : [`ageAppearance:${appearance.ageAppearance}`];
  return { values, unsupported };
}

function makeRetargetedClips(
  template: THREE.Group,
  sourceRig: THREE.Object3D & { skeleton: THREE.Skeleton },
  clips: readonly THREE.AnimationClip[],
): ReadonlyMap<CompleteCharacterPose, THREE.AnimationClip> {
  const reference = cloneSkinnedHierarchy(template) as THREE.Group;
  const referenceMeshes = actorMeshes(reference);
  const target = referenceMeshes.find((mesh) => mesh.name === 'Body')!;
  const byName = new Map(clips.map((clip) => [clip.name, clip]));
  const result = new Map<CompleteCharacterPose, THREE.AnimationClip>();
  for (const name of ['idle', 'walk', 'dance'] as const) {
    const sourceClip = byName.get(name);
    assert(sourceClip, `clip pack is missing ${name}`);
    sourceRig.skeleton.pose();
    sourceRig.updateMatrixWorld(true);
    target.skeleton.pose();
    reference.updateMatrixWorld(true);
    const mapped = retargetClip(target, sourceRig, sourceClip, {
      names: { ...BODY_JOINT_MAP },
      hip: 'pelvis',
      scale: 1,
      preserveBoneMatrix: true,
      preserveBonePositions: true,
    });
    assert(mapped.tracks.length >= 18, `${name} retargeted too few tracks (${mapped.tracks.length})`);
    assert(mapped.tracks.every((track) => track.times.every(Number.isFinite) && track.values.every(Number.isFinite)),
      `${name} retarget produced nonfinite keyframes`);
    mapped.name = name;
    result.set(name, mapped);
    target.skeleton.pose();
  }
  return result;
}

function cacheFor(kit: CompleteCharacterKit): Cache {
  const existing = caches.get(kit);
  if (existing) return existing;
  const cache: Cache = { closed: false, actors: new Set(), promise: Promise.resolve(null as never) };
  cache.promise = Promise.all([
    kit.authoredCharacterAssets.loadTemplate(),
    kit.authoredCharacterAssets.loadMotionRig(),
  ]).then(([template, motion]) => {
    assert(!cache.closed, 'kit was disposed while authored assets were loading');
    actorMeshes(template);
    return { template, clips: makeRetargetedClips(template, motion.root, motion.clips) };
  }).catch((error: unknown) => {
    if (caches.get(kit) === cache) caches.delete(kit);
    throw error;
  });
  caches.set(kit, cache);
  kit.onDispose(() => {
    cache.closed = true;
    for (const dispose of [...cache.actors]) dispose();
    cache.actors.clear();
  });
  return cache;
}

/** Load a whole authored actor and retarget existing world clips; no old-body or head transplant is used. */
export async function loadCompleteCharacter(kit: CompleteCharacterKit, look: unknown, seed: unknown): Promise<CompleteCharacter> {
  const normalized = normalizeLook(look, seed);
  const cache = cacheFor(kit);
  const shared = await cache.promise;
  assert(!cache.closed, 'kit was disposed before actor creation');
  const object = cloneSkinnedHierarchy(shared.template) as THREE.Group;
  const meshes = actorMeshes(object);
  const bodyMesh = meshes.find((mesh) => mesh.name === 'Body')!;
  const ownedMaterials: THREE.Material[] = [];
  let mixer: THREE.AnimationMixer | null = null;
  let disposed = false;
  let unregisterKitDispose: (() => boolean) | null = null;
  let cleanupActor: (() => void) | null = null;
  try {
    ownedMaterials.push(...materialsForActor(meshes, normalized, seed));
    const staticMorph = staticMorphValues(normalized);
    for (const mesh of meshes) {
      const dictionary = mesh.morphTargetDictionary ?? {};
      for (const [name, value] of Object.entries(staticMorph.values)) {
        if (Object.hasOwn(dictionary, name)) setMorph(mesh, name, value);
      }
    }
    mixer = new THREE.AnimationMixer(bodyMesh);
    const actions = new Map<CompleteCharacterPose, THREE.AnimationAction>();
    for (const [pose, clip] of shared.clips) actions.set(pose, mixer.clipAction(clip));
    let activePose: CompleteCharacterPose | null = null;
    const baseInfluences = new Map(meshes.map((mesh) => [mesh, Float32Array.from(mesh.morphTargetInfluences ?? [])]));
    const setExpression = (name: CompleteCharacterExpression, seconds: number) => {
      if (disposed) return;
      for (const mesh of meshes) {
        const influences = mesh.morphTargetInfluences;
        const base = baseInfluences.get(mesh);
        if (influences && base) for (let index = 0; index < influences.length; index++) influences[index] = base[index]!;
      }
      const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
      if (name === 'smile') {
        setMorph(bodyMesh, 'mouthCornersUp', 0.62);
        setMorph(bodyMesh, 'mouthDimples', 0.25);
      } else if (name === 'grin') {
        setMorph(bodyMesh, 'mouthCornersUp', 0.9);
        setMorph(bodyMesh, 'mouthDimples', 0.35);
        setMorph(bodyMesh, 'jawDrop', 0.12);
      } else if (name === 'talk') {
        setMorph(bodyMesh, 'jawDrop', 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(time * Math.PI * 4)));
      } else if (name === 'blink') {
        setMorph(bodyMesh, 'eyeUpperLidDownLeft', 1);
        setMorph(bodyMesh, 'eyeUpperLidDownRight', 1);
        setMorph(bodyMesh, 'eyeLowerLidUpLeft', 0.25);
        setMorph(bodyMesh, 'eyeLowerLidUpRight', 0.25);
      }
    };
    const sample = (seconds: number, pose: CompleteCharacterPose) => {
      if (disposed) return;
      const action = actions.get(pose);
      assert(action, `no retargeted ${pose} action`);
      if (activePose !== pose) {
        for (const [otherPose, other] of actions) if (otherPose !== pose) other.stop();
        action.reset().play();
        activePose = pose;
      }
      const duration = action.getClip().duration;
      const time = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
      action.time = duration > 0 ? time % duration : 0;
      mixer!.update(0);
      object.updateMatrixWorld(true);
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      unregisterKitDispose?.();
      unregisterKitDispose = null;
      mixer?.stopAllAction();
      if (mixer) mixer.uncacheRoot(bodyMesh);
      mixer = null;
      object.removeFromParent();
      for (const material of ownedMaterials) material.dispose();
      ownedMaterials.length = 0;
      cache.actors.delete(dispose);
    };
    cleanupActor = dispose;
    cache.actors.add(dispose);
    unregisterKitDispose = kit.onDispose(dispose);
    // Kit.onDispose invokes callbacks immediately for an already-closed Kit.
    // Do not return a character whose materials and mixer were just released.
    assert(!disposed && !cache.closed, 'kit was disposed while actor was being created');
    setExpression(normalized.expression, 0);
    sample(0, 'idle');
    const triangleCount = meshes.reduce((sum, mesh) => sum + (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count) / 3, 0);
    const metrics: CompleteCharacterMetrics = Object.freeze({
      body: normalized.body,
      bodyKey: normalized.body === 'man' ? 'male' : 'female',
      meshNames: Object.freeze(meshes.map((mesh) => mesh.name)),
      triangleCount,
      jointCount: bodyMesh.skeleton.bones.length,
      retargetedClipNames: Object.freeze([...shared.clips.keys()]),
      unsupportedAppearance: Object.freeze(staticMorph.unsupported),
      morphNames: Object.freeze(Object.keys(bodyMesh.morphTargetDictionary ?? {})),
    });
    return { object, metrics, sample, setExpression, dispose };
  } catch (error) {
    if (cleanupActor) cleanupActor();
    else {
      mixer?.stopAllAction();
      if (mixer) mixer.uncacheRoot(bodyMesh);
      for (const material of ownedMaterials) material.dispose();
      object.removeFromParent();
    }
    throw error;
  }
}
