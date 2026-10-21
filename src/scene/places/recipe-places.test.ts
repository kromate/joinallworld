// OWNER: scenes (unique places) — a recipe venue scene with a model of its own: the hero is replaced by the venue's model behind the back wall,
// measured under the place budget and not as scenery; and everything is as it was when the model cannot be had. Uses the retained Accra fixture
// (real kit and hero GLBs, the hero venue accra-market-game) and the real packed Abuja airport as the "venue's own model".
import '../recipe/node-test-fixture.ts'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { screenText } from '../../../server/moderation/text.ts'
import { cityContent, loadCityContent } from '../../game/cities/registry.ts'
import { spotsOf } from '../../life.ts'
import { BUDGETS, withinBudget } from '../../budgets.ts'
import { measureRenderCost, totalRenderCost } from '../body/render-cost.ts'
import { createKit } from '../kit.ts'
import { compileRecipe } from '../recipe/compile.ts'
import { parseCityRecipes } from '../recipe/contract.ts'
import { recipeAssets } from '../recipe/prepare.ts'
import { recipeRuntimeHost } from '../recipe/runtime-host.ts'
import type { RecipePlace } from '../recipe/runtime-host.ts'
import { fixtureFetch, fixturePack } from '../recipe/runtime.test-support.ts'
import { PLACE_ATLAS } from './atlas.generated.ts'
import type { PlaceDeviceHints } from './device.ts'
import { parsePlaceManifest } from './manifest.ts'
import { placeModelPath } from './paths.ts'

const VENUE = 'accra-market-game'
const lod1 = new Uint8Array(readFileSync(new URL('./fixtures/airport-abuja.lod1.glb', import.meta.url)))
const lod2 = new Uint8Array(readFileSync(new URL('./fixtures/airport-abuja.lod2.glb', import.meta.url)))
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const entry = (bytes: Uint8Array, triangles: number) => ({ sha256: sha(bytes), bytes: bytes.length, brotliBytes: Math.ceil(bytes.length / 2), triangles })
const manifest = (venue = VENUE) => parsePlaceManifest({ schema: 'allworld-place-models', version: 1, city: 'accra', atlas: { url: PLACE_ATLAS.full.url, sha256: PLACE_ATLAS.full.sha256 },
  venues: { [venue]: { archetype: 'airport-terminal', lod0: entry(lod1, 2657), lod1: entry(lod1, 2657), lod2: entry(lod2, 170) } } })
const weak: PlaceDeviceHints = { light: false, saveData: false, tier: 'phone', memory: 2, cores: 4 }
const served: typeof fetch = async input => String(input).endsWith(`${sha(lod1)}.glb`) ? new Response(new Uint8Array(lod1).buffer, { status: 200 }) : new Response('no', { status: 404 })
const until = async (done: () => boolean) => { for (let i = 0; i < 400 && !done(); i++) await new Promise(resolve => setTimeout(resolve, 5)) }

async function scene() {
  await loadCityContent('accra')
  const pack = await fixturePack()
  const targets = cityContent('accra').venues.filter(v => pack.metadata.targetVenueIds.includes(v.id)).map(v => ({ ...v.definition, scene: { ...v.definition.scene, spots: spotsOf(v.id, 'accra').map(s => ({ id: s.id, label: s.label })) } }))
  const parsed = parseCityRecipes(pack.text, { city: 'accra', venues: targets, assets: { kit: pack.metadata.assets.kit.measurement, hero: pack.metadata.assets.hero!.measurement }, hostScenery: pack.metadata.hostScenery, screenText })
  const found = parsed.recipes.find(v => v.recipe.venue === VENUE)!
  // The fixture pack was drafted without the hero's reference label; production names the hero on the sign as "Model: <label>".
  const checked = { ...found, recipe: { ...found.recipe, signs: found.recipe.signs.map(sign => ({ ...sign, text: 'Model: Fixture hall' })) } }
  const prepared = await recipeAssets.prepareCity(pack.metadata)
  const def = compileRecipe(checked, prepared, pack.metadata, null)
  return { checked, prepared, reservation: def.runtime!.reservation, request: def.runtime!.request, bounds: def.runtime!.bounds }
}
function hostOptions(group: import('three').Group, current: () => boolean, base: { request: unknown; bounds: unknown }) {
  return { current, cost: (exclude?: boolean) => measureRenderCost(group, node => exclude === true && node.name === `recipe:${VENUE}`).scenery,
    budget: () => ({ triangles: 15_000, drawCalls: 60 }), readmit() {}, changed() {}, request: base.request, bounds: base.bounds, fallback: [], heights: [0],
    index() { throw new Error('unused') }, fallbackContact: () => null, contact() {} } as unknown as Parameters<ReturnType<typeof recipeRuntimeHost>>[2]
}
/** The venue's one sign is a single quad. */
const SIGN_TRIANGLES = 2
const trianglesOf = (placements: { triangles: number }[]) => placements.reduce((sum, p) => sum + p.triangles, 0)

test('a venue with its own model: the hero is replaced by the model behind the back wall, and it is measured apart from scenery', async () => {
  const files = await fixtureFetch(), kit = createKit(), group = new kit.THREE.Group()
  try {
    const base = await scene(), { checked, prepared, reservation } = base
    assert.ok(checked.recipe.hero, 'the fixture venue is the city hero venue')
    assert.ok(checked.recipe.signs.some(sign => sign.text.startsWith('Model: ')), 'whose sign names the hero model')
    const place: RecipePlace = { manifest: manifest(), hooks: { hints: weak, fetcher: served, loadAtlas: async () => new kit.THREE.Texture() } }
    const owner = await recipeRuntimeHost(checked, prepared, reservation, place)(kit, group, hostOptions(group, () => true, base))
    assert.ok(owner)
    const root = group.getObjectByName(`recipe:${VENUE}`)!
    const heroless = trianglesOf(checked.placements.filter(p => p.source !== 'hero'))
    assert.equal(measureRenderCost(root).scenery.triangles, heroless, 'the hero is not drawn')
    assert.equal(root.getObjectByName('recipe:signs'), undefined, 'nor the sign that names it')
    await until(() => group.userData.placeModelStatus === 'ready')
    assert.equal(group.userData.placeModelStatus, 'ready', String(group.userData.placeModelError))
    const model = group.children.find(child => child.name.startsWith('place-model:'))
    assert.ok(model, 'the model is in the scene')
    const cost = measureRenderCost(group)
    assert.equal(cost.place.triangles, 2657)
    assert.ok(withinBudget(BUDGETS.PLACE_MODEL_LOD1_TRIANGLES, cost.place.triangles))
    assert.equal(cost.scenery.triangles, heroless, 'scenery is exactly what it was')
    assert.ok(cost.scenery.triangles <= BUDGETS.SCENE_SCENERY_TRIANGLES.value)
    assert.ok(cost.place.drawCalls <= BUDGETS.PLACE_MODEL_DRAW_CALLS.value)
    assert.ok(totalRenderCost(group).drawCalls <= BUDGETS.SCENE_DRAW_CALLS.value)
    const box = new kit.THREE.Box3().setFromObject(model!)
    assert.ok(box.max.z < -checked.recipe.footprint.d / 2, `the model (z up to ${box.max.z.toFixed(2)}) stands behind the footprint edge (${-checked.recipe.footprint.d / 2})`)
    // The walkable floor, the hero's blocking footprint and the spots are the recipe's own: nothing was added to them.
    assert.ok(checked.solids.length > 0 && (checked.walk.block?.length ?? 0) > 0)
    owner.dispose()
    assert.equal(group.children.length, 0, 'everything is taken down with the scene')
  } finally { kit.dispose(); files.restore() }
})

test('when the model cannot be had the hero and its sign come back and the scene is as it always was', async () => {
  const files = await fixtureFetch(), kit = createKit(), group = new kit.THREE.Group()
  try {
    const base = await scene(), { checked, prepared, reservation } = base
    const place: RecipePlace = { manifest: manifest(), hooks: { hints: weak, fetcher: async () => { throw new TypeError('offline') }, loadAtlas: async () => new kit.THREE.Texture() } }
    const owner = await recipeRuntimeHost(checked, prepared, reservation, place)(kit, group, hostOptions(group, () => true, base))
    assert.ok(owner)
    const root = group.getObjectByName(`recipe:${VENUE}`)!
    await until(() => group.userData.placeModelStatus === 'failed' && Boolean(root.getObjectByName('recipe:signs')))
    assert.equal(group.userData.placeModelStatus, 'failed')
    assert.equal(group.children.some(child => child.name.startsWith('place-model:')), false)
    assert.equal(measureRenderCost(root).scenery.triangles, trianglesOf(checked.placements) + SIGN_TRIANGLES, 'the hero is drawn again')
    assert.ok(root.getObjectByName('recipe:signs'), 'with its sign')
    assert.equal(measureRenderCost(group).place.triangles, 0)
    owner.dispose()
    assert.equal(group.children.length, 0)
  } finally { kit.dispose(); files.restore() }
})

test('a venue the manifest does not list, and a city without a manifest, are drawn exactly as before with no attempt to fetch', async () => {
  const files = await fixtureFetch(), kit = createKit()
  try {
    const base = await scene(), { checked, prepared, reservation } = base
    for (const place of [{ manifest: manifest('another-venue'), hooks: { hints: weak, fetcher: async () => { throw new Error('must not fetch') } } } satisfies RecipePlace, undefined]) {
      const group = new kit.THREE.Group()
      const owner = await recipeRuntimeHost(checked, prepared, reservation, place)(kit, group, hostOptions(group, () => true, base))
      assert.ok(owner)
      await new Promise(resolve => setTimeout(resolve, 20))
      const root = group.getObjectByName(`recipe:${VENUE}`)!
      assert.equal(measureRenderCost(root).scenery.triangles, trianglesOf(checked.placements) + SIGN_TRIANGLES, 'the hero stands in its slot')
      assert.ok(root.getObjectByName('recipe:signs'))
      assert.equal(group.userData.placeModelStatus ?? 'none', 'none')
      assert.equal(group.children.some(child => child.name.startsWith('place-model:')), false)
      owner.dispose()
    }
  } finally { kit.dispose(); files.restore() }
})

test('a scene that goes away while its model is on the way takes nothing with it afterwards', async () => {
  const files = await fixtureFetch(), kit = createKit(), group = new kit.THREE.Group()
  try {
    const base = await scene(), { checked, prepared, reservation } = base
    let live = true
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const place: RecipePlace = { manifest: manifest(), hooks: { hints: weak, fetcher: async (...args) => { await gate; return served(...args) }, loadAtlas: async () => new kit.THREE.Texture() } }
    const owner = await recipeRuntimeHost(checked, prepared, reservation, place)(kit, group, hostOptions(group, () => live, base))
    assert.ok(owner)
    live = false; owner.dispose(); release()
    await new Promise(resolve => setTimeout(resolve, 60))
    assert.equal(group.children.length, 0, 'no late attachment')
  } finally { kit.dispose(); files.restore() }
})
