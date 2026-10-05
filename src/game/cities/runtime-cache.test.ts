import assert from 'node:assert/strict'
import test from 'node:test'
import { cityModule, cachedCityContent, loadCityContent, registerCityForTest } from './registry.ts'
import { contentFor } from './runtime.ts'
import { fictionalCity, fictionalContent } from './testing/fictionalCity.test-fixture.ts'
import type { CityModule } from '../../types/content.ts'

test('an authored city replaces closed compatibility content and requires loading', async () => {
  assert.equal(cityModule('ibadan'), null)
  const legacy = contentFor('ibadan')
  assert.equal(legacy.venues.some(venue => venue.id === 'unilag'), false)
  const content = { ...fictionalContent, cityId: 'ibadan' }
  let loads = 0
  const module: CityModule = { ...fictionalCity, id: 'ibadan', rules: { ...fictionalCity.rules, id: 'ibadan' }, loadContent: async () => { loads += 1; return content } }
  const registration = registerCityForTest(module, { replaceClosed: true })
  try {
    assert.throws(() => contentFor('ibadan'), /has not been loaded/)
    const [first, second] = await Promise.all([loadCityContent('ibadan'), loadCityContent('ibadan')])
    assert.equal(loads, 1)
    assert.equal(first, second)
    assert.equal(contentFor('ibadan'), content)
  } finally { registration.dispose() }
  assert.equal(cachedCityContent('ibadan'), null)
  assert.equal(cityModule('ibadan'), null)
  assert.equal(contentFor('ibadan'), legacy)
})

test('a pending disposed loader cannot replace a newly registered catalogue', async () => {
  let release: (() => void) | undefined
  const pause = new Promise<void>(resolve => { release = resolve })
  const oldContent = { ...fictionalContent, cityId: 'test-cache' }
  const replacementContent = { ...oldContent, culture: { ...oldContent.culture, greeting: 'Replacement' } }
  const old: CityModule = { ...fictionalCity, id: 'test-cache', rules: { ...fictionalCity.rules, id: 'test-cache' }, loadContent: async () => { await pause; return oldContent } }
  const first = registerCityForTest(old)
  const pending = loadCityContent(old.id)
  first.dispose()
  const second = registerCityForTest({ ...old, loadContent: async () => replacementContent })
  try {
    await loadCityContent(old.id)
    assert.ok(release)
    release()
    await pending
    assert.equal(contentFor(old.id), replacementContent)
  } finally { release?.(); second.dispose() }
})
