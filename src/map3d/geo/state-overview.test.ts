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
