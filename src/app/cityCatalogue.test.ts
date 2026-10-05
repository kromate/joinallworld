import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { App } from './state/app.ts'
import type { CrowdEntry } from '../scene/crowd.ts'
import type { LifeState } from '../types/life.ts'
import { createKit } from '../scene/kit.ts'
import { buildVenueScene } from '../scene/venue-scenes.ts'
import { contentFor } from '../game/cities/runtime.ts'
import { loadCityContent as loadDirectContent, registerCityForTest as registerDirectCity } from '../game/cities/registry.ts'
import { FICTIONAL_CITY_ID as DIRECT_CITY_ID, fictionalCity as directCity } from '../game/cities/testing/fictionalCity.test-fixture.ts'
import { tablesFor } from '../tables/city-places.ts'

const root = fileURLToPath(new URL('../..', import.meta.url))
let vite: ViteDevServer
let app: App
let dispose: Array<() => void> = []
let createLife: (saved: unknown, context: { cityId: string }) => LifeState
const realFetch = globalThis.fetch
const load = async <T>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/\s+/g, ' ').trim()

before(async () => {
  vite = await createServer({ root, configFile: `${root}/vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const registry = await load<typeof import('../game/cities/registry.ts')>('/src/game/cities/registry.ts')
  const fixtures = await load<typeof import('../game/cities/testing/fictionalCity.test-fixture.ts')>('/src/game/cities/testing/fictionalCity.test-fixture.ts')
  createLife = (await load<typeof import('../life.ts')>('/src/life.ts')).createLife
  dispose = [registry.registerCityForTest(fixtures.fictionalCity), registry.registerCityForTest(fixtures.fictionalNeighbourCity)].map((registration) => registration.dispose)
  await Promise.all([registry.loadCityContent(fixtures.FICTIONAL_CITY_ID), registry.loadCityContent(fixtures.FICTIONAL_NEIGHBOUR_CITY_ID)])
  const fake = (await load<typeof import('./testing/fakeServer.ts')>('/src/app/testing/fakeServer.ts')).createFakeServer()
  globalThis.fetch = fake.fetch
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
})
after(async () => { for (const release of dispose.reverse()) release(); app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

test('Vue game view, scene crowd and NPC card use the current city catalogue', async () => {
  const state = createLife({ location: 'test-square' }, { cityId: 'test-fictional' })
  app.game.cityId.value = 'test-fictional'
  app.game.state.value = state
  const venues = app.game.view.value.venues
  assert.equal(venues.find((venue) => venue.id === 'test-square')?.label, 'Test Square')
  assert.equal(venues.some((venue) => venue.label === 'Freedom Park' || venue.id === 'park'), false)

  let crowd: CrowdEntry[] = []
  Reflect.set(app.scene.venue, 'value', { setCrowd(next: CrowdEntry[]) { crowd = next } })
  app.showCrowd()
  assert.deepEqual(crowd.filter((entry) => entry.kind === 'npc').map((entry) => entry.name), ['One', 'Two'])

  const component = (await load<{ default: Component }>('/src/app/features/social/NpcCard.vue')).default
  const html = await renderToString(createSSRApp({ render: () => h(component, { id: 'test-fictional-one' }) }))
  const words = text(html)
  assert.ok(words.includes('One') && words.includes('Neighbour · NPC'))
  assert.equal(words.includes('Kunle') || words.includes('Freedom Park'), false)

  const RadioBanner = (await load<{ default: Component }>('/src/app/features/civic/RadioBanner.vue')).default
  const radio = text(await renderToString(createSSRApp({ render: () => h(RadioBanner) })))
  assert.ok(radio.includes('Club radio') && !radio.includes('Quilox'))
  const TablesChip = (await load<{ default: Component }>('/src/app/features/tables/TablesChip.vue')).default
  const chip = text(await renderToString(createSSRApp({ render: () => h(TablesChip) })))
  assert.ok(chip.includes('Whot table here'))
  const AdsApp = (await load<{ default: Component }>('/src/app/features/civic/AdsApp.vue')).default
  const ads = text(await renderToString(createSSRApp({ render: () => h(AdsApp) })))
  assert.ok(ads.includes('1 billboard slots') && !ads.includes('12 billboard slots'))
  app.game.state.value = { ...state, location: 'home', spot: 'kitchen' }
  const HealthApp = (await load<{ default: Component }>('/src/app/features/life/HealthApp.vue')).default
  const health = text(await renderToString(createSSRApp({ render: () => h(HealthApp) })))
  assert.ok(health.includes('See the Doctor ₦123 · 2s') && health.includes('Go to Test Square'))
  assert.equal(health.includes('General Hospital'), false)
})

test('the fictional table is the only table row and scene marker in its renamed venue', async () => {
  const registration = registerDirectCity(directCity)
  const kit = createKit()
  try {
    await loadDirectContent(DIRECT_CITY_ID)
    assert.deepEqual(tablesFor(DIRECT_CITY_ID).map((table) => [table.id, table.venue, table.label]), [['test-square-table', 'test-square', 'Test square table']])
    const venue = contentFor(DIRECT_CITY_ID).venues.find((item) => item.id === 'test-square')?.definition
    assert.ok(venue)
    const scene = buildVenueScene(kit, venue, DIRECT_CITY_ID)
    try {
      assert.deepEqual(scene.walk.things().map((thing) => [thing.id, thing.label]), [['table:test-square-table', 'Whot · Test square table']])
    } finally { scene.dispose() }
  } finally { kit.dispose(); registration.dispose() }
})

test('cold foreign NPC card uses the saved snapshot and offers no local interaction', async () => {
  const registry = await load<typeof import('../game/cities/registry.ts')>('/src/game/cities/registry.ts')
  const fixtures = await load<typeof import('../game/cities/testing/fictionalCity.test-fixture.ts')>('/src/game/cities/testing/fictionalCity.test-fixture.ts')
  for (const release of dispose.reverse()) release()
  dispose = [registry.registerCityForTest(fixtures.fictionalCity), registry.registerCityForTest(fixtures.fictionalNeighbourCity)].map((registration) => registration.dispose)
  await registry.loadCityContent(fixtures.FICTIONAL_NEIGHBOUR_CITY_ID)
  assert.equal(registry.cachedCityContent(fixtures.FICTIONAL_CITY_ID), null)
  const state = createLife({ social: { rel: {
    'test-fictional-one': { p: 20, npc: true, npcSnapshot: { city: fixtures.FICTIONAL_CITY_ID, name: 'One', emoji: 'person', role: 'Neighbour' } },
  } } }, { cityId: fixtures.FICTIONAL_NEIGHBOUR_CITY_ID })
  app.game.cityId.value = fixtures.FICTIONAL_NEIGHBOUR_CITY_ID
  app.game.state.value = state

  const component = (await load<{ default: Component }>('/src/app/features/social/NpcCard.vue')).default
  const html = await renderToString(createSSRApp({ render: () => h(component, { id: 'test-fictional-one' }) }))
  const words = text(html)
  assert.ok(words.includes('One') && words.includes('Neighbour · NPC'))
  assert.ok(words.includes('Fictional') && words.includes('Travel there to interact.'))
  assert.equal(html.includes('class="social-act"'), false)
  assert.equal(words.includes('Neighbour One') || words.includes('Neighbour Two'), false, 'a local neighbour does not replace the cold foreign identity')
  assert.equal(registry.cachedCityContent(fixtures.FICTIONAL_CITY_ID), null)
})
