import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceLife, createLife, dispatch, viewLife } from '../../life.ts'
import { TRIP_SKIP, tripSkipFee } from '../content/travel.ts'
import { DEFAULT_LOOK } from '../content/traits.ts'
import { cityRules, linksFrom, loadCityContent } from './registry.ts'
import type { LifeContextInit, LifeState } from '../../types/life.ts'

await Promise.all(['lagos', 'port-harcourt', 'abuja', 'kano'].map(loadCityContent))

function settled(seed: string) {
  let now = Date.UTC(2026, 0, 5, 9)
  const context = (state?: LifeState): LifeContextInit => ({ cityId: state?.estate.city ?? 'lagos', now, seed })
  const state = createLife({ name: 'Skipper' }, { ...context(), isNew: true, quickStart: true })
  const run = (type: string, payload: object = {}) => dispatch(state, { type, payload } as never, context(state))
  const wait = (seconds: number): void => { now += seconds * 1000; advanceLife(state, seconds, context(state)) }
  run('onboarding.quick-start', { look: DEFAULT_LOOK })
  run('onboarding.traits', { traits: ['clean-pikin', 'musical'] })
  run('onboarding.dream', { dream: 'afrobeats-star' })
  run('onboarding.lottery', {})
  assert.equal(run('onboarding.home', { lga: cityRules('lagos')!.units[0]!.id, via: 'manual' }).code, 'life_started')
  state.cash = 1_000_000
  return { state, run, wait, offer: () => viewLife(state, context(state)).travel.skip }
}

test('a flight or a bus to Port Harcourt, Abuja or Kano can be skipped: the first for nothing, the next for ₦100 and ₦10 a second, never more than half the fare', () => {
  const life = settled('skip-states')
  assert.equal(life.run('estate.relocate', { to: 'kano', mode: 'air' }).code, 'departed')
  assert.deepEqual([life.offer()?.kind, life.offer()?.fee, life.offer()?.free], ['intercity', 0, true])
  assert.equal(life.run('travel.skip').code, 'skipped')
  assert.equal(life.state.estate.city, 'kano')
  for (const [to, mode] of [['abuja', 'road'], ['port-harcourt', 'air'], ['lagos', 'road'], ['abuja', 'air']] as const) {
    const link = linksFrom(life.state.estate.city).find((item) => item.to === to && item.mode === mode)
    assert.ok(link, `${life.state.estate.city} to ${to} by ${mode}`)
    assert.equal(life.run('estate.relocate', { to, mode }).code, 'departed')
    const fee = tripSkipFee('intercity', link.seconds, link.fare), before = life.state.cash
    assert.equal(fee, Math.min(Math.ceil((100 + 10 * link.seconds) / TRIP_SKIP.roundTo) * TRIP_SKIP.roundTo, Math.floor(link.fare * 0.5 / TRIP_SKIP.roundTo) * TRIP_SKIP.roundTo))
    assert.ok(fee <= link.fare / 2, `${to} by ${mode}: the price is at most half the fare`)
    assert.equal(life.offer()?.fee, fee)
    assert.equal(life.run('travel.skip', { quote: fee }).code, 'skipped')
    assert.deepEqual([life.state.estate.city, before - life.state.cash, life.state.activeAction], [to, fee, null])
  }
})

test('the boat between Port Harcourt’s landings follows the rule of every trip inside a city: skippable while more than twenty seconds are left', () => {
  const life = settled('skip-boat')
  life.run('estate.relocate', { to: 'port-harcourt', mode: 'road' }); life.run('travel.skip')
  assert.equal(life.state.estate.city, 'port-harcourt')
  life.run('travel', { id: 'bonny-jetty', mode: 'trek' }); life.wait(life.state.activeAction!.remaining + 1)
  assert.equal(life.state.location, 'bonny-jetty')
  assert.equal(life.run('travel', { id: 'okrika-jetty', mode: 'boat' }).ok, true)
  assert.deepEqual([life.state.activeAction?.kind, life.state.activeAction?.duration], ['travel', 40])
  assert.deepEqual([life.offer()?.kind, life.offer()?.fee, life.offer()?.blocked], ['travel', tripSkipFee('local', 40), null])
  life.wait(21)
  assert.equal(life.offer(), null, 'with twenty seconds or less left the boat is not sold a skip, like any local trip')
  assert.equal(life.run('travel.skip').code, 'too_short')
  life.wait(20)
  assert.equal(life.state.location, 'okrika-jetty')
  // And taken at once: the fare and the skip are each paid once, and the boat arrives.
  const before = life.state.cash
  assert.equal(life.run('travel', { id: 'bonny-jetty', mode: 'boat' }).ok, true)
  assert.equal(life.run('travel.skip').code, 'skipped')
  assert.deepEqual([life.state.location, before - life.state.cash], ['bonny-jetty', 800 + tripSkipFee('local', 40)])
})

test('a link that is still coming cannot be started, so there is nothing to skip', () => {
  const life = settled('skip-coming')
  assert.equal(life.run('estate.relocate', { to: 'kano', mode: 'rail' }).code, 'route_not_open')
  assert.equal(life.offer(), null)
  assert.equal(life.run('travel.skip').code, 'not_travelling')
})
