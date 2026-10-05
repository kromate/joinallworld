// Rules that meet only when every feature is in one build: what skipping a trip costs under the shorter timetable on every
// route of every open city, and that the first free skip, a free journey by joining a friend and the guest house add up to
// money spent — never to money made.
import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceLife, createLife, dispatch, viewLife } from '../../life.ts'
import { LOCAL_TRIP_CAP_SECONDS, TRIP_SKIP, tripSkipFee } from '../content/travel.ts'
import { DEFAULT_LOOK } from '../content/traits.ts'
import { LODGING } from '../content/world.ts'
import { allCityLinks, cityRules, linksFrom, loadCityContent, playableCityIds } from './registry.ts'
import { publicArrivalVenue } from './runtime.ts'
import type { LifeContextInit, LifeState } from '../../types/life.ts'

const OPEN = playableCityIds()
await Promise.all(OPEN.map(loadCityContent))

function settled(seed: string) {
  let now = Date.UTC(2026, 0, 5, 9)
  const context = (state?: LifeState): LifeContextInit => ({ cityId: state?.estate.city ?? 'lagos', now, seed })
  const state = createLife({ name: 'Traveller' }, { ...context(), isNew: true, quickStart: true })
  const run = (type: string, payload: object = {}, extra: LifeContextInit = {}) => dispatch(state, { type, payload } as never, { ...context(state), ...extra })
  const wait = (seconds: number): void => { now += seconds * 1000; advanceLife(state, seconds, context(state)) }
  run('onboarding.quick-start', { look: DEFAULT_LOOK })
  run('onboarding.traits', { traits: ['clean-pikin', 'musical'] })
  run('onboarding.dream', { dream: 'afrobeats-star' })
  run('onboarding.lottery', {})
  assert.equal(run('onboarding.home', { lga: cityRules('lagos')!.units[0]!.id, via: 'manual' }).code, 'life_started')
  const view = () => viewLife(state, context(state))
  /** Brought beside a friend by the server (the join of a ping): no fare, no trip. */
  const join = (city: string) => run('social.server', { op: 'join', city, venue: publicArrivalVenue(city).id, name: 'Ada' }, { internal: true })
  return { state, run, wait, view, join }
}
/** The cities on the way from one to another, by the fewest trips. */
function route(from: string, to: string): { to: string; mode: string }[] {
  const seen = new Map<string, { from: string; mode: string } | null>([[from, null]]), queue = [from]
  while (queue.length && !seen.has(to)) {
    const at = queue.shift() as string
    for (const link of linksFrom(at)) if (!seen.has(link.to) && cityRules(link.to)?.status === 'open' && link.status !== 'coming') { seen.set(link.to, { from: at, mode: link.mode }); queue.push(link.to) }
  }
  const steps: { to: string; mode: string }[] = []
  for (let at = to; at !== from;) { const step = seen.get(at); assert.ok(step, `${to} can be reached from ${from}`); steps.unshift({ to: at, mode: step.mode }); at = step.from }
  return steps
}

test('skipping a trip between cities: on every route of every open city the price is the timetable’s, at most half the fare, charged once, and it falls as the trip goes on', () => {
  const life = settled('every-route'), { state } = life
  state.cash = 50_000_000
  const go = (to: string, mode: string): void => { assert.equal(life.run('estate.relocate', { to, mode }).code, 'departed', `${state.estate.city} → ${to} by ${mode}`); life.wait((state.activeAction?.remaining ?? 0) + 1); assert.equal(state.estate.city, to) }
  // The one free skip is used first, on the first leg: every route after it is priced.
  assert.equal(life.run('estate.relocate', { to: 'ibadan', mode: 'road' }).code, 'departed')
  assert.deepEqual([life.view().travel.skip?.fee, life.view().travel.skip?.free], [0, true])
  assert.equal(life.run('travel.skip', { quote: 0 }).code, 'skipped')
  assert.equal(state.travel.skipped, true)
  // A route that is announced but not running yet sells no ticket, so it has nothing to skip.
  const routes = OPEN.flatMap((from) => linksFrom(from).filter((link) => cityRules(link.to)?.status === 'open' && link.status !== 'coming').map((link) => ({ from, ...link })))
  assert.equal(routes.length, 2 * allCityLinks().filter((link) => OPEN.includes(link.a) && OPEN.includes(link.b) && link.status !== 'coming').length, 'both directions of every running link between open cities')
  let flights = 0
  for (const link of routes) {
    for (const step of route(state.estate.city, link.from)) go(step.to, step.mode)
    const before = state.cash, what = `${link.from} → ${link.to} by ${link.mode}`
    assert.equal(life.run('estate.relocate', { to: link.to, mode: link.mode }).code, 'departed', what)
    assert.equal(state.cash, before - link.fare, `${what}: the fare`)
    const whole = life.view().travel.skip
    const price = tripSkipFee('intercity', link.seconds, link.fare)
    assert.deepEqual([whole?.kind, whole?.fee, whole?.free, whole?.blocked], ['intercity', price, false, null], what)
    assert.ok(price >= TRIP_SKIP.roundTo && price % TRIP_SKIP.roundTo === 0 && price <= link.fare * TRIP_SKIP.intercity.capShare, `${what}: ₦${price} of a ₦${link.fare} fare`)
    assert.equal(whole?.confirm, price >= TRIP_SKIP.confirmFrom)
    // Part of the way there it costs no more, and a price shown a moment ago is the price charged.
    life.wait(Math.floor(link.seconds / 2))
    const later = life.view().travel.skip?.fee ?? -1
    assert.ok(later > 0 && later <= price, `${what}: ₦${later} halfway`)
    assert.equal(later, tripSkipFee('intercity', state.activeAction?.remaining ?? 0, link.fare))
    const done = life.run('travel.skip', { quote: later })
    assert.deepEqual([done.ok, done.code, state.estate.city, state.activeAction], [true, 'skipped', link.to, null], what)
    assert.equal(state.cash, before - link.fare - later, `${what}: fare and skip, each once`)
    assert.equal(life.run('travel.skip', { quote: later }).code, 'not_travelling')
    assert.equal(state.cash, before - link.fare - later)
    if (link.mode === 'air') flights += 1
  }
  assert.ok(flights >= 8, `the flights of the newer cities are among them (${flights} flown)`)
  // Nothing was ever paid back: every line of the wallet since the start is a fare or a skip.
  assert.ok(state.ledger.every((line) => line.amount <= 0 || /^(Start cash|Goal:|Welcome|.*starter)/i.test(line.reason)), JSON.stringify(state.ledger.filter((line) => line.amount > 0).map((line) => line.reason)))
})

test('inside a city a new trip is never long enough to sell a skip: the cap on local trips is below the shortest trip that can be skipped', () => {
  assert.ok(LOCAL_TRIP_CAP_SECONDS <= TRIP_SKIP.localMinRemainingSeconds)
  const life = settled('local'), { state } = life
  for (const destination of life.view().travel.destinations.filter((item) => item.id !== state.location).slice(0, 12)) {
    for (const mode of destination.modes) assert.ok(mode.seconds <= LOCAL_TRIP_CAP_SECONDS, `${destination.id} by ${mode.id}: ${mode.seconds}s`)
  }
  assert.equal(life.run('travel', { id: 'park', mode: 'trek' }).ok, true)
  assert.ok((state.activeAction?.duration ?? 99) <= LOCAL_TRIP_CAP_SECONDS)
  assert.equal(life.view().travel.skip, null, 'no offer')
  const cash = state.cash, refused = life.run('travel.skip', {})
  assert.deepEqual([refused.ok, refused.code, state.cash], [false, 'too_short', cash])
})

test('the first free skip, free journeys by joining and the guest house together: every naira that moves is a fare, a skip or a room — nothing comes back', () => {
  const life = settled('no-exploit'), { state } = life
  state.cash = 200_000
  const start = state.cash, lines = state.ledger.length
  const spent: number[] = []
  const pay = (amount: number): void => { spent.push(amount) }
  const bus = cityRules('lagos') && linksFrom('ibadan').find((link) => link.to === 'lagos' && link.mode === 'road')
  assert.ok(bus)
  // 1. Joined in Ibadan: free, a visitor, and the free skip is not used up by it.
  assert.equal(life.join('ibadan').code, 'joined_city')
  assert.deepEqual([state.estate.city, state.cash, state.travel.skipped, state.estate.lga, state.estate.home], ['ibadan', start, false, null, 'lagos'])
  // 2. A room: paid, and only once while rested.
  Object.assign(state.needs, { energy: 20, hygiene: 20 })
  assert.equal(life.run('estate.lodge').code, 'rested'); pay(LODGING.fee)
  assert.equal(life.run('estate.lodge').code, 'rested', 'the refusal has the same word')
  assert.equal(state.cash, start - LODGING.fee, 'and charges nothing')
  // 3. Home by bus, skipped: the fare is paid, the first skip is free — once.
  assert.equal(life.run('estate.relocate', { to: 'lagos', mode: 'road' }).code, 'departed'); pay(bus.fare)
  assert.equal(life.run('travel.skip', { quote: 0 }).code, 'skipped')
  assert.deepEqual([state.estate.city, state.location, state.travel.skipped], ['lagos', 'home', true])
  // 4. Joined again, and home again: joining did not give the free skip back, nor did sleeping in a guest house.
  assert.equal(life.join('ibadan').code, 'joined_city')
  Object.assign(state.needs, { energy: 20, hygiene: 20 })
  assert.equal(life.run('estate.lodge').code, 'rested'); pay(LODGING.fee)
  assert.equal(life.run('estate.relocate', { to: 'lagos', mode: 'road' }).code, 'departed'); pay(bus.fare)
  const offer = life.view().travel.skip
  assert.deepEqual([offer?.free, offer?.fee], [false, tripSkipFee('intercity', bus.seconds, bus.fare)])
  // A stale "free" quote does not make it free.
  const cheap = life.run('travel.skip', { quote: 0 })
  assert.deepEqual([cheap.ok, cheap.code], [false, 'price_changed'])
  assert.equal(life.run('travel.skip', { quote: offer?.fee }).code, 'skipped'); pay(offer?.fee ?? 0)
  // 5. A trip under way cannot be turned into a free one, or into a refund: no join, no room, no cancel.
  assert.equal(life.run('estate.relocate', { to: 'ibadan', mode: 'road' }).code, 'departed'); pay(bus.fare)
  const riding = state.cash
  assert.equal(life.join('abuja').code, 'busy')
  assert.equal(life.run('estate.lodge').ok, false)
  assert.equal(life.run('cancel').code, 'no_cancel')
  assert.equal(state.cash, riding)
  life.wait(bus.seconds + 1)
  assert.equal(state.estate.city, 'ibadan')
  // 6. Moving the main home to the city just joined does not give the free skip back either, and costs nothing by itself.
  assert.equal(life.run('estate.set-lga', { lga: cityRules('ibadan')!.units[0]!.id, via: 'manual', home: 'main' }).code, 'home_moved')
  assert.deepEqual([state.travel.skipped, state.estate.home], [true, 'ibadan'])
  // The books: what left is exactly the fares, the skip and the rooms; no line since the start is a credit.
  const total = spent.reduce((sum, amount) => sum + amount, 0)
  assert.equal(state.cash, start - total)
  const since = state.ledger.slice(lines)
  assert.deepEqual(since.filter((line) => line.amount > 0), [])
  assert.equal(since.reduce((sum, line) => sum + line.amount, 0), -total)
})
