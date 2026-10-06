// The Map's level bar, the trip bar of a trip between cities and the Home sheet of a visitor, without a browser.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import type { LifeState } from '../../../types/life.ts'
import type { EstateView } from '../../../types/view.ts'
import { asMapParams, mapCrumbText, mapLevels, paidText, tripInfo } from './travelModel.ts'
import { visitorHome } from './visitorModel.ts'

const here = (path: string): Promise<string> => readFile(new URL(path, import.meta.url), 'utf8')

test('the level bar: World › Africa › Nigeria › the city, the level in view marked, each wider level one tap', () => {
  const city = mapLevels('Lagos', 'city')
  assert.deepEqual(city.map((level) => [level.id, level.label, level.atlas, level.current]), [['world', 'World', 0, false], ['africa', 'Africa', 1, false], ['nigeria', 'Nigeria', 2, false], ['city', 'Lagos', null, true]])
  assert.equal(mapCrumbText('Abuja'), 'World › Africa › Nigeria › Abuja')
  for (const [index, id] of ['world', 'africa', 'nigeria'].entries()) assert.deepEqual(mapLevels('Kano', 'world', index).filter((level) => level.current).map((level) => level.id), [id])
  assert.deepEqual(asMapParams({ layer: 'world', level: 0, city: 'abuja' }), { layer: 'world', level: 0, city: 'abuja' })
})

test('the bar is on the city map itself, the world is one key away, and arriving opens no sheet', async () => {
  const [app, bar, levels, keys, shell, pane] = await Promise.all([here('./MapApp.vue'), here('./MapLevels.vue'), here('./MapOverview.vue'), here('../../../ui/keys.ts'), here('../../state/app.ts'), here('../../scene/MapPane.vue')])
  assert.match(app, /<div class="map-dock">\s*<MapLevels \/>/, 'drawn with the city map whatever else the panel shows, as the top of the one docked column')
  assert.match(bar, /showMapLayer\('world', \{ level: level\.atlas \}\)/)
  assert.doesNotMatch(levels, /World map|showWorld/, 'the entry at the end of the list is gone')
  assert.match(keys, /\{ keys: \['g'\], label: 'G', run: 'world' \}/)
  assert.match(await here('../../App.vue'), /verb === 'world'\) showMapLayer\('world', \{ level: 0 \}\)/)
  // A visitor (a home elsewhere, none here) is not shown the city sheet on arrival or at connect: only a life with no home anywhere is.
  assert.equal((shell.match(/shell\.open\('city'/g) ?? []).length, 3)
  assert.match(shell, /!state\.estate\.lga && !state\.estate\.home && !away\) shell\.open\('city'/)
  assert.match(shell, /estate\.lga === null && !game\.state\.value\.estate\.home\) shell\.open\('city'\)/)
  assert.match(shell, /else if \(!away && state\.message\.startsWith\('Welcome to '\)\) game\.toast\(state\.message\)/, 'the welcome notice is shown on arrival')
  assert.match(pane, /wallet: \(\) => game\.state\.value\.cash/)
  assert.match(pane, /scene\.world\.value\?\.warm\(\)/, 'the wider levels are fetched while the device is idle')
})

test('a trip between cities has its own trip bar: the two cities, the way, what was paid, and no Cancel', () => {
  const state = { cash: 1000, location: 'home', activeAction: { kind: 'intercity', id: 'abuja', from: 'lagos', mode: 'air', fare: 65000, duration: 16, remaining: 12 } } as unknown as LifeState
  const names: Record<string, string> = { lagos: 'Lagos', abuja: 'Abuja' }
  const trip = tripInfo(state, { travel: { destinations: [], modes: [], active: null } } as never, (id) => names[id] ?? id)
  assert.ok(trip)
  assert.deepEqual([trip.from.label, trip.to.label, trip.mode.label, trip.fare, trip.remaining, trip.duration, trip.fraction, trip.locked, trip.commute], ['Lagos', 'Abuja', 'Flight', 65000, 12, 16, 0.25, true, false])
  assert.equal(paidText(trip), ' · ₦65,000 paid')
  assert.match(trip.rule, /^You are on the way to Abuja\. The trip has left, so it cannot be cancelled\.$/)
  for (const [mode, label] of [['road', 'Bus'], ['rail', 'Train']] as const) assert.equal(tripInfo({ ...state, activeAction: { ...state.activeAction, mode } } as unknown as LifeState, { travel: { destinations: [] } } as never)?.mode.label, label)
})

const estate = (extra: Partial<EstateView> = {}): Pick<EstateView, 'cityName' | 'home' | 'visiting' | 'lodging' | 'settle'> => ({
  cityName: 'Abuja', home: { city: 'lagos', name: 'Lagos', here: false }, visiting: true, lodging: { fee: 2500, blocked: null },
  settle: { buy: { tier: 'Two-room house', from: 64000, prices: { abaji: 64000, amac: 76000 }, groundRent: 400 }, main: { blocked: null, gives: 'your starter house in Lagos' } }, ...extra,
})

test('Home for a visitor: where it is, where its home is, and three actions with their prices', () => {
  const model = visitorHome(estate())
  assert.ok(model)
  assert.equal(model.title, 'You are visiting Abuja')
  assert.match(model.line, /^Your home is in Lagos\./)
  assert.deepEqual([model.rest, model.home], [{ label: 'Rest at a guest house · ₦2,500', why: '' }, { label: 'Travel home to Lagos' }])
  assert.equal(model.buy.label, 'Buy a home here · from ₦64,000')
  assert.match(model.buy.note, /two-room house .* as well as your home in Lagos.*Ground rent ₦400 a week/)
  assert.deepEqual([model.main.label, model.main.why], ['Make Abuja my main home', ''])
  assert.match(model.main.note, /^Free: your starter house stands on a plot here instead, and you give up your starter house in Lagos\. You vote where your main home is\.$/)
  // Why a button is off is the server's own sentence; offline says so on each.
  assert.equal(visitorHome(estate({ lodging: { fee: 2500, blocked: 'You are rested and fresh already. Keep your money.' } }))?.rest.why, 'You are rested and fresh already. Keep your money.')
  const owned = visitorHome(estate({ settle: { ...estate().settle!, main: { blocked: 'Your Bungalow in Lagos is property you paid for: it is never given up. Buy a home here first, then make it your main home.', gives: null } } }))
  assert.match(owned?.main.why ?? '', /never given up\. Buy a home here first/)
  assert.deepEqual([visitorHome(estate(), 'Offline — this needs the server')?.rest.why, visitorHome(estate(), 'Offline — this needs the server')?.main.why], ['Offline — this needs the server', 'Offline — this needs the server'])
  // Not a visitor: at home, or not settled in.
  assert.equal(visitorHome(estate({ visiting: false, settle: null })), null)
})

test('the Home tab, the Houses app, Profile and the city sheet each show a visitor the same sheet, and never ask', async () => {
  const [nav, house, profile, city, sheet, card] = await Promise.all([here('../nav/BottomNav.vue'), here('./MyHouse.vue'), here('../sim/ProfileTab.vue'), here('./CityPanel.vue'), here('./VisitorHome.vue'), here('../world/LgaCard.vue')])
  assert.match(nav, /estate\.visiting\) \{ shell\.open\('visiting'\); return \}/)
  assert.match(house, /<VisitorHome v-if="estate && estate\.settle" \/>/)
  assert.match(house, /data-make-main[^>]*@click="makeMain">Make \{\{ estate\.cityName \}\} my main home/)
  assert.match(profile, /v-else-if="view\.estate\.settle"><b>Home<\/b> \{\{ view\.estate\.home\?\.name \}\} · visiting/)
  assert.match(profile, /<LgaCard v-if="onboarding\.done && !view\.estate\.settle" \/>/, 'a visitor is not shown a chooser it did not ask for')
  assert.match(city, /v-if="game\.view\.value\.estate\.settle"[^>]*data-city-visiting>You are visiting\. Your home is in/)
  for (const action of ['rest', 'home', 'things', 'buy', 'main']) assert.match(sheet, new RegExp(`data-visitor="${action}"`), action)
  assert.match(sheet, /command\('estate\.lodge'\)/)
  assert.match(sheet, /<LgaCard v-else home="buy"/); assert.match(sheet, /<LgaCard v-else home="main"/)
  assert.match(card, /props\.home \? \{ lga, via, home: props\.home \} : \{ lga, via \}/)
})
