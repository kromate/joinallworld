import assert from 'node:assert/strict'
import test from 'node:test'
import { stateOverviewHtml } from './state-overview.ts'
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
