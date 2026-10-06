// "A player is never stuck": a sampled search over reachable states (visitor or resident, each city, cash 0 to 20,000, every need low
// or fine, with and without a job, any hour of the week, mid-trip, away from the arrival place) for a way to recover, earn and get home.
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCityContent, playableCityIds } from './cities/registry.ts'
import { cityRules } from './cities/registry.ts'
import { publicArrivalVenue, venueFor } from './cities/runtime.ts'
import { START_SAMPLE, playOut, rng, sampleOf, stuck } from './stuckSearch.ts'

await Promise.all(playableCityIds().map(loadCityContent))

test('with the safety nets, no sampled state is a dead end: needs recover, money comes in, and a visitor gets home', () => {
  const next = rng(20261005)
  const cities = playableCityIds()
  let played = 0
  const failing = []
  for (let i = 0; i < 3000; i++) {
    const outcome = playOut(sampleOf(next, cities, ['lagos', 'port-harcourt', 'kano']), { nets: true })
    played++
    if (stuck(outcome)) failing.push(outcome)
  }
  assert.equal(played, 3000)
  assert.deepEqual(failing.slice(0, 3), [], `${failing.length} dead ends`)
})

test('each playable city gets its own bounded dead-end sample', () => {
  for (const city of playableCityIds()) {
    const next = rng(20261005 + city.length)
    const failing = []
    const otherHomes = playableCityIds().filter(id => id !== city)
    for (let i = 0; i < 80; i++) {
      const home = i % 2 === 0 ? city : otherHomes[i % otherHomes.length]!
      const sample = { ...sampleOf(next, [city], [home]), city }
      const outcome = playOut(sample, { nets: true })
      if (stuck(outcome)) failing.push(outcome)
    }
    assert.deepEqual(failing.slice(0, 3), [], `${city}: ${failing.length} dead ends in 80 samples`)
  }
})

test('the search is not vacuous: without the nets the same states include dead ends, and the owner\'s case is one', () => {
  const next = rng(20261005)
  const cities = playableCityIds()
  let dead = 0
  for (let i = 0; i < 150; i++) if (stuck(playOut(sampleOf(next, cities, ['lagos', 'port-harcourt', 'kano']), { nets: false }))) dead++
  assert.ok(dead > 10, `${dead} dead ends without the nets`)
  const owner = { home: 'lagos', city: 'port-harcourt', cash: 2800, hunger: 15, energy: 15, job: null, now: START_SAMPLE + 14 * 3600_000 }
  assert.equal(stuck(playOut(owner, { nets: false })), true, 'before: stuck')
  assert.equal(stuck(playOut(owner, { nets: true })), false, 'after: a way out')
})

test('every city has somewhere open at every hour for the nets: its arrival place is open all day and night', () => {
  for (const city of playableCityIds()) {
    const place = publicArrivalVenue(city)
    assert.equal(venueFor(city, place.id)?.hours, undefined, `${city}: ${place.id} has no closing hours`)
  }
})

test('a visitor who lands at an airport, a terminal or a station is never stuck there: the nets are one free walk away, at any hour', () => {
  const next = rng(20261006)
  let played = 0
  const failing = []
  for (const city of playableCityIds()) {
    const hubs = (cityRules(city)?.hubs ?? []).flatMap((hub) => (hub.venueId && venueFor(city, hub.venueId) ? [hub.venueId] : []))
    for (const venue of hubs) for (let i = 0; i < 40; i++) {
      const sample = { ...sampleOf(next, [city], ['lagos', 'port-harcourt', 'kano']), city, venue }
      delete sample.midTrip
      // A visitor (the home is not here) with little or no money and low needs: the case the nets are for.
      const visitor = { ...sample, home: sample.home === city ? (city === 'lagos' ? 'kano' : 'lagos') : sample.home, cash: [0, 50, 300, 1000][i % 4]!, hunger: [10, 19, 100][i % 3]!, energy: [10, 19, 100][(i + 1) % 3]! }
      played++
      const outcome = playOut(visitor, { nets: true })
      if (stuck(outcome)) failing.push(outcome)
    }
  }
  assert.ok(played > 100, `${played} states played`)
  assert.deepEqual(failing.slice(0, 3), [], `${failing.length} dead ends starting at a hub`)
})
