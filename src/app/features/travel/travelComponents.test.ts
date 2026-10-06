// Component tests for the Getting around panels, in the approach of src/app/features/world/worldComponents.test.ts:
// each component is compiled by the project's Vite configuration and rendered to a string against the real
// store connected to a fake server. What is asserted is what the player reads and can press.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { createSSRApp, h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import type { LifeState } from '../../../types/life.ts'
import type { App } from '../../state/app.ts'
import { createFakeServer } from '../../testing/fakeServer.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const server = createFakeServer()
let vite: ViteDevServer
let app: App
const realFetch = globalThis.fetch

interface TravelStateModule { mapUi: Record<string, unknown>; layers: Record<string, boolean>; seen: { city: string | null; params: unknown; layout: string } }
const load = async <T = { default: Component }>(path: string): Promise<T> => await vite.ssrLoadModule(path) as T
const text = (html: string): string => html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, '\'').replace(/\s+/g, ' ').trim()
async function render(path: string, props: Record<string, unknown> = {}): Promise<string> {
  const component = (await load(path)).default
  return renderToString(createSSRApp({ render: () => h(component, props) }))
}
const travelState = (): Promise<TravelStateModule> => load<TravelStateModule>('/src/app/features/travel/travelState.ts')
/** Run `body` with the life changed, then put it back. */
/** Run `body` while the fake server is unreachable, then reconnect. */
async function whileOffline(body: () => Promise<void>): Promise<void> {
  server.fault.offline = true
  await app.game.refresh()
  try { assert.equal(app.game.connected.value, false); await body() } finally {
    server.fault.offline = false
    assert.equal(await app.game.connect(), true)
    app.game.stop()
  }
}
async function withState(change: (state: LifeState) => LifeState, body: () => Promise<void>): Promise<void> {
  const before = app.game.state.value
  app.game.state.value = change(before)
  try { await body() } finally { app.game.state.value = before }
}
const resetMap = async (): Promise<void> => {
  const { mapUi, layers, seen } = await travelState()
  Object.assign(mapUi, { destination: null, mode: null, filter: 'all', layer: 'city', showAll: false, listOpen: null, aboutOpen: false })
  Object.assign(layers, { lgas: true, homes: true, moving: false, billboards: false, sea: false, gov: false })
  Object.assign(seen, { city: null, params: null, layout: '' })
}
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

before(async () => {
  globalThis.fetch = server.fetch
  vite = await createServer({ root, configFile: `${root}vite.config.ts`, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
  const cityLoader = await vite.ssrLoadModule('/src/game/cities/registry.ts') as typeof import('../../../game/cities/registry.ts')
  await cityLoader.loadCityContent('lagos')
  app = (await load<{ useApp: () => App }>('/src/app/state/app.ts')).useApp()
  assert.equal(await app.game.connect(), true)
  app.game.stop()
})
after(async () => { app?.game.stop(); await vite?.close(); globalThis.fetch = realFetch })

test('the registered panels carry the metadata of the existing ones', async () => {
  type Meta = { id: string; title: string; placement: string; order?: number; group?: string; slot?: string; badge?: (state: LifeState, view: unknown) => unknown }
  const { TRAVEL_PANELS } = await load<{ TRAVEL_PANELS: readonly Meta[] }>('/src/app/features/travel/register.ts')
  const meta = TRAVEL_PANELS.map(({ id, title, placement, order, group, slot }) => ({ id, title, placement, order, group, slot }))
  assert.deepEqual(meta, [
    { id: 'map', title: 'Map', placement: 'nav', order: undefined, group: undefined, slot: undefined },
    { id: 'roadside', title: 'On the road', placement: 'modal', order: undefined, group: undefined, slot: undefined },
    { id: 'ride', title: 'Ride', placement: 'phone', order: 18, group: 'life', slot: undefined },
    { id: 'city', title: 'City', placement: 'modal', order: undefined, group: undefined, slot: undefined },
    { id: 'visiting', title: 'Home', placement: 'modal', order: undefined, group: undefined, slot: undefined },
    { id: 'roadside-chip', title: 'On the road', placement: 'hud', order: 5, group: undefined, slot: 'alert' },
  ])
  const badge = TRAVEL_PANELS.find((panel) => panel.id === 'ride')?.badge
  assert.equal(badge?.(app.game.state.value, { travel: { event: null } }), 0)
  assert.equal(badge?.(app.game.state.value, { travel: { event: { id: 'hawker' } } }), 1)
})

test('the Map overview: the handle, the filters, the layers and every place with whether it is open', async () => {
  await resetMap()
  const view = app.game.view.value
  const html = await render('/src/app/features/travel/MapApp.vue')
  const words = text(html)
  assert.match(html, /<div class="map-panel map-overview (is-open|is-collapsed)"/)
  assert.match(html, /<button[^>]*class="map-handle"[^>]*aria-controls="map-list"/)
  assert.ok(words.includes(`${view.city.name} map`))
  assert.match(words, /\d+ of \d+ places open/)
  assert.match(html, /role="group" aria-label="Filter places"/)
  for (const label of ['All', 'Open now', 'Food']) assert.ok(words.includes(label), label)
  assert.match(html, /<button[^>]*aria-pressed="true"[^>]*class="is-selected"[^>]*>(?:<!--.*?-->)*All/)
  assert.match(html, /role="group" aria-label="Map layers"/)
  for (const label of ['LGAs', 'Homes', 'Moving', 'Billboards', 'Gov']) assert.ok(words.includes(label), label)
  assert.ok(!words.includes('Sea'), 'the sea-plot layer is not offered')
  assert.ok(!words.includes('Street traffic'), 'a layer that is off says nothing')
  const listed = view.travel.destinations.filter((item) => item.kind !== 'soon')
  assert.equal((html.match(/class="ll-row"[^>]*>(?:<!--\[-->)?<button/g) ?? []).length, listed.length, 'every place is in the list')
  assert.ok(words.includes('You are here'))
  // The world is one tap from the Map: the level bar is on the city map itself, not at the end of the list.
  assert.match(html, /<nav class="map-levels" aria-label="Map level\. You are in World › Africa › Nigeria › [^"]+">/)
  assert.match(html, /<button[^>]*data-map-level="world"[^>]*data-tour="map-world"[^>]*title="World map · 9 cities open"/)
  assert.deepEqual([...html.matchAll(/data-map-level="([a-z]+)"/g)].map((match) => match[1]), ['world', 'africa', 'nigeria', 'city'])
  assert.match(html, /<button[^>]*data-map-level="city"[^>]*aria-current="true"/, 'the level in view is marked')
  assert.doesNotMatch(html.slice(html.indexOf('id="map-list"')), /World map/, 'no second entry hidden at the end of the list')
  assert.match(html, /<svg class="ui-glyph"/, 'places and layers are drawn with glyphs')
  assert.doesNotMatch(html, /\p{Extended_Pictographic}/u, 'never the content emoji')
})

test('the Map overview: a filter narrows the list to its category, and Home is on every one', async () => {
  await resetMap()
  const { mapUi } = await travelState()
  const view = app.game.view.value
  mapUi.filter = 'food'
  const html = await render('/src/app/features/travel/MapApp.vue')
  const expected = view.travel.destinations.filter((item) => item.kind !== 'soon' && (item.category === 'food' || item.kind === 'home'))
  assert.ok(expected.length > 1 && expected.length < view.travel.destinations.length)
  assert.equal((html.match(/class="ll-row"[^>]*>(?:<!--\[-->)?<button/g) ?? []).length, expected.length)
  assert.match(html, /<button[^>]*aria-pressed="true"[^>]*class="is-selected"[^>]*>(?:<!--.*?-->)*Food/)
  await resetMap()
})

test('the Map overview: a switched-on layer says what it shows, or why it cannot, and the way to manage it', async () => {
  await resetMap()
  const { layers } = await travelState()
  layers.moving = true
  layers.gov = true
  const html = await render('/src/app/features/travel/MapApp.vue')
  const words = text(html)
  assert.ok(words.includes('Street traffic — decoration only, it changes nothing in the game.'))
  assert.match(words, /Loading…|No Governor yet|Governor /)
  assert.ok(words.includes('Open the State House'))
  await resetMap()
})

test('the venue card: hours, how to travel, the trip line, Go, and About folded away', async () => {
  await resetMap()
  const view = app.game.view.value
  const target = view.travel.destinations.find((item) => !item.here && item.open && item.modes.length > 0 && !item.blocked)
  assert.ok(target, 'the fake life has somewhere to go')
  const html = await render('/src/app/features/travel/MapApp.vue', { params: { destination: target.id } })
  const words = text(html)
  assert.match(html, new RegExp(`<div class="map-panel map-card" role="region" aria-label="${escape(target.label)}"`))
  assert.ok(words.includes(target.label) && words.includes(target.district) && words.includes(target.status))
  assert.match(html, /aria-label="Back to the map and the list of places"/)
  assert.match(html, new RegExp(`aria-label="Copy a link to ${escape(target.label)}"`))
  assert.match(html, /role="group" aria-label="How to travel"/)
  for (const mode of target.modes) assert.match(html, new RegExp(`aria-label="${escape(mode.label)}, (Free|₦[\\d,]+), ${mode.seconds} seconds"`))
  assert.match(html, /<p class="map-trip">/)
  assert.match(html, /<button[^>]*class="map-go"[^>]*>(?:<!--.*?-->)*Go · (Free|₦[\d,]+)/)
  assert.doesNotMatch(html, /class="map-go"[^>]*disabled/)
  assert.match(html, /<details class="ui-details map-about"/)
  assert.doesNotMatch(html, /<details[^>]* open/, 'About is folded away')
  await resetMap()
})

test('the venue card: where you are, and offline, are said on the card with the way out', async () => {
  await resetMap()
  const view = app.game.view.value
  const here = view.travel.destinations.find((item) => item.here)
  assert.ok(here)
  const html = await render('/src/app/features/travel/MapApp.vue', { params: { destination: here.id } })
  assert.ok(text(html).includes('You are already here. Go inside'))
  assert.match(html, /<button[^>]*class="map-go"[^>]*disabled[^>]*aria-label="Cannot go: You are here"/)
  assert.match(html, /<div class="[^"]*is-already_here[^"]*" role="note">/)
  await resetMap()
  const target = view.travel.destinations.find((item) => !item.here && item.open && !item.blocked)
  assert.ok(target)
  await whileOffline(async () => {
    const offline = await render('/src/app/features/travel/MapApp.vue', { params: { destination: target.id } })
    assert.match(offline, /<div class="[^"]*is-offline[^"]*" role="note">/)
    assert.ok(text(offline).includes('so the trip cannot start'))
    assert.match(offline, /<button[^>]*class="map-fix"[^>]*>(?:<!--.*?-->)*(Try again|Choose a nickname|Start a new life)/)
    assert.match(offline, /<button[^>]*class="map-go"[^>]*disabled/)
  })
  await resetMap()
})

test('the trip bar: from, to, how, the time left, Cancel with the real rule; the card makes way for it', async () => {
  await resetMap()
  const view = app.game.view.value
  const target = view.travel.destinations.find((item) => !item.here && item.open && !item.blocked)
  assert.ok(target)
  const mode = target.modes[0]
  assert.ok(mode)
  await withState((state) => ({ ...state, activeAction: { kind: 'travel', id: target.id, mode: mode.id, duration: 10, remaining: 4, fare: mode.fare } }), async () => {
    const html = await render('/src/app/features/travel/MapApp.vue')
    const words = text(html)
    assert.match(html, new RegExp(`<div class="map-panel map-trip" role="group" aria-label="Travelling to ${escape(target.label)}"`))
    assert.ok(words.includes(mode.label) && words.includes('4s left'))
    assert.match(html, /<button[^>]*class="map-trip-cancel"[^>]*aria-label="Cancel the trip and stay at /)
    assert.match(html, /role="progressbar" aria-label="Trip progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="60"/)
    assert.match(html, /--from:60\.0%;animation-duration:4\.00s/)
    assert.match(words, /Cancel to stay at .+\. /)
    assert.match(html, /<svg class="ui-glyph"/)
    assert.doesNotMatch(html, /map-overview/)
  })
  await resetMap()
})

test('the world layer: the panel only names the screen', async () => {
  await resetMap()
  const html = await render('/src/app/features/travel/MapApp.vue', { params: { layer: 'world' } })
  assert.equal(html.replace(/<!--.*?-->/g, ''), '<h1 class="ui-sr">World map. Explore cities and travel routes.</h1>')
  await resetMap()
})

test('the Ride app: where you are, how to travel, a row for every place with its fare', async () => {
  const view = app.game.view.value
  const html = await render('/src/app/features/travel/RideApp.vue')
  const words = text(html)
  const here = view.travel.destinations.find((item) => item.here)
  assert.ok(words.includes(`You are at ${here?.label} . Fares are charged when you set off — no refund if you cancel.`), words)
  assert.match(html, /role="group" aria-label="How to travel"/)
  assert.match(html, /<details class="how is-page"/)
  assert.ok(words.includes('How rides work'))
  const places = view.travel.destinations.filter((item) => item.kind !== 'soon' && !item.here)
  assert.equal((html.match(/<li class="[^"]*ride-row/g) ?? []).length, places.length)
  assert.match(html, /<button[^>]*class="ride-go"[^>]*aria-label="Go to [^"]+ by [^"]+ for (Free|₦[\d,]+)"/)
  assert.doesNotMatch(html, /\p{Extended_Pictographic}/u)
})

test('the Ride app: offline is said once at the top, and every Go is off', async () => {
  await whileOffline(async () => {
    const html = await render('/src/app/features/travel/RideApp.vue')
    assert.equal((html.match(/class="ride-notice"/g) ?? []).length, 1)
    assert.ok(text(html).includes('so the trip cannot start'))
    assert.doesNotMatch(html, /<button[^>]*class="ride-go"(?![^>]*disabled)/, 'no Go can be pressed')
    assert.doesNotMatch(html, /class="ride-why"/, 'the rows do not repeat it')
  })
})

test('the Ride app: travelling is said once, with the way to cancel', async () => {
  const view = app.game.view.value
  const target = view.travel.destinations.find((item) => !item.here && item.open && !item.blocked)
  assert.ok(target)
  await withState((state) => ({ ...state, activeAction: { kind: 'travel', id: target.id, mode: 'danfo', duration: 10, remaining: 4 } }), async () => {
    const html = await render('/src/app/features/travel/RideApp.vue')
    assert.equal((html.match(/class="ride-notice"/g) ?? []).length, 1)
    assert.match(html, /<button[^>]*class="ride-fix"[^>]*>(?:<!--.*?-->)*Cancel that trip/)
    assert.ok(text(html).includes('Already travelling'))
  })
})

test('the roadside prompt: nothing waiting, then a choice with its cost and chance', async () => {
  const path = '/src/app/features/travel/RoadsideModal.vue'
  const none = text(await render(path))
  assert.ok(none.startsWith('Nothing is waiting for you by the roadside right now.') && none.endsWith('Carry on'))
  await withState((state) => ({ ...state, cash: 100, travel: { ...state.travel, event: { id: 'hawker', at: app.game.view.value.now } } }), async () => {
    const event = app.game.view.value.travel.event
    assert.ok(event)
    const html = await render(path)
    const words = text(html)
    assert.ok(words.includes(event.title) && words.includes(event.text))
    assert.match(html, /<div class="map-event-choices">/)
    for (const choice of event.choices) assert.ok(words.includes(choice.label), choice.label)
    assert.ok(words.includes('Not answering is fine: this passes when you travel again'))
    const dear = event.choices.find((choice) => choice.blocked)
    if (dear) assert.match(html, /<button[^>]*class="ui-button"[^>]*disabled[^]*?class="map-event-why"/)
  })
})

test('the roadside chip: nothing without an event, a button with it', async () => {
  const path = '/src/app/features/travel/RoadsideChip.vue'
  assert.equal(text(await render(path)), '', 'nothing: the chip, and the "What you can do now" card beside it, are both empty for a life that is fine')
  await withState((state) => ({ ...state, travel: { ...state.travel, event: { id: 'hawker', at: app.game.view.value.now } } }), async () => {
    const html = await render(path)
    assert.match(html, /<button type="button" class="(is-new )?map-event-chip( is-new)?">/)
    assert.ok(text(html).includes('Hawker in the go-slow Tap to answer'))
  })
})

test('the city card: the city and a link to every place on the Map', async () => {
  const view = app.game.view.value
  const html = await render('/src/app/features/travel/CityPanel.vue')
  const words = text(html)
  assert.ok(words.startsWith(view.city.name))
  assert.ok(words.includes('You are here. Choose somewhere to go.'))
  const places = /<div id="city-places">([^]*?)<\/div>/.exec(html)?.[1]
  assert.ok(places, 'the complete place list remains available')
  assert.equal((places.match(/<button type="button">/g) ?? []).length, view.venues.length)
  assert.ok(words.includes(`Things to do in ${view.city.name}`))
  const guide = /<ul>([^]*?)<\/ul>/.exec(html)?.[1]
  assert.ok(guide, 'the city guide is shown before the full place list')
  assert.equal((guide.match(/<li>/g) ?? []).length, 5)
  assert.equal((guide.match(/<button type="button">/g) ?? []).length, 5)
  assert.ok(words.includes(`More places and activities are coming to ${view.city.name}.`))
})

test('your own house: a life without a place is sent to choose; a life with one sees its look and the bigger houses', async () => {
  const path = '/src/app/features/travel/MyHouse.vue'
  if (!app.game.view.value.estate.placed) {
    const html = await render(path)
    assert.ok(text(html).includes('you have no home here yet. Everyone gets a starter house on their own plot, free'))
    assert.match(html, /<button[^>]*class="ui-button is-primary is-block"[^>]*data-choose-lga[^>]*>(?:<!--.*?-->)*Choose your local government/, 'one primary way to settle, which opens the picker (not Profile)')
    assert.ok(!html.includes('Choose where you live'))
  }
  await withState((state) => ({ ...state, estate: { ...state.estate, lga: 'ikeja', lgaConfirmed: true } }), async () => {
    const estate = app.game.view.value.estate
    assert.equal(estate.placed, true)
    const html = await render(path)
    const words = text(html)
    assert.match(html, /<section class="world-card" data-my-house/)
    assert.ok(words.includes(estate.tier.label) && words.includes('Look') && words.includes('Bigger houses'))
    for (const field of ['Roof shape', 'Walls', 'Roof colour', 'Door', 'Windows', 'Fence', 'Yard', 'Name sign']) assert.ok(words.includes(field), field)
    assert.match(html, /role="img" aria-label="[^"]+"/)
    assert.match(html, /<button[^>]*class="[^"]*is-chosen[^"]*"[^>]*aria-pressed="true"[^>]*disabled/, 'the look you have is not pressable')
    assert.ok(words.includes(estate.living === 'own' ? 'You live here · no weekly rent' : 'Move into your own house · free'))
    if (estate.plot) assert.ok(words.includes('Show it on the map'))
  })
})
