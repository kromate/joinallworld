import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceLife, createLife, dispatch, spotsOf, viewLife } from '../../../life.ts'
import { DEFAULT_LOOK } from '../../content/traits.ts'
import { findActivity } from '../../systems/activities.ts'
import { cityRules, isOpenCityId, linksFrom, loadCityContent } from '../registry.ts'
import { contentFor } from '../runtime.ts'
import type { LifeContextInit, LifeState } from '../../../types/life.ts'

const CITIES = ['abeokuta', 'ota', 'ijebu-ode', 'sagamu'] as const

function journeyClock(cityId: string) {
  let now = Date.UTC(2026, 0, 5, 9), sequence = 0
  const context = (state?: LifeState): LifeContextInit => ({ cityId: state?.estate.city ?? cityId, now, seed: `ogun-journey-${sequence++}` })
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
  const state = createLife({ name: 'Ogun Traveller' }, { ...clock.context(), isNew: true, quickStart: true })
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
  const lga = defaultUnit(state.estate.city)
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

for (const cityId of ['lagos', ...CITIES]) test(`${cityId}: a public guest can play, settle and earn from local work`, async () => {
  await loadCityContent(cityId)
  const clock = journeyClock(cityId), state = newGuest(cityId, clock), opening = cashBase(state)
  playHere(state, clock)
  settle(state, clock)
  workLocally(state, clock)
  const restored = createLife(structuredClone(state), { ...clock.context(state), trustedSave: true })
  assert.deepEqual(restored, state)
  assert.equal(cashBase(state), opening, 'all cash changes have ledger entries')
})

test('Lagos → Ota → Abeokuta → Lagos keeps one wallet, the held job and both homes', async () => {
  await Promise.all(['lagos', 'ota', 'abeokuta'].map(loadCityContent))
  const clock = journeyClock('lagos')
  let state = newGuest('lagos', clock)
  settle(state, clock)
  workLocally(state, clock)
  let opening = cashBase(state)
  const originalHome = home(state), job = state.job, career = structuredClone(state.career)
  const skills = structuredClone(state.skills)
  const originalWork = contentFor('lagos').workplaces.find(item => item.careerId === job)?.definition
  assert.ok(originalWork)
  const cooldown = state.travel.cooldowns[originalWork.shift.id]
  assert.ok(cooldown)

  const travel = (to: string): void => {
    const link = linksFrom(state.estate.city).find(item => item.to === to && item.mode === 'road')
    assert.ok(link, `a declared road link reaches ${to}`)
    const before = state.cash, from = state.ledger.length
    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to, mode: link.mode } }, clock.context(state)).code, 'departed')
    assert.equal(state.cash, before - link.fare)
    const remaining = state.activeAction?.remaining
    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to, mode: link.mode } }, clock.context(state)).ok, false)
    assert.equal(state.cash, before - link.fare)
    assert.equal(state.activeAction?.remaining, remaining)
    clock.advance(state, link.seconds / 2)
    const saved = structuredClone(state)
    state = createLife(saved, { ...clock.context(state), trustedSave: true })
    assert.deepEqual(state, saved, 'reloading midway preserves the paid fare and remaining timer')
    clock.finish(state)
    assert.equal(state.estate.city, to)
    assert.deepEqual(state.ledger.slice(from).filter(entry => entry.amount < 0).map(entry => entry.amount), [-link.fare])
    const arrivedCash = state.cash
    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to, mode: link.mode } }, clock.context(state)).ok, false)
    assert.equal(state.cash, arrivedCash)
    assert.equal(state.job, job)
    assert.deepEqual(state.career, career)
    assert.deepEqual(state.skills, skills)
    assert.equal(cashBase(state), opening)
  }

  travel('ota')
  assert.equal(state.estate.lga, null)
  assert.notEqual(state.location, 'home')
  const awayCareer = viewLife(state, clock.context(state)).career
  assert.equal(awayCareer.id, job, 'the held job identity is still visible')
  assert.deepEqual([awayCareer.workplace, awayCareer.hours, awayCareer.shift, awayCareer.pay, awayCareer.today.canWork], [null, null, null, 0, false], 'a job held in Lagos cannot be worked in Ota until it is moved')
  // A second home is bought at its price; the money for it is put in hand here so the rest of the journey keeps its wallet.
  const homePrice = viewLife(state, clock.context(state)).estate.settle?.buy.prices[defaultUnit('ota')] ?? 0
  assert.ok(homePrice > 0, 'a visitor is quoted the price of a home here')
  const beforeHome = state.cash
  state.cash += homePrice; opening += homePrice
  assert.equal(dispatch(state, { type: 'estate.set-lga', payload: { lga: defaultUnit('ota'), via: 'manual', home: 'buy' } }, clock.context(state)).code, 'home_bought')
  assert.equal(state.estate.living, 'own')
  assert.equal(dispatch(state, { type: 'estate.set-lga', payload: { lga: defaultUnit('ota'), via: 'manual' } }, clock.context(state)).code, 'unchanged')
  assert.equal(state.cash, beforeHome, 'the Ota home cost exactly its price')
  const otaHome = home(state)
  travel('abeokuta')
  assert.equal(state.estate.lga, null)
  assert.notEqual(state.location, 'home')
  travel('lagos')
  assert.deepEqual(home(state), originalHome)
  const away = state.estate.away.ota
  assert.ok(away)
  assert.deepEqual({ lga: away.lga, living: away.living, tier: away.tier, style: away.style, house: away.house }, otaHome)
  assert.ok(viewLife(state, clock.context(state)).career.workplace, 'the held Lagos job is available again after return')
  assert.equal(state.travel.cooldowns[originalWork.shift.id], cooldown, 'travel and reload never erase the original shift cooldown')
  assert.equal(dispatch(state, { type: 'travel', payload: { id: originalWork.workplace.venue, mode: 'trek' } }, clock.context(state)).code, 'started')
  clock.finish(state)
  assert.equal(dispatch(state, { type: 'spot', payload: { id: originalWork.workplace.spot } }, clock.context(state)).ok, true)
  assert.equal(dispatch(state, { type: 'activity', payload: { id: originalWork.shift.id } }, clock.context(state)).code, 'cooldown')
  const restored = createLife(structuredClone(state), { ...clock.context(state), trustedSave: true })
  assert.deepEqual(restored, state)
})

const travelBy = (state: LifeState, clock: Clock, to: string): void => {
  const link = linksFrom(state.estate.city).find(item => item.to === to && item.mode === 'road')
  assert.ok(link, `a road link reaches ${to}`)
  assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to, mode: 'road' } }, clock.context(state)).code, 'departed')
  clock.finish(state)
  assert.equal(state.estate.city, to)
}

test('moving a job to another city keeps its track, level and the day\'s shift; the starter shift has one break for the character', async () => {
  await Promise.all(['lagos', 'ota', 'abeokuta'].map(loadCityContent))
  const clock = journeyClock('lagos'), state = newGuest('lagos', clock)
  settle(state, clock)
  workLocally(state, clock)
  assert.ok(state.travel.cooldowns['helper-shift'], 'the starter shift break is filed for the character')
  travelBy(state, clock, 'ota')
  const listing = viewLife(state, clock.context(state)).career.jobs.find(job => job.id === 'community-helper')
  assert.equal(listing?.transfer, true, 'the same track elsewhere is offered as a transfer')
  assert.equal(listing?.switchWarning, null, 'a transfer loses nothing, so there is no warning')
  const before = structuredClone(state.career)
  assert.equal(dispatch(state, { type: 'apply-job', payload: { id: 'community-helper' } }, clock.context(state)).code, 'transferred')
  assert.equal(state.career.city, 'ota')
  assert.deepEqual({ ...state.career, city: null, transferDay: null }, { ...before, city: null, transferDay: null })
  assert.equal(state.job, 'community-helper')
  assert.equal(dispatch(state, { type: 'apply-job', payload: { id: 'community-helper' } }, clock.context(state)).code, 'already_employed')
  // The break from the Lagos shift still runs in Ota: travelling never buys a second paid shift.
  const work = contentFor('ota').workplaces.find(item => item.careerId === 'community-helper')!.definition
  if (state.location !== work.workplace.venue) {
    assert.equal(dispatch(state, { type: 'travel', payload: { id: work.workplace.venue, mode: 'trek' } }, clock.context(state)).code, 'started')
    clock.finish(state)
  }
  assert.equal(dispatch(state, { type: 'spot', payload: { id: work.workplace.spot } }, clock.context(state)).ok, true)
  assert.equal(dispatch(state, { type: 'activity', payload: { id: work.shift.id } }, clock.context(state)).code, 'cooldown')
  assert.equal((viewLife(state, clock.context(state)).travel.cooldowns[work.shift.id] ?? 0) > 0, true, 'the break is shown in the new city')
  // One move a day.
  travelBy(state, clock, 'lagos')
  assert.equal(dispatch(state, { type: 'apply-job', payload: { id: 'community-helper' } }, clock.context(state)).code, 'transfer_limit')
})

test('a career track moved between cities keeps its level and the one paid shift a day', async () => {
  await Promise.all(['lagos', 'ota'].map(loadCityContent))
  const clock = journeyClock('lagos'), state = newGuest('lagos', clock)
  settle(state, clock)
  assert.equal(dispatch(state, { type: 'apply-job', payload: { id: 'teaching' } }, clock.context(state)).code, 'applied')
  const day = Math.floor((Date.UTC(2026, 0, 5, 9) + 3600000) / 86400000)
  Object.assign(state.career, { level: 2, performance: 60, shifts: 4, lastShiftDay: day })
  travelBy(state, clock, 'ota')
  assert.equal(dispatch(state, { type: 'apply-job', payload: { id: 'teaching' } }, clock.context(state)).code, 'transferred')
  assert.deepEqual([state.career.city, state.career.level, state.career.performance, state.career.shifts, state.career.lastShiftDay], ['ota', 2, 60, 4, day])
  assert.equal(viewLife(state, clock.context(state)).career.today.code, 'shift_done', 'today\'s paid shift was already worked in Lagos')
  // A track with no workplace to move to is not touched: a different local job is a confirmed switch that resets.
  assert.equal(dispatch(state, { type: 'apply-job', payload: { id: 'community-helper' } }, clock.context(state)).code, 'confirm_switch')
})
