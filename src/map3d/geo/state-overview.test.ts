import assert from 'node:assert/strict'
import test from 'node:test'
import { stateOverviewHtml, stateOverviewToggleHtml } from './state-overview.ts'
import type { CityStateOverview } from '../../types/content.ts'

const overview: CityStateOverview = {
  stateId: 'test-state', name: 'Test State',
  outline: [[[[3, 7], [3.2, 7], [3.2, 7.1], [3, 7.1], [3, 7]]]],
  localUnits: [
    { id: 'open-unit', name: 'Open Unit', polygons: [[[[3, 7], [3.1, 7], [3.1, 7.1], [3, 7.1], [3, 7]]]] },
    { id: 'coming-unit', name: 'Coming Unit', polygons: [[[[3.1, 7], [3.2, 7], [3.2, 7.1], [3.1, 7.1], [3.1, 7]]]] },
  ],
  neighbours: [], landmarks: [{ id: 'test-point', name: 'Museum & gardens', lon: 3.15, lat: 7.05 }],
}

test('a state overview shows unopened units and only offers inspection of their owning city', () => {
  const html = stateOverviewHtml(overview, [{ id: 'test-city', name: 'Test City', units: [{ id: 'open-unit' }] }], 'test-city')
  assert.match(html, /2 local governments · 1 in open cities · 1 coming/)
  assert.match(html, /data-atlas-inspect-city="test-city"/)
  assert.match(html, /Coming Unit <small>Coming soon<\/small>/)
  assert.doesNotMatch(html, /data-atlas-travel|data-atlas-action/)
  assert.match(html, /Museum &amp; gardens <small>Coming soon<\/small>/)
})

test('the overview uses the common north-up frame and rejects empty geometry', () => {
  const html = stateOverviewHtml(overview, [], null)
  assert.match(html, /viewBox="-/)
  assert.doesNotMatch(html, /NaN|Infinity/)
  assert.throws(() => stateOverviewHtml({ ...overview, outline: [] }, [], null), /needs an outline/)
})

test('the state view pins each open city, draws the travel links in the shared frame and follows the player’s city', () => {
  const cities = [
    { id: 'north', name: 'North City', units: [{ id: 'open-unit' }], at: { lon: 3.05, lat: 7.05 } },
    { id: 'south', name: 'South City', units: [], at: { lon: 3.15, lat: 7.0 } },
  ]
  const extras = {
    current: 'south',
    outside: [{ id: 'far', name: 'Far Port', lon: 3.1, lat: 6.9 }],
    links: [
      { id: 'north:south:road', a: 'north', b: 'south', mode: 'road', label: 'Bus on the old road', fare: 2500, minutes: 1.5, km: 70 },
      { id: 'north:south:rail', a: 'north', b: 'south', mode: 'rail', label: 'Train', fare: 4000, minutes: 0.8, km: 70 },
      { id: 'far:south:road', a: 'far', b: 'south', mode: 'road', label: 'Bus from the port', fare: 2000, minutes: 1, km: 40 },
      { id: 'gone:south:road', a: 'gone', b: 'south', mode: 'road', label: 'Not drawn: no such end', fare: 1, minutes: 1, km: 1 },
    ],
  }
  const html = stateOverviewHtml(overview, cities, 'north', {}, extras)
  assert.equal((html.match(/class="atlas-state-pin/g) ?? []).length, 2, 'one pin per open city')
  assert.match(html, /data-atlas-inspect-city="north"[^>]*aria-pressed="true"/)
  assert.match(html, /aria-label="South City, you are here"/, 'the note follows the city the player is in')
  assert.equal((html.match(/<small>You are here<\/small>/g) ?? []).length, 1, 'one note on the map: the player’s city')
  assert.doesNotMatch(html, /aria-label="North City, you are here"/)
  assert.equal((html.match(/class="atlas-state-link /g) ?? []).length, 3, 'links whose two ends are on the map are drawn; the rest are not')
  assert.match(html, /is-rail/)
  assert.match(html, /class="atlas-state-ext[^"]*"[^>]*><i aria-hidden="true"><\/i><span>Far Port<\/span>/, 'a place outside the state is named at the end of its line')
  assert.match(html, /Travel from North City/)
  assert.match(html, /Bus · ₦2,500 · about 1\.5 min · 70 km/, 'fares and times are said for the chosen city')
  assert.doesNotMatch(html, /Far Port<\/b>/, 'a place outside the state is not a pin')
  // A line in focus says its own fare and time.
  const focused = stateOverviewHtml(overview, cities, 'north', {}, { ...extras, link: 'north:south:rail' })
  assert.match(focused, /North City ⇄ South City/)
  assert.match(focused, /Train · ₦4,000 · about 0\.8 min · 70 km/)
  assert.doesNotMatch(html + focused, /NaN|Infinity|undefined/)
  // The stage keeps the drawing's own proportions, so a pin's place is a share of it.
  assert.match(html, /style="aspect-ratio:[\d.]+ \/ [\d.]+"/)
  assert.match(html, /style="left:[\d.]+%;top:[\d.]+%"/)
})

test('four cities a few kilometres apart each get a name of their own, set further out with a leader when the near sides are taken', () => {
  const cities = [
    { id: 'a', name: 'Abeokuta', units: [], at: { lon: 3.1, lat: 7.05 } },
    { id: 'b', name: 'Ota', units: [], at: { lon: 3.101, lat: 7.049 } },
    { id: 'c', name: 'Ijebu-Ode', units: [], at: { lon: 3.102, lat: 7.051 } },
    { id: 'd', name: 'Sagamu', units: [], at: { lon: 3.1015, lat: 7.0495 } },
  ]
  const html = stateOverviewHtml(overview, cities, null, {}, { current: 'a' })
  const sides = [...html.matchAll(/class="atlas-state-pin[^"]*? at-([a-z-]+)"/g)].map((match) => match[1])
  assert.equal(sides.length, 4)
  assert.equal(new Set(sides).size, 4, `no two names share a side: ${sides.join(', ')}`)
  assert.ok(sides.some((side) => side?.startsWith('far-')), 'the crowded ones are set further out')
})

test('a state overview can show explicit water without changing the unit choices', () => {
  const html = stateOverviewHtml({ ...overview, water: overview.localUnits[1]!.polygons }, [], null)
  assert.match(html, /fill="#7cb9cd" fill-rule="evenodd" pointer-events="none"/)
  assert.match(html, /2 local governments · 0 in open cities · 2 coming/)
})

test('an explicit context qualification overrides a conflicting polygon membership', () => {
  const html = stateOverviewHtml({ ...overview, landmarks: [{ id: 'context', name: 'Context rock', lon: 3.05, lat: 7.05, context: 'Neighbouring jurisdiction · context only' }] }, [{ id: 'test-city', name: 'Test City', units: [{ id: 'open-unit' }] }], 'test-city')
  assert.match(html, /Context rock <small>Neighbouring jurisdiction · context only<\/small>/)
  assert.doesNotMatch(html, /Context rock <small>Test City/)
})


test('the atlas overview button uses the selected city unit while preserving Lagos wording', () => {
  assert.match(stateOverviewToggleHtml('fct', 'abuja', false), /View all area councils/)
  assert.doesNotMatch(stateOverviewToggleHtml('fct', 'abuja', false), /local governments/)
  assert.match(stateOverviewToggleHtml('lagos', 'lagos', false), /View all local governments/)
  assert.match(stateOverviewToggleHtml('fct', 'abuja', true), /aria-expanded="true">Hide state overview/)
})

test('a remote landmark can inspect a local outing departure without offering a teleport or starting an activity', () => {
  const withDeparture: CityStateOverview = { ...overview, landmarks: [{ id: 'lake', name: 'Lake reference', lon: 3.15, lat: 7.05, context: 'Outside the playable city', departure: { cityId: 'kano', venueId: 'railway-station', label: 'See simulated outing departure' } }] }
  const local = stateOverviewHtml(withDeparture, [], 'kano', { landmarks: true }, { current: 'kano' })
  assert.match(local, /data-atlas-departure="lake">See simulated outing departure/)
  assert.doesNotMatch(local, /data-atlas-travel|data-atlas-action|data-activity/)
  const elsewhere = stateOverviewHtml(withDeparture, [], 'kano', { landmarks: true }, { current: 'lagos' })
  assert.doesNotMatch(elsewhere, /data-atlas-departure/)
  assert.match(elsewhere, /Departs from Kano/)
})
