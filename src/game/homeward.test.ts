import assert from 'node:assert/strict'
import test from 'node:test'
import { createLife, dispatch, advanceLife, viewLife } from '../life.ts'
import { loadCityContent, playableCityIds, linksFrom, isOpenCityId, cityRules } from './cities/registry.ts'
import { planHomewardRoute } from './cities/homewardRoute.ts'
import { DEFAULT_LOOK, DREAM_TARGETS } from './content/traits.ts'
import { dreamProgress } from './systems/goals.ts'
import { lagosTime } from './clock.ts'
import type { LifeState } from '../types/life.ts'

await Promise.all(playableCityIds().map(loadCityContent))

function visitor(from = 'nairobi', home = 'maiduguri') {
  let now = Date.UTC(2026, 0, 6, 9)
  let state = createLife({ name: 'Homeward fixture' }, { now, cityId: home, isNew: true, quickStart: true, seed: 'homeward' })
  const context = () => ({ now, cityId: state.estate.city, seed: 'homeward' })
  const run = (type: string, payload: object = {}, internal = false) => dispatch(state, { type, payload } as never, { ...context(), internal })
  const wait = (seconds: number) => { now += seconds * 1000; advanceLife(state, seconds, context()) }
  const fund = (target: number) => {
    const difference = target - state.cash
    if (difference) {
      const result = run('wallet.admin', { op: difference > 0 ? 'credit' : 'debit', amount: Math.abs(difference), reason: 'Homeward fixture' }, true)
      assert.equal(result.code, difference > 0 ? 'credited' : 'debited')
      assert.equal(state.ledger.at(-1)?.amount, difference)
    }
    assert.equal(state.cash, target)
  }
  assert.equal(run('onboarding.quick-start', { look: DEFAULT_LOOK }).ok, true)
  run('onboarding.traits', { traits: ['clean-pikin', 'musical'] })
  run('onboarding.dream', { dream: 'afrobeats-star' })
  run('onboarding.lottery')
  assert.equal(run('onboarding.home', { lga: cityRules(home)?.units[0]?.id, via: 'manual' }).code, 'life_started')
  const original = structuredClone({ home: state.home, property: state.property, inventory: state.inventory, estateHome: state.estate.home })
  const outward = planHomewardRoute(home, from, linksFrom, isOpenCityId)
  assert.ok(outward)
  for (const leg of outward.legs) {
    fund(Math.max(state.cash, leg.fare))
    assert.equal(run('estate.relocate', { to: leg.to, mode: leg.mode }).code, 'departed')
    wait(leg.seconds + 1)
  }
  assert.equal(state.estate.city, from)
  fund(0)
  return { get state() { return state }, run, wait, fund, original, context, view: () => viewLife(state, context()),
    restart: (trustedSave = true) => { state = createLife(state, { ...context(), trustedSave }) } }
}

test('a cashless foreign visitor books every actual connection and resumes to the original non-airport home', () => {
  for (const from of ['yaounde', 'lome', 'accra', 'nairobi', 'algiers']) {
    const life = visitor(from)
    const quote = life.view().estate.ride.journey
    assert.ok(quote)
    const money: number[] = []
    const result = dispatch(life.state, { type: 'homeward.accept', payload: { quote: quote.key } }, { ...life.context(), money: effect => money.push(effect.amount) })
    assert.equal(result.code, 'departed')
    assert.equal(life.state.cash, 0)
    assert.equal(life.state.travel.rideDebt, quote.totalFare)
    assert.deepEqual(money, [quote.totalFare, -quote.totalFare])
    assert.equal(life.state.activeAction?.kind, 'homeward')
    assert.equal(life.run('cancel').code, 'no_cancel')
    assert.equal(life.run('travel.skip', { quote: 0 }).ok, false)
    assert.equal(life.run('homeward.accept', { quote: quote.key }).code, 'busy')
    for (const [index, leg] of quote.legs.entries()) {
      life.restart()
      life.wait(leg.seconds)
      if (index + 1 < quote.legs.length) {
        assert.equal(life.state.estate.city, from, 'connections do not become playable stops')
        assert.equal(life.state.activeAction?.kind === 'homeward' ? life.state.activeAction.legIndex : -1, index + 1)
      }
    }
    assert.equal(life.state.activeAction, null)
    assert.equal(life.state.estate.city, 'maiduguri')
    assert.equal(life.state.location, 'home')
    assert.equal(life.state.cash, 0)
    assert.equal(life.state.travel.rideDebt, quote.totalFare)
    assert.deepEqual({ home: life.state.home, property: life.state.property, inventory: life.state.inventory, estateHome: life.state.estate.home }, life.original)
    const ledger = structuredClone(life.state.ledger)
    life.restart(); life.wait(1)
    assert.deepEqual(life.state.ledger, ledger, 'completion does not repeat loan or ticket money')
  }
})

test('missing and changed quotes refuse without money, debt or a journey', () => {
  const life = visitor()
  const quote = life.view().estate.ride.journey
  assert.ok(quote)
  const ledger = structuredClone(life.state.ledger)
  for (const payload of [{}, { quote: null }, { quote: quote.key + 'changed' }, { quote: 'x'.repeat(1025) }]) {
    assert.equal(life.run('homeward.accept', payload).code, 'quote_changed')
    assert.equal(life.state.cash, 0)
    assert.equal(life.state.travel.rideDebt ?? 0, 0)
    assert.equal(life.state.activeAction, null)
    assert.deepEqual(life.state.ledger, ledger)
  }
})

test('canonical repayment during travel preserves the issued ticket through reconstruction', () => {
  const life = visitor()
  const quote = life.view().estate.ride.journey
  assert.ok(quote)
  assert.equal(life.run('homeward.accept', { quote: quote.key }).code, 'departed')
  assert.equal(life.run('social.server', { op: 'transfer-in', from: '11111111-2222-3333-4444-555555555555', amount: 1000, name: 'Fixture friend' }, true).ok, true)
  const debt = life.state.travel.rideDebt
  assert.equal(debt, quote.totalFare - 500)
  life.restart()
  assert.equal(life.state.activeAction?.kind, 'homeward')
  life.wait(quote.totalSeconds)
  assert.equal(life.state.estate.city, 'maiduguri')
  assert.equal(life.state.travel.rideDebt, debt)
})

test('a ride advance is borrowed money and does not complete an earnings wish', () => {
  const life = visitor('port-harcourt', 'lagos')
  life.state.goals.wishes = [{ id: 'earn-15k', n: 0, day: lagosTime(life.state.t).day }]
  const earned = life.state.civic.week.earned
  const quote = life.view().estate.ride.journey
  assert.ok(quote)
  assert.equal(life.run('homeward.accept', { quote: quote.key }).code, 'departed')
  assert.equal(life.state.goals.wishes.find(wish => wish.id === 'earn-15k')?.n, 0)
  assert.equal(life.state.civic.week.earned, earned, 'borrowing is not civic weekly earnings')
  assert.equal(life.run('social.server', { op: 'transfer-in', from: '11111111-2222-3333-4444-555555555555', amount: 1000, name: 'Fixture friend' }, true).ok, true)
  assert.equal(life.state.goals.wishes.find(wish => wish.id === 'earn-15k')?.n, 1000, 'ordinary gift earnings still count')
  assert.equal(life.state.travel.rideDebt, quote.totalFare - 500)
  assert.equal(life.state.civic.week.earned, earned + 1000, 'ordinary gift earnings still count for the civic week')
})

test('corrupt trusted ticket timing or contents rejects reconstruction without mutating the saved object', () => {
  const life = visitor()
  const quote = life.view().estate.ride.journey
  assert.ok(quote)
  assert.equal(life.run('homeward.accept', { quote: quote.key }).code, 'departed')
  for (const damage of [(state: LifeState) => { if (state.activeAction) state.activeAction.remaining = -1 }, (state: LifeState) => { if (state.activeAction?.kind === 'homeward') state.activeAction.ticket.key = 'corrupt' }]) {
    const saved = structuredClone(life.state)
    damage(saved)
    const bytes = JSON.stringify(saved)
    assert.throws(() => createLife(saved, { ...life.context(), trustedSave: true }), /trusted homeward ticket/i)
    assert.equal(JSON.stringify(saved), bytes)
    const untrusted = createLife(saved, { ...life.context(), trustedSave: false })
    assert.equal(untrusted.activeAction, null)
    assert.equal(untrusted.cash, saved.cash)
    assert.equal(untrusted.travel.rideDebt, saved.travel.rideDebt)
  }
})

test('repaying the full loan in transit cannot replace or move the original home', () => {
  const life = visitor()
  const quote = life.view().estate.ride.journey
  assert.ok(quote)
  assert.equal(life.run('homeward.accept', { quote: quote.key }).code, 'departed')
  assert.equal(life.run('social.server', { op: 'transfer-in', from: '11111111-2222-3333-4444-555555555555', amount: 2 * quote.totalFare, name: 'Fixture friend' }, true).ok, true)
  assert.equal(life.state.travel.rideDebt ?? 0, 0)
  const estate = structuredClone(life.state.estate)
  const ticket = structuredClone(life.state.activeAction)
  const cash = life.state.cash, ledger = structuredClone(life.state.ledger)
  for (const home of ['main', 'buy']) {
    assert.equal(life.run('estate.set-lga', { lga: cityRules('nairobi')?.units[0]?.id, home }).code, 'busy')
  }
  assert.equal(life.run('estate.make-home').code, 'busy')
  assert.deepEqual(life.state.estate, estate)
  assert.deepEqual(life.state.activeAction, ticket)
  assert.deepEqual(life.state.ledger, ledger)
  assert.equal(life.state.cash, cash)
  life.restart(); life.wait(quote.totalSeconds)
  assert.equal(life.state.estate.city, 'maiduguri')
  assert.equal(life.state.estate.home, life.original.estateHome)
  assert.deepEqual(life.state.home, life.original.home)
})

test('the temporary loan advance cannot complete a wealth dream or award cash', () => {
  const life = visitor('port-harcourt', 'lagos')
  const quote = life.view().estate.ride.journey
  assert.ok(quote)
  // Controlled goal-only boundary condition, not a funded balance or ownership fixture.
  life.state.goals.dream = 'lekki-landlord'
  life.state.goals.dreamDone = false
  life.state.goals.stats.assets = DREAM_TARGETS.netWorth - 1
  assert.equal(life.state.goals.stats.debt, 0)
  assert.ok(dreamProgress(life.state) < 1)
  assert.ok(life.state.goals.stats.assets + quote.totalFare >= DREAM_TARGETS.netWorth)
  const stars = life.state.goals.stars, ledger = life.state.ledger.length
  assert.equal(life.run('homeward.accept', { quote: quote.key }).code, 'departed')
  assert.equal(life.state.goals.dreamDone, false)
  assert.equal(life.state.goals.stars, stars)
  assert.equal(life.state.cash, 0)
  assert.equal(life.state.ledger.length, ledger + 2)
  assert.deepEqual(life.state.ledger.slice(-2).map(line => [line.amount, line.balance, line.reason]), [[quote.totalFare, quote.totalFare, 'Ride home on credit: full route advance'], [-quote.totalFare, 0, 'Ride home on credit: ticket purchase']])
})

test('a pending legitimate starter reward is evaluated after the loan ticket debit', () => {
  const life = visitor('port-harcourt', 'lagos')
  const quote = life.view().estate.ride.journey
  assert.ok(quote)
  life.state.goals.dream = 'lekki-landlord'
  life.state.goals.dreamDone = false
  life.state.goals.stats.assets = DREAM_TARGETS.netWorth - 10000
  life.state.goals.started = true
  life.state.goals.chain = 0
  life.state.goals.seen = ['first-fun']
  const stars = life.state.goals.stars
  assert.equal(life.run('homeward.accept', { quote: quote.key }).code, 'departed')
  assert.equal(life.state.goals.dreamDone, false)
  assert.equal(life.state.goals.stars, stars + 1)
  assert.equal(life.state.cash, 500, 'only the ordinary completed goal pays cash')
  assert.equal(life.state.ledger.at(-1)?.reason, 'Goal: Play ayo in the park')
  assert.equal(life.state.ledger.some(line => line.reason.startsWith('Dream achieved:')), false)
})
