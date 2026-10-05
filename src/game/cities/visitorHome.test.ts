import assert from 'node:assert/strict'
import test from 'node:test'
import { createLife, viewLife } from '../../life.ts'
import { loadCityContent } from './registry.ts'
import { hasPlace } from '../systems/estate.ts'

await Promise.all([loadCityContent('lagos'), loadCityContent('ibadan')])

test('a visitor has no Home place in the city until a local government is chosen', () => {
  const life = createLife({}, { cityId: 'ibadan' })
  life.location = 'dugbe-amala'
  assert.equal(hasPlace(life), false)
  assert.ok(!viewLife(life).travel.destinations.some((place) => place.id === 'home'), 'no Home row for a visitor')
  assert.equal(viewLife(life).estate.placed, false)
  const settled = structuredClone(life)
  settled.estate.lga = 'akinyele'
  settled.estate.lgaConfirmed = true
  assert.equal(hasPlace(settled), true)
  assert.ok(viewLife(settled).travel.destinations.some((place) => place.id === 'home'), 'a home appears once the choice is made')
})
