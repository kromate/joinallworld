import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { weatherAt } from '../systems/health.ts'
import { HEALTH } from '../content/health.ts'
import { registerCityForTest } from './registry.ts'
import { fictionalCity } from './testing/fictionalCity.test-fixture.ts'
import { assertCityRulesContract } from './cityContractTest.test.ts'
import type { CityClimate } from '../../types/content.ts'

const blockMs = HEALTH.weather.blockMinutes * 60000
const climate: CityClimate = {
  beta: true,
  rainChanceByMonth: [0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0],
  clearLabel: 'Hot and dry',
  harmattan: { months: [12, 1, 2], label: 'Harmattan haze' },
}

test('Lagos weather retains all 864 pre-climate outputs across twelve months', () => {
  const values = Array.from({ length: 12 }, (_, month) => Array.from({ length: 72 }, (_, block) => weatherAt(Date.UTC(2026, month, 15) + block * blockMs, 'lagos'))).flat()
  assert.equal(createHash('sha256').update(JSON.stringify(values)).digest('hex'), '7087d6a932d2f52b4dac97c126b9e7829f70e99beea74ea52830a7b9897fdc54')
})

test('city climate is deterministic by block and WAT month without changing weather shape', () => {
  const registration = registerCityForTest({ ...fictionalCity, rules: { ...fictionalCity.rules, climate } })
  try {
    const dry = weatherAt(Date.UTC(2026, 2, 15), fictionalCity.id)
    const harmattan = weatherAt(Date.UTC(2026, 0, 15), fictionalCity.id)
    const rain = weatherAt(Date.UTC(2026, 6, 15), fictionalCity.id)
    assert.deepEqual(dry, { ...HEALTH.weather.kinds.clear, label: 'Hot and dry', raining: false, until: Date.UTC(2026, 2, 15) + blockMs })
    assert.deepEqual(harmattan, { ...HEALTH.weather.kinds.clear, label: 'Harmattan haze', raining: false, until: Date.UTC(2026, 0, 15) + blockMs })
    assert.equal(rain.raining, true)
    assert.doesNotMatch(rain.text, /okada/)
    assert.deepEqual(Object.keys(rain).sort(), Object.keys(dry).sort(), 'no new health effects or weather state')
    const boundary = Date.UTC(2026, 4, 31, 23)
    assert.equal(weatherAt(boundary - 1, fictionalCity.id).raining, false, 'May in WAT')
    assert.equal(weatherAt(boundary, fictionalCity.id).raining, true, 'June in WAT')
    assert.deepEqual(weatherAt(boundary, fictionalCity.id), weatherAt(boundary + blockMs - 1, fictionalCity.id))
  } finally { registration.dispose() }
})

test('city test kit rejects invalid climate month tables and harmattan metadata', () => {
  for (const broken of [
    { ...climate, rainChanceByMonth: [0] },
    { ...climate, rainChanceByMonth: climate.rainChanceByMonth.map(() => 1.1) },
    { ...climate, clearLabel: ' ' },
    { ...climate, harmattan: { months: [0, 13], label: 'Haze' } },
    { ...climate, harmattan: { months: [1, 1], label: 'Haze' } },
  ]) {
    // Malformed external authoring input intentionally crosses the contract-test boundary.
    const module = { ...fictionalCity, rules: { ...fictionalCity.rules, climate: broken } }
    assert.throws(() => assertCityRulesContract(module as typeof fictionalCity))
  }
})
