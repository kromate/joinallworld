/**
 * OWNER: scenes
 * The HIGH tier's one post stack, built once per renderer and fetched only when a high-tier host asks for it (a phone or the
 * wide tier never imports this file):
 *
 *   RenderPass          the scene into a half-float buffer with 4x MSAA (hardware edges, no extra code)
 *   N8AOPostPass        ambient occlusion at half resolution in its "Performance" quality: contact shadows under eaves, cars, steps
 *   EffectPass          bloom (only what is brighter than the threshold, so only lamps and signs), tone mapping, the colour grade
 *                       (a 16^3 table made in code, grade.ts) and a gentle vignette, all in one shader
 *
 * NO SMAA. Its two lookup images are about 60 kB gzipped inside the lazy chunk, more than every other effect here together, and
 * MSAA gives the same clean edges on the scene before tone mapping. The depth-aware upsampling of the half-resolution AO keeps its
 * own edges clean, so the AO needs no screen-space anti-aliasing either.
 *
 * TONE MAPPING. The renderer's own tone mapper is off while a composer draws, so the stack applies the same one the renderer
 * was set up with (src/scene/look.ts: Khronos Neutral by default, ?tm=aces|agx to compare) at exposure 1. The art is
 * hand-picked sRGB colour, which is why Neutral is the default and ACES stays an option.
 *
 * AO SCALE. A street is built at 1.5 units to the metre (UNITS_PER_METRE in street-life/street-scene.ts) and a venue at about
 * the same, so a 1.1 m reach is 1.65 units: wide enough to put a soft shadow under an eave or a car, narrow enough not to
 * dirty a wall. The scenes already carry baked vertex AO (ao-bake.ts), so the intensity is modest.
 *
 * The libraries are handed in through `loadPostLibs()` so the wiring can be tested without a GL context.
 */
import type * as THREE from 'three';
import type { ThreeModule } from '../types.ts';
import { buildLut, gradeParams, type GradeKind, type HourBand } from './grade.ts';

/** What the stack needs from `postprocessing` and `n8ao`: named classes only, so nothing else is pulled in. */
export interface PostLibs {
  EffectComposer: new (renderer: THREE.WebGLRenderer, options?: Record<string, unknown>) => Composer
  RenderPass: new (scene: THREE.Scene, camera: THREE.Camera) => PostPass
  EffectPass: new (camera: THREE.Camera, ...effects: unknown[]) => PostPass
  BloomEffect: new (options?: Record<string, unknown>) => unknown
  LUT3DEffect: new (lut: THREE.Texture, options?: Record<string, unknown>) => unknown
  VignetteEffect: new (options?: Record<string, unknown>) => unknown
  ToneMappingEffect: new (options?: Record<string, unknown>) => unknown
  ToneMappingMode: { NEUTRAL: number; ACES_FILMIC: number; AGX: number }
  /** Absent when ambient occlusion is off, so its code is never fetched. */
  N8AOPostPass?: new (scene: THREE.Scene, camera: THREE.Camera, width?: number, height?: number) => AoPass
}
export interface PostPass { enabled?: boolean; scene?: THREE.Scene; camera?: THREE.Camera; mainScene?: THREE.Scene; mainCamera?: THREE.Camera; setSize?(width: number, height: number): void; dispose?(): void }
export interface AoPass extends PostPass {
  setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void
  configuration: { aoRadius: number; distanceFalloff: number; intensity: number; halfRes: boolean; depthAwareUpsampling: boolean }
}
export interface Composer {
  addPass(pass: PostPass): void
  render(delta?: number): void
  inputBuffer: THREE.WebGLRenderTarget
  outputBuffer: THREE.WebGLRenderTarget
  passes: PostPass[]
  dispose(): void
}

/** The AO settings, in scene units (1.5 per metre). Exported so a test pins them and a host can read what was chosen. */
export const AO_SETTINGS = Object.freeze({ quality: 'Performance' as const, radius: 1.65, distanceFalloff: 0.8, intensity: 2.2 });
/** Bloom as today's night bloom had it: only emissive surfaces pass the threshold. */
export const BLOOM_SETTINGS = Object.freeze({ intensity: 0.45, radius: 0.6, luminanceSmoothing: 0.06 });
export const VIGNETTE_SETTINGS = Object.freeze({ offset: 0.35, darkness: 0.4 });
/** The frame buffers draw at up to this pixel ratio (the canvas keeps the tier's): a retina screen costs about half the pixels. */
export const DEFAULT_MAX_RATIO = 1.5;
/** Hardware multisampling of the scene buffer. */
export const MSAA_SAMPLES = 4;

export interface PostOptions {
  /** Bloom threshold (linear luminance). */
  threshold?: number
  /** The grade to start with; change it later with `setGrade`. */
  grade?: { kind: GradeKind; band: HourBand }
  /** Ambient occlusion on or off. Off never loads n8ao. */
  ao?: boolean
  /** The highest pixel ratio the frame buffers use. */
  maxRatio?: number
}
export interface Post {
  render(scene: THREE.Scene, camera: THREE.Camera): void
  setSize(width: number, height: number, pixelRatio: number): void
  /** Change the colour grade (season or hour); the table is rewritten in place and re-uploaded. */
  setGrade(kind: GradeKind, band: HourBand): void
  dispose(): void
}

/**
 * The stack is ON by default on the high tier (the owner's call on 20 October 2026: deploy with everything on). The wave-1 critic
 * (docs/evidence/critic-wave1-20261020.md) found little for it to work on until lamps, windows and signs emit (phase 2b), so
 * `?post=0` turns it off for a before/after pair and for a slow machine.
 */
export function postEnabled(win: { location?: { search?: string } } = globalThis): boolean {
  try { return new URLSearchParams(win.location?.search || '').get('post') !== '0'; } catch { return true; }
}

/**
 * Post-process ambient occlusion is on by default when the stack is on. Measured on an M4 Pro at 1080p: the AO pass adds about 0.7 to 1.5 ms
 * and the whole stack about 3 ms; at 2x about 2.2 ms for AO and 3.7 ms for the stack (docs/agent-work/os-phase2-post-20261019.md), inside the
 * 3 ms and 5 ms gates. `?ao=0` turns it off (and, in look.ts, the baked AO too), for comparison and for a slow machine.
 */
export function postAoEnabled(win: { location?: { search?: string } } = globalThis): boolean {
  try { return new URLSearchParams(win.location?.search || '').get('ao') !== '0'; } catch { return true; }
}

/** The stack's tone mapper for the renderer's own: Neutral unless the renderer was set to ACES or AgX. */
function toneModeFor(THREE: ThreeModule, renderer: THREE.WebGLRenderer, modes: PostLibs['ToneMappingMode']): number {
  if (renderer.toneMapping === THREE.ACESFilmicToneMapping) return modes.ACES_FILMIC;
  if (renderer.toneMapping === THREE.AgXToneMapping) return modes.AGX;
  return modes.NEUTRAL;
}

/** Fetch the libraries (a lazy chunk of its own). Named imports only. */
export async function loadPostLibs(ao: boolean): Promise<PostLibs> {
  // Destructured in the `then` so the bundler can drop every other export of the library.
  const [pp, n8] = await Promise.all([
    import('postprocessing').then(({ EffectComposer, RenderPass, EffectPass, BloomEffect, LUT3DEffect, VignetteEffect, ToneMappingEffect, ToneMappingMode }) => ({ EffectComposer, RenderPass, EffectPass, BloomEffect, LUT3DEffect, VignetteEffect, ToneMappingEffect, ToneMappingMode })),
    // @ts-ignore n8ao ships no type declarations; what is used from it is described by PostLibs above.
    ao ? import('n8ao').then(({ N8AOPostPass }: { N8AOPostPass: PostLibs['N8AOPostPass'] }) => ({ N8AOPostPass })) : Promise.resolve(null),
  ]);
  return { ...pp, ...n8 } as unknown as PostLibs;
}

/** Build the stack from libraries already in hand. The passes are added in this order, which a test pins. */
export function buildPost(THREE: ThreeModule, renderer: THREE.WebGLRenderer, libs: PostLibs, width: number, height: number, options: PostOptions = {}): Post {
  const { threshold = 0.85, grade = { kind: 'clear' as GradeKind, band: 'day' as HourBand }, maxRatio = DEFAULT_MAX_RATIO } = options;
  const composer = new libs.EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: MSAA_SAMPLES });
  const camera = new THREE.PerspectiveCamera(), scene = new THREE.Scene();

  const size = 16;
  const lutData = buildLut(gradeParams(grade.kind, grade.band), size);
  const lut = new THREE.Data3DTexture(lutData, size, size, size);
  lut.format = THREE.RGBAFormat; lut.type = THREE.UnsignedByteType;
  lut.minFilter = THREE.LinearFilter; lut.magFilter = THREE.LinearFilter;
  lut.wrapS = lut.wrapT = lut.wrapR = THREE.ClampToEdgeWrapping;
  lut.unpackAlignment = 1; lut.needsUpdate = true;

  const render = new libs.RenderPass(scene, camera);
  composer.addPass(render);
  let ao: AoPass | null = null;
  if (options.ao && libs.N8AOPostPass) {
    ao = new libs.N8AOPostPass(scene, camera, width, height);
    ao.setQualityMode(AO_SETTINGS.quality);
    ao.configuration.halfRes = true;
    ao.configuration.depthAwareUpsampling = true;
    ao.configuration.aoRadius = AO_SETTINGS.radius;
    ao.configuration.distanceFalloff = AO_SETTINGS.distanceFalloff;
    ao.configuration.intensity = AO_SETTINGS.intensity;
    composer.addPass(ao);
  }
  const bloom = new libs.BloomEffect({ luminanceThreshold: threshold, mipmapBlur: true, ...BLOOM_SETTINGS });
  const tone = new libs.ToneMappingEffect({ mode: toneModeFor(THREE, renderer, libs.ToneMappingMode) });
  const graded = new libs.LUT3DEffect(lut);
  const vignette = new libs.VignetteEffect({ ...VIGNETTE_SETTINGS });
  const grading = new libs.EffectPass(camera, bloom, tone, graded, vignette);
  composer.addPass(grading);

  let sizeKey = '';
  return {
    render(view, eye) {
      // postprocessing's passes take the scene and camera as mainScene / mainCamera; n8ao's takes them as scene / camera.
      render.mainScene = view; render.mainCamera = eye;
      if (ao) { ao.scene = view; ao.camera = eye; }
      grading.mainCamera = eye;
      composer.render();
    },
    setSize(w, h, ratio) {
      const k = Math.min(ratio, maxRatio), bw = Math.max(1, Math.round(w * k)), bh = Math.max(1, Math.round(h * k));
      const key = `${bw}x${bh}`;
      if (key === sizeKey) return;
      sizeKey = key;
      // The frame buffers follow the capped ratio, not the canvas: the last pass stretches them over the screen.
      composer.inputBuffer.setSize(bw, bh); composer.outputBuffer.setSize(bw, bh);
      for (const pass of composer.passes) pass.setSize?.(bw, bh);
    },
    setGrade(kind, band) {
      (lut.image as unknown as { data: Uint8Array }).data.set(buildLut(gradeParams(kind, band), size));
      lut.needsUpdate = true;
    },
    dispose() { composer.dispose(); lut.dispose(); },
  };
}

/** Fetch the libraries and build the stack. */
export async function createPost(THREE: ThreeModule, renderer: THREE.WebGLRenderer, width: number, height: number, options: PostOptions = {}): Promise<Post> {
  const libs = await loadPostLibs(Boolean(options.ao));
  return buildPost(THREE, renderer, libs, width, height, options);
}
