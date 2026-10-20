/**
 * OWNER: scenes
 * The HIGH quality tier's extras, all lazy: nothing here is in the startup bundle, and a phone never
 * imports it. A procedurally generated environment map (three's RoomEnvironment through PMREM, no
 * download) at low intensity gives standard materials a believable specular response, and a subtle
 * post stack for emissive night lights, contact shading and a climate grade (src/scene/fx/post.ts, fetched only on demand).
 */
import type * as THREE from 'three';
import type { ThreeModule } from './types.ts';
import type { GradeKind, HourBand } from './fx/grade.ts';

/** Environment intensity as a share of the scene's brightest hemisphere light (night gets less). */
/** The bloom pipeline draws at up to this pixel ratio (the canvas itself stays at the tier's): a retina screen costs ~half the pixels, and a glow is soft anyway. */
export const BLOOM_RATIO = 1.5;
export const ENV_INTENSITY = 0.1;

type Renderer = THREE.WebGLRenderer;
const started = new WeakSet<THREE.Scene>();
const generated = new WeakMap<Renderer, THREE.Texture>();

/**
 * Give `scene` the generated environment, once per scene, then redraw the view that asked (the caller
 * may be demand-driven). Returns a promise that resolves when it is in place (or never needed).
 */
export async function ensureEnvironment(THREE: ThreeModule, renderer: Renderer, scene: THREE.Scene, redraw?: THREE.Camera | (() => void), intensity = ENV_INTENSITY): Promise<void> {
  if (started.has(scene) || typeof renderer.compile !== 'function') return;
  started.add(scene);
  try {
    let texture = generated.get(renderer);
    if (!texture) {
      const { RoomEnvironment } = await import('three/examples/jsm/environments/RoomEnvironment.js');
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      texture = pmrem.fromScene(room, 0.04).texture;
      room.dispose?.(); pmrem.dispose();
      generated.set(renderer, texture);
    }
    scene.environment = texture;
    scene.environmentIntensity = intensity;
    if (typeof redraw === 'function') redraw(); else if (redraw) renderer.render(scene, redraw);
  } catch { /* no environment: the scene simply keeps its direct lights */ }
}

export interface Bloom {
  render(scene: THREE.Scene, camera: THREE.Camera): void
  setSize(width: number, height: number, pixelRatio: number): void
  /** Re-grade the picture for a season and hour (src/scene/fx/grade.ts). Optional: a caller that never asks keeps the clear-day grade. */
  setGrade?(kind: GradeKind, band: HourBand): void
  dispose(): void
}
/**
 * The HIGH tier's post stack (src/scene/fx/post.ts): bloom for the night's lamps and signs (threshold high so only emissive
 * surfaces glow), contact shading, a gentle vignette, MSAA and the climate grade, in one lazy chunk. This keeps its old
 * signature: the stack is built here and drawn at up to BLOOM_RATIO.
 */
export async function createBloom(THREE: ThreeModule, renderer: Renderer, width: number, height: number, threshold = 0.85, grade?: { kind: GradeKind; band: HourBand }): Promise<Bloom> {
  const { createPost, postAoEnabled } = await import('./fx/post.ts');
  const post = await createPost(THREE, renderer, width, height, { threshold, maxRatio: BLOOM_RATIO, ao: postAoEnabled(), ...(grade ? { grade } : {}) });
  post.setSize(width, height, renderer.getPixelRatio?.() ?? 1);
  return post;
}
