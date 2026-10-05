// The travel card of the atlas: the ways to a city as one button each, cheapest first, with the price and the seconds.
import assert from 'node:assert/strict'
import test from 'node:test'
import { regionInfo } from './info.ts'
import { TRAVEL_CONFIRM_SHARE, needsConfirm, travelWays } from './travel-card.ts'

const mine = (to: string, blocked: Record<string, string | null> = {}) => ['road', 'rail', 'air'].map((mode) => ({ to, mode, blocked: blocked[mode] ?? null, skipFree: true }))
const routesTo = (state: string, city: string, blocked: Record<string, string | null> = {}) => regionInfo({ kind: 'state', id: state }, { cityId: city, feature: { name: state }, current: 'lagos', routes: mine(city, blocked) }).routes

test('the ways to Abuja from Lagos: cheapest first, each with its price and its seconds, one tap to leave', () => {
  const card = travelWays(routesTo('fct', 'abuja'), { cash: 200_000 })
  assert.equal(card.shared, null)
  assert.deepEqual(card.ways.map((way) => [way.name, way.fare, way.seconds, way.state, way.why]), [['Bus', 14000, 59, 'go', ''], ['Flight', 65000, 16, 'go', '']])
  assert.deepEqual(card.ways.map((way) => `${way.to}:${way.mode}`), ['abuja:road', 'abuja:air'], 'each button carries the action it sends')
  // Ibadan has a train too, and Kano a railway that is still coming: it is listed as coming and can never be pressed.
  assert.deepEqual(travelWays(routesTo('oyo', 'ibadan'), { cash: 200_000 }).ways.map((way) => [way.name, way.fare, way.seconds, way.state]), [['Bus', 3500, 30, 'go'], ['Train', 9000, 21, 'go']])
  assert.deepEqual(travelWays(routesTo('kano', 'kano'), { cash: 200_000 }).ways.map((way) => [way.name, way.state, way.why]), [['Bus', 'go', ''], ['Flight', 'go', ''], ['Train', 'coming', 'Coming soon']])
})

test('a fare the player cannot pay is off with the amount missing; one above half the cash asks once, in place', () => {
  const short = travelWays(routesTo('fct', 'abuja'), { cash: 24_000 })
  assert.deepEqual(short.ways.map((way) => [way.name, way.state, way.short, way.why]), [['Bus', 'go', 0, ''], ['Flight', 'off', 41000, 'You need ₦41,000 more.']])
  assert.equal(TRAVEL_CONFIRM_SHARE, 0.5)
  assert.deepEqual([needsConfirm(14000, 24_000), needsConfirm(14000, 28_000), needsConfirm(14000, 28_001), needsConfirm(65000, null)], [true, false, false, false], 'more than half asks; exactly half or less, or an unknown wallet, does not')
  const asking = travelWays(routesTo('fct', 'abuja'), { cash: 96_000, confirming: 'lagos:abuja:air' })
  assert.deepEqual(asking.ways.map((way) => [way.name, way.state]), [['Bus', 'go'], ['Flight', 'ask']])
  // A way that cannot be afforded is never asked about, whatever the card was told.
  assert.equal(travelWays(routesTo('fct', 'abuja'), { cash: 1000, confirming: 'lagos:abuja:air' }).ways[1]?.state, 'off')
})

test('what stops every way alike is said once above them; what stops one is said under it', () => {
  const busy = 'You are on the way to Ibadan. Arrive first.'
  const all = travelWays(routesTo('fct', 'abuja', { road: busy, air: busy }), { cash: 200_000 })
  assert.equal(all.shared, busy)
  assert.deepEqual(all.ways.map((way) => [way.state, way.why]), [['off', ''], ['off', '']])
  const guest = 'Settle in first (tap the "Settle in" goal): then you can travel between cities.'
  assert.equal(travelWays(routesTo('oyo', 'ibadan', { road: guest, rail: guest }), { cash: 5000 }).shared, guest)
  const one = travelWays(routesTo('fct', 'abuja', { air: 'The airport is closed tonight.' }), { cash: 200_000 })
  assert.deepEqual([one.shared, one.ways.map((way) => [way.state, way.why])], [null, [['go', ''], ['off', 'The airport is closed tonight.']]])
  // The server's own "costs …; you have …" is one way's reason, never everyone's.
  const poor = travelWays(routesTo('oyo', 'ibadan', { road: 'Bus costs ₦3,500; you have ₦100.', rail: 'Bus costs ₦3,500; you have ₦100.' }), { cash: 100 })
  assert.deepEqual([poor.shared, poor.ways.map((way) => way.why)], [null, ['You need ₦3,400 more.', 'You need ₦8,900 more.']])
  assert.deepEqual(travelWays([], { cash: 1 }), { shared: null, ways: [] })
})

test('the card never shows more than three buttons, and never two of one mode', () => {
  const road = routesTo('fct', 'abuja')[0]!, extra = [road, { ...road, id: 'lagos:abuja:road:2', fare: road.fare - 1 }, ...routesTo('kano', 'kano')]
  const ways = travelWays(extra, { cash: 500_000 }).ways
  assert.ok(ways.length <= 3)
  assert.equal(new Set(ways.map((way) => way.mode)).size, ways.length)
})
