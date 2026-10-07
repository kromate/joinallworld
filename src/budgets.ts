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

export const SCENE_CROWD_TRIANGLES: Budget = {
  value: 15000, unit: 'triangles', limit: 'max', status: 'current',
  enforcedIn: 'src/scene/scenes.test.ts, scenes-rivers/fct/kano.test.ts',
  why: 'A venue and its full crowd stay cheap enough for a mid-range phone at 60 fps.',
}
export const PLAYER_FIGURE_TRIANGLES: Budget = {
  value: 2000, unit: 'triangles', limit: 'max', status: 'current',
  enforcedIn: 'src/scene/scenes.test.ts (inside SCENE_TRIANGLES)',
  why: "The player's own figure is drawn once at medium detail (up to about 2,700 triangles) on top of the crowd.",
}
export const SCENE_TRIANGLES: Budget = {
  value: 15000 + 2000, unit: 'triangles', limit: 'max', status: 'current',
  enforcedIn: 'src/scene/scenes.test.ts, scenes-rivers/fct/kano.test.ts, parametric-venue.test.ts, src/game/cities/allCities.test.ts',
  why: 'The crowd budget plus the player figure: everything one venue scene draws.',
}
export const SCENE_DRAW_CALLS: Budget = {
  value: 60, unit: 'draw calls', limit: 'max', status: 'current',
  enforcedIn: 'src/scene tests, src/game/cities/allCities.test.ts',
  why: 'Draw calls, not triangles, are what a phone GPU pays for: a scene is batched into a few meshes plus the crowd and the player.',
}
export const SCENE_MESHES: Budget = {
  value: 15, unit: 'meshes', limit: 'max', status: 'current',
  enforcedIn: 'src/scene/scenes.test.ts',
  why: 'Static layers (3), sky, crowd (2), the player rig (8 with its crown), the spot ring and two walking marks.',
}
export const SCENE_MESHES_WITH_WALLS: Budget = {
  value: 21, unit: 'meshes', limit: 'max', status: 'current',
  enforcedIn: 'src/scene/scenes.test.ts',
  why: "A room's two walls are parts of their own (3 layers each) so the scene can hide the wall the camera is behind.",
}
export const SCENE_MESHES_NO_CROWD: Budget = {
  value: 13, unit: 'meshes', limit: 'max', status: 'current',
  enforcedIn: 'src/scene/scenes.test.ts',
  why: 'The same scene with the crowd cleared: the crowd meshes are the difference.',
}
export const SCENE_LIGHTS: Budget = {
  value: 4, unit: 'lights', limit: 'max', status: 'current',
  enforcedIn: 'src/scene tests',
  why: 'Every point light is paid for on every fragment.',
}

// ---- Avatar detail levels (src/scene/characters.ts) ------------------------------------------------------------------------------

export const AVATAR_LOW_TRIANGLES: Budget = {
  value: 600, unit: 'triangles', limit: 'max', status: 'current',
  enforcedIn: 'src/scene/characters.ts (LOW_BUDGET), src/scene/avatar-preview.test.ts',
  why: 'Crowds and venue and home scenes draw many figures: low detail holds whatever is worn.',
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
  value: 609_000, unit: 'raw bytes', limit: 'max', status: 'current',
  enforcedIn: 'src/app/entry.test.ts',
  why: 'The automatic startup (entry, Vue, shell, engine with one city) measured 604.8 kB plus about 0.7%.',
}
export const STARTUP_GZIP: Budget = {
  value: 223_000, unit: 'gzip bytes', limit: 'max', status: 'current',
  enforcedIn: 'src/app/entry.test.ts',
  why: 'The same startup, gzipped: measured 219.5 kB plus about 1.6%.',
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
  value: 186_000, unit: 'raw bytes', limit: 'max', status: 'current',
  enforcedIn: 'src/scene/city-scenes.test.ts',
  why: "The shared scene chunk without any city's own scenes: measured 179.1 kB plus about 4%.",
}
export const SCENE_HOST_GZIP: Budget = {
  value: 71_000, unit: 'gzip bytes', limit: 'max', status: 'current',
  enforcedIn: 'src/scene/city-scenes.test.ts',
  why: 'The shared scene chunk gzipped: measured 68.3 kB plus about 4%.',
}

// ---- Download budgets in brotli (scripts/download-budget.ts). PROVISIONAL: realism-plan targets -----------------------------------

export const FIRST_PAINT_BROTLI: Budget = {
  value: 36_800, unit: 'brotli bytes', limit: 'max', status: 'provisional',
  enforcedIn: 'scripts/download-budget.ts',
  why: 'Shell first paint may not grow: index.html, its stylesheet and the chunks it statically imports (baseline after phase 0, with the boot-recovery and old-browser notice: 36.6 kB, plus about 0.6%).',
}
export const STARTUP_BROTLI: Budget = {
  value: 195_600, unit: 'brotli bytes', limit: 'max', status: 'provisional',
  enforcedIn: 'scripts/download-budget.ts',
  why: 'The automatic startup (shell, engine, the default city) may not grow (baseline after phase 0: the largest of the cities, Lagos, measures 195.4 kB, plus about 0.1%).',
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

export const BUDGETS = {
  SCENE_CROWD_TRIANGLES, PLAYER_FIGURE_TRIANGLES, SCENE_TRIANGLES, SCENE_DRAW_CALLS, SCENE_MESHES, SCENE_MESHES_WITH_WALLS, SCENE_MESHES_NO_CROWD, SCENE_LIGHTS,
  AVATAR_LOW_TRIANGLES, AVATAR_MEDIUM_TRIANGLES_MIN, AVATAR_MEDIUM_TRIANGLES, AVATAR_HIGH_TRIANGLES_MIN, AVATAR_HIGH_TRIANGLES,
  CITY_TRIANGLES, CITY_DRAW_CALLS, HOUSES_DETAIL_TRIANGLES, HOUSES_MAX_DETAILED, HOUSES_DRAW_CALLS,
  STARTUP_RAW, STARTUP_GZIP, LOADING_RAW, LOADING_GZIP, SCENE_HOST_RAW, SCENE_HOST_GZIP,
  FIRST_PAINT_BROTLI, STARTUP_BROTLI, BASE_BODY_BROTLI, CLIP_PACK_BROTLI, WARDROBE_ITEM_BROTLI, WARDROBE_ITEM_TRIANGLES, WARDROBE_ITEM_TEXTURE_PX,
  STREET_TILE_BROTLI, STREET_TILE_TRIANGLES, PHONE_SCENE_DRAW_CALLS,
} as const satisfies Record<string, Budget>

export type BudgetName = keyof typeof BUDGETS
