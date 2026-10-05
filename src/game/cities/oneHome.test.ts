// One home, and more by choice: what a visitor may do, the guest house, buying a home in another city, moving the main
// home, where a character with several homes votes, and how a life saved before the rule is read. Also the timetable
// of every trip between cities.
import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceLife, createLife, dispatch, viewLife } from '../../life.ts'
import { INTERCITY_TIME, TRIP_SKIP, intercitySeconds, tripSkipFee } from '../content/travel.ts'
import { DEFAULT_LOOK } from '../content/traits.ts'
import { HOUSE_TIERS, LODGING, SECOND_HOME, tierCost } from '../content/world.ts'
import { civicEligibility } from '../systems/civic.ts'
import { hasPlace } from '../systems/estate.ts'
import { allCityLinks, cityRules, linksFrom, loadCityContent } from './registry.ts'
import type { LifeContextInit, LifeState } from '../../types/life.ts'

await Promise.all(['lagos', 'ibadan', 'abuja', 'kano'].map(loadCityContent))

const DAY = 86400000
function settled(seed: string) {
  let now = Date.UTC(2026, 0, 5, 9)
  const context = (state?: LifeState): LifeContextInit => ({ cityId: state?.estate.city ?? 'lagos', now, seed })
  const state = createLife({ name: 'Traveller' }, { ...context(), isNew: true, quickStart: true })
  const run = (type: string, payload: object = {}) => dispatch(state, { type, payload } as never, context(state))
  const wait = (seconds: number): void => { now += seconds * 1000; advanceLife(state, seconds, context(state)) }
  run('onboarding.quick-start', { look: DEFAULT_LOOK })
  run('onboarding.traits', { traits: ['clean-pikin', 'musical'] })
  run('onboarding.dream', { dream: 'afrobeats-star' })
  run('onboarding.lottery', {})
  assert.equal(run('onboarding.home', { lga: cityRules('lagos')!.units[0]!.id, via: 'manual' }).code, 'life_started')
  state.cash = 1_000_000
  const go = (to: string, mode = 'air'): void => {
    assert.equal(run('estate.relocate', { to, mode }).code, 'departed', `a ${mode} trip to ${to}`)
    wait((state.activeAction?.remaining ?? 0) + 1)
    assert.equal(state.estate.city, to)
  }
  const view = () => viewLife(state, context(state))
  return { state, run, wait, go, view, context: () => context(state) }
}
const unit = (city: string, index = 0): string => cityRules(city)!.units[index]!.id

test('the timetable: every trip between cities takes what its distance and mode say, and one number scales them all', () => {
  const seconds = (a: string, b: string, mode: string) => linksFrom(a).find((link) => link.to === b && link.mode === mode)?.seconds
  assert.deepEqual([seconds('lagos', 'ibadan', 'road'), seconds('lagos', 'ibadan', 'rail'), seconds('lagos', 'abuja', 'road'), seconds('lagos', 'abuja', 'air'), seconds('lagos', 'port-harcourt', 'road'), seconds('lagos', 'kano', 'road'), seconds('lagos', 'kano', 'air'), seconds('lagos', 'ota', 'road')],
    [30, 21, 59, 16, 53, 75, 20, 26])
  for (const link of allCityLinks()) {
    assert.equal(link.seconds, intercitySeconds(link.mode, link.km), `${link.a}–${link.b} by ${link.mode} reads the timetable`)
    const [low, high] = link.mode === 'air' ? [12, 20] : link.mode === 'rail' ? [17, 50] : [25, 75]
    assert.ok(link.seconds >= low && link.seconds <= high, `${link.a}–${link.b} by ${link.mode}: ${link.seconds}s`)
  }
  // Distance and mode still matter: a longer road is never quicker, a train beats the bus and a flight beats both.
  for (let km = 50; km < 1200; km += 50) {
    assert.ok(intercitySeconds('road', km + 50) >= intercitySeconds('road', km))
    assert.ok(intercitySeconds('rail', km) < intercitySeconds('road', km) && intercitySeconds('air', km) < intercitySeconds('rail', km))
  }
  assert.equal(INTERCITY_TIME.scale, 1)
  assert.deepEqual([0.5, 2].map((scale) => intercitySeconds('road', 130, scale)), [15, 60], 'the scale halves or doubles a wait')
  assert.equal(intercitySeconds('air', 300, 0.01), INTERCITY_TIME.floor, 'no trip is shorter than the floor')
  // A whole trip skipped costs about what it did before the timetable changed, and never more than half the fare.
  assert.deepEqual([tripSkipFee('intercity', 30, 3500), tripSkipFee('intercity', 16, 65000), tripSkipFee('intercity', 75, 20000), tripSkipFee('intercity', 26, 2000)], [1300, 750, 3100, 1000])
  assert.ok(TRIP_SKIP.minRemainingSeconds < 12, 'the shortest flight can still be skipped when it starts')
})

test('a trip that left under the earlier timetable finishes on the clock it left with', () => {
  const life = settled('old-clock')
  assert.equal(life.run('estate.relocate', { to: 'ibadan', mode: 'road' }).code, 'departed')
  const cash = life.state.cash
  const old = createLife({ ...structuredClone(life.state), activeAction: { ...life.state.activeAction, duration: 120, remaining: 100 } }, { ...life.context(), trustedSave: true })
  assert.deepEqual([old.activeAction?.kind, old.activeAction?.duration, old.activeAction?.remaining, old.cash], ['intercity', 120, 100, cash], 'kept as it was: nothing refunded, nothing lost')
  advanceLife(old, 101, { ...life.context(), now: (life.context().now ?? 0) + 101000 })
  assert.equal(old.estate.city, 'ibadan')
  // A trip claiming to be shorter than the link, or dearer than it, is not one this game sold: the fare is given back once.
  const forged = createLife({ ...structuredClone(life.state), activeAction: { ...life.state.activeAction, duration: 5, remaining: 1 } }, { ...life.context(), trustedSave: true })
  assert.deepEqual([forged.activeAction, forged.cash, forged.estate.city], [null, cash + 3500, 'lagos'])
})

test('arriving in another city asks for nothing: the life is a visitor with its home named, and plays in full', () => {
  const life = settled('visitor')
  assert.deepEqual([life.state.estate.home, life.view().estate.home, life.view().estate.visiting], ['lagos', { city: 'lagos', name: 'Lagos', here: true }, false])
  life.go('abuja')
  const { state } = life
  assert.equal(state.message, 'Welcome to Abuja. You are visiting: your home is in Lagos.')
  assert.deepEqual([state.estate.lga, state.estate.plot, hasPlace(state), state.estate.home], [null, null, false, 'lagos'])
  const estate = life.view().estate
  assert.deepEqual([estate.visiting, estate.placed, estate.home], [true, false, { city: 'lagos', name: 'Lagos', here: false }])
  assert.equal(state.activeAction, null)
  assert.notEqual(state.location, 'home')
  // Home is not a place here, and home actions say so; nothing else is closed to a visitor.
  assert.ok(!life.view().travel.destinations.some((place) => place.id === 'home'))
  assert.equal(life.run('travel', { id: 'home', mode: 'trek' }).code, 'settle_required')
  // Work: the job held in Lagos is taken up at this city's workplace with one action, and a shift is paid.
  if (state.job) {
    const moved = life.run('apply-job', { id: state.job })
    assert.ok(moved.ok, `the held job moves here: ${moved.code}`)
    assert.equal(state.career.city, 'abuja')
  }
  // Something to do where it stands, without a home: any open activity starts.
  const card = life.view().activities.cards.find((item) => !item.blocked)
  assert.ok(card, 'the arrival venue offers something to a visitor')
  assert.equal(life.run('activity', { id: card.id }).code, 'started')
  // The bank and the ledger are the character's own, wherever it is.
  assert.ok(life.view().economy)
})

test('a guest house: exact money, Energy and Hygiene restored, and only for a life with no home in the city', () => {
  const life = settled('lodging')
  assert.equal(LODGING.fee, 2500)
  assert.equal(life.run('estate.lodge').code, 'has_home', 'at home the bed is free')
  assert.match(life.view().estate.lodging.blocked ?? '', /You have a home in Lagos/)
  life.go('abuja')
  const { state } = life
  Object.assign(state.needs, { energy: 12, hygiene: 20, hunger: 44 })
  const cash = state.cash
  assert.deepEqual(life.view().estate.lodging, { fee: 2500, blocked: null })
  const rested = life.run('estate.lodge')
  assert.deepEqual([rested.ok, rested.code], [true, 'rested'])
  assert.deepEqual([state.cash, state.needs.energy, state.needs.hygiene, state.needs.hunger], [cash - 2500, 100, 100, 44])
  assert.deepEqual([state.ledger.at(-1)?.amount, state.ledger.at(-1)?.reason], [-2500, 'Guest house in Abuja'])
  assert.match(state.message, /guest house in Abuja for ₦2,500/)
  // Rested already: nothing is sold. Not enough cash: the amount missing is named and nothing is charged.
  assert.equal(life.run('estate.lodge').code, 'rested')
  state.needs.energy = 10; state.cash = 900
  const short = life.run('estate.lodge')
  assert.deepEqual([short.ok, short.code, state.cash, state.needs.energy], [false, 'insufficient_funds', 900, 10])
  assert.match((short.ok ? '' : short.reason) ?? '', /You need ₦1,600 more/)
  // Busy: not in the middle of something else.
  state.cash = 50_000
  assert.equal(life.run('estate.relocate', { to: 'kano', mode: 'road' }).code, 'departed')
  assert.equal(life.run('estate.lodge').code, 'busy')
  // A life still being created has no room to take.
  const guest = createLife(null, { cityId: 'lagos', now: Date.UTC(2026, 0, 5, 9), seed: 'guest', isNew: true, quickStart: true })
  assert.equal(dispatch(guest, { type: 'estate.lodge', payload: {} } as never, { cityId: 'lagos', now: Date.UTC(2026, 0, 5, 9), seed: 'guest' }).ok, false)
})

test('a visitor is never given a home: it may buy one, at the price of the house where it stands, and keeps its main home', () => {
  const life = settled('buy')
  life.go('abuja')
  const { state } = life
  const offer = life.view().estate.settle
  assert.ok(offer)
  const lga = unit('abuja'), price = tierCost('abuja', lga, SECOND_HOME.tier)
  assert.ok(price && price >= HOUSE_TIERS[SECOND_HOME.tier].cost)
  assert.deepEqual([offer.buy.tier, offer.buy.prices[lga], offer.buy.groundRent], [HOUSE_TIERS[SECOND_HOME.tier].label, price, HOUSE_TIERS[SECOND_HOME.tier].groundRent])
  assert.equal(offer.buy.from, Math.min(...Object.values(offer.buy.prices)))
  // Choosing a local unit alone gives nothing away.
  const cash = state.cash
  const bare = life.run('estate.set-lga', { lga, via: 'manual' })
  assert.deepEqual([bare.ok, bare.code, state.cash, state.estate.lga], [false, 'choice_required', cash, null])
  state.cash = price - 1
  assert.equal(life.run('estate.set-lga', { lga, home: 'buy' }).code, 'insufficient_funds')
  assert.deepEqual([state.cash, state.estate.lga], [price - 1, null])
  state.cash = 1_000_000
  assert.equal(life.run('estate.set-lga', { lga, home: 'buy' }).code, 'home_bought')
  assert.deepEqual([state.cash, state.estate.lga, state.estate.tier, state.estate.living, state.estate.home, hasPlace(state)], [1_000_000 - price, lga, SECOND_HOME.tier, 'own', 'lagos', true])
  assert.equal(state.ledger.at(-1)?.amount, -price)
  assert.match(state.message, /Your main home stays in Lagos\.$/)
  assert.equal(state.estate.away.lagos?.tier, 'starter', 'the first home is untouched')
  const after = life.view().estate
  assert.deepEqual([after.visiting, after.settle, after.lodging.blocked !== null, after.makeMain], [false, null, true, { blocked: null }])
  assert.ok(life.view().travel.destinations.some((place) => place.id === 'home'), 'the bought home is a place to go to')
  // One vote: with homes in two cities the character votes and stands where its main home is.
  const here = civicEligibility(state, life.context() as never)
  assert.deepEqual([here.vote[0]?.code, here.vote[0]?.met, here.run[0]?.code], ['not_main_home', false, 'not_main_home'])
  life.go('lagos')
  assert.ok(!civicEligibility(state, life.context() as never).vote.some((item) => item.code === 'not_main_home'), 'in the main home city nothing is added')
  // It may name the bought home its main one, at most once in the cooldown; then the vote is there instead.
  life.go('abuja')
  assert.equal(life.run('estate.make-home').code, 'home_set')
  assert.deepEqual([state.estate.home, life.view().estate.makeMain], ['abuja', null])
  assert.ok(!civicEligibility(state, life.context() as never).vote.some((item) => item.code === 'not_main_home'))
  life.go('lagos')
  assert.equal(civicEligibility(state, life.context() as never).vote[0]?.code, 'not_main_home')
  assert.equal(life.run('estate.make-home').code, 'home_cooldown')
  life.wait(SECOND_HOME.moveCooldownDays * DAY / 1000 + 1)
  assert.equal(life.run('estate.make-home').code, 'home_set')
  assert.equal(state.estate.home, 'lagos')
})

test('moving the main home: the one free starter house goes along, and a house that was paid for is never given up', () => {
  const life = settled('move')
  const { state } = life
  assert.equal(life.run('estate.style', { style: { wall: 2 } }).ok, true)
  life.go('kano')
  assert.deepEqual(life.view().estate.settle?.main, { blocked: null, gives: 'your starter house in Lagos' })
  const cash = state.cash, lga = unit('kano')
  assert.equal(life.run('estate.set-lga', { lga, home: 'main' }).code, 'home_moved')
  assert.deepEqual([state.cash, state.estate.home, state.estate.lga, state.estate.tier, state.estate.style.wall, Object.keys(state.estate.away)], [cash, 'kano', lga, 'starter', 2, []], 'free, the look came along, and the Lagos starter house was given up')
  assert.match(state.message, /^Kano is your main home now: .*Your starter house in Lagos was given up\.$/)
  // Back in Lagos it is a visitor: no second free house there, and the main home cannot move again at once.
  life.go('lagos')
  assert.deepEqual([state.estate.lga, life.view().estate.visiting, state.message], [null, true, 'Welcome to Lagos. You are visiting: your home is in Kano.'])
  assert.match(life.view().estate.settle?.main.blocked ?? '', /once every 7 days/)
  assert.equal(life.run('estate.set-lga', { lga: unit('lagos'), home: 'main' }).code, 'home_cooldown')
  // A paid-for house: built in Kano, then the owner visits Abuja. The house stays; the main home moves only by buying there first.
  life.go('kano')
  assert.equal(life.run('estate.upgrade', { to: 'bq' }).code, 'upgrade_started')
  life.wait(HOUSE_TIERS.bq.buildSeconds + SECOND_HOME.moveCooldownDays * DAY / 1000)
  assert.equal(state.estate.tier, 'bq')
  life.go('abuja')
  const refused = life.run('estate.set-lga', { lga: unit('abuja'), home: 'main' })
  assert.deepEqual([refused.ok, refused.code, state.estate.home, state.estate.away.kano?.tier], [false, 'home_owned', 'kano', 'bq'])
  assert.match((refused.ok ? '' : refused.reason) ?? '', /Two-room house in Kano is property you paid for/)
  assert.equal(life.run('estate.set-lga', { lga: unit('abuja'), home: 'buy' }).code, 'home_bought')
  assert.equal(life.run('estate.make-home').code, 'home_set')
  assert.deepEqual([state.estate.home, state.estate.away.kano?.tier, state.estate.tier], ['abuja', 'bq', SECOND_HOME.tier], 'both houses are kept')
})

test('a life saved with homes in several cities before the rule keeps every one, and its first home is the main one', () => {
  // The stored shape of the earlier rule: a home in the current city and others under `away`, no `home` field.
  const residence = (lga: string, lgaAt: number, tier = 'starter') => ({ lga, lgaAt, lgaConfirmed: true, lgaVia: 'manual', plot: { lga, estate: 3, plot: 7 }, old: null, tier, style: { wall: 1 }, upgrade: null, living: 'own', ground: { week: null, arrears: 0 } })
  const now = Date.UTC(2026, 5, 1, 9)
  const base = createLife(structuredClone(settled('legacy').state), { cityId: 'lagos', now, seed: 'legacy' })
  const raw = JSON.parse(JSON.stringify(base)) as Record<string, unknown> & { estate: Record<string, unknown> }
  raw.estate = { city: 'abuja', ...residence(unit('abuja'), now - 5 * DAY, 'bq'), nudged: false,
    away: { lagos: { ...residence(unit('lagos'), now - 40 * DAY), house: cityRules('lagos')!.defaultRentedHome }, kano: { ...residence(unit('kano'), now - 20 * DAY), house: cityRules('kano')!.defaultRentedHome } } }
  const read = createLife(structuredClone(raw), { cityId: 'abuja', now, seed: 'legacy', trustedSave: true })
  const stored = raw.estate as { away: Record<string, unknown> }
  const { home, homeAt, ...rest } = read.estate
  assert.deepEqual([home, homeAt], ['lagos', null], 'the home chosen first is the main one')
  assert.deepEqual(JSON.parse(JSON.stringify(rest)), { ...JSON.parse(JSON.stringify(rest)), city: 'abuja', lga: unit('abuja'), tier: 'bq', plot: { lga: unit('abuja'), estate: 3, plot: 7 } })
  assert.deepEqual(Object.keys(read.estate.away).sort(), Object.keys(stored.away).sort())
  for (const city of ['lagos', 'kano'] as const) assert.deepEqual([read.estate.away[city]?.lga, read.estate.away[city]?.plot, read.estate.away[city]?.tier], [unit(city), { lga: unit(city), estate: 3, plot: 7 }, 'starter'], `${city} is kept as it was`)
  assert.equal(hasPlace(read), true, 'it is at home in the city it is in, as before')
  // Reading it again changes nothing, and the choice once stored is kept.
  assert.deepEqual(createLife(structuredClone(read), { cityId: 'abuja', now, seed: 'legacy', trustedSave: true }).estate, read.estate)
  const chosen = createLife({ ...structuredClone(raw), estate: { ...structuredClone(raw.estate), home: 'kano' } }, { cityId: 'abuja', now, seed: 'legacy', trustedSave: true })
  assert.equal(chosen.estate.home, 'kano')
  // A stored value that names a city where no home is held is not believed.
  for (const hostile of ['ibadan', 'atlantis', 7, null]) assert.equal(createLife({ ...structuredClone(raw), estate: { ...structuredClone(raw.estate), home: hostile } }, { cityId: 'abuja', now, seed: 'legacy', trustedSave: true }).estate.home, 'lagos')
  // In a city where it has no home it is a visitor like anyone else, and returning to each home finds it.
  const ctx = (state: LifeState, at: number): LifeContextInit => ({ cityId: state.estate.city, now: at, seed: 'legacy' })
  read.cash = 500_000
  assert.equal(dispatch(read, { type: 'estate.relocate', payload: { to: 'kano', mode: 'air' } } as never, ctx(read, now)).code, 'departed')
  advanceLife(read, 60, ctx(read, now + 60000))
  assert.deepEqual([read.estate.city, read.estate.lga, read.location, read.message], ['kano', unit('kano'), 'home', 'Welcome to Kano. You are back at your house here.'])
  assert.deepEqual(Object.keys(read.estate.away).sort(), ['abuja', 'lagos'])
})
