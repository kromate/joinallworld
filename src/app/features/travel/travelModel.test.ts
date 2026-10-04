// The Getting around logic without a browser. The first tests are the port of
// src/ui/panels/world-ui.test.js (the words and the way out for every connection state); the rest
// hold what the Map, the Ride app and the roadside prompt decide to what the existing panels did.
import assert from 'node:assert/strict'
import test from 'node:test'
import type { LifeState } from '../../../types/life.ts'
import type { TravelDestination, TravelModeCard } from '../../../types/view.ts'
import { FIELD_NAMES, minutesToGo, offeredTiers, offlineWhy, swatchLabel, swatchOff, swatchTitle, tierWhy } from './myHouseModel.ts'
import { chipKey, markShown, resetShown } from './roadsideChipModel.ts'
import { LINK_STATES, linkWords } from './travelBoundary.ts'
import type { TravelPanelView } from './travelModel.ts'
import {
  CHIP_LIMIT, DATA_LAYERS, EVERYWHERE, FILTERS, LAYERS, asMapParams, chosenMode, choiceHint, choiceTitle, expiryText, fareText, goBlock, initialLayers, layerNote,
  layoutKey, matchesFilter, needsLine, overviewLine, paidText, pickedMode, rideRows, rideRules, ridePlaces, signed, statusClass, tripInfo, tripLine, venueLink,
} from './travelModel.ts'

const mode = (extra: Partial<TravelModeCard> = {}): TravelModeCard => ({ id: 'danfo', label: 'Danfo', icon: '🚌', blurb: 'Cheap and slow', fuel: false, fare: 150, seconds: 8, needs: {}, xp: {}, blocked: null, ...extra })
const place = (extra: Partial<TravelDestination> = {}): TravelDestination => ({
  id: 'park', kind: 'venue', label: 'Freedom Park', district: 'Lagos Island', icon: '🌳', description: '', category: 'fun', x: 1, y: 1, zone: 'island', here: false, visited: false,
  open: true, hours: 'Open 24 hours', status: 'Open', band: null, ambient: '', preview: [], blocked: null, modes: [mode()], ...extra,
})
const destination = place({ id: 'cchub' as TravelDestination['id'], label: 'CcHub' })
const state = { cash: 1000, location: 'home', activeAction: null } as unknown as LifeState
const view = (extra: Record<string, unknown> = {}): TravelPanelView => ({ travel: { destinations: [destination], modes: [], active: null, defaultMode: 'danfo' }, activities: { active: null }, ...extra }) as unknown as TravelPanelView
const block = (extra: Record<string, unknown>) => goBlock(state, view(extra), destination, destination.modes[0] ?? null)

test('Go is blocked with the truthful words and the right action for every connection state', () => {
  assert.equal(block({ connected: true, link: 'online' }), null, 'connected: nothing stops the trip')
  const seen: Record<string, ReturnType<typeof block>> = {}
  for (const link of LINK_STATES.filter((name) => name !== 'online')) {
    const result = block({ connected: false, link }), words = linkWords(link)
    seen[link] = result
    assert.equal(result?.code, 'offline', 'the code stays "offline" for every not-connected state (a code, not wording)')
    assert.equal(result?.link, link)
    assert.equal(result?.label, words?.short, 'the Go button carries the short words of that state')
    assert.ok(result?.reason.startsWith((words?.why ?? '').replace(/\.$/, '')), `${link}: the reason starts with what is true`)
    // "Offline" is said only when this device has no network.
    if (link !== 'offline') assert.doesNotMatch(`${result?.label} ${result?.reason} ${result?.fix?.label ?? ''}`, /offline/i, link)
  }
  assert.equal(seen.offline?.label, 'No internet')
  assert.match(seen.offline?.reason ?? '', /no internet connection, so the trip cannot start\. Reconnect and Go will work again/)
  assert.deepEqual(seen.offline?.fix, { kind: 'reconnect', label: 'Try again', action: { label: 'Try again', menu: 'reconnect' } })
  assert.equal(seen.unreachable?.label, 'Server unreachable')
  assert.match(seen.unreachable?.reason ?? '', /server is not answering, so the trip cannot start\. Your life is safe there/)
  assert.equal(seen.unreachable?.fix?.label, 'Try again')
  assert.equal(seen.expired?.label, 'Saved life not found')
  assert.deepEqual(seen.expired?.fix, { kind: 'reconnect', label: 'Start a new life', action: { label: 'Start a new life', gate: 'expired' } }, 'an expired life offers a new life, not "reconnect"')
  assert.equal(seen.new?.label, 'Not started')
  assert.match(seen.new?.reason ?? '', /^You have not started a life yet\. Choose a nickname to start a session on this device, then travel\.$/)
  assert.deepEqual(seen.new?.fix, { kind: 'reconnect', label: 'Choose a nickname', action: { label: 'Choose a nickname', gate: 'new' } })
  assert.equal(seen.connecting?.label, 'Connecting…')
  assert.equal(seen.connecting?.fix, null, 'still connecting: nothing to press, it resolves by itself')
  // A host that sends no `link` at all is read as "server unreachable", never as "offline".
  assert.equal(block({ connected: false })?.label, 'Server unreachable')
  assert.equal(block({ connected: false })?.fix?.kind, 'reconnect')
  // …and one with no session at all is a device that has not started a life.
  assert.equal(block({ connected: false, session: null })?.label, 'Not started')
  assert.equal(block({ connected: false, session: null, link: 'offline' })?.label, 'No internet', 'a reported state always wins')
})

test('the connection words give every panel the same sentence for a state', () => {
  assert.equal(linkWords('online'), null)
  assert.equal(linkWords('unreachable')?.cannot('vote'), 'The game server is not answering. You cannot vote right now. Your life is safe there. Try again shortly.')
  assert.equal(linkWords('connecting')?.action, null)
})

test('a refusal says what to do: closed, already here, coming soon, not enough cash, busy', () => {
  const go = (extra: Partial<TravelDestination>, cash = 1000, active: unknown = null, viewExtra: Record<string, unknown> = {}) =>
    goBlock({ ...state, cash, activeAction: active } as unknown as LifeState, view({ connected: true, ...viewExtra }), place({ ...extra }), place(extra).modes[0] ?? null)
  assert.deepEqual(go({ blocked: { code: 'closed', reason: 'It is closed.' }, status: 'Closed · opens 8AM' }), { code: 'closed', label: 'Closed · opens 8AM', reason: 'It is closed. Pick somewhere that is open now, or come back then.' })
  assert.deepEqual(go({ blocked: { code: 'already_here', reason: 'x' } }), { code: 'already_here', label: 'You are here', reason: 'You are already here.', fix: { kind: 'enter', label: 'Go inside' } })
  assert.equal(go({ blocked: { code: 'coming_soon', reason: 'Soon.' } })?.reason, 'Soon. There is nothing to do there yet.')
  assert.equal(go({ blocked: { code: 'invalid_travel', reason: 'No.' } })?.label, 'Unavailable')
  const short = goBlock({ ...state, cash: 40 } as unknown as LifeState, view({ connected: true }), place({ modes: [mode({ blocked: { code: 'insufficient_funds', reason: '' } }), mode({ id: 'trek', label: 'Trek', fare: 0, seconds: 20 })] }), mode({ blocked: { code: 'insufficient_funds', reason: '' } }))
  assert.equal(short?.label, 'Not enough cash · ₦150')
  assert.equal(short?.reason, 'Danfo costs ₦150 and you have ₦40 — you are ₦110 short. Trekking is free, or earn a little first.')
  assert.deepEqual(short?.fix, { kind: 'mode', mode: 'trek', label: 'Trek instead · Free · 20s' })
  const trip = go({}, 1000, { kind: 'travel', id: 'cchub', remaining: 5 })
  assert.equal(trip?.code, 'travelling')
  assert.equal(trip?.reason, 'You are already on the way to CcHub. Arrive first, or cancel that trip (its fare is not refunded) and then travel here.')
  assert.deepEqual(trip?.fix, { kind: 'cancel', label: 'Cancel that trip' })
  const busy = go({}, 1000, { kind: 'activity', id: 'x', remaining: 4.2 }, { activities: { active: { label: 'Jog', cancellable: false } } })
  assert.equal(busy?.code, 'busy')
  assert.equal(busy?.fix, null, 'an activity that cannot be cancelled offers no cancel')
  assert.equal(busy?.reason, 'You are busy: Jog (5s left). It cannot be cancelled — wait for it to finish, then travel.')
  assert.equal(goBlock(state, view({ connected: true }), place({ modes: [] }), null)?.reason, 'No way of travelling there is available right now.')
})

test('fares, trip lines and the chosen mode read as before', () => {
  assert.equal(fareText({ fare: 0 }), 'Free')
  assert.equal(fareText({ fare: 1500 }), '₦1,500')
  assert.equal(signed(3), '+3')
  assert.equal(signed(-2), '−2')
  assert.equal(needsLine({ hygiene: -2, fun: -2 }), '−2 Hygiene, −2 Fun')
  assert.equal(tripLine(mode({ needs: { hygiene: -2, fun: -2 }, xp: { fitness: 3 }, fuel: true })), 'Danfo · about 8s · −2 Hygiene, −2 Fun · +3 Fitness XP · fuel only')
  const modes = [mode({ id: 'trek' }), mode({ id: 'danfo' }), mode({ id: 'cab' })]
  assert.equal(chosenMode({ modes }, 'cab')?.id, 'cab')
  assert.equal(chosenMode({ modes }, 'okada')?.id, 'danfo', 'a mode this trip does not offer falls back to Danfo')
  assert.equal(chosenMode({ modes }, null, 'zzz')?.id, 'trek', 'and then to the first')
  assert.equal(chosenMode({ modes: [] }, 'cab'), null)
})

test('the trip bar: where from, how, what was paid, how long is left, and the rule for Cancel', () => {
  const full = view({ connected: true, travel: { destinations: [place({ id: 'home' as TravelDestination['id'], label: 'Home' }), destination], modes: [{ id: 'okada', label: 'Okada', icon: '🏍️' }], active: { from: 'home', fare: 200 } } })
  const trip = tripInfo({ location: 'home', activeAction: { kind: 'travel', id: 'cchub', mode: 'okada', duration: 10, remaining: 4 } } as unknown as LifeState, full)
  assert.equal(trip?.mode.id, 'okada')
  assert.equal(trip?.from.label, 'Home')
  assert.equal(trip?.to.label, 'CcHub')
  assert.equal(trip?.fraction, 0.6)
  assert.equal(trip?.rule, 'Cancel to stay at Home. The ₦200 fare you paid is not refunded.')
  assert.equal(paidText(trip ?? { fare: null }), ' · ₦200 paid')
  assert.equal(paidText({ fare: 0 }), ' · Free')
  assert.equal(paidText({ fare: null }), '')
  const car = tripInfo({ location: 'home', activeAction: { kind: 'travel', id: 'cchub', mode: 'car', duration: 10, remaining: 4 } } as unknown as LifeState, full)
  assert.equal(car?.mode.label, 'Your car')
  assert.match(car?.rule ?? '', /fuel you paid/)
  const commute = tripInfo({ location: 'home', activeAction: { kind: 'commute', id: 'cchub', duration: 10, remaining: 0 } } as unknown as LifeState, full)
  assert.equal(commute?.mode.label, 'Commute to work')
  assert.equal(commute?.rule, 'Cancel to stay at Home. Nothing was charged for the commute.'.replace('Home', commute?.from.label ?? ''))
  assert.equal(commute?.fraction, 1)
  assert.equal(tripInfo({ location: 'home', activeAction: null } as unknown as LifeState, full), null)
  assert.equal(tripInfo({ location: 'home', activeAction: { kind: 'activity', id: 'x', duration: 3, remaining: 1 } } as unknown as LifeState, full), null)
  const old = tripInfo({ location: 'home', activeAction: { kind: 'travel', id: 'cchub', duration: 0, remaining: 3 } } as unknown as LifeState, view({ travel: { destinations: [], modes: [], active: null } }))
  assert.equal(old?.mode.label, 'On the way', 'a trip from an older save has no mode')
  assert.equal(old?.rule, 'Cancel to stay at home. A fare already paid is not refunded.')
  assert.equal(old?.to.label, 'cchub', 'a place the map does not list is named by its id')
})

test('the Map: filters, the overview line and the list', () => {
  assert.deepEqual(FILTERS.slice(0, 2), [{ id: 'all', label: 'All' }, { id: 'open', label: 'Open now' }])
  assert.ok(FILTERS.length > 2 && FILTERS.every((item) => item.id && item.label))
  const open = place({ open: true, category: 'food' }), closed = place({ open: false, category: 'food' }), home = place({ kind: 'home', open: false, category: 'home' }), soon = place({ kind: 'soon' })
  assert.deepEqual([open, closed, home, soon].map((item) => matchesFilter(item, 'all')), [true, true, true, false])
  assert.deepEqual([open, closed, home, soon].map((item) => matchesFilter(item, 'open')), [true, false, false, false])
  assert.deepEqual([open, closed, home, soon].map((item) => matchesFilter(item, 'food')), [true, true, true, false], 'Home is on every category')
  assert.equal(overviewLine([open, closed, soon], null, 'Clear'), 'Clear · 1 of 2 places open')
  assert.equal(overviewLine([open, closed], null, null), '1 of 2 places open')
  assert.equal(overviewLine([open], { label: 'CcHub' }, 'Rain'), 'On the way to CcHub…')
  assert.deepEqual(['is-open', 'is-closed', 'is-soon'], [statusClass(open), statusClass(closed), statusClass(soon)])
  assert.equal(CHIP_LIMIT, 9)
  assert.equal(venueLink('https://x.test', '/play', 'park & ride'), 'https://x.test/play?venue=park%20%26%20ride')
  assert.deepEqual(asMapParams({ destination: 'park' }), { destination: 'park' })
  assert.equal(asMapParams(null), null)
  assert.equal(layoutKey({ layer: 'city', destination: null, listOpen: true, layersOn: 2, tripping: false }), 'city||true|2|false')
})

test('the Map layers: the world layer on from the start, civic overlays off', () => {
  assert.deepEqual(initialLayers(), { lgas: true, homes: true, moving: false, billboards: false, sea: false, gov: false })
  assert.deepEqual(LAYERS.map((item) => item.id), ['lgas', 'homes', 'moving', 'billboards', 'sea', 'gov'])
  assert.deepEqual(DATA_LAYERS.map((item) => [item.id, item.path]), [['billboards', 'ads'], ['sea', 'ads'], ['gov', 'gov']])
  const byId = (id: string) => LAYERS.find((item) => item.id === id)!
  assert.equal(layerNote(byId('lgas'), { data: null, error: null }, true, ''), null)
  assert.equal(layerNote(byId('moving'), { data: null, error: null }, true, '')?.text, 'Street traffic — decoration only, it changes nothing in the game.')
  const offline = layerNote(byId('gov'), { data: null, error: null }, false, 'This device has no internet connection.')
  assert.deepEqual(offline, { text: 'This device has no internet connection. This layer cannot be loaded right now.', reconnect: true, action: null })
  assert.equal(layerNote(byId('gov'), { data: null, error: null }, true, '')?.text, 'Loading…')
  assert.equal(layerNote(byId('gov'), { data: null, error: 'Slow.' }, true, '')?.text, 'Could not load: Slow.')
  assert.deepEqual(layerNote(byId('gov'), { data: null, error: null }, true, '')?.action, { label: 'Open the State House', open: 'state-house', params: null })
  const ads = { billboards: { slots: [{ ad: {} }, { ad: null }, { ad: {} }] }, sea: { plots: [{}] } } as never
  assert.equal(layerNote(byId('billboards'), { data: ads, error: null }, true, '')?.text, '2 of 3 billboards rented')
  assert.equal(layerNote(byId('sea'), { data: ads, error: null }, true, '')?.text, '1 sea plot rented · shown in the water below the city')
  assert.deepEqual(layerNote(byId('sea'), { data: ads, error: null }, true, '')?.action, { label: 'Rent a sea plot', open: 'ads', params: { tab: 'sea' } })
  assert.equal(layerNote(byId('gov'), { data: { governor: { name: 'Ada' } } as never, error: null }, true, '')?.text, 'Governor Ada')
  assert.equal(layerNote(byId('gov'), { data: { governor: null } as never, error: null }, true, '')?.text, 'No Governor yet')
})

test('the roadside prompt and chip', () => {
  assert.equal(choiceTitle({ label: 'Pay the fixer', cost: 200 }), 'Pay the fixer · ₦200')
  assert.equal(choiceTitle({ label: 'Pay ₦200 to pass', cost: 200 }), 'Pay ₦200 to pass', 'the cost is not said twice')
  assert.equal(choiceTitle({ label: 'Walk away', cost: 0 }), 'Walk away')
  assert.equal(choiceHint({ hint: 'Might work', chance: 60 }), 'Might work · 60% chance')
  assert.equal(choiceHint({ hint: '', chance: null }), '')
  assert.equal(expiryText(0), '')
  assert.equal(expiryText(30), ', or in about 1 min')
  assert.equal(expiryText(190), ', or in about 4 min')
  resetShown()
  const key = chipKey({ id: 'flat-tyre', at: 5 })
  assert.equal(key, 'flat-tyre:5')
  assert.equal(markShown(key), true, 'a new event draws the eye once')
  assert.equal(markShown(key), false)
  assert.equal(markShown(''), false)
  assert.equal(markShown(chipKey({ id: 'flat-tyre', at: 6 })), true)
})

test('the Ride app: places, the picked mode, what stops every row and what stops one', () => {
  const home = place({ id: 'home' as TravelDestination['id'], kind: 'home', label: 'Home', open: false })
  const closed = place({ id: 'cchub' as TravelDestination['id'], label: 'Zoo', open: false })
  const open = place({ id: 'mall' as TravelDestination['id'], label: 'Mall' })
  const here = place({ here: true, label: 'Here' }), soon = place({ kind: 'soon', label: 'Soon' })
  assert.deepEqual(ridePlaces([closed, open, here, soon, home]).map((item) => item.label), ['Home', 'Mall', 'Zoo'], 'home first, then open ones, then by name; not here, not coming soon')
  const places = ridePlaces([open, closed])
  assert.equal(pickedMode(places, 'cab', 'danfo')?.id, 'danfo', 'a mode no place offers falls back')
  assert.equal(pickedMode([place({ modes: [mode({ id: 'cab' }), mode()] })], 'cab', 'danfo')?.id, 'cab')
  assert.equal(pickedMode([], null, 'danfo'), undefined)
  const v = view({ connected: true })
  const listing = rideRows(state, v, [open, place({ id: 'x' as TravelDestination['id'], blocked: { code: 'closed', reason: 'Shut.' }, status: 'Closed' })], pickedMode([open], null, 'danfo'))
  assert.equal(listing.notice, null)
  assert.equal(listing.rows[0]?.block, null)
  assert.equal(listing.rows[1]?.own?.code, 'closed', 'a closed place says so on its own row')
  const gone = rideRows(state, view({ connected: false, link: 'offline' }), [open], mode())
  assert.equal(gone.notice?.code, 'offline', 'offline is said once, above the list')
  assert.equal(gone.rows[0]?.own, null)
  assert.ok(EVERYWHERE.includes('travelling'))
  assert.equal(rideRules([mode(), mode({ id: 'trek', label: 'Trek', blurb: '' })]).at(-1), 'Danfo: Cheap and slow')
  assert.equal(rideRules([]).length, 3)
})

test('your own house: what can be pressed, and the words beside what cannot', () => {
  const owned = { chosen: true, price: 0 }, dear = { chosen: false, price: 5000 }, cheap = { chosen: false, price: 0 }
  assert.deepEqual([owned, dear, cheap].map((option) => swatchOff(option, 1000, '')), [true, true, false])
  assert.equal(swatchOff(cheap, 1000, 'No internet — this needs the server'), true)
  assert.equal(swatchTitle(dear, 1000), 'Costs ₦5,000')
  assert.equal(swatchTitle(owned, 0), '')
  assert.equal(swatchLabel({ label: 'Red', price: 300 }), 'Red · ₦300')
  assert.equal(swatchLabel({ label: 'Red', price: 0 }), 'Red')
  assert.equal(offlineWhy(true, 'x'), '')
  assert.equal(offlineWhy(false, 'No internet'), 'No internet — this needs the server')
  assert.equal(tierWhy({ blocked: null }, ''), '')
  assert.equal(tierWhy({ blocked: 'Not enough cash.' }, ''), 'Not enough cash.')
  assert.equal(tierWhy({ blocked: 'Not enough cash.' }, 'Offline'), 'Offline')
  assert.equal(minutesToGo(61), '2 minutes')
  assert.equal(minutesToGo(30), '1 minute')
  assert.deepEqual(offeredTiers([{ id: 'starter', current: false }, { id: 'family', current: false }, { id: 'starter', current: true }] as never).map((tier) => `${tier.id}:${tier.current}`), ['family:false', 'starter:true'])
  assert.equal(FIELD_NAMES.shape, 'Roof shape')
  assert.equal(Object.keys(FIELD_NAMES).length, 8)
})

test('held equal to the existing helpers (src/ui/panels/world-ui.js) over a grid of situations', async () => {
  const legacy = await import('../../../ui/panels/world-ui.js') as unknown as {
    goBlock(state: unknown, view: unknown, destination: unknown, mode: unknown): (Record<string, unknown> & { fix?: Record<string, unknown> | null }) | null
    tripLine(mode: unknown): string
    tripInfo(state: unknown, view: unknown): Record<string, unknown> | null
    fareText(mode: unknown): string
    chosenMode(destination: unknown, wanted: unknown, fallback?: string): unknown
    statusClass(destination: unknown): string
  }
  const trek = mode({ id: 'trek', label: 'Trek', fare: 0, seconds: 20 })
  const broke = mode({ blocked: { code: 'insufficient_funds', reason: '' } })
  const places = [
    place({ modes: [mode(), trek] }), place({ modes: [broke, trek] }), place({ modes: [broke] }), place({ blocked: { code: 'closed', reason: 'Shut.' }, status: 'Closed' }),
    place({ blocked: { code: 'already_here', reason: '' } }), place({ blocked: { code: 'coming_soon', reason: 'Soon.' } }), place({ blocked: { code: 'invalid_travel', reason: 'No.' } }), place({ modes: [] }),
  ]
  const actives = [null, { kind: 'travel', id: 'park', remaining: 3, duration: 8 }, { kind: 'commute', id: 'park', remaining: 3, duration: 8 }, { kind: 'activity', id: 'a', remaining: 2.2, duration: 5 }]
  const views = [{ connected: true }, { connected: false, link: 'offline' }, { connected: false, link: 'unreachable' }, { connected: false, link: 'expired' }, { connected: false, link: 'new' }, { connected: false, link: 'connecting' }, { connected: false }, { connected: false, session: null }]
  const strip = (block: Record<string, unknown> & { fix?: Record<string, unknown> | null } | null) => (block ? { ...block, fix: block.fix ? Object.fromEntries(Object.entries(block.fix).filter(([key]) => key !== 'attrs')) : block.fix } : block)
  const withoutAction = (block: ReturnType<typeof goBlock>) => (block ? { ...block, fix: block.fix ? Object.fromEntries(Object.entries(block.fix).filter(([key]) => key !== 'action')) : block.fix } : block)
  let checked = 0
  for (const destinationCard of places) for (const active of actives) for (const link of views) for (const cash of [10, 1000]) for (const which of [0, 1]) {
    const current = { cash, location: 'home', activeAction: active }
    const panelView = { ...link, travel: { destinations: [destinationCard], modes: [], active: null }, activities: { active: { label: 'Jog', cancellable: which === 0 } } }
    const picked = destinationCard.modes[which] ?? null
    const old = strip(legacy.goBlock(current, panelView, destinationCard, picked))
    const next = withoutAction(goBlock(current as unknown as LifeState, panelView as unknown as TravelPanelView, destinationCard, picked))
    assert.deepEqual(next && { ...next, fix: next.fix === undefined ? undefined : next.fix }, old && { ...old, fix: old.fix === undefined ? undefined : old.fix }, JSON.stringify({ link, active, cash, which }))
    checked++
  }
  assert.ok(checked > 1000)
  for (const item of [mode(), trek, mode({ needs: { hygiene: -2 }, xp: { fitness: 2 }, fuel: true })]) {
    assert.equal(tripLine(item), legacy.tripLine(item))
    assert.equal(fareText(item), legacy.fareText(item))
  }
  for (const wanted of [null, 'trek', 'cab']) assert.deepEqual(chosenMode(places[0] ?? null, wanted), legacy.chosenMode(places[0], wanted))
  for (const item of [place(), place({ open: false }), place({ kind: 'soon' })]) assert.equal(statusClass(item), legacy.statusClass(item))
  const full = view({ connected: true, travel: { destinations: [destination], modes: [{ id: 'okada', label: 'Okada' }], active: { from: 'cchub', fare: 200 } } })
  for (const active of [{ kind: 'travel', id: 'cchub', mode: 'okada', duration: 10, remaining: 4 }, { kind: 'travel', id: 'zzz', mode: 'car', duration: 10, remaining: 4 }, { kind: 'commute', id: 'cchub', duration: 10, remaining: 0 }, { kind: 'travel', id: 'cchub', duration: 0, remaining: 3 }, null]) {
    const current = { location: 'home', activeAction: active }
    assert.deepEqual(tripInfo(current as unknown as LifeState, full), legacy.tripInfo(current, full))
  }
})

test('a house style is announced only after the server accepted it', async () => {
  const { afterStyle } = await import('./myHouseModel.ts')
  let told = 0
  afterStyle(false, () => { told += 1 })
  assert.equal(told, 0)
  afterStyle(true, () => { told += 1 })
  assert.equal(told, 1)
})
