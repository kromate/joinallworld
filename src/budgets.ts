// One place for Allworld's render and download budgets.
//
// Pure data and two tiny helpers: no DOM, no three, no imports, so a test, a script or a lazily fetched module can read it.
// Each entry says what the number is, what it measures, where something enforces it and why it is that number.
//
//   status 'current'      the number the code and tests already enforce: moving it here changed nothing.
//   status 'provisional'  a target from the realism plan that nothing measures yet (or a baseline taken from today's build):
//                         scripts/download-budget.ts reports it, and fails on it only when it finds something to measure.
//
// Entries are separate exports (not one big object) so a bundle only carries the ones its module reads;
// BUDGETS at the end lists them all for the report and the tests, and nothing in the app imports it.

export type BudgetUnit = 'triangles' | 'draw calls' | 'meshes' | 'lights' | 'houses' | 'px' | 'raw bytes' | 'gzip bytes' | 'brotli bytes'

export interface Budget {
  readonly value: number
  readonly unit: BudgetUnit
  /** 'max': the measurement may not exceed `value`. 'min': it may not fall below it (a floor that catches a model gone empty). */
  readonly limit: 'max' | 'min'
  readonly status: 'current' | 'provisional'
  /** The file or script that checks it. */
  readonly enforcedIn: string
  readonly why: string
}

/** Whether a measurement is inside a budget (the limit itself is inside). */
export function withinBudget(budget: Budget, measured: number): boolean {
  return budget.limit === 'max' ? measured <= budget.value : measured >= budget.value
}

/** "17,000 triangles (max)": for a failure message. */
export function describeBudget(budget: Budget): string {
  return `${budget.value.toLocaleString('en-US')} ${budget.unit} (${budget.limit})`
}

// ---- Venue and home scenes (src/scene) -------------------------------------------------------------------------------------------

/** Existing housing shell ceiling retained independently of the approved native character budget. */
export const SCENE_CROWD_TRIANGLES: Budget = {
  value: 15000, unit: 'triangles', limit: 'max', status: 'current',
  enforcedIn: 'src/housing-studio/production.ts', why: 'Preserve the shipped housing shell ceiling.',
}
export const SCENE_SCENERY_TRIANGLES: Budget = {
  value: 15000, unit: 'triangles', limit: 'max', status: 'current',
  enforcedIn: 'src/scene scene and ambient tests, src/game/cities/allCities.test.ts',
  why: 'Scenery retains a separate 15,000-triangle allowance within the approved native scene ceiling.',
}
export const SCENE_CHARACTER_TRIANGLES: Budget = {
  value: 72000, unit: 'triangles', limit: 'max', status: 'current',
  enforcedIn: 'src/scene scene and ambient tests, src/game/cities/allCities.test.ts',
  why: 'Native character allowance approved on 16 October 2026. Admission uses actual geometry cost; this is not measured physical-phone performance.',
}
export const SCENE_TRIANGLES: Budget = {
  value: SCENE_SCENERY_TRIANGLES.value + SCENE_CHARACTER_TRIANGLES.value, unit: 'triangles', limit: 'max', status: 'current',
  enforcedIn: 'src/scene scene and ambient tests, src/game/cities/allCities.test.ts',
  why: 'Approved native replacement ceiling: 15,000 scenery plus 72,000 character triangles. Whole-host draw calls remain separately capped.',
}
export const SCENE_DRAW_CALLS: Budget = {
  value: 60, unit: 'draw calls', limit: 'max', status: 'current',
  enforcedIn: 'src/scene tests, src/game/cities/allCities.test.ts',
  why: 'Draw submission remains capped at sixty; both triangle cost and CPU/GPU timing still matter.',
}
export const SCENE_SCENERY_MESHES: Budget = {
  value: 13, unit: 'meshes', limit: 'max', status: 'current',
  enforcedIn: 'src/scene/scenes.test.ts',
  why: 'Merged scenery, independent room walls, sky and walking markers. Character cost is constrained by the shared draw-call limit.',
}
export const SCENE_LIGHTS: Budget = {
  value: 4, unit: 'lights', limit: 'max', status: 'current',
  enforcedIn: 'src/scene tests',
  why: 'Every point light is paid for on every fragment.',
}

// Native runtime admission and archived conversion limits are intentionally separate.
// CPU/GPU frame timing is measured separately in the game.
/** Native lab actor, with original53-bone surface and authored fitted equipment. The native scene exception was approved on 16 October 2026. */
export const NATIVE_FULL_BODY_TRIANGLES: Budget = {
  value: 34000,
  unit: 'triangles', limit:'max', status:'provisional', enforcedIn:'src/scene/character-lab/native-body.ts and measured scene admission',
  why: 'Original native53 lab actor with fitted catalogue clothing; provisional per-actor ceiling, actual scene admission still uses measured cost.',
};
/** Retired canonical23 asset guard, retained for archived conversion fixtures only. */
export const CANONICAL_FULL_BODY_TRIANGLES: Budget = {
  value: 9000, unit: 'triangles', limit: 'max', status: 'current',
  enforcedIn: 'src/scene/body/body-assets.test.ts',
  why: 'Maximum measured dressed full body is 8,594 triangles, including the most expensive supported accessories.',
}
export const CANONICAL_LOD_BODY_TRIANGLES: Budget = {
  value: 3300, unit: 'triangles', limit: 'max', status: 'current',
  enforcedIn: 'src/scene/body/body-assets.test.ts',
  why: 'Maximum measured dressed crowd body is 3,123 triangles; it preserves the same character design and rig.',
}

// ---- Historical studio-reference avatar detail levels (src/scene/characters.ts) ------------------------------------------------------------------------------

export const AVATAR_LOW_TRIANGLES: Budget = {
  value: 600, unit: 'triangles', limit: 'max', status: 'current',
  enforcedIn: 'src/scene/characters.ts (LOW_BUDGET), src/scene/avatar-preview.test.ts',
  why: 'Historical procedural reference geometry only; production crowds use measured native53 snapshots.',
}
export const AVATAR_MEDIUM_TRIANGLES_MIN: Budget = {
  value: 1500, unit: 'triangles', limit: 'min', status: 'current',
  enforcedIn: 'src/scene/avatar-preview.test.ts',
  why: 'Medium is a light version of the full model, not the low one.',
}
export const AVATAR_MEDIUM_TRIANGLES: Budget = {
  value: 4500, unit: 'triangles', limit: 'max', status: 'current',
  enforcedIn: 'src/scene/avatar-preview.test.ts',
  why: "Medium is the player's own figure in a scene: a couple of thousand triangles.",
}
export const AVATAR_HIGH_TRIANGLES_MIN: Budget = {
  value: 10000, unit: 'triangles', limit: 'min', status: 'current',
  enforcedIn: 'src/scene/avatar-preview.test.ts',
  why: 'High is the full model the look preview shows.',
}
export const AVATAR_HIGH_TRIANGLES: Budget = {
  value: 34000, unit: 'triangles', limit: 'max', status: 'current',
  enforcedIn: 'src/scene/avatar-preview.test.ts',
  why: 'The full model with every accessory still draws in one preview frame.',
}

// ---- The 3D city map (src/map3d) -------------------------------------------------------------------------------------------------

export const CITY_TRIANGLES: Budget = {
  value: 90000, unit: 'triangles', limit: 'max', status: 'current',
  enforcedIn: 'src/map3d/city-build.ts (CITY_TRIANGLE_BUDGET), src/map3d/*.test.ts, src/game/cities/{ogun,ibadan}/map.test.ts',
  why: 'One frame of the city: the city, its overlays, the route and the houses of an estate in view. A true-scale shoreline alone is about 17,000.',
}
export const CITY_DRAW_CALLS: Budget = {
  value: 40, unit: 'draw calls', limit: 'max', status: 'current',
  enforcedIn: 'src/map3d/map3d.test.ts, src/game/cities/{ogun,ibadan}/map.test.ts',
  why: 'Merged meshes and instancing keep the city to about forty draw calls, the limit that matters.',
}
export const AERIAL_DIVE_TRIANGLES: Budget = {
  value: 120000, unit: 'triangles', limit: 'max', status: 'provisional',
  enforcedIn: 'src/map3d/aerial-plan.ts (AERIAL_TRIANGLES), src/map3d/aerial-plan.test.ts, src/map3d/aerial.test.ts',
  why: 'One frame of the city map during the aerial pass of the dive: the city plus the aerial massing, parks, road ribbons and clouds. Not timed on a phone yet.',
}
export const AERIAL_DIVE_DRAW_CALLS: Budget = {
  value: 40 + 4, unit: 'draw calls', limit: 'max', status: 'provisional',
  enforcedIn: 'src/map3d/aerial-plan.ts (AERIAL_DRAW_CALLS), src/map3d/aerial.test.ts',
  why: 'The city budget plus the four aerial layers (massing, parks, roads, clouds), for the few seconds of the dive only.',
}
export const HOUSES_DETAIL_TRIANGLES: Budget = {
  value: 10000, unit: 'triangles', limit: 'max', status: 'current',
  enforcedIn: 'src/map3d/houses.ts (DETAIL_BUDGET), src/map3d/world.test.ts',
  why: 'Detailed houses are used nearest-first until this is spent, so the city plus houses stays under CITY_TRIANGLES.',
}
export const HOUSES_MAX_DETAILED: Budget = {
  value: 9, unit: 'houses', limit: 'max', status: 'current',
  enforcedIn: 'src/map3d/houses.ts (MAX_DETAILED)',
  why: 'At most this many houses are fully modelled at once; the rest stay pads.',
}
export const HOUSES_DRAW_CALLS: Budget = {
  value: 16, unit: 'draw calls', limit: 'max', status: 'current',
  enforcedIn: 'src/map3d/world.test.ts',
  why: 'Close on an estate every style is a per-instance colour: a handful of draw calls.',
}

// ---- Built JavaScript today: gzip and raw (src/app/entry.test.ts, src/scene/city-scenes.test.ts) --------------------------------

export const STARTUP_RAW: Budget = {
  value: 616_000, unit: 'raw bytes', limit: 'max', status: 'current',
  enforcedIn: 'src/app/entry.test.ts',
  why: 'Measured 614,121 bytes after the reviewed wallet audit, exact-action recovery and cross-identity snapshot mask (0.99% over the former 609,000). Raised by 1,000 on 18 Oct 2026 for the social platform: the Lite decision (no scene for a browser that cannot draw one), the feed apps\' five registrations and their inbox badge, measured 615,175. The owner\'s 17 Oct direction lifted the first-download budget for the 3D world; first paint is unchanged.',
}
export const STARTUP_GZIP: Budget = {
  value: 223_500, unit: 'gzip bytes', limit: 'max', status: 'current',
  enforcedIn: 'src/app/entry.test.ts',
  why: 'The same startup, gzipped: measured 219.5 kB plus about 1.6%; raised by 500 on 18 Oct 2026 with the raw budget (Lite and the feed apps), measured 223,107.',
}
export const LOADING_RAW: Budget = {
  value: 92_000, unit: 'raw bytes', limit: 'max', status: 'current',
  enforcedIn: 'src/app/entry.test.ts',
  why: 'The loading screen alone (entry, Vue, preload helper): measured 88.1 kB plus about 4%.',
}
export const LOADING_GZIP: Budget = {
  value: 37_000, unit: 'gzip bytes', limit: 'max', status: 'current',
  enforcedIn: 'src/app/entry.test.ts',
  why: 'The loading screen gzipped: measured 35.5 kB plus about 4%.',
}
export const SCENE_HOST_RAW: Budget = {
  value: 192_000, unit: 'raw bytes', limit: 'max', status: 'current',
  enforcedIn: 'src/scene/city-scenes.test.ts',
  why: "The shared scene chunk without any city's own scenes: measured 186.3 kB plus about 3%. It was 179.1 kB until the skinned stand-in body's hooks and the home scene's body went into it. It is fetched with the scene, never part of the first download.",
}
export const SCENE_HOST_GZIP: Budget = {
  value: 71_000, unit: 'gzip bytes', limit: 'max', status: 'current',
  enforcedIn: 'src/scene/city-scenes.test.ts',
  why: 'The shared scene chunk gzipped: measured 68.3 kB plus about 4%.',
}

export const FX_RAW: Budget = {
  value: 400_000, unit: 'raw bytes', limit: 'max', status: 'provisional',
  enforcedIn: 'src/scene/city-scenes.test.ts, scripts/download-budget.ts',
  why: 'The lazy fx chunk (weather, particles, post-processing, game feel and the libraries behind them), fetched by a scene host after its first frame. A first guess: measured after phase 2 of docs/OPEN-SOURCE-PLAN.md lands, then set to the measurement plus about 4%. Not part of the first download.',
}
export const FX_GZIP: Budget = {
  value: 120_000, unit: 'gzip bytes', limit: 'max', status: 'provisional',
  enforcedIn: 'src/scene/city-scenes.test.ts, scripts/download-budget.ts',
  why: 'The fx chunk gzipped: a first guess, measured after phase 2 of docs/OPEN-SOURCE-PLAN.md lands.',
}

// ---- Download budgets in brotli (scripts/download-budget.ts). PROVISIONAL: realism-plan targets -----------------------------------

export const FIRST_PAINT_BROTLI: Budget = {
  value: 36_800, unit: 'brotli bytes', limit: 'max', status: 'provisional',
  enforcedIn: 'scripts/download-budget.ts',
  why: 'Shell first paint may not grow: index.html, its stylesheet and the chunks it statically imports (baseline after phase 0, with the boot-recovery and old-browser notice: 36.6 kB, plus about 0.6%).',
}
export const STARTUP_BROTLI: Budget = {
  value: 196_300, unit: 'brotli bytes', limit: 'max', status: 'provisional',
  enforcedIn: 'scripts/download-budget.ts',
  why: 'The automatic startup (shell, engine, the default city) may not grow (baseline after phase 0: the largest of the cities, Lagos, measures 195.4 kB, plus about 0.1%). Raised by 500 on 18 Oct 2026 for Lite and the feed apps (measured 195,912), under the owner\'s 17 Oct direction. Raised by 200 on 19 Oct 2026: the engine lists the 284 city-rules chunk hashes, which change whenever a lazy chunk does, and their brotli size moves by about ±100 bytes with no code change (raw startup unchanged at 615,827; measured 196,149).',
}
export const BASE_BODY_BROTLI: Budget = {
  value: 300_000, unit: 'brotli bytes', limit: 'max', status: 'provisional',
  enforcedIn: 'scripts/download-budget.ts (nothing to measure yet)',
  why: 'The base avatar body is fetched once before anyone is drawn at high detail.',
}
export const CLIP_PACK_BROTLI: Budget = {
  value: 200_000, unit: 'brotli bytes', limit: 'max', status: 'provisional',
  enforcedIn: 'scripts/download-budget.ts (nothing to measure yet)',
  why: 'All the shared animation clips together.',
}
export const WARDROBE_ITEM_BROTLI: Budget = {
  value: 60_000, unit: 'brotli bytes', limit: 'max', status: 'provisional',
  enforcedIn: 'scripts/download-budget.ts (nothing to measure yet)',
  why: 'One garment or accessory is fetched when it is tried on or worn.',
}
export const WARDROBE_ITEM_TRIANGLES: Budget = {
  value: 4000, unit: 'triangles', limit: 'max', status: 'provisional',
  enforcedIn: 'nothing yet (wardrobe item tests)',
  why: 'A worn item is a small share of the figure triangle budget.',
}
export const WARDROBE_ITEM_TEXTURE_PX: Budget = {
  value: 1024, unit: 'px', limit: 'max', status: 'provisional',
  enforcedIn: 'nothing yet (wardrobe item tests)',
  why: 'The longest side of any texture on a wardrobe item.',
}
export const STREET_TILE_BROTLI: Budget = {
  value: 60_000, unit: 'brotli bytes', limit: 'max', status: 'provisional',
  enforcedIn: 'scripts/download-budget.ts (nothing to measure yet)',
  why: 'Walking streams street tiles; each must arrive well inside a frame of walking.',
}
export const STREET_TILE_TRIANGLES: Budget = {
  value: 25000, unit: 'triangles', limit: 'max', status: 'provisional',
  enforcedIn: 'nothing yet (street tile build tests)',
  why: 'A street tile as built in the browser, with its neighbours still in view.',
}
export const PHONE_SCENE_DRAW_CALLS: Budget = {
  value: 60, unit: 'draw calls', limit: 'max', status: 'provisional',
  enforcedIn: 'nothing yet (visible scene on a phone)',
  why: 'Everything visible at once on a phone, the same limit venue scenes already keep.',
}

export const TALK_INDEX_BYTES: Budget = {
  value: 256_000, unit: 'raw bytes', limit: 'max', status: 'current',
  enforcedIn: 'server/story/talk-banks.ts, scripts/download-budget.ts',
  why: 'The immutable Talk city index is bounded before any city pack is requested.',
}
export const TALK_CITY_PACK_BYTES: Budget = {
  value: 5_000_000, unit: 'raw bytes', limit: 'max', status: 'current',
  enforcedIn: 'server/story/talk-banks.ts, scripts/talk-factory/world.ts, scripts/download-budget.ts',
  why: 'Each immutable Talk city pack remains within the existing 5 MB per-file contract.',
}

export const CITY_SCENE_RECIPES_BYTES: Budget = {
  value: 120_000, unit: 'raw bytes', limit: 'max', status: 'current',
  enforcedIn: 'src/scene/recipe/contract.ts, scripts/scene-factory/scenes.ts, scripts/download-budget.ts',
  why: 'One city fetches its compact recipes and measured dependencies in a separate lazy entry.',
}
export const CITY_CONTENT_RECIPE_TALK_BYTES: Budget = {
  value: 5_000_000, unit: 'raw bytes', limit: 'max', status: 'current',
  enforcedIn: 'scripts/download-budget.ts',
  why: 'One city download sums its immutable content JSON, optional city recipe entry and optional indexed Talk pack; shared kits and heroes are excluded.',
}
export const SCENE_KIT_BROTLI: Budget = {
  value: 300_000, unit: 'brotli bytes', limit: 'max', status: 'current',
  enforcedIn: 'scripts/scene-factory/assets.ts, scripts/download-budget.ts',
  why: 'One regional prop kit is shared by cities in that region and fetched on demand.',
}
export const HERO_BROTLI: Budget = {
  value: 60_000, unit: 'brotli bytes', limit: 'max', status: 'current',
  enforcedIn: 'scripts/scene-factory/assets.ts, scripts/download-budget.ts',
  why: 'One city landmark is a bounded optional dependency of that city scene pack.',
}

export const BUDGETS = {
  SCENE_SCENERY_TRIANGLES, SCENE_CHARACTER_TRIANGLES, SCENE_TRIANGLES, SCENE_DRAW_CALLS, SCENE_SCENERY_MESHES, SCENE_LIGHTS,
  NATIVE_FULL_BODY_TRIANGLES, CANONICAL_FULL_BODY_TRIANGLES, CANONICAL_LOD_BODY_TRIANGLES,
  AVATAR_LOW_TRIANGLES, AVATAR_MEDIUM_TRIANGLES_MIN, AVATAR_MEDIUM_TRIANGLES, AVATAR_HIGH_TRIANGLES_MIN, AVATAR_HIGH_TRIANGLES,
  CITY_TRIANGLES, CITY_DRAW_CALLS, AERIAL_DIVE_TRIANGLES, AERIAL_DIVE_DRAW_CALLS, HOUSES_DETAIL_TRIANGLES, HOUSES_MAX_DETAILED, HOUSES_DRAW_CALLS,
  STARTUP_RAW, STARTUP_GZIP, LOADING_RAW, LOADING_GZIP, SCENE_HOST_RAW, SCENE_HOST_GZIP, FX_RAW, FX_GZIP,
  FIRST_PAINT_BROTLI, STARTUP_BROTLI, BASE_BODY_BROTLI, CLIP_PACK_BROTLI, WARDROBE_ITEM_BROTLI, WARDROBE_ITEM_TRIANGLES, WARDROBE_ITEM_TEXTURE_PX,
  STREET_TILE_BROTLI, STREET_TILE_TRIANGLES, PHONE_SCENE_DRAW_CALLS,
  CITY_SCENE_RECIPES_BYTES, TALK_INDEX_BYTES, TALK_CITY_PACK_BYTES, CITY_CONTENT_RECIPE_TALK_BYTES, SCENE_KIT_BROTLI, HERO_BROTLI,
} as const satisfies Record<string, Budget>

export type BudgetName = keyof typeof BUDGETS
