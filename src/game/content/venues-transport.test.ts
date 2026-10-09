import assert from 'node:assert/strict'
import test from 'node:test'
import type { CityModule } from '../../types/content.ts'
import { registerCityForTest } from '../cities/registry.ts'
import { fictionalCity } from '../cities/testing/fictionalCity.test-fixture.ts'
import { AIRPORT } from './venues-transport.ts'

test('airport desk reads routes registered after the venue was imported and removes disposed routes', () => {
  const desk = AIRPORT.spots.desk
  assert.ok(desk)
  const before = desk.caption
  const name = 'Late flight destination'
  assert.ok(!before?.includes(name))
  const module: CityModule = {
    ...fictionalCity,
    rules: {
      ...fictionalCity.rules,
      name,
      links: [{ a: 'lagos', b: fictionalCity.id, mode: 'air', label: 'Test flight', icon: 'plane', fare: 2100, seconds: 10, km: 180, beta: true }],
    },
  }
  const registration = registerCityForTest(module)
  try {
    const [available = '', waiting = ''] = (desk.caption ?? '').split('Coming soon:')
    assert.ok(available.includes(name))
    assert.ok(!waiting.includes(name))
    assert.match(available, /country map/)
    assert.equal(desk.activities.length, 2, 'the desk remains informational')
    assert.ok(desk.activities.every(activity => !activity.reward && !activity.cost))
  } finally {
    registration.dispose()
  }
  assert.equal(desk.caption, before)
})
