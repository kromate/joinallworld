// The safety nets: a ride home on credit, odd jobs, the bench and the tap, and every limit on them.
import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceLife, createLife, dispatch, viewLife } from '../life.ts'
import { DEFAULT_LOOK } from './content/traits.ts'
import { BENCH, ODD_JOBS, ODD_JOBS_CASH_BELOW, RIDE_CREDIT, TAP } from './content/relief.ts'
import { LODGING } from './content/world.ts'
import { allCityLinks, cityRules, linksFrom, loadCityContent, playableCityIds } from './cities/registry.ts'
import { publicArrivalVenue } from './cities/runtime.ts'
import { findActivity } from './api.ts'
import { statementOf } from './systems/wallet.ts'
import { helpOf, helpStep } from '../app/features/relief/reliefHelp.ts'
import { rideDebtText } from './relief.ts'
import { makeContext } from './util.ts'
import { DECAY_FLOOR } from './systems/needs.ts'
import type { LifeContextInit, LifeState } from '../types/life.ts'

const CITIES = ['lagos', 'ibadan', 'abeokuta', 'ota', 'ijebu-ode', 'sagamu', 'port-harcourt', 'abuja', 'kano']
await Promise.all(CITIES.map(loadCityContent))

const HOUR = 3600
/** A settled life whose main home is `home`, standing in `home`. */
function life(home = 'lagos', seed = 'relief') {
  let now = Date.UTC(2026, 0, 6, 10)
  const context = (state?: LifeState): LifeContextInit => ({ cityId: state?.estate.city ?? home, now, seed })
  const state = createLife({ name: 'Wanderer' }, { ...context(), isNew: true, quickStart: true })
  const run = (type: string, payload: object = {}, extra: Partial<LifeContextInit> = {}) => dispatch(state, { type, payload } as never, { ...context(state), ...extra })
  const wait = (seconds: number): void => { now += seconds * 1000; advanceLife(state, seconds, context(state)) }
  run('onboarding.quick-start', { look: DEFAULT_LOOK })
  run('onboarding.traits', { traits: ['clean-pikin', 'musical'] })
  run('onboarding.dream', { dream: 'afrobeats-star' })
  run('onboarding.lottery', {})
  assert.equal(run('onboarding.home', { lga: cityRules(home)!.units[0]!.id, via: 'manual' }).code, 'life_started')
  const view = () => viewLife(state, context(state))
  const arrival = () => { wait((state.activeAction?.remaining ?? 0) + 1) }
  /** Visit a city with money, then spend down to `cash`. */
  const visit = (city: string, cash: number, mode = 'road'): void => {
    state.cash = 1_000_000
    assert.equal(run('estate.relocate', { to: city, mode }).code, 'departed')
    arrival()
    assert.equal(state.estate.city, city)
    state.cash = cash
  }
  const at = (hour: number, day = 6): void => { now = Date.UTC(2026, 0, day, hour); state.t = now }
  const doActivity = (id: string, venue: string): { ok: boolean; code: string } => {
    const spot = findActivity(id, state.estate.city)!.spot
    if (state.location !== venue) assert.ok(run('travel', { id: venue, mode: 'trek' }).ok, 'reach the place'), arrival()
    if (state.spot !== spot) run('spot', { id: spot })
    const done = run('activity', { id })
    if (done.ok) arrival()
    return { ok: done.ok, code: done.code }
  }
  return { state, run, wait, view, visit, at, doActivity, context: () => context(state), arrival, now: () => now }
}
const ctx = (l: ReturnType<typeof life>) => makeContext({ cityId: l.state.estate.city, now: l.now() })
const help = (l: ReturnType<typeof life>) => helpOf(l.state, ctx(l))
const FRIEND = '11111111-2222-3333-4444-555555555555'
const collect = (l: ReturnType<typeof life>, amount: number) => l.run('business.server', { op: 'collect', amount, sales: 0, name: 'Stall' }, { internal: true })
const homeFare = (from: string, to: string): number => Math.min(...linksFrom(from).filter((link) => link.to === to).map((link) => link.fare))

test('the owner\'s case: a visitor in Port Harcourt with ₦2,800 is offered the ride home on credit, at the cheapest fare', () => {
  const l = life()
  l.visit('port-harcourt', 2800)
  const offer = l.view().estate.ride.offer
  assert.ok(offer)
  assert.deepEqual([offer.to, offer.mode, offer.fare], ['lagos', 'road', 12000])
  assert.equal(l.view().estate.ride.debt, 0)
  assert.equal(l.run('estate.relocate', { to: 'lagos', mode: 'road' }).code, 'insufficient_funds', 'the plain way is still the plain way')
  const before = l.state.cash
  assert.equal(l.run('estate.relocate', { to: 'lagos', mode: 'road', credit: true }).code, 'departed')
  assert.equal(l.state.cash, before, 'the fare goes to the ticket: no spending money is handed over')
  assert.equal(l.state.travel.rideDebt, 12000)
  assert.equal(rideDebtText(l.view().estate.ride.debt), 'You owe ₦12,000 for your ride home')
  const lines = l.state.ledger.slice(-2)
  assert.deepEqual(lines.map((line) => line.amount), [12000, -12000])
  assert.match(lines[0]!.reason, /^Ride home on credit/)
  assert.equal(statementOf(l.state).lines.at(-1)?.amount, -12000)
  l.arrival()
  assert.deepEqual([l.state.estate.city, l.state.cash, l.state.travel.rideDebt], ['lagos', before, 12000])
})

test('limits of the ride on credit: main home only, only when cash is short, one at a time, a visitor, and no skip', () => {
  const l = life()
  l.visit('port-harcourt', 2800)
  // Not to a city that is not the main home, not by a mode that is not the cheapest.
  assert.equal(l.run('estate.relocate', { to: 'abuja', mode: 'road', credit: true }).code, 'credit_not_offered')
  assert.equal(l.run('estate.relocate', { to: 'lagos', mode: 'air', credit: true }).code, 'credit_not_offered')
  // Not when the fare can be paid.
  l.state.cash = 12000
  assert.equal(l.run('estate.relocate', { to: 'lagos', mode: 'road', credit: true }).code, 'credit_not_offered')
  assert.equal(l.view().estate.ride.offer, null)
  l.state.cash = 100
  assert.equal(l.run('estate.relocate', { to: 'lagos', mode: 'road', credit: true }).code, 'departed')
  // No skip of any kind: the first skip is not used up either.
  const skip = l.run('travel.skip')
  assert.equal(skip.code, 'ride_debt')
  assert.equal(l.state.travel.skipped, false)
  assert.equal(l.view().travel.skip?.blocked?.code, 'ride_debt')
  l.arrival()
  // A resident is not offered it; with the debt standing, no trip between cities starts, paid or not.
  assert.equal(l.view().estate.ride.offer, null)
  l.state.cash = 1_000_000
  const refused = l.run('estate.relocate', { to: 'ibadan', mode: 'road' })
  assert.equal(refused.code, 'ride_debt')
  assert.match(String(refused.reason), /You owe ₦12,000 for your ride home/)
  assert.ok(l.view().estate.links.filter((link) => link.open && link.status !== 'coming').every((link) => /You owe/.test(link.blocked ?? '')), 'every open link says why')
  assert.equal(l.run('estate.relocate', { to: 'ibadan', mode: 'road', credit: true }).code, 'ride_debt')
})

test('a guest who has not settled in cannot travel between cities, on credit or not', () => {
  const now = Date.UTC(2026, 0, 6, 10)
  const context = (state?: LifeState): LifeContextInit => ({ cityId: state?.estate.city ?? 'lagos', now, seed: 'guest' })
  const state = createLife({ name: 'Guest' }, { ...context(), isNew: true, quickStart: true })
  dispatch(state, { type: 'onboarding.quick-start', payload: { look: DEFAULT_LOOK } } as never, context(state))
  state.cash = 0
  for (const credit of [false, true]) {
    const result = dispatch(state, { type: 'estate.relocate', payload: { to: 'port-harcourt', mode: 'road', credit } } as never, context(state))
    assert.equal(result.ok, false)
    assert.ok(['settle_required', 'onboarding_required'].includes(String(result.code)), `${credit}: ${result.code}`)
  }
  assert.equal(state.estate.city, 'lagos')
})

test('a visitor whose home is anywhere can always get home: every pair of open cities has a road, and the home is open', () => {
  const open = playableCityIds()
  for (const a of open) for (const b of open) {
    if (a === b) continue
    assert.ok(linksFrom(a).some((link) => link.to === b && link.mode === 'road' && link.status !== 'coming'), `${a} to ${b} has an open road`)
    assert.equal(cityRules(b)?.status, 'open')
  }
  assert.ok(allCityLinks().length > 0)
})

test('the debt is repaid from earnings, half of each, as ledger lines, and the statement shows it', () => {
  const l = life()
  l.visit('port-harcourt', 0)
  assert.equal(l.run('estate.relocate', { to: 'lagos', mode: 'road', credit: true }).code, 'departed')
  l.arrival()
  assert.equal(l.state.cash, 0)
  // A wage: an odd job pays ₦350, so ₦175 repays and ₦175 is kept.
  const arrivalVenue = publicArrivalVenue('lagos').id
  const done = l.doActivity(ODD_JOBS.id, arrivalVenue)
  assert.equal(done.ok, true, done.code)
  assert.deepEqual([l.state.cash, l.state.travel.rideDebt], [175, 11825])
  const repaid = l.state.ledger.find((line) => line.reason === 'Ride home repaid')
  assert.equal(repaid?.amount, -175)
  assert.ok(statementOf(l.state).days.at(-1)!.groups.some((group) => group.group === 'Ride home repaid'), 'a group of its own in the day summary')
  // A gift received: half of it too.
  const gift = l.run('social.server', { op: 'transfer-in', from: FRIEND, amount: 1000, name: 'Ada' }, { internal: true })
  assert.equal(gift.ok, true, String(gift.code))
  assert.deepEqual([l.state.cash, l.state.travel.rideDebt], [175 + 500, 11825 - 500])
  // The takings of a stall.
  const takings = collect(l, 400)
  assert.equal(takings.ok, true, String(takings.code))
  assert.deepEqual([l.state.cash, l.state.travel.rideDebt], [675 + 200, 11325 - 200])
  // Anything that is not earned is not taken: a refund, a prize.
  const debtBefore = l.state.travel.rideDebt
  l.run('social.server', { op: 'transfer-in', from: FRIEND, amount: 100, name: 'Ada', refund: true }, { internal: true })
  assert.equal(l.state.travel.rideDebt, debtBefore)
})

test('the last part of the debt clears it, removes the field and says so; paying from the wallet works too', () => {
  const l = life()
  l.visit('port-harcourt', 0)
  l.run('estate.relocate', { to: 'lagos', mode: 'road', credit: true })
  l.arrival()
  l.state.travel.rideDebt = 100
  assert.equal(collect(l, 1000).ok, true)
  assert.equal('rideDebt' in l.state.travel, false)
  assert.equal(l.state.cash, 900)
  assert.equal(l.view().estate.ride.debt, 0)
  l.state.travel.rideDebt = 2000
  l.state.cash = 0
  assert.equal(l.run('travel.repay-ride').code, 'no_cash')
  l.state.cash = 700
  assert.equal(l.run('travel.repay-ride').code, 'repaid')
  assert.deepEqual([l.state.cash, l.state.travel.rideDebt], [0, 1300])
  l.state.cash = 5000
  assert.equal(l.run('travel.repay-ride').code, 'repaid')
  assert.deepEqual([l.state.cash, 'rideDebt' in l.state.travel], [3700, false])
  assert.equal(l.run('travel.repay-ride').code, 'no_debt')
  // Free to travel again once it is paid.
  l.state.cash = 100000
  assert.equal(l.run('estate.relocate', { to: 'ibadan', mode: 'road' }).code, 'departed')
})

test('with a debt standing, the main home cannot be moved and a second home cannot be bought', () => {
  const l = life()
  l.visit('abuja', 0)
  assert.equal(l.run('estate.relocate', { to: 'lagos', mode: 'road', credit: true }).code, 'departed')
  l.arrival()
  l.state.cash = 1_000_000
  const owed = l.state.travel.rideDebt, cashBefore = l.state.cash
  // Pay to go to Abuja is refused (a debt): so put the life there the way a ping does, free.
  const joined = l.run('social.server', { op: 'join', city: 'abuja', venue: publicArrivalVenue('abuja').id, name: 'Ada' }, { internal: true })
  assert.equal(joined.ok, true, String(joined.code))
  assert.equal(l.state.estate.city, 'abuja')
  assert.equal(l.state.travel.rideDebt, owed, 'the free join does not touch the debt')
  assert.equal(l.state.cash, cashBefore, 'and costs nothing')
  const unit = cityRules('abuja')!.units[0]!.id
  assert.equal(l.run('estate.set-lga', { lga: unit, home: 'buy' }).code, 'ride_debt')
  assert.equal(l.run('estate.set-lga', { lga: unit, home: 'main' }).code, 'ride_debt')
  assert.equal(l.state.estate.lga, null, 'nothing changed')
  l.state.travel.rideDebt = undefined as never
  delete l.state.travel.rideDebt
  assert.equal(l.run('estate.set-lga', { lga: unit, home: 'main' }).ok, true, 'and without it, it is allowed')
})

test('the free join of a friend\'s ping is still free, with or without a debt', () => {
  const l = life()
  l.state.cash = 0
  const before = l.state.cash
  const joined = l.run('social.server', { op: 'join', city: 'port-harcourt', venue: publicArrivalVenue('port-harcourt').id, name: 'Ada' }, { internal: true })
  assert.equal(joined.ok, true)
  assert.equal(l.state.cash, before)
  assert.equal(l.state.estate.city, 'port-harcourt')
})

test('odd jobs: in every city, at every hour, with the worst needs, for anyone short of money, as a floor', () => {
  for (const city of playableCityIds()) {
    const l = life('lagos', `odd-${city}`)
    if (city !== 'lagos') l.visit(city, 300)
    else l.state.cash = 300
    const venue = publicArrivalVenue(city).id
    for (const hour of [3, 14, 23]) {
      l.at(hour, 7 + hour)
      l.state.needs.hunger = 10
      l.state.needs.energy = 10
      l.state.cash = 300
      delete l.state.travel.cooldowns[ODD_JOBS.id]
      l.state.travel.gigs = { day: 0, count: 0 }
      const done = l.doActivity(ODD_JOBS.id, venue)
      assert.equal(done.ok, true, `${city} at ${hour}h: ${done.code}`)
      assert.equal(l.state.cash, 300 + ODD_JOBS.reward!, `${city}: paid`)
    }
  }
})

test('odd jobs are a floor: not for the comfortable, a break between jobs shared by every city, and inside the daily gig limit', () => {
  const l = life()
  l.visit('port-harcourt', 300)
  const venue = publicArrivalVenue('port-harcourt').id
  assert.equal(l.doActivity(ODD_JOBS.id, venue).ok, true)
  assert.equal(l.doActivity(ODD_JOBS.id, venue).code, 'cooldown', 'a break between two')
  // The break follows the player to the next city: it cannot be worked twice by moving.
  l.state.cash = 100000
  l.visit('abuja', 300)
  const abuja = publicArrivalVenue('abuja').id
  assert.equal(l.doActivity(ODD_JOBS.id, abuja).code, 'cooldown')
  l.wait(ODD_JOBS.cooldown! + 5)
  l.state.cash = ODD_JOBS_CASH_BELOW
  assert.equal(l.doActivity(ODD_JOBS.id, abuja).code, 'not_needed', 'with money in hand it is not on offer')
  l.state.cash = ODD_JOBS_CASH_BELOW - 1
  assert.equal(l.doActivity(ODD_JOBS.id, abuja).ok, true)
  // The most a day pays: the gig limit counts it.
  const view = l.view().travel
  assert.ok(view.gigs.used >= 1)
  l.state.travel.gigs = { day: l.state.travel.gigs.day, count: view.gigs.limit }
  l.wait(ODD_JOBS.cooldown! + 5)
  l.state.cash = 300
  assert.equal(l.doActivity(ODD_JOBS.id, abuja).code, 'gig_limit')
  assert.ok(ODD_JOBS.reward! * 6 <= 2400, 'six jobs a day is the most: a floor, not an income')
})

test('the bench and the tap: free, in every city, slowly, only for someone who needs them, with a break', () => {
  for (const city of playableCityIds()) {
    const l = life('lagos', `bench-${city}`)
    if (city !== 'lagos') l.visit(city, 0)
    const venue = publicArrivalVenue(city).id
    l.state.needs.energy = 10
    l.state.needs.hunger = 10
    const cash = l.state.cash
    assert.equal(l.doActivity(BENCH.id, venue).ok, true, city)
    assert.equal(l.doActivity(TAP.id, venue).ok, true, city)
    assert.ok(l.state.needs.energy >= 10 + BENCH.effects!.energy! - 10 && l.state.needs.hunger >= 10 + TAP.effects!.hunger! - 1, `${city}: needs are back above the line ${l.state.needs.energy} ${l.state.needs.hunger}`)
    assert.equal(l.state.cash, cash, 'free')
    assert.equal(l.doActivity(BENCH.id, venue).code, 'cooldown')
  }
  const l = life()
  l.state.needs.energy = 80
  l.state.needs.hunger = 80
  const venue = publicArrivalVenue('lagos').id
  assert.equal(l.doActivity(BENCH.id, venue).code, 'not_needed')
  assert.equal(l.doActivity(TAP.id, venue).code, 'not_needed')
})

test('"Miserable" blocks neither the work nor the ride home', () => {
  const l = life()
  l.visit('port-harcourt', 0)
  l.state.needs.hunger = 10
  l.state.needs.energy = 10
  l.state.needs.hygiene = 10
  l.state.needs.fun = 10
  l.state.needs.social = 10
  l.state.needs.bladder = 10
  assert.equal(l.doActivity(ODD_JOBS.id, publicArrivalVenue('port-harcourt').id).ok, true)
  assert.equal(l.run('estate.relocate', { to: 'lagos', mode: 'road', credit: true }).code, 'departed')
})

test('a character left idle for days is never below the floor, and the nets are still there when they come back', () => {
  const l = life()
  l.visit('port-harcourt', 1000)
  l.wait(10 * 24 * HOUR)
  for (const need of Object.values(l.state.needs)) assert.ok(need >= DECAY_FLOOR, `a need at ${need}`)
  assert.ok(l.view().estate.ride.offer, 'still offered')
  assert.equal(l.state.cash, 1000)
})

test('mid-trip with nothing in the wallet: the trip finishes, and a second one waits', () => {
  const l = life()
  l.visit('port-harcourt', 0)
  assert.equal(l.run('estate.relocate', { to: 'lagos', mode: 'road', credit: true }).code, 'departed')
  l.state.cash = 0
  assert.equal(help(l), null, 'nothing is offered mid-trip')
  assert.equal(l.run('estate.relocate', { to: 'lagos', mode: 'road', credit: true }).code, 'busy')
  l.arrival()
  assert.equal(l.state.estate.city, 'lagos')
})

test('"What you can do now": offered when stuck-ish, with the first step the odd job or the ride, and not otherwise', () => {
  const l = life()
  assert.equal(help(l), null, 'at home with money: nothing')
  l.visit('port-harcourt', 2800)
  const card = help(l)
  assert.ok(card)
  assert.equal(card.title, 'What you can do now')
  assert.deepEqual(card.actions.map((action) => action.id), ['odd-job', 'credit-ride', 'friend'])
  assert.ok(card.actions.every((action) => action.blocked === null), JSON.stringify(card.actions.map((a) => [a.id, a.blocked])))
  assert.equal(card.actions[1]!.to, 'lagos')
  assert.match(card.key, /port-harcourt/)
  // The one goal line under the needs bars points at the same first step.
  const step = helpStep(l.state, ctx(l))
  assert.equal(step?.title, card.actions[0]!.label)
  assert.deepEqual(step?.go, [card.actions[0]!.venue, findActivity(ODD_JOBS.id, 'port-harcourt')!.spot])
  // Hungry and short of a meal, at home of a kind: the tap is on the card.
  l.state.cash = 1000
  l.state.needs.hunger = 12
  l.state.needs.energy = 90
  const hungry = help(l)
  assert.deepEqual(hungry?.actions.map((action) => action.id), ['odd-job', 'tap', 'credit-ride', 'friend'])
  l.state.needs.energy = 10
  assert.deepEqual(help(l)?.actions.map((action) => action.id), ['odd-job', 'tap', 'bench', 'credit-ride', 'friend'])
  l.state.cash = 12000
  l.state.needs.hunger = 90
  assert.equal(help(l), null, 'with the fare in hand and fed: nothing')
  // A stall owner is pointed at the cash box.
  l.state.cash = 100
  l.state.business.opened = 1
  assert.ok(help(l)?.actions.some((action) => action.id === 'cash-box'))
  void LODGING
})

test('stored shape: the field is absent without a debt, a legacy life loads unchanged, and a bad value is dropped', () => {
  const l = life()
  const plain = structuredClone(l.state)
  assert.equal('rideDebt' in plain.travel, false)
  const again = createLife(structuredClone(plain), { ...l.context(), trustedSave: true })
  assert.deepEqual(again.travel, plain.travel)
  const owing = createLife({ ...structuredClone(plain), travel: { ...plain.travel, rideDebt: 8000 } }, { ...l.context(), trustedSave: true })
  assert.equal(owing.travel.rideDebt, 8000)
  for (const bad of [-5, 1.5, 'much', null, 1e12]) {
    const loaded = createLife({ ...structuredClone(plain), travel: { ...plain.travel, rideDebt: bad } }, { ...l.context(), trustedSave: true })
    assert.ok(!('rideDebt' in loaded.travel) || loaded.travel.rideDebt === RIDE_CREDIT.max, `${String(bad)} is not a debt`)
  }
})
