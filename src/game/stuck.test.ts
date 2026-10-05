// "A player is never stuck": a sampled search over reachable states (visitor or resident, each city, cash 0 to 20,000, every need low
// or fine, with and without a job, any hour of the week, mid-trip, away from the arrival place) for a way to recover, earn and get home.
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadCityContent, playableCityIds } from './cities/registry.ts'
import { publicArrivalVenue, venueFor } from './cities/runtime.ts'
import { START_SAMPLE, playOut, rng, sampleOf, stuck } from './stuckSearch.ts'

const CITIES = ['lagos', 'ibadan', 'abeokuta', 'ota', 'ijebu-ode', 'sagamu', 'port-harcourt', 'abuja', 'kano']
await Promise.all(CITIES.map(loadCityContent))

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
