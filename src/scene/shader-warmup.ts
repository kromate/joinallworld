/**
 * OWNER: scenes
 * Shader programs are linked off the main thread before the first draw that needs them.
 *
 * WebGL links a program in the GPU process, but the first draw with a new program asks for its
 * uniforms, which waits for the link: 0.1 to 1.8 s on one frame when a scene, a crowd or a street tile
 * first appears. With KHR_parallel_shader_compile, renderer.compile() starts the links and each program
 * reports when it is linked without waiting (what renderer.compileAsync() does, but tolerating a material
 * that is disposed meanwhile). A host asks `hold()` before it draws; while new programs
 * link, the draw is skipped (the last frame stays up) and `redraw` runs once they are ready.
 * Textures are handled the same way: new ones are uploaded a few milliseconds a frame before the first draw that needs them.
 * What is covered: every material under the root, hidden ones too (three's compile() gathers them with traverse), so the rain's streaks and its
 * splashes (hidden until the rain moves) are linked before the first draw that shows them. With a post stack the host passes its scene buffer:
 * the scene's programs are linked again against it, once, because a program drawn into a render target differs from the one for the screen
 * (tone mapping and output colour space are part of the key). Without that the stack's first frame relinked the whole scene in one frame.
 * Nothing changes what is drawn. Without the extension (or a renderer that cannot compile, as in the
 * tests) `hold()` is always false and drawing is unchanged.
 */
import type { Camera, Material, Object3D, Texture, WebGLRenderer, WebGLRenderTarget } from 'three';

/** The longest a draw waits for links before it goes ahead (and waits for the rest itself). */
const MAX_WAIT_MS = 1500;
/** Objects can also arrive without a mark() (people streamed in by a scene): look again at most this often. */
const RECHECK_MS = 500;

type Compiling = Pick<WebGLRenderer, 'compile' | 'properties' | 'extensions'> & Partial<Pick<WebGLRenderer, 'initTexture' | 'setRenderTarget' | 'getRenderTarget'>>;
type Program = { isReady?: () => boolean };

function canCompileAsync(renderer: Partial<Compiling> | null | undefined): renderer is Compiling {
  try {
    return typeof renderer?.compile === 'function' && typeof renderer.properties?.get === 'function' && renderer.extensions?.has?.('KHR_parallel_shader_compile') === true;
  } catch { return false; }
}

/** Upload at most this much texture work per frame before the first draw that needs it (see `pendingTextures`). */
const UPLOAD_BUDGET_MS = 6;

/**
 * Textures under `root` that the GPU has not been given yet, or whose image changed since: the first draw would upload them
 * all inside one frame (texImage2D / texSubImage2D: 20–80 ms when a venue or a crowd of new looks appears). Uploading them
 * a few at a time beforehand, with renderer.initTexture, leaves exactly the same texture on the GPU.
 */
function pendingTextures(renderer: Compiling, root: Object3D): Texture[] {
  const out = new Set<Texture>();
  root.traverse((object) => {
    const drawn = object as Object3D & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean; material?: Material | Material[] };
    if (!drawn.material || !(drawn.isMesh || drawn.isPoints || drawn.isLine || drawn.isSprite) || !drawn.visible) return;
    for (const material of Array.isArray(drawn.material) ? drawn.material : [drawn.material]) {
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        const texture = value as Texture | null;
        if (!texture || (texture as { isTexture?: boolean }).isTexture !== true || out.has(texture)) continue;
        const image = (texture as { image?: { width?: number; height?: number; data?: unknown } }).image;
        if (!image || (!(image.width! > 0) && !image.data)) continue;
        const known = renderer.properties.get(texture) as { __webglInit?: boolean; __version?: number };
        if (!known.__webglInit || known.__version !== texture.version) out.add(texture);
      }
    }
  });
  return [...out];
}

/** True when some material under `root` has never had a program. */
function hasUnlinked(renderer: Compiling, root: Object3D): boolean {
  let found = false;
  root.traverse((object) => {
    if (found) return;
    const drawn = object as Object3D & { isMesh?: boolean; isPoints?: boolean; isLine?: boolean; isSprite?: boolean; material?: Material | Material[] };
    if (!drawn.material || !(drawn.isMesh || drawn.isPoints || drawn.isLine || drawn.isSprite)) return;
    for (const material of Array.isArray(drawn.material) ? drawn.material : [drawn.material]) {
      if (!(renderer.properties.get(material) as { currentProgram?: unknown }).currentProgram) { found = true; return; }
    }
  });
  return found;
}

export interface ShaderWarmup {
  /** Something new may have been added: the next hold() looks for materials without a program. */
  mark(): void
  /**
   * Call before drawing `root` (part of `scene`) with `camera`. True while programs are linking: skip this draw; `redraw` is called
   * once they are ready. Looks for new materials after mark(), and otherwise at most twice a second (one walk over `root`).
   */
  hold(root: Object3D, scene: Object3D, camera: Camera, redraw: () => void, buffer?: WebGLRenderTarget | null): boolean
}

export function createShaderWarmup(renderer: unknown): ShaderWarmup {
  const target = renderer as Partial<Compiling> | null;
  const able = canCompileAsync(target);
  let dirty = true, waiting: Promise<void> | null = null, checked = -Infinity, uploads: Texture[] = [], uploading = false;
  const warmedTargets = new WeakSet<object>();
  const canUpload = able && typeof (target as Compiling).initTexture === 'function';
  /** Upload what is pending, UPLOAD_BUDGET_MS a frame; redraw when done. */
  const drain = (redraw: () => void) => {
    const started = performance.now();
    while (uploads.length && performance.now() - started < UPLOAD_BUDGET_MS) { const texture = uploads.pop()!; try { (target as Compiling).initTexture!(texture); } catch { /* drawn (and uploaded) as before */ } }
    if (uploads.length) requestAnimationFrame(() => drain(redraw)); else { uploading = false; redraw(); }
  };
  return {
    mark() { dirty = true; },
    hold(root, scene, camera, redraw, buffer) {
      if (!able) return false;
      if (waiting || uploading) return true;
      const at = performance.now();
      // A post stack draws the scene into its own buffer, which needs its own variant of every program: the first time, link them all.
      const retarget = Boolean(buffer) && !warmedTargets.has(buffer!);
      if (retarget) dirty = true;
      if (!dirty && at - checked < RECHECK_MS) return false;
      dirty = false; checked = at;
      const compiler = target as Compiling;
      if (canUpload) { uploads = pendingTextures(compiler, root); if (uploads.length) { uploading = true; requestAnimationFrame(() => drain(() => { dirty = true; redraw(); })); return true; } }
      if (!retarget && !hasUnlinked(compiler, root)) return false;
      let materials: Set<Material>;
      const before = buffer && compiler.getRenderTarget ? compiler.getRenderTarget() : null;
      try {
        if (buffer) compiler.setRenderTarget?.(buffer);
        materials = compiler.compile(root, camera, scene as Parameters<Compiling['compile']>[2]);
      } catch { return false; } finally { if (buffer) compiler.setRenderTarget?.(before); }
      if (buffer) warmedTargets.add(buffer);
      const started = at;
      const settle = () => {
        for (const material of materials) {
          const program = (compiler.properties.get(material) as { currentProgram?: Program }).currentProgram;
          let ready = true;
          try { ready = !program?.isReady || program.isReady(); } catch { ready = true; }
          if (ready) materials.delete(material);
        }
        return !materials.size;
      };
      // Programs that were already linked (another material had the same shader) need no wait: draw this frame.
      if (settle()) return false;
      const wait: Promise<void> = new Promise<void>((resolve) => {
        const check = () => {
          if (waiting !== wait) { resolve(); return; }
          if (settle() || performance.now() - started > MAX_WAIT_MS) { resolve(); return; }
          setTimeout(check, 8);
        };
        setTimeout(check, 0);
      }).then(() => { if (waiting !== wait) return; waiting = null; redraw(); });
      waiting = wait;
      return true;
    },
  };
}
