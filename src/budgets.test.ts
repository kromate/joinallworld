// The budget table: well formed, the numbers the code and tests enforced before it existed, and every source constant that mirrors it.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { BUDGETS, describeBudget, withinBudget } from './budgets.ts'
import type { Budget } from './budgets.ts'
import { CITY_TRIANGLE_BUDGET } from './map3d/city-build.ts'
import { DETAIL_BUDGET } from './map3d/houses.ts'
import { CAMPUS_BUDGET } from './campus/unilag/scene.ts'
import { PLACE_MODEL_LIMITS } from './scene/places/limits.ts'

const entries = Object.entries(BUDGETS) as [string, Budget][]

test('every budget has a positive whole value, a place it is enforced and a reason', () => {
  for (const [name, budget] of entries) {
    assert.ok(Number.isInteger(budget.value) && budget.value > 0, `${name} value`)
    assert.ok(budget.enforcedIn.trim().length > 0, `${name} says where it is enforced`)
    assert.ok(budget.why.trim().length > 12, `${name} says why`)
    assert.ok(budget.limit === 'max' || budget.limit === 'min', `${name} limit`)
    assert.ok(budget.status === 'current' || budget.status === 'provisional' || budget.status === 'proposed', `${name} status`)
  }
})

test('the numbers are the ones the tests and source hard-coded before the table', () => {
  const values = Object.fromEntries(entries.filter(([, budget]) => budget.status === 'current').map(([name, budget]) => [name, budget.value]))
  assert.deepEqual(values, {
    SCENE_SCENERY_TRIANGLES: 15000, SCENE_CHARACTER_TRIANGLES: 72000, SCENE_TRIANGLES: 87000, SCENE_DRAW_CALLS: 60,
    SCENE_SCENERY_MESHES: 13, SCENE_LIGHTS: 4, CANONICAL_FULL_BODY_TRIANGLES: 9000, CANONICAL_LOD_BODY_TRIANGLES: 3300,
    AVATAR_LOW_TRIANGLES: 600, AVATAR_MEDIUM_TRIANGLES_MIN: 1500, AVATAR_MEDIUM_TRIANGLES: 4500, AVATAR_HIGH_TRIANGLES_MIN: 10000, AVATAR_HIGH_TRIANGLES: 34000,
    CITY_TRIANGLES: 90000, CITY_DRAW_CALLS: 40, HOUSES_DETAIL_TRIANGLES: 10000, HOUSES_MAX_DETAILED: 9, HOUSES_DRAW_CALLS: 16,
    STARTUP_RAW: 616000, STARTUP_GZIP: 223500, LOADING_RAW: 92000, LOADING_GZIP: 37000, SCENE_HOST_RAW: 192000, SCENE_HOST_GZIP: 71000,
  })
})

test('the realism download targets are named and marked provisional', () => {
  const provisional = Object.fromEntries(entries.filter(([, budget]) => budget.status === 'provisional').map(([name, budget]) => [name, [budget.value, budget.unit]]))
  assert.deepEqual(Object.keys(provisional).sort(), ['AERIAL_DIVE_DRAW_CALLS', 'AERIAL_DIVE_TRIANGLES', 'BASE_BODY_BROTLI', 'CLIP_PACK_BROTLI', 'FIRST_PAINT_BROTLI', 'PHONE_SCENE_DRAW_CALLS', 'STARTUP_BROTLI', 'STREET_TILE_BROTLI', 'STREET_TILE_TRIANGLES', 'WARDROBE_ITEM_BROTLI', 'WARDROBE_ITEM_TEXTURE_PX', 'WARDROBE_ITEM_TRIANGLES'])
  assert.deepEqual(provisional.BASE_BODY_BROTLI, [300_000, 'brotli bytes'])
  assert.deepEqual(provisional.CLIP_PACK_BROTLI, [200_000, 'brotli bytes'])
  assert.deepEqual([provisional.WARDROBE_ITEM_BROTLI, provisional.WARDROBE_ITEM_TRIANGLES, provisional.WARDROBE_ITEM_TEXTURE_PX], [[60_000, 'brotli bytes'], [4000, 'triangles'], [1024, 'px']])
  assert.deepEqual([provisional.STREET_TILE_BROTLI, provisional.STREET_TILE_TRIANGLES], [[60_000, 'brotli bytes'], [25_000, 'triangles']])
  assert.deepEqual(provisional.PHONE_SCENE_DRAW_CALLS, [60, 'draw calls'])
})

test('the place model allowances are named, proposed, and equal the limits the generator and loader enforce', () => {
  const proposed = Object.fromEntries(entries.filter(([, budget]) => budget.status === 'proposed').map(([name, budget]) => [name, [budget.value, budget.unit]]))
  assert.deepEqual(proposed, {
    PLACE_MODEL_TRIANGLES: [20000, 'triangles'], PLACE_MODEL_LOD1_TRIANGLES: [4000, 'triangles'], PLACE_MODEL_LOD2_TRIANGLES: [500, 'triangles'],
    PLACE_MODEL_DRAW_CALLS: [2, 'draw calls'], PLACE_MODEL_LOD0_BROTLI: [110_000, 'brotli bytes'], PLACE_MODEL_LOD1_BROTLI: [30_000, 'brotli bytes'], PLACE_MODEL_LOD2_BROTLI: [6000, 'brotli bytes'],
  })
  assert.deepEqual(Object.values(PLACE_MODEL_LIMITS).map((limit) => limit.triangles), [BUDGETS.PLACE_MODEL_TRIANGLES.value, BUDGETS.PLACE_MODEL_LOD1_TRIANGLES.value, BUDGETS.PLACE_MODEL_LOD2_TRIANGLES.value])
  assert.deepEqual(Object.values(PLACE_MODEL_LIMITS).map((limit) => limit.brotliBytes), [BUDGETS.PLACE_MODEL_LOD0_BROTLI.value, BUDGETS.PLACE_MODEL_LOD1_BROTLI.value, BUDGETS.PLACE_MODEL_LOD2_BROTLI.value])
  // A separate allowance: the scenery cap is untouched.
  assert.equal(BUDGETS.SCENE_SCENERY_TRIANGLES.value, 15000)
  assert.equal(BUDGETS.SCENE_TRIANGLES.value, 87000)
})

test('the scene budget is its two parts, and a phone sees no more draw calls than a venue scene may use', () => {
  assert.equal(BUDGETS.SCENE_TRIANGLES.value, BUDGETS.SCENE_SCENERY_TRIANGLES.value + BUDGETS.SCENE_CHARACTER_TRIANGLES.value)
  assert.equal(BUDGETS.PHONE_SCENE_DRAW_CALLS.value, BUDGETS.SCENE_DRAW_CALLS.value)
})

test('source constants that mirror the table equal it', () => {
  assert.equal(CITY_TRIANGLE_BUDGET, BUDGETS.CITY_TRIANGLES.value)
  assert.equal(DETAIL_BUDGET, BUDGETS.HOUSES_DETAIL_TRIANGLES.value)
  // The campus keeps its own frozen object (src/campus is outside the table's reach); its numbers are today's budgets.
  assert.equal(CAMPUS_BUDGET.drawCalls, BUDGETS.SCENE_DRAW_CALLS.value)
})

test('withinBudget treats the limit as inside, and a floor the other way round', () => {
  const max: Budget = { ...BUDGETS.SCENE_DRAW_CALLS }, min: Budget = { ...BUDGETS.AVATAR_MEDIUM_TRIANGLES_MIN }
  assert.deepEqual([59, 60, 61].map((n) => withinBudget(max, n)), [true, true, false])
  assert.deepEqual([1499, 1500, 1501].map((n) => withinBudget(min, n)), [false, true, true])
  assert.equal(describeBudget(BUDGETS.SCENE_TRIANGLES), '87,000 triangles (max)')
})

test('budgets.ts imports nothing, so any module or script can read it', () => {
  const code = readFileSync(fileURLToPath(new URL('./budgets.ts', import.meta.url)), 'utf8')
  assert.deepEqual(code.match(/^\s*import\s.*$/gm) ?? [], [])
  assert.ok(!/\b(document|window|three)\b/.test(code.replace(/\/\/.*$/gm, '')))
})
