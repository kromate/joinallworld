import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceLife, createLife, dispatch, spotsOf, viewLife } from '../../../life.ts'
import { DEFAULT_LOOK } from '../../content/traits.ts'
import needsSystem from '../../systems/needs.ts'
import { findActivity } from '../../systems/activities.ts'
import { cityRules, isOpenCityId, linksFrom, loadCityContent } from '../registry.ts'
import { contentFor } from '../runtime.ts'
import type { LifeContextInit, LifeState } from '../../../types/life.ts'

const CITY = 'kano'

function journeyClock(cityId: string) {
  let now = Date.UTC(2026, 0, 5, 9), sequence = 0
  const context = (state?: LifeState): LifeContextInit => ({ cityId: state?.estate.city ?? cityId, now, seed: `kano-journey-${sequence++}` })
  const advance = (state: LifeState, seconds: number): void => {
    now += seconds * 1000
    assert.equal(advanceLife(state, seconds, context(state)).ok, true)
  }
  const finish = (state: LifeState): void => {
    const seconds = state.activeAction?.remaining
    assert.equal(typeof seconds, 'number', 'there is an active timed action')
    if (typeof seconds !== 'number') throw new Error('Missing timed action')
    advance(state, seconds + 1)
    assert.equal(state.activeAction, null)
  }
  return { context, advance, finish }
}
type Clock = ReturnType<typeof journeyClock>

function defaultUnit(cityId: string): string {
  const rules = cityRules(cityId)
  assert.ok(rules)
  const home = contentFor(cityId).housing.find(item => item.definition.id === rules.defaultRentedHome)
  assert.ok(home, `${cityId} declares its default home`)
  const district = rules.districts.find(item => item.id === (home.districtId ?? home.definition.id))
  assert.ok(district, `${cityId}'s default home has an authored district`)
  assert.ok(rules.units.some(unit => unit.id === district.localUnitId))
  return district.localUnitId
}

function newGuest(cityId: string, clock: Clock): LifeState {
  assert.equal(isOpenCityId(cityId), true)
  const state = createLife({ name: 'Capital Traveller' }, { ...clock.context(), isNew: true, quickStart: true })
  assert.notEqual(state.location, 'home')
  assert.equal(state.estate.city, cityId)
  assert.equal(state.estate.lgaConfirmed, false)
  assert.equal(state.estate.plot, null)
  assert.equal(viewLife(state, clock.context(state)).estate.placed, false)
  assert.equal(dispatch(state, { type: 'onboarding.quick-start', payload: { look: DEFAULT_LOOK } }, clock.context(state)).code, 'playing')
  assert.equal(state.onboarding.done, false)
  return state
}

function settle(state: LifeState, clock: Clock): void {
  assert.equal(dispatch(state, { type: 'onboarding.traits', payload: { traits: ['clean-pikin', 'musical'] } }, clock.context(state)).code, 'traits_saved')
  assert.equal(dispatch(state, { type: 'onboarding.dream', payload: { dream: 'afrobeats-star' } }, clock.context(state)).code, 'dream_saved')
  assert.equal(dispatch(state, { type: 'onboarding.lottery', payload: {} }, clock.context(state)).code, 'rolled')
  const lga = state.estate.city === CITY ? 'nassarawa' : defaultUnit(state.estate.city)
  assert.equal(dispatch(state, { type: 'onboarding.home', payload: { lga, via: 'manual' } }, clock.context(state)).code, 'life_started')
  assert.equal(state.estate.lga, lga)
  assert.equal(state.estate.lgaConfirmed, true)
  assert.equal(state.estate.living, 'own')
  assert.equal(state.property.house, cityRules(state.estate.city)?.defaultRentedHome)
}

function playHere(state: LifeState, clock: Clock): void {
  const offered = spotsOf(state.location, state.estate.city).flatMap(spot => spot.activities.map(activity => ({ spot, activity })))
  const free = offered.find(({ activity }) => !(activity.cost ?? 0) && !activity.requiresSkill && !activity.requiresIllness && !activity.requiresMoodlet && !activity.hours)
  assert.ok(free, `${state.estate.city} offers a free guest activity at its arrival venue`)
  assert.equal(dispatch(state, { type: 'spot', payload: { id: free.spot.id } }, clock.context(state)).ok, true)
  assert.equal(dispatch(state, { type: 'activity', payload: { id: free.activity.id } }, clock.context(state)).code, 'started')
  clock.finish(state)
}

function workLocally(state: LifeState, clock: Clock): void {
  const job = contentFor(state.estate.city).workplaces.find(item => item.careerId === 'community-helper')?.definition
  assert.ok(job, `${state.estate.city} offers accessible paid local work`)
  assert.equal(dispatch(state, { type: 'apply-job', payload: { id: job.id } }, clock.context(state)).code, 'applied')
  if (state.location !== job.workplace.venue) {
    assert.equal(dispatch(state, { type: 'travel', payload: { id: job.workplace.venue, mode: 'trek' } }, clock.context(state)).code, 'started')
    clock.finish(state)
  }
  assert.equal(dispatch(state, { type: 'spot', payload: { id: job.workplace.spot } }, clock.context(state)).ok, true)
  const shift = viewLife(state, clock.context(state)).career.shift
  assert.ok(shift)
  const definition = findActivity(shift.id, state.estate.city)?.def
  assert.ok(definition)
  const pay = viewLife(state, clock.context(state)).career.pay, from = state.ledger.length
  assert.ok(pay > 0)
  assert.equal(dispatch(state, { type: 'activity', payload: { id: shift.id } }, clock.context(state)).code, 'started')
  clock.finish(state)
  const paid = state.ledger.slice(from).filter(entry => entry.reason === definition.label && entry.amount > 0)
  assert.deepEqual(paid.map(entry => entry.amount), [pay])
  assert.equal(state.completedShifts, 1)
  const cash = state.cash
  assert.equal(dispatch(state, { type: 'activity', payload: { id: shift.id } }, clock.context(state)).ok, false)
  assert.equal(state.cash, cash, 'the same completed shift cannot immediately pay again')
}

const cashBase = (state: LifeState): number => state.cash - state.ledger.reduce((sum, entry) => sum + entry.amount, 0)
const home = (state: LifeState) => ({ lga: state.estate.lga, living: state.estate.living, tier: state.estate.tier, style: structuredClone(state.estate.style), house: state.property.house })

test('Kano: a fresh Nassarawa guest chooses Nassarawa, works and eats locally', async () => {
  await loadCityContent(CITY)
  const clock = journeyClock(CITY), state = newGuest(CITY, clock), opening = cashBase(state)
  assert.equal(state.location, 'nassarawa-garden', 'the new player starts in the authored Nassarawa public venue')
  playHere(state, clock)
  settle(state, clock)
  assert.equal(state.estate.lga, 'nassarawa')
  workLocally(state, clock)
  const food = contentFor(CITY).venues.flatMap(venue => Object.values(venue.definition.spots).flatMap(spot => spot.activities.map(activity => ({ venue, spot, activity })))).find(({ activity }) => activity.tags?.includes('food') && (activity.effects?.hunger ?? 0) > 0)
  assert.ok(food, 'the city offers a local meal')
  if (state.location !== food.venue.id) {
    assert.equal(dispatch(state, { type: 'travel', payload: { id: food.venue.id, mode: 'trek' } }, clock.context(state)).code, 'started')
    clock.finish(state)
  }
  state.needs.hunger = 20
  const hunger = state.needs.hunger
  assert.equal(dispatch(state, { type: 'spot', payload: { id: food.spot.id } }, clock.context(state)).ok, true)
  assert.equal(dispatch(state, { type: 'activity', payload: { id: food.activity.id } }, clock.context(state)).code, 'started')
  clock.finish(state)
  assert.ok(state.needs.hunger > hunger)
  assert.equal(cashBase(state), opening)
  assert.deepEqual(createLife(structuredClone(state), { ...clock.context(state), trustedSave: true }), state)
})

test('Lagos–Kano flights preserve the travelling character and both homes', async () => {
  await Promise.all(['lagos', CITY].map(loadCityContent))
  const clock = journeyClock('lagos')
  let state = newGuest('lagos', clock)
  settle(state, clock)
  workLocally(state, clock)
  state.cash = 1_000_000
  state.needs.hunger = 63
  const opening = cashBase(state), originalHome = home(state), job = state.job, career = structuredClone(state.career)
  const fly = (to: string): void => {
    const link = linksFrom(state.estate.city).find(link => link.to === to && link.mode === 'air')
    assert.ok(link)
    const before = state.cash, ledgerFrom = state.ledger.length, skills = structuredClone(state.skills), expectedNeeds = structuredClone(state)
    needsSystem.advance(expectedNeeds, link.seconds + 1, { cityId: state.estate.city, now: state.t + (link.seconds + 1) * 1000, rng: () => 0.5 })
    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to, mode: 'air' } }, clock.context(state)).code, 'departed')
    assert.equal(state.cash, before - link.fare)
    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to, mode: 'air' } }, clock.context(state)).ok, false)
    assert.equal(state.cash, before - link.fare)
    clock.advance(state, link.seconds / 2)
    const saved = structuredClone(state)
    state = createLife(saved, { ...clock.context(state), trustedSave: true })
    assert.deepEqual(state, saved)
    clock.finish(state)
    assert.equal(state.estate.city, to)
    assert.equal(state.job, job)
    assert.deepEqual(state.career, career)
    assert.deepEqual(state.skills, skills)
    assert.deepEqual(state.needs, expectedNeeds.needs, 'flight retains needs with only the existing background decay')
    assert.deepEqual(state.ledger.slice(ledgerFrom).filter(entry => entry.amount < 0).map(entry => entry.amount), [-link.fare])
    assert.equal(cashBase(state), opening)
  }
  fly(CITY)
  const paused = viewLife(state, clock.context(state)).career
  assert.deepEqual([paused.workplace, paused.shift, paused.pay], [null, null, 0])
  const beforeHome = state.cash, homePrice = viewLife(state, clock.context(state)).estate.settle?.buy.prices['nassarawa'] ?? 0
  assert.ok(homePrice > 0, 'a visitor is quoted the price of a home here')
  assert.equal(dispatch(state, { type: 'estate.set-lga', payload: { lga: 'nassarawa', via: 'manual', home: 'buy' } }, clock.context(state)).code, 'home_bought')
  assert.equal(state.cash, beforeHome - homePrice, 'a second home is bought at its price, never given')
  const kanoHome = home(state)
  fly('lagos')
  assert.deepEqual(home(state), originalHome)
  const away = state.estate.away[CITY]
  assert.ok(away)
  assert.deepEqual({ lga: away.lga, living: away.living, tier: away.tier, style: away.style, house: away.house }, kanoHome)
  assert.ok(viewLife(state, clock.context(state)).career.workplace)
  assert.equal(cashBase(state), opening)
})


test('Kano keeps the planned train closed, opens its roads and flights, and offers neighbourhood keke without okada', async () => {
  await Promise.all(['lagos', 'abuja', CITY].map(loadCityContent))
  const hand = ['abuja:air', 'abuja:road', 'lagos:air', 'lagos:road']
  assert.deepEqual(linksFrom(CITY).filter(link => link.status !== 'coming').map(link => `${link.to}:${link.mode}`).sort().filter(way => hand.includes(way)), hand)
  assert.equal(linksFrom(CITY).some(link => link.mode === 'rail' && link.status !== 'coming'), false, 'no generated railway')
  for (const from of ['lagos', CITY]) {
    const clock = journeyClock(from), state = createLife({ cash: 1_000_000 }, clock.context())
    const planned = linksFrom(from).filter(link => link.status === 'coming' && (from === CITY || link.to === CITY))
    assert.ok(planned.length > 0, `${from} lists the planned Lagos–Kano train`)
    for (const link of planned) {
      const before = structuredClone({ cash: state.cash, ledger: state.ledger, estate: state.estate })
      const result = dispatch(state, { type: 'estate.relocate', payload: { to: link.to, mode: link.mode } }, clock.context(state))
      assert.equal(result.code, 'route_not_open')
      assert.deepEqual({ cash: state.cash, ledger: state.ledger, estate: state.estate }, before)
      assert.equal(state.activeAction, null)
    }
  }
  const clock = journeyClock(CITY), state = newGuest(CITY, clock)
  const destinations = viewLife(state, clock.context(state)).travel.destinations
  assert.ok(destinations.some(place => place.modes.some(mode => mode.id === 'keke')), 'Nassarawa has a declared neighbourhood keke connection')
  assert.ok(destinations.every(place => place.modes.every(mode => mode.id !== 'okada')), 'commercial okada is not offered')
})
