/**
 * The skinned body the player's own figure wears (the procedural avatar in src/scene/characters.ts is the
 * fallback: no WebGL2, a low-tier device or Data Saver, a failed fetch; see gate.ts). Reached only through
 * importBody(), so this module, GLTFLoader and the meshopt decoder are one lazy chunk fetched after a scene's first frame
 * (home-scene.ts for the home room, stand-in.ts for venues, avatar-preview.ts once one of those has fetched it).
 *
 *   loadBody(kit, look, seed, scale) → SkinnedBody
 *     one SkinnedMesh (one primitive, one material, 23 bones, ≤ 4 weights a vertex) from assets/base-body-<male|female>.glb,
 *     the clips from assets/clip-pack.glb, and the look's colours (tint.ts) as material uniforms.
 *
 * STATIC RENDERING (the battery rule). The body never asks for frames. A resting pose (idle, sit, interact, dance,
 * lie, soak, wash) is one still frame of its clip. Walking and jogging sample the walk/jog clip (stairs-up/-down on a
 * slope) at the stride phase the host already steps every walking frame. The only clips that run in time are the
 * bounded transitions (sit-enter, sit-exit, lie-down, get-up, door), and only when the caller says the host's motion
 * loop is running (show(pose, true), enter(true)): while one plays, `easing` is true, the host steps it with
 * step(dt), and settle() jumps to its end. Otherwise the pose is taken at once, so a still frame never shows a
 * half-sat body.
 */
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type * as THREE from 'three';
import type { Kit } from '../kit.ts';
import { BODY_FILES } from './files.ts';
import { BODY_MANIFEST } from './manifest.ts';
import type { BodyKey } from './manifest.ts';
import { bodyTint } from './tint.ts';
import { normalizeLook } from '../characters.ts';
import { avatarProportions, normalizeAvatarAppearance } from '../../types/avatar.ts';
import { resolveAvatarWearablesForRenderer } from '../../game/wardrobe/rules.ts';
import { createWardrobeRenderer } from '../wardrobe/renderer.ts';
import type { WardrobePresentation, WardrobeMetrics } from '../wardrobe/renderer.ts';
import { createAvatarAppearanceController } from './appearance.ts';
import { createFootContactController } from './foot-contact.ts';
import type { FootContact, FootSolveResult } from './foot-contact.ts';
import type { BodyTint } from './tint.ts';
import { DOOR, INTO, OUT, SEATED, STAIRS, STILL, WORK_INTO, WORK_OUT } from './poses.ts';
import type { BodyPose } from './poses.ts';

export type { BodyPose };

/**
 * The seated pose in body units (metres), measured from the shipped clips at the end of sit-enter: the underside of
 * the thighs is this high, and the pelvis this far behind the body's origin. The home scene seats the body with them.
 */
export const SIT = Object.freeze({ contact: 0.47, back: 0.332 });
/** The clips carry the animation rig's pelvis height, which leaves these bodies' soles this far under the floor (metres). */
export const LIFT = 0.045;
/** Scene units per body unit when the body stands as tall as the procedural avatar (2.45 units × the scene's scale). */
export const fitScale = (key: BodyKey, sceneScale: number): number => (2.45 * sceneScale) / BODY_MANIFEST.bodies[key].height;

export interface SkinnedBody {
  /** Add this to the scene; move it with place(). */
  readonly object: THREE.Group;
  readonly key: BodyKey;
  /** Scene units per body unit. */
  readonly scale: number;
  /** Effective local-axis scales; scale remains the vertical factor for older callers. */
  readonly scaleX: number;
  readonly scaleZ: number;
  /** Multiply the existing authored stride distance by this relative proportion factor. */
  readonly strideScale: number;
  readonly wardrobe: WardrobeMetrics;
  readonly wardrobeError: string | null;
  setPresentation(presentation: WardrobePresentation): boolean;
  sampleFootContacts(): readonly FootContact[];
  solveFeet(heightAt: (contact: FootContact) => number): FootSolveResult;
  /** True while a transition (sit-enter, sit-exit, lie-down, get-up, door) is playing. */
  readonly easing: boolean;
  readonly pose: BodyPose;
  /** True while seated, lying, soaking or entering/leaving a furniture pose. */
  readonly seated: boolean;
  /** Show a pose: a still frame, or, into and out of `sit` and `lie` with `animate`, the bounded transition first. */
  show(pose: BodyPose, animate?: boolean): void;
  /** Sample a known use loop after entry; the scene owns its bounded duration and motion loop. */
  sampleUse(pose: BodyPose, seconds: number): void;
  /** Just came in through a door: with `animate`, the push-and-step-through clip, then idle; else idle. */
  enter(animate: boolean): void;
  /**
   * One walking frame: the walk (or jog) clip at the stride phase (radians; 2π is a full left-right cycle). `climb`
   * > 0 walking up a stair or ramp, < 0 down it: the stairs clips (same length as the walk, so the phase holds).
   */
  stride(phase: number, jog: boolean, climb?: number): void;
  /** Advance a transition. True while more frames are needed. */
  step(dt: number): boolean;
  /** Jump to the end of a transition. */
  settle(): void;
  /** Stand (or walk) with the feet on a floor at height y; retain this destination while resting on furniture. */
  place(x: number, y: number, z: number, ry: number): void;
  /**
   * Sit with the pelvis over (x, z) on a seat whose top is at height `top`, facing ry. Lying: the hips over (x, z) on
   * a mattress whose top is `top`, the feet toward ry (the head the other way). Transitions blend from the current
   * placement to this resting anchor, or back to the last place() destination when getting up.
   */
  sitOn(x: number, top: number, z: number, ry: number): void;
  /** A standing/crouched object-use anchor, with feet over its floor; keep the separate place() exit destination. */
  workOn(x: number, floor: number, z: number, ry: number): void;
  fit(sceneScale: number): void;
  /** Wear another look. False when it needs the other body file (load again). */
  wear(look: unknown, seed?: unknown): boolean;
  dispose(): void;
}

const VERTEX = /* glsl */ `
attribute vec4 color;
varying vec4 vRegion;`;
const FRAGMENT = /* glsl */ `
varying vec4 vRegion;
uniform vec3 uSkin, uTop, uBottoms, uHair, uShoes;
uniform float uSkinLum, uClothLum, uSleeping;
uniform vec2 uEyeU;`;
// After the base-colour texel is in: keep the painted face, recolour skin by tone, dress the regions.
const DRESS = /* glsl */ `
#include <map_fragment>
{
  vec3 texel = diffuseColor.rgb;
  #ifdef USE_MAP
  if (uSleeping > 0.5) {
    float dx = abs(vMapUv.x - uEyeU.x) < abs(vMapUv.x - uEyeU.y) ? vMapUv.x - uEyeU.x : vMapUv.x - uEyeU.y;
    float eye = (1.0 - smoothstep(0.82, 1.0, length(vec2(dx / 0.031, (vMapUv.y - 0.177734375) / 0.014)))) * vRegion.r;
    vec3 cheek = texture2D(map, vec2(vMapUv.x, 0.205)).rgb;
    float lidY = 0.178 + 0.003 * (1.0 - min(1.0, dx * dx / 0.0009));
    float lid = (1.0 - smoothstep(0.0011, 0.0023, abs(vMapUv.y - lidY))) * (1.0 - smoothstep(0.026, 0.031, abs(dx)));
    texel = mix(texel, mix(cheek, cheek * 0.22, lid), eye);
  }
  #endif
  float hi = max(max(texel.r, texel.g), texel.b), lo = min(min(texel.r, texel.g), texel.b);
  float skinness = hi > 0.01 ? smoothstep(0.28, 0.42, (hi - lo) / hi) : 0.0;
  float shade = clamp(dot(texel, vec3(0.2126, 0.7152, 0.0722)) / mix(uClothLum, uSkinLum, skinness), 0.55, 1.35);
  float shoes = clamp(1.0 - vRegion.r - vRegion.g - vRegion.b - vRegion.a, 0.0, 1.0);
  vec3 skin = mix(texel, texel * uSkin, skinness);
  diffuseColor.rgb = skin * vRegion.r + (uTop * vRegion.g + uBottoms * vRegion.b + uHair * vRegion.a + uShoes * shoes) * shade;
}`;

let loader: GLTFLoader | null = null;
let clipsOnce: Promise<THREE.AnimationClip[]> | null = null;
function gltfLoader(): GLTFLoader {
  if (!loader) loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  return loader;
}
/** The clip pack, fetched once a session (the two bodies share it). A failed fetch can be tried again. */
function loadClips(): Promise<THREE.AnimationClip[]> {
  clipsOnce ??= gltfLoader().loadAsync(BODY_FILES.clips).then((gltf) => gltf.animations).catch((error: unknown) => { clipsOnce = null; throw error; });
  return clipsOnce;
}

/** Load the body a look wears, dressed in it, scaled for a scene whose avatar scale is `sceneScale`. */
export async function loadBody(kit: Kit, look: unknown, seed: unknown, sceneScale: number): Promise<SkinnedBody> {
  const { THREE: T } = kit;
  let tint = bodyTint(look, seed);
  const key = tint.key, facts = BODY_MANIFEST.bodies[key];
  await MeshoptDecoder.ready;
  const [gltf, clips] = await Promise.all([gltfLoader().loadAsync(BODY_FILES[key]), loadClips()]);
  let mesh: THREE.SkinnedMesh | null = null;
  gltf.scene.traverse((node) => { if ((node as THREE.SkinnedMesh).isSkinnedMesh && !mesh) mesh = node as THREE.SkinnedMesh; });
  if (!mesh) throw new Error(`no skinned mesh in ${BODY_FILES[key]}`);
  const skinned: THREE.SkinnedMesh = mesh;
  const loaded = skinned.material as THREE.MeshStandardMaterial;
  const map = loaded.map;
  if (!map) throw new Error(`no base colour in ${BODY_FILES[key]}`);
  // The scene's own material family (Lambert when scenery is matte), with the look as uniforms.
  const material = kit.matte ? new T.MeshLambertMaterial({ map }) : new T.MeshStandardMaterial({ map, roughness: 0.82, metalness: 0 });
  const uniforms = {
    uSkin: { value: new T.Vector3() }, uTop: { value: new T.Vector3() }, uBottoms: { value: new T.Vector3() },
    uHair: { value: new T.Vector3() }, uShoes: { value: new T.Vector3() },
    uSkinLum: { value: facts.skinLum }, uClothLum: { value: facts.clothLum },
    uSleeping: { value: 0 }, uEyeU: { value: new T.Vector2(key === 'male' ? 141 / 1024 : 134 / 1024, key === 'male' ? 240 / 1024 : 239 / 1024) },
  };
  const apply = (next: BodyTint) => { for (const part of ['skin', 'top', 'bottoms', 'hair', 'shoes'] as const) uniforms[`u${part[0]!.toUpperCase()}${part.slice(1)}` as 'uSkin'].value.fromArray(next[part]); };
  apply(tint);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>${VERTEX}`).replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRegion = color;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>${FRAGMENT}`).replace('#include <map_fragment>', DRESS);
  };
  material.customProgramCacheKey = () => 'allworld-body-sleep-1';
  loaded.dispose();
  skinned.material = material;
  // A posed body leaves its bind-pose bounds; one small mesh is cheaper to draw than to cull wrongly.
  skinned.frustumCulled = false;
  skinned.name = `body-${key}`;

  const object = new T.Group();
  object.name = 'skinned-body';
  object.add(gltf.scene);
  // Garment rest fitting must see the untouched asset before age-face geometry changes.
  const wardrobe = createWardrobeRenderer(skinned, kit.matte);
  const appearanceMade = createAvatarAppearanceController(skinned);
  const footContact = createFootContactController(object, skinned, wardrobe.object);
  let read = normalizeLook(look, seed), appearance = normalizeAvatarAppearance(read.appearance);
  let proportions = avatarProportions(appearance), sceneFit = sceneScale;
  wardrobe.wear({ look: read, ids: resolveAvatarWearablesForRenderer(read) });
  if (appearanceMade.ok) appearanceMade.controller.apply(appearance);
  const mixer = new T.AnimationMixer(gltf.scene);
  const actions = new Map(clips.map((clip) => [clip.name, mixer.clipAction(clip)]));
  let active: THREE.AnimationAction | null = null, scale = 1, pose: BodyPose = 'idle';
  let strideClimb = 0;
  // A running transition: the clip, how far in, and the pose it ends in.
  type Placement = { x: number; y: number; z: number; ry: number };
  let standing: Placement = { x: 0, y: 0, z: 0, ry: 0 }, working: Placement | null = null;
  let seat: { x: number; top: number; z: number; ry: number; lying: boolean } | null = null;
  type BoneFrame = { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };
  let blendFrom: BoneFrame[] | null = null;
  const CROSSFADE = 0.16;
  let transition: { clip: string; time: number; length: number; then: BodyPose; from: Placement } | null = null;
  const anchored = new Set([...Object.values(INTO), ...Object.values(OUT), ...Object.values(WORK_INTO), ...Object.values(WORK_OUT)]);
  const clipFor = (name: string) => key === 'female' && actions.has(`${name}-female`) ? `${name}-female` : name;

  function put() {
    const back = seat?.lying ? 0 : SIT.back * scale * proportions.depth;
    const resting = seat ? { x: seat.x + Math.sin(seat.ry) * back, y: seat.lying ? seat.top : seat.top - SIT.contact * scale, z: seat.z + Math.cos(seat.ry) * back, ry: seat.ry } : null;
    const floor = WORK_INTO[pose] && working ? working : standing;
    const target = SEATED.has(pose) && resting ? resting : { ...floor, y: floor.y + LIFT * scale };
    if (transition && anchored.has(transition.clip)) {
      const t = transition.time / transition.length, eased = t * t * (3 - 2 * t), from = transition.from;
      object.position.set(from.x + (target.x - from.x) * eased, from.y + (target.y - from.y) * eased, from.z + (target.z - from.z) * eased);
      const turn = Math.atan2(Math.sin(target.ry - from.ry), Math.cos(target.ry - from.ry));
      object.rotation.y = from.ry + turn * eased;
    } else {
      object.position.set(target.x, target.y, target.z);
      object.rotation.y = target.ry;
    }
  }

  function sample(name: string, time: number) {
    const action = actions.get(clipFor(name));
    if (!action) return;
    if (action !== active) { active?.stop(); action.play(); active = action; }
    action.time = Math.min(Math.max(time, 0), action.getClip().duration);
    mixer.update(0);
    if (blendFrom && transition) {
      const t = Math.min(1, transition.time / CROSSFADE), eased = t * t * (3 - 2 * t);
      skinned.skeleton.bones.forEach((bone, index) => {
        const from = blendFrom?.[index];
        if (!from) return;
        bone.position.lerpVectors(from.position, bone.position, eased);
        bone.quaternion.slerp(from.quaternion, 1 - eased);
        bone.scale.lerpVectors(from.scale, bone.scale, eased);
      });
      if (t >= 1) blendFrom = null;
    }
  }
  function still(next: BodyPose) {
    const { clip, at } = STILL[next];
    sample(clip, (actions.get(clipFor(clip))?.getClip().duration ?? 0) * at);
  }
  function finish() {
    if (!transition) return;
    const then = transition.then;
    transition = null; blendFrom = null;
    still(then);
    put();
  }
  /** Run a bounded clip into the current pose, or (none, or not in the pack) take the pose at once. */
  function play(clip: string | undefined) {
    const length = clip ? actions.get(clipFor(clip))?.getClip().duration ?? 0 : 0;
    if (!clip || !length) { transition = null; blendFrom = null; return still(pose); }
    // An interrupted use loop can be at any phase. Blend its exact current local bones into the authored exit.
    blendFrom = Object.values(OUT).includes(clip) || Object.values(WORK_OUT).includes(clip)
      ? skinned.skeleton.bones.map(bone => ({ position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone() })) : null;
    transition = { clip, time: 0, length, then: pose, from: { x: object.position.x, y: object.position.y, z: object.position.z, ry: object.rotation.y } };
    sample(clip, 0);
  }
  const body: SkinnedBody = {
    object, key,
    get scale() { return scale; },
    get scaleX() { return scale * proportions.width; },
    get scaleZ() { return scale * proportions.depth; },
    get strideScale() { return proportions.height * proportions.depth; },
    get wardrobe() { return wardrobe.metrics; },
    get wardrobeError() { return wardrobe.lastError; },
    setPresentation(next) { uniforms.uSleeping.value = next === 'sleeping' ? 1 : 0; return wardrobe.setPresentation(next); },
    sampleFootContacts() { object.updateWorldMatrix(true, false); object.updateMatrixWorld(true); return footContact.sample(); },
    solveFeet(heightAt) {
      // SkinnedMesh updates bindMatrixInverse in updateMatrixWorld, not updateWorldMatrix.
      object.updateWorldMatrix(true, false); object.updateMatrixWorld(true);
      let result = footContact.solve(heightAt);
      // Real stair risers need more than the flat-floor correction. Retain the per-pass anatomical bound.
      if (strideClimb) for (let pass = 0; pass < 3 && result.limited && result.maxError > 0.002; pass++) result = footContact.solve(heightAt);
      return result;
    },
    get easing() { return transition !== null; },
    get pose() { return pose; },
    get seated() { return SEATED.has(pose) || SEATED.has(transition?.clip ?? ''); },
    show(next, animate = false) {
      if (next === pose && transition && animate) return;
      if (next === pose && !transition) return still(next);
      const into = next !== pose ? INTO[next] ?? WORK_INTO[next] : undefined, out = next !== pose && next !== 'walk' && next !== 'jog' ? OUT[pose] ?? WORK_OUT[pose] : undefined;
      pose = next;
      play(animate ? into ?? out : undefined);
    },
    sampleUse(next, seconds) {
      if (transition) return;
      pose = next;
      const { clip } = STILL[next], length = actions.get(clipFor(clip))?.getClip().duration ?? 0;
      if (length) sample(clip, ((Math.max(0, seconds) % length) + length) % length);
      put();
    },
    enter(animate) { pose = 'idle'; play(animate ? DOOR : undefined); },
    stride(phase, jog, climb = 0) {
      strideClimb = climb;
      transition = null; blendFrom = null;
      pose = jog ? 'jog' : 'walk';
      const name = !climb ? pose : climb > 0 ? STAIRS.up : STAIRS.down, clip = actions.get(name)?.getClip();
      if (!clip) return;
      const turn = phase / (2 * Math.PI);
      sample(name, (turn - Math.floor(turn)) * clip.duration);
    },
    step(dt) {
      if (!transition) return false;
      transition.time += Math.max(dt, 0);
      if (transition.time >= transition.length) { finish(); return false; }
      sample(transition.clip, transition.time);
      put();
      return true;
    },
    settle: finish,
    place(x, y, z, ry) { standing = { x, y, z, ry }; put(); },
    sitOn(x, top, z, ry) {
      seat = { x, top, z, ry, lying: (transition?.clip ?? pose) === 'get-up' || pose === 'lie' };
      put();
    },
    workOn(x, floor, z, ry) { working = { x, y: floor, z, ry }; put(); },
    fit(nextSceneScale) {
      sceneFit = nextSceneScale;
      scale = fitScale(key, sceneFit) * proportions.height;
      object.scale.set(scale * proportions.width, scale, scale * proportions.depth);
      put();
    },
    wear(next, nextSeed) {
      const wanted = bodyTint(next, nextSeed);
      if (wanted.key !== key) return false;
      const nextRead = normalizeLook(next, nextSeed);
      if (!wardrobe.wear({ look: nextRead, ids: resolveAvatarWearablesForRenderer(nextRead) })) return true;
      read = nextRead; appearance = normalizeAvatarAppearance(read.appearance); proportions = avatarProportions(appearance);
      if (appearanceMade.ok) appearanceMade.controller.apply(appearance);
      body.fit(sceneFit);
      tint = wanted; apply(tint);
      return true;
    },
    dispose() {
      wardrobe.dispose();
      if (appearanceMade.ok) appearanceMade.controller.dispose();
      mixer.stopAllAction();
      mixer.uncacheRoot(gltf.scene);
      skinned.geometry.dispose();
      material.dispose();
      map.dispose();
      skinned.skeleton.dispose();
      object.removeFromParent();
    },
  };
  body.fit(sceneScale);
  still('idle');
  return body;
}
