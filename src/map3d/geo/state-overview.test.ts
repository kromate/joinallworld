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
