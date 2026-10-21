// OWNER: scenes (unique places) — the manifest format, the content-addressed fetch, the device rule, the fit, the lazy manifest loader and the scene
// backdrop, against the committed manifests and a real packed model (the Abuja airport, LOD1 and LOD2, in ./fixtures).
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'
import { BUDGETS, withinBudget } from '../../budgets.ts'
import { createKit } from '../kit.ts'
import { measureRenderCost } from '../body/render-cost.ts'
import { METRES_TO_SCENE } from '../recipe/contract.ts'
import { PLACE_ATLAS } from './atlas.generated.ts'
import { attachPlaceBackdrop } from './backdrop.ts'
import { chooseVenueDetail, mayFetchOptionalPlaces } from './device.ts'
import type { PlaceDeviceHints } from './device.ts'
import { fitPlaceModel, recipePlaceSlot } from './fit.ts'
import { checkPlaceGlbStructure, fetchPlaceGlb } from './glb.ts'
import { iconOf, planPlaceIcons } from './icons.ts'
import { PLACE_METRES_TO_SCENE, PLACE_MODEL_LIMITS } from './limits.ts'
import { forgetPlaceManifests, loadPlaceManifest } from './load.ts'
import { parsePlaceManifest } from './manifest.ts'
import type { PlaceManifest } from './manifest.ts'
import { isPlaceAtlasPath, isPlaceModelRoute, placeModelHash, placeModelPath, placeObjectKey } from './paths.ts'
import { forgetPersistRequest, rememberPlaces } from './persist.ts'
import { isPackageAssetPath } from '../../../scripts/guard-joinallworld-package.mjs'

const file = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))
const lod1 = file('airport-abuja.lod1.glb'), lod2 = file('airport-abuja.lod2.glb')
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const committed = (city: string) => JSON.parse(readFileSync(new URL(`../../../scripts/places/manifest/${city}.json`, import.meta.url), 'utf8')) as unknown
const manifestDir = new URL('../../../scripts/places/manifest/', import.meta.url)
const cities = readdirSync(manifestDir).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5))

/** A manifest for a venue made from the two fixtures (LOD0 stands in with the LOD1 file where a test never draws it). */
function fixtureManifest(venue = 'airport'): PlaceManifest {
  const entry = (bytes: Uint8Array, triangles: number) => ({ sha256: sha(bytes), bytes: bytes.length, brotliBytes: Math.ceil(bytes.length / 2), triangles })
  return parsePlaceManifest({ schema: 'allworld-place-models', version: 1, city: 'abuja', atlas: { url: PLACE_ATLAS.full.url, sha256: PLACE_ATLAS.full.sha256 },
    venues: { [venue]: { archetype: 'airport-terminal', lod0: entry(lod1, 2657), lod1: entry(lod1, 2657), lod2: entry(lod2, 170) } } })
}
const serve = (files: Record<string, Uint8Array>): typeof fetch => async input => {
  const path = String(input).replace(/^https?:\/\/[^/]+/, '')
  const hit = Object.entries(files).find(([hash]) => placeModelPath(hash) === path)
  return hit ? new Response(new Uint8Array(hit[1]).buffer, { status: 200, headers: { 'content-length': String(hit[1].length) } }) : new Response('no', { status: 404 })
}
const served = serve({ [sha(lod1)]: lod1, [sha(lod2)]: lod2 })
const stubAtlas = async (kit: ReturnType<typeof createKit>) => new kit.THREE.Texture()
const strong: PlaceDeviceHints = { light: false, saveData: false, tier: 'high' }
const weak: PlaceDeviceHints = { light: false, saveData: false, tier: 'phone', memory: 2, cores: 4 }

test('every committed manifest parses, names the shared atlas, and keeps each level inside its budget', () => {
  assert.ok(cities.length > 0, 'at least the pilot cities have manifests')
  for (const city of cities) {
    const manifest = parsePlaceManifest(committed(city), city)
    assert.equal(manifest.atlas.sha256, PLACE_ATLAS.full.sha256, `${city}: the atlas is the shared one`)
    for (const [venue, models] of Object.entries(manifest.venues)) {
      assert.ok(withinBudget(BUDGETS.PLACE_MODEL_TRIANGLES, models.lod0.triangles), `${city}/${venue} lod0 triangles`)
      assert.ok(withinBudget(BUDGETS.PLACE_MODEL_LOD1_TRIANGLES, models.lod1.triangles), `${city}/${venue} lod1 triangles`)
      assert.ok(withinBudget(BUDGETS.PLACE_MODEL_LOD2_TRIANGLES, models.lod2.triangles), `${city}/${venue} lod2 triangles`)
      assert.ok(withinBudget(BUDGETS.PLACE_MODEL_LOD0_BROTLI, models.lod0.brotliBytes) && withinBudget(BUDGETS.PLACE_MODEL_LOD1_BROTLI, models.lod1.brotliBytes) && withinBudget(BUDGETS.PLACE_MODEL_LOD2_BROTLI, models.lod2.brotliBytes), `${city}/${venue} brotli`)
    }
  }
})

test('a manifest that is not exactly the format is refused', () => {
  const good = committed(cities[0]!) as { venues: Record<string, { lod0: Record<string, unknown> }> }
  const first = Object.keys(good.venues)[0]!
  const mutate = (change: (copy: any) => void) => { const copy = structuredClone(good); change(copy); return copy }
  const refused: [string, unknown][] = [
    ['an extra field', mutate(c => { c.extra = 1 })],
    ['another version', mutate(c => { c.version = 2 })],
    ['a bad hash', mutate(c => { c.venues[first].lod0.sha256 = 'XYZ' })],
    ['a short hash', mutate(c => { c.venues[first].lod1.sha256 = 'a'.repeat(63) })],
    ['lod0 over 20,000 triangles', mutate(c => { c.venues[first].lod0.triangles = 20_001 })],
    ['lod1 over 4,000 triangles', mutate(c => { c.venues[first].lod1.triangles = 4_001 })],
    ['lod2 over 500 triangles', mutate(c => { c.venues[first].lod2.triangles = 501 })],
    ['lod2 over its brotli gate', mutate(c => { c.venues[first].lod2.brotliBytes = 6_001 })],
    ['a missing level', mutate(c => { delete c.venues[first].lod2 })],
    ['an atlas address that is not the hash', mutate(c => { c.atlas.url = '/assets/places/trim-other.webp' })],
    ['a venue id that is not an identifier', mutate(c => { c.venues['Bad Id'] = c.venues[first] })],
    ['an array', []],
    ['null', null],
  ]
  for (const [name, input] of refused) assert.throws(() => parsePlaceManifest(input), /Place manifest/, name)
  assert.throws(() => parsePlaceManifest(good, 'somewhere-else'), /expected somewhere-else/)
  assert.ok(withinBudget(BUDGETS.PLACE_MODEL_TRIANGLES, 20_000) && !withinBudget(BUDGETS.PLACE_MODEL_TRIANGLES, 20_001))
})

test('the limits mirror the named budgets, and the metre scale mirrors the recipe contract', () => {
  assert.equal(PLACE_MODEL_LIMITS.lod0.triangles, BUDGETS.PLACE_MODEL_TRIANGLES.value)
  assert.equal(PLACE_MODEL_LIMITS.lod1.triangles, BUDGETS.PLACE_MODEL_LOD1_TRIANGLES.value)
  assert.equal(PLACE_MODEL_LIMITS.lod2.triangles, BUDGETS.PLACE_MODEL_LOD2_TRIANGLES.value)
  assert.equal(PLACE_METRES_TO_SCENE, METRES_TO_SCENE)
  assert.equal(BUDGETS.PLACE_MODEL_TRIANGLES.status, 'proposed')
  assert.equal(BUDGETS.SCENE_SCENERY_TRIANGLES.value, 15000, 'the scenery cap is not raised')
})

test('addresses: only an exact 64-hex .glb under /assets/places/ is a model; keys and atlas paths follow', () => {
  const hash = sha(lod1)
  assert.equal(placeModelHash(placeModelPath(hash)), hash)
  assert.equal(placeObjectKey(hash), `places/${hash}.glb`)
  for (const bad of ['/assets/places/abc.glb', `/assets/places/${hash.toUpperCase()}.glb`, `/assets/places/${hash}.glb/`, `/assets/places/x/${hash}.glb`, `/assets/${hash}.glb`, `/assets/places/${hash}.webp`]) assert.equal(placeModelHash(bad), null, bad)
  assert.equal(isPlaceModelRoute('/assets/places/anything.glb'), true)
  assert.equal(isPlaceModelRoute(`/assets/places/trim-${hash}.webp`), false)
  assert.equal(isPlaceAtlasPath(PLACE_ATLAS.full.url), true)
  assert.equal(isPlaceAtlasPath(PLACE_ATLAS.small.url), true)
  assert.equal(isPlaceAtlasPath('/assets/places/trim-short.webp'), false)
})

test('the generated atlas files exist, are named for their own bytes, and the manifest atlas is the 2048 one', () => {
  for (const key of ['full', 'small'] as const) {
    const info = PLACE_ATLAS[key], bytes = readFileSync(new URL(`../../../public${info.url}`, import.meta.url))
    assert.equal(sha(bytes), info.sha256, `${key} atlas bytes match their name`)
    assert.ok(bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP')
  }
  assert.equal(PLACE_ATLAS.full.size, 2048); assert.equal(PLACE_ATLAS.small.size, 1024)
  assert.ok(readFileSync(new URL(`../../../public${PLACE_ATLAS.small.url}`, import.meta.url)).length < readFileSync(new URL(`../../../public${PLACE_ATLAS.full.url}`, import.meta.url)).length)
})

test('which level a device gets: lod0 only when known to be strong; lod1 for Light, Save-Data, slow links, phones and unknowns', () => {
  assert.equal(chooseVenueDetail(strong), 'lod0')
  assert.equal(chooseVenueDetail({ ...strong, light: true }), 'lod1')
  assert.equal(chooseVenueDetail({ ...strong, saveData: true }), 'lod1')
  assert.equal(chooseVenueDetail({ ...strong, connection: '2g' }), 'lod1')
  assert.equal(chooseVenueDetail({ ...strong, connection: '4g' }), 'lod0')
  assert.equal(chooseVenueDetail(weak), 'lod1')
  assert.equal(chooseVenueDetail({ light: false, saveData: false, tier: 'wide' }), 'lod1', 'a tablet that does not say what it is')
  assert.equal(chooseVenueDetail({ light: false, saveData: false, tier: 'wide', memory: 8, cores: 8 }), 'lod0')
  assert.equal(chooseVenueDetail({ light: false, saveData: false, tier: 'wide', memory: 2, cores: 8 }), 'lod1')
  assert.equal(mayFetchOptionalPlaces({ light: false, saveData: false }), true)
  assert.equal(mayFetchOptionalPlaces({ light: true, saveData: false }), false)
  assert.equal(mayFetchOptionalPlaces({ light: false, saveData: true }), false)
  assert.equal(mayFetchOptionalPlaces({ light: false, saveData: false, connection: 'slow-2g' }), false)
})

test('fit: never above life size, inside the slot, resting on the ground, facade at the front edge', () => {
  const slot = recipePlaceSlot({ w: 27, d: 22 })
  assert.deepEqual([slot.width, slot.depth, slot.height], [26, 12, 24])
  assert.ok(slot.frontZ < -11, 'behind the back wall (the footprint ends at -11)')
  const big = fitPlaceModel({ min: [-60, 0, -30], max: [60, 40, 30] }, slot)
  assert.ok(big.size[0] <= slot.width + 1e-9 && big.size[1] <= slot.height + 1e-9 && big.size[2] <= slot.depth + 1e-9)
  assert.ok(Math.abs(big.size[0] - slot.width) < 1e-9 || Math.abs(big.size[2] - slot.depth) < 1e-9, 'the binding side is used in full')
  assert.ok(Math.abs(big.y) < 1e-9 && Math.abs(big.z - (slot.frontZ - 30 * big.scale)) < 1e-9, 'its front edge (z = +30 m) lands on the slot front')
  const small = fitPlaceModel({ min: [-3, 0, -2], max: [3, 4, 2] }, slot)
  assert.equal(small.scale, PLACE_METRES_TO_SCENE, 'a small shop is not enlarged past life size')
  assert.throws(() => fitPlaceModel({ min: [0, 0, 0], max: [0, 1, 1] }, slot), /empty bounds/)
  const offset = fitPlaceModel({ min: [10, 2, 5], max: [30, 12, 15] }, slot)
  assert.ok(Math.abs(offset.x + 20 * offset.scale) < 1e-9, 'centred on the slot middle line')
  assert.ok(Math.abs(offset.y + 2 * offset.scale) < 1e-9, 'its lowest point stands on y = 0')
})

test('a model is fetched by its address and refused on a wrong length, a wrong hash, an error or a body that is not a place model', async () => {
  const entry = fixtureManifest().venues.airport!.lod1
  assert.deepEqual(await fetchPlaceGlb(entry, 'lod1', { fetcher: served }), lod1)
  const tampered = new Uint8Array(lod1); tampered[tampered.length - 5] = ~tampered[tampered.length - 5]! & 0xff
  await assert.rejects(fetchPlaceGlb(entry, 'lod1', { fetcher: serve({ [entry.sha256]: tampered }) }), /hash differs/)
  await assert.rejects(fetchPlaceGlb(entry, 'lod1', { fetcher: serve({ [entry.sha256]: lod1.subarray(0, lod1.length - 4) }) }), /byte length differs/)
  await assert.rejects(fetchPlaceGlb(entry, 'lod1', { fetcher: serve({ [entry.sha256]: new Uint8Array(lod1.length + 8) }) }), /exceeds/)
  await assert.rejects(fetchPlaceGlb(entry, 'lod1', { fetcher: async () => new Response('nope', { status: 500 }) }), /HTTP 500/)
  await assert.rejects(fetchPlaceGlb(entry, 'lod1', { fetcher: async () => { throw new TypeError('offline') } }), /offline/)
  // A file whose bytes do hash to its address but which is not a place model is refused by the structure check.
  const html = new TextEncoder().encode('<html>not a model</html>'), fake = { sha256: sha(html), bytes: html.length, brotliBytes: 10, triangles: 1 }
  await assert.rejects(fetchPlaceGlb(fake, 'lod1', { fetcher: serve({ [fake.sha256]: html }) }), /invalid GLB header/)
})

/** A GLB around a JSON document and an empty buffer, for the structure checks. */
function glbOf(doc: object): Uint8Array<ArrayBuffer> {
  const json = new TextEncoder().encode(JSON.stringify(doc)), pad = (4 - json.length % 4) % 4, jsonLength = json.length + pad, bin = new Uint8Array(4)
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + bin.length), view = new DataView(out.buffer)
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, out.length, true)
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true); out.set(json, 20); out.fill(0x20, 20 + json.length, 20 + jsonLength)
  view.setUint32(20 + jsonLength, bin.length, true); view.setUint32(24 + jsonLength, 0x004e4942, true)
  return out as Uint8Array<ArrayBuffer>
}
test('structure: a picture of its own, a second material, a skin or missing colours are all refused; the real files pass', () => {
  assert.doesNotThrow(() => checkPlaceGlbStructure(lod1 as Uint8Array<ArrayBuffer>, 'lod1'))
  assert.doesNotThrow(() => checkPlaceGlbStructure(lod2 as Uint8Array<ArrayBuffer>, 'lod2'))
  const base = (): Record<string, any> => ({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], extensionsUsed: ['EXT_meshopt_compression', 'KHR_mesh_quantization'],
    buffers: [{ byteLength: 4 }], bufferViews: [{ buffer: 0, byteLength: 4 }], materials: [{ name: 'trim' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, COLOR_0: 3 }, material: 0 }] }] })
  assert.doesNotThrow(() => checkPlaceGlbStructure(glbOf(base()), 'lod1'))
  const refuse = (name: string, change: (doc: Record<string, any>) => void, pattern: RegExp) => { const doc = base(); change(doc); assert.throws(() => checkPlaceGlbStructure(glbOf(doc), 'lod1'), pattern, name) }
  refuse('an embedded image', d => { d.images = [{ bufferView: 0, mimeType: 'image/webp' }]; d.textures = [{ source: 0 }] }, /carries no picture/)
  refuse('a second material', d => { d.materials.push({ name: 'other' }) }, /material "trim"/)
  refuse('a material not named trim', d => { d.materials[0].name = 'wall' }, /material "trim"/)
  refuse('an animation', d => { d.animations = [{}] }, /static scene/)
  refuse('a skin', d => { d.skins = [{}] }, /static scene/)
  refuse('an unsupported extension', d => { d.extensionsUsed.push('KHR_draco_mesh_compression') }, /unsupported extension/)
  refuse('no meshopt', d => { d.extensionsUsed = ['KHR_mesh_quantization'] }, /meshopt/)
  refuse('missing vertex colours', d => { delete d.meshes[0].primitives[0].attributes.COLOR_0 }, /invalid primitives/)
  refuse('missing UVs at a venue level', d => { delete d.meshes[0].primitives[0].attributes.TEXCOORD_0 }, /invalid primitives/)
  refuse('an external buffer', d => { d.buffers[0].uri = 'x.bin' }, /embedded buffer/)
  const noUv = base(); delete noUv.meshes[0].primitives[0].attributes.TEXCOORD_0
  assert.doesNotThrow(() => checkPlaceGlbStructure(glbOf(noUv), 'lod2'), 'the map icon needs no UVs')
})

test('the lazy manifest loader: a city with models, a city without, and a failure that is not remembered', async () => {
  forgetPlaceManifests()
  const manifest = await loadPlaceManifest('abuja')
  assert.equal(manifest?.city, 'abuja')
  assert.deepEqual(manifest, parsePlaceManifest(committed('abuja'), 'abuja'), 'the generated module is the committed JSON')
  assert.equal(await loadPlaceManifest('no-such-city'), null, 'a city without place models')
  assert.equal(await loadPlaceManifest('abuja'), manifest, 'read once')
  forgetPlaceManifests()
  let calls = 0
  const flaky = async () => { calls++; if (calls === 1) throw new Error('network'); return { abuja: async () => ({ default: manifest! }) } }
  assert.equal(await loadPlaceManifest('abuja', flaky), null, 'a failed load is null')
  assert.equal((await loadPlaceManifest('abuja', flaky))?.city, 'abuja', 'and is asked again')
  forgetPlaceManifests()
  const other = { ...manifest!, atlas: { url: `/assets/places/trim-${'b'.repeat(64)}.webp`, sha256: 'b'.repeat(64) } }
  assert.equal(await loadPlaceManifest('abuja', async () => ({ abuja: async () => ({ default: other }) })), null, 'a manifest for another atlas is not used')
  forgetPlaceManifests()
})

test('the backdrop: the venue\'s own model stands behind the back wall, measured under its own budget and not as scenery', async () => {
  const kit = createKit(), group = new kit.THREE.Group(), slot = recipePlaceSlot({ w: 27, d: 22 })
  let changed = 0
  try {
    const backdrop = await attachPlaceBackdrop(kit, group, { city: 'abuja', venue: 'airport', manifest: fixtureManifest(), slot, current: () => true, hints: weak, fetcher: served, loadAtlas: stubAtlas, changed: () => { changed++ } })
    assert.ok(backdrop, 'attached')
    assert.equal(backdrop.detail, 'lod1')
    assert.equal(group.userData.placeModelStatus, 'ready'); assert.equal(group.userData.placeModelDetail, 'lod1')
    assert.equal(changed, 1)
    const cost = measureRenderCost(group)
    assert.equal(cost.place.triangles, 2657); assert.equal(backdrop.triangles, 2657)
    assert.equal(cost.scenery.triangles, 0, 'the model is not scenery')
    assert.equal(cost.characters.triangles, 0)
    assert.ok(withinBudget(BUDGETS.PLACE_MODEL_LOD1_TRIANGLES, cost.place.triangles))
    assert.ok(withinBudget(BUDGETS.PLACE_MODEL_DRAW_CALLS, cost.place.drawCalls), `${cost.place.drawCalls} draw calls`)
    assert.equal(cost.scenery.drawCalls, cost.place.drawCalls, 'its draw calls count toward the shared 60')
    assert.equal(cost.place.meshes, 1, 'one merged mesh on the one atlas')
    const mesh = backdrop.group.getObjectByProperty('isMesh', true) as import('three').Mesh
    assert.ok(mesh.material && (mesh.material as import('three').MeshStandardMaterial).map, 'the atlas is bound to the model\'s material')
    assert.equal((mesh.material as import('three').MeshStandardMaterial).vertexColors, true, 'texture x vertex colour')
    assert.equal(mesh.castShadow, false)
    // Standing room: inside the slot, behind the wall, on the ground.
    const box = new kit.THREE.Box3().setFromObject(backdrop.group)
    assert.ok(box.max.z <= slot.frontZ + 1e-3 && box.min.z >= slot.frontZ - slot.depth - 1e-3, `depth ${box.min.z}..${box.max.z}`)
    assert.ok(box.min.x >= -slot.width / 2 - 1e-3 && box.max.x <= slot.width / 2 + 1e-3, 'width')
    assert.ok(Math.abs(box.min.y) < 1e-3 && box.max.y <= slot.height + 1e-3, 'height')
    assert.ok(box.max.z < -11, 'wholly outside the 27 x 22 walkable footprint, so it blocks nothing')
    backdrop.dispose()
    assert.equal(group.children.length, 0); assert.equal(group.userData.placeModelStatus, 'none')
  } finally { kit.dispose() }
})

test('the backdrop uses LOD0 on a strong device (when a LOD0 file is on hand)', async (t) => {
  const store = new URL('../../../scripts/places/out/store/', import.meta.url), entry = parsePlaceManifest(committed('abuja'), 'abuja').venues.airport
  let lod0: Uint8Array
  try { lod0 = new Uint8Array(readFileSync(new URL(`${entry!.lod0.sha256}.glb`, store))) } catch { t.skip('scripts/places/out/store is not built here'); return }
  const kit = createKit(), group = new kit.THREE.Group()
  try {
    const backdrop = await attachPlaceBackdrop(kit, group, { city: 'abuja', venue: 'airport', manifest: parsePlaceManifest(committed('abuja'), 'abuja'), slot: recipePlaceSlot({ w: 27, d: 22 }), current: () => true, hints: strong, fetcher: serve({ [entry!.lod0.sha256]: lod0 }), loadAtlas: stubAtlas })
    assert.equal(backdrop?.detail, 'lod0')
    const cost = measureRenderCost(group)
    assert.equal(cost.place.triangles, entry!.lod0.triangles)
    assert.ok(withinBudget(BUDGETS.PLACE_MODEL_TRIANGLES, cost.place.triangles), `${cost.place.triangles} triangles`)
    assert.ok(withinBudget(BUDGETS.PLACE_MODEL_DRAW_CALLS, cost.place.drawCalls))
  } finally { kit.dispose() }
})

test('the backdrop changes nothing when there is no model, the fetch fails, the scene is gone or has no room', async () => {
  const kit = createKit()
  try {
    const slot = recipePlaceSlot({ w: 27, d: 22 })
    const attempt = async (over: Partial<Parameters<typeof attachPlaceBackdrop>[2]>) => {
      const group = new kit.THREE.Group()
      const result = await attachPlaceBackdrop(kit, group, { city: 'abuja', venue: 'airport', manifest: fixtureManifest(), slot, current: () => true, hints: weak, fetcher: served, loadAtlas: stubAtlas, ...over })
      return { result, group }
    }
    const nothing = await attempt({ venue: 'not-a-venue' })
    assert.equal(nothing.result, null); assert.equal(nothing.group.children.length, 0); assert.equal(nothing.group.userData.placeModelStatus, 'none')
    const noCity = await attempt({ manifest: null })
    assert.equal(noCity.result, null); assert.equal(noCity.group.userData.placeModelStatus, 'none')
    const offline = await attempt({ fetcher: async () => { throw new TypeError('offline') } })
    assert.equal(offline.result, null); assert.equal(offline.group.children.length, 0); assert.equal(offline.group.userData.placeModelStatus, 'failed'); assert.match(String(offline.group.userData.placeModelError), /offline/)
    const bad = await attempt({ fetcher: serve({ [sha(lod1)]: new Uint8Array(lod1.length) }) })
    assert.equal(bad.result, null); assert.equal(bad.group.userData.placeModelStatus, 'failed')
    const atlasFails = await attempt({ loadAtlas: async () => { throw new Error('atlas 404') } })
    assert.equal(atlasFails.result, null); assert.equal(atlasFails.group.children.length, 0); assert.equal(atlasFails.group.userData.placeModelStatus, 'failed')
    let live = true
    const gone = await attempt({ current: () => live, fetcher: async (...args) => { live = false; return served(...args) } })
    assert.equal(gone.result, null); assert.equal(gone.group.children.length, 0)
    const full = await attempt({ fits: () => false })
    assert.equal(full.result, null); assert.equal(full.group.children.length, 0); assert.equal(full.group.userData.placeModelStatus, 'skipped')
  } finally { kit.dispose() }
})

test('map icons: the LOD2 file becomes plain arrays; a failed file is absent and the rest are kept', async () => {
  const manifest = fixtureManifest()
  const plan = await planPlaceIcons('abuja', { manifest, fetcher: served })
  assert.deepEqual([...plan!.venues], ['airport'])
  const icons = await plan!.load()
  const icon = icons.models.get('airport')!
  assert.equal(icon.triangles, 170); assert.ok(withinBudget(BUDGETS.PLACE_MODEL_LOD2_TRIANGLES, icon.triangles))
  assert.equal(icon.index.length, 510); assert.equal(icon.position.length, icon.color.length)
  assert.ok(icon.position.every(Number.isFinite))
  const failed = await (await planPlaceIcons('abuja', { manifest, fetcher: async () => new Response('x', { status: 503 }) }))!.load()
  assert.equal(failed.models.size, 0)
  assert.equal(await planPlaceIcons('abuja', { manifest: null }), null)
  assert.equal(typeof iconOf, 'function')
})

test('the first verified model asks the browser to keep storage and registers the place cache once; refusals are ignored', async () => {
  forgetPersistRequest()
  const calls: string[] = []
  const nav = { storage: { persisted: async () => false, persist: async () => { calls.push('persist'); return true } }, serviceWorker: { register: async (url: string, options?: { scope?: string }) => { calls.push(`register ${url} ${options?.scope}`) } } }
  rememberPlaces(nav); rememberPlaces(nav)
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.deepEqual(calls.sort(), ['persist', 'register /sw.js /'])
  forgetPersistRequest()
  assert.doesNotThrow(() => rememberPlaces({ storage: { persist: async () => { throw new Error('denied') } }, serviceWorker: { register: async () => { throw new Error('blocked') } } }))
  await new Promise(resolve => setTimeout(resolve, 5))
  forgetPersistRequest()
  assert.doesNotThrow(() => rememberPlaces({}))
  assert.doesNotThrow(() => rememberPlaces(undefined))
  forgetPersistRequest()
})

test('the release guard admits the two atlas files under assets/ and their size is within its 5 MB file limit', () => {
  for (const key of ['full', 'small'] as const) {
    const bytes = readFileSync(new URL(`../../../public${PLACE_ATLAS[key].url}`, import.meta.url)).length
    assert.ok(bytes < 5 * 1024 * 1024)
    assert.equal(isPackageAssetPath(`assets${PLACE_ATLAS[key].url}`, bytes), true, `${key} atlas`)
  }
  // Models are not shipped in the package at all (they live in R2): a place GLB under assets/ would be a mistake the guard's own size rule catches.
  assert.equal(PLACE_ATLAS.full.url.startsWith('/assets/places/'), true)
})
