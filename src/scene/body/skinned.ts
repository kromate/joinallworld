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
 * STATIC RENDERING (the battery rule). The body never asks for frames. A resting pose (idle, sit, interact, dance) is
 * one still frame of its clip. Walking and jogging sample the walk/jog clip at the stride phase the host already steps
 * every walking frame. The only clips that run in time are the bounded transitions (sit-enter, sit-exit), and only
 * when the caller says the host's motion loop is running (show(pose, true)): while one plays, `easing` is true, the
 * host steps it with step(dt), and settle() jumps to its end. Otherwise the pose is taken at once, so a still frame
 * never shows a half-sat body.
 */
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type * as THREE from 'three';
import type { Kit } from '../kit.ts';
import { BODY_FILES } from './files.ts';
import { BODY_MANIFEST } from './manifest.ts';
import type { BodyKey } from './manifest.ts';
import { bodyTint } from './tint.ts';
import type { BodyTint } from './tint.ts';

/** What the body can show. */
export type BodyPose = 'idle' | 'walk' | 'jog' | 'sit' | 'interact' | 'dance';
/** Where a resting pose's still frame is taken, as a share of its clip. */
const STILL: Record<BodyPose, { clip: string; at: number }> = {
  idle: { clip: 'idle', at: 0 }, walk: { clip: 'walk', at: 0.25 }, jog: { clip: 'jog', at: 0.25 },
  sit: { clip: 'sit', at: 0 }, interact: { clip: 'interact', at: 0.4 }, dance: { clip: 'dance', at: 0.25 },
};
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
  /** True while a transition (sit-enter, sit-exit) is playing. */
  readonly easing: boolean;
  readonly pose: BodyPose;
  /** True while seated or getting up (placed by sitOn). */
  readonly seated: boolean;
  /** Show a pose: a still frame, or, into and out of `sit` with `animate`, the bounded transition first. */
  show(pose: BodyPose, animate?: boolean): void;
  /** One walking frame: the walk (or jog) clip at the stride phase (radians; 2π is a full left-right cycle). */
  stride(phase: number, jog: boolean): void;
  /** Advance a transition. True while more frames are needed. */
  step(dt: number): boolean;
  /** Jump to the end of a transition. */
  settle(): void;
  /** Stand (or walk) with the feet on a floor at height y. */
  place(x: number, y: number, z: number, ry: number): void;
  /** Sit with the pelvis over (x, z) on a seat whose top is at height `top`, facing ry. */
  sitOn(x: number, top: number, z: number, ry: number): void;
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
uniform float uSkinLum, uClothLum;`;
// After the base-colour texel is in: keep the painted face, recolour skin by tone, dress the regions.
const DRESS = /* glsl */ `
#include <map_fragment>
{
  vec3 texel = diffuseColor.rgb;
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
  };
  const apply = (next: BodyTint) => { for (const part of ['skin', 'top', 'bottoms', 'hair', 'shoes'] as const) uniforms[`u${part[0]!.toUpperCase()}${part.slice(1)}` as 'uSkin'].value.fromArray(next[part]); };
  apply(tint);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>${VERTEX}`).replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRegion = color;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>${FRAGMENT}`).replace('#include <map_fragment>', DRESS);
  };
  material.customProgramCacheKey = () => 'allworld-body';
  loaded.dispose();
  skinned.material = material;
  // A posed body leaves its bind-pose bounds; one small mesh is cheaper to draw than to cull wrongly.
  skinned.frustumCulled = false;
  skinned.name = `body-${key}`;

  const object = new T.Group();
  object.name = 'skinned-body';
  object.add(gltf.scene);
  const mixer = new T.AnimationMixer(gltf.scene);
  const actions = new Map(clips.map((clip) => [clip.name, mixer.clipAction(clip)]));
  let active: THREE.AnimationAction | null = null, scale = 1, pose: BodyPose = 'idle';
  // A running transition: the clip, how far in, and the pose it ends in.
  let transition: { clip: string; time: number; length: number; then: BodyPose } | null = null;

  function sample(name: string, time: number) {
    const action = actions.get(name);
    if (!action) return;
    if (action !== active) { active?.stop(); action.play(); active = action; }
    action.time = Math.min(Math.max(time, 0), action.getClip().duration);
    mixer.update(0);
  }
  function still(next: BodyPose) {
    const { clip, at } = STILL[next];
    sample(clip, (actions.get(clip)?.getClip().duration ?? 0) * at);
  }
  function finish() {
    if (!transition) return;
    const then = transition.then;
    transition = null;
    still(then);
  }
  const body: SkinnedBody = {
    object, key,
    get scale() { return scale; },
    get easing() { return transition !== null; },
    get pose() { return pose; },
    get seated() { return pose === 'sit' || transition?.clip === 'sit-exit'; },
    show(next, animate = false) {
      if (next === pose && !transition) return still(next);
      const into = next === 'sit' && pose !== 'sit', out = pose === 'sit' && next !== 'sit' && next !== 'walk' && next !== 'jog';
      pose = next;
      const clip = !animate ? null : into ? 'sit-enter' : out ? 'sit-exit' : null, length = clip ? actions.get(clip)?.getClip().duration ?? 0 : 0;
      if (!clip || !length) { transition = null; return still(next); }
      transition = { clip, time: 0, length, then: next };
      sample(clip, 0);
    },
    stride(phase, jog) {
      transition = null;
      pose = jog ? 'jog' : 'walk';
      const clip = actions.get(pose)?.getClip();
      if (!clip) return;
      const turn = phase / (2 * Math.PI);
      sample(pose, (turn - Math.floor(turn)) * clip.duration);
    },
    step(dt) {
      if (!transition) return false;
      transition.time += Math.max(dt, 0);
      if (transition.time >= transition.length) { finish(); return false; }
      sample(transition.clip, transition.time);
      return true;
    },
    settle: finish,
    place(x, y, z, ry) { object.position.set(x, y + LIFT * scale, z); object.rotation.y = ry; },
    sitOn(x, top, z, ry) {
      const back = SIT.back * scale;
      object.position.set(x + Math.sin(ry) * back, top - SIT.contact * scale, z + Math.cos(ry) * back);
      object.rotation.y = ry;
    },
    fit(sceneScale) { scale = fitScale(key, sceneScale); object.scale.setScalar(scale); },
    wear(next, nextSeed) {
      const wanted = bodyTint(next, nextSeed);
      if (wanted.key !== key) return false;
      tint = wanted; apply(tint);
      return true;
    },
    dispose() {
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
