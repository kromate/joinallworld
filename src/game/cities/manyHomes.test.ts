import assert from 'node:assert/strict'
import test from 'node:test'
import { createLife } from '../../life.ts'
import { lagosCity } from './lagos/index.ts'
import { cachedCityContent, loadCityContent, registerCityForTest } from './registry.ts'
import { loadLifeCities } from './lifeCities.ts'
import type { CityModule } from '../../types/content.ts'

await loadCityContent('lagos')

test('forty away homes and the main-home choice survive a rules-only reload', async () => {
  const ids = Array.from({ length: 40 }, (_, index) => `test-home-${index}`)
  const registrations = ids.map(id => registerCityForTest({
    id,
    rules: { ...lagosCity.rules, id, name: id, links: [] },
    loadContent: async () => { throw new Error('An away home must not need its city content') },
    loadMap: async () => { throw new Error('An away home must not need its map') },
  } satisfies CityModule))
  try {
    const now = Date.UTC(2026, 0, 5, 9)
    const saved = createLife({ cash: 123456, estate: { city: 'lagos', lga: 'ikeja', lgaConfirmed: true } }, { cityId: 'lagos', now })
    const { city, away, nudged, home, homeAt, ...residence } = saved.estate
    assert.equal(city, 'lagos')
    saved.estate.away = Object.fromEntries(ids.map(id => [id, { ...structuredClone(residence), house: lagosCity.rules.defaultRentedHome }]))
    saved.estate.home = ids.at(-1)!
    await loadLifeCities(saved)
    const restored = createLife(structuredClone(saved), { cityId: 'lagos', now, trustedSave: true })
    assert.equal(Object.keys(restored.estate.away).length, 40)
    assert.deepEqual(restored.estate.away, saved.estate.away)
    assert.equal(restored.estate.home, ids.at(-1), 'the selected main home is not replaced')
    assert.equal(restored.cash, saved.cash)
    assert.ok(ids.every(id => cachedCityContent(id) === null), 'only the current city content is loaded')
    assert.deepEqual(createLife(structuredClone(restored), { cityId: 'lagos', now, trustedSave: true }), restored)
  } finally { for (const registration of registrations) registration.dispose() }
})
