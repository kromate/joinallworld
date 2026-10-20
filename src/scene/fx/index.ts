/**
 * OWNER: scenes
 * The `fx` chunk's front door: weather, particles, post-processing and game feel are fetched through `loadFx(tier)`, never imported
 * directly. Phase 1 of docs/OPEN-SOURCE-PLAN.md added the weather, phase 2 the post stack; phase 3's feel is reached from
 * src/scene/reward.ts and the venue host on its own lazy imports.
 *
 * Nothing in the first download imports this file. It is reached only by lazy `import('./fx/index.ts')` calls from scene hosts,
 * so vite.config.ts can put src/scene/fx/**, src/scene/feel/** and the libraries behind them (postprocessing and
 * n8ao) in one chunk named `fx`, and src/scene/city-scenes.test.ts checks that no startup or scene-host chunk imports it statically.
 *
 * The tier gate, in one paragraph: rain, particles and feel are for every tier (a phone gets fewer drops and sparks, never none),
 * but the post-processing and ambient-occlusion parts, the code that imports `postprocessing` and `n8ao`, are imported only when
 * `tier === 'high'`, so a phone or a wide screen never downloads or compiles them. The tier comes from `renderTier()` in
 * src/scene/look.ts through `fxTierFor`; the HIGH tier there (`env: true`) is the same gate that already decides the environment map.
 *
 * Pure planners stay in their own files (a function of seed, clock and conditions, with Node tests); the draw modules that own THREE
 * are what `loadFx` imports. Nothing here asks for frames: the caller's wake window decides when anything moves.
 */

import type * as THREE from 'three'
import type { ThreeModule } from '../types.ts'
import type { Post } from './post.ts'
import { gradeFor } from './grade.ts'
// A static import, with only the name used: a dynamic import() of this module would keep every export of it in the first download's engine chunk.
import { cityRules } from '../../game/cities/registry.ts'

/** Which parts of the fx chunk a device may use. Same names as `RenderTier.name` in src/scene/look.ts. */
export type FxTier = 'phone' | 'wide' | 'high'

/** What a scene host hands `loadFx` so the post stack can be built on its renderer. Without it, no post stack is built. */
export interface FxContext {
  readonly THREE: ThreeModule
  readonly renderer: THREE.WebGLRenderer
  /** The city the scene shows, for its season (the colour grade). */
  readonly cityId: string
}

/** What a scene host holds after `loadFx`. `dispose` frees what the host built (the post stack); weather objects belong to the scene that made them. */
export interface FxHost {
  readonly tier: FxTier
  /** Phase 1: rain, splashes and smoke (weather.ts). Every tier; the tier only sets the counts. */
  readonly weather: typeof import('./weather.ts')
  /** The high tier's post stack (src/scene/fx/post.ts), or null on every other tier or without a context. Draw through `post.render(scene, camera)` when it is set. */
  readonly post: Post | null
  /** Re-grade the picture for the city's season and the hour at `now` (ms). Cheap: nothing happens unless the grade changed. */
  regrade(now: number): void
  dispose(): void
}

/**
 * The fx tier for a render tier. Only the exact names 'high' and 'wide' lift a device above the phone: an unknown or missing name
 * gets the cheapest set, so a new tier added to look.ts costs nothing until it is mapped here.
 */
export function fxTierFor(renderTier: { name: string }): FxTier {
  return renderTier.name === 'high' ? 'high' : renderTier.name === 'wide' ? 'wide' : 'phone'
}

/** Whether the post-processing and ambient-occlusion parts may be imported at all: the high tier only. */
export const fxUsesPost = (tier: FxTier): boolean => tier === 'high'

/**
 * Load the fx parts this tier may use and return the host that owns them. Call `dispose` when the scene goes away.
 * The weather always; on the high tier, given a context, the post stack as well (`?post=0` leaves it out: post.ts postEnabled).
 */
export async function loadFx(tier: FxTier, context?: FxContext): Promise<FxHost> {
  let post: Post | null = null
  let regrade = (_now: number): void => {}
  // FX_IMPORTS: rain, particles and feel for every tier; `if (fxUsesPost(tier))` around anything that imports postprocessing or n8ao.
  const weather = await import('./weather.ts')
  if (fxUsesPost(tier) && context) {
    const { createPost, postAoEnabled, postEnabled } = await import('./post.ts')
    if (!postEnabled()) return { tier, weather, post: null, regrade, dispose() {} }
    const gradeNow = (now: number) => gradeFor(cityRules(context.cityId)?.climate, now)
    const size = context.renderer.getSize(new context.THREE.Vector2())
    const first = gradeNow(Date.now())
    const stack = await createPost(context.THREE, context.renderer, size.x, size.y, { grade: first, ao: postAoEnabled() })
    stack.setSize(size.x, size.y, context.renderer.getPixelRatio())
    post = stack
    let key = `${first.kind}/${first.band}`
    regrade = (now) => {
      const next = gradeNow(now), nextKey = `${next.kind}/${next.band}`
      if (nextKey === key) return
      key = nextKey; stack.setGrade(next.kind, next.band)
    }
  }
  return { tier, weather, post, regrade, dispose() { post?.dispose(); post = null } }
}

/** `loadFx` for this device's render tier (src/scene/look.ts), without a post stack. What the scene builders call for the weather. */
export async function loadFxHere(): Promise<FxHost> {
  return loadFx(fxTierFor((await import('../look.ts')).renderTier()))
}
