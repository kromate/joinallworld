import assert from 'node:assert/strict'
import test from 'node:test'
import { createLife, viewLife } from '../../life.ts'
import { addressLabel, lgaOf, moveLevy } from '../content/world.ts'
import { cachedCityContent, cityRules, loadCityContent } from './registry.ts'
import { localUnitDescription } from './runtime.ts'
import { assertCityContentContract } from './cityContractTest.test.ts'
import { lagosCity } from './lagos/index.ts'

test('local-unit identity, addresses and prices work without loading city descriptions', () => {
  assert.equal(cachedCityContent('lagos'), null)
  assert.equal(lgaOf('lagos', 'ikeja')?.land, 500000)
  assert.match(addressLabel('lagos', 'ikeja', 0, 0), /Ikeja/)
  assert.ok(Number.isFinite(moveLevy('lagos', 'ikeja', 'mushin', 'starter')))
  assert.equal(cachedCityContent('lagos'), null)
  assert.equal(Object.hasOwn(lgaOf('lagos', 'ikeja') ?? {}, 'line'), false)
  assert.throws(() => localUnitDescription('lagos', 'ikeja'), /has not been loaded/)
})

test('estate views attach exactly the selected city descriptions after loading', async () => {
  for (const city of ['lagos', 'ibadan']) {
    const content = await loadCityContent(city)
    for (const unit of cityRules(city)?.units ?? []) {
      const state = createLife({ estate: { city, lga: unit.id, lgaConfirmed: true } }, { cityId: city })
      const view = viewLife(state).estate
      assert.equal(view.lga?.line, content.localUnitDescriptions[unit.id])
      assert.deepEqual(view.lgas.map(item => item.line), cityRules(city)?.units.map(item => content.localUnitDescriptions[item.id]))
      assert.equal(Object.hasOwn(unit, 'line'), false)
    }
  }
})

test('the city kit rejects missing local-unit prose', async () => {
  const content = await loadCityContent('lagos')
  const { ikeja: removed, ...remaining } = content.localUnitDescriptions
  assert.ok(removed)
  assert.throws(() => assertCityContentContract(lagosCity, { ...content, localUnitDescriptions: remaining }), /every local unit has city-owned prose/)
})
