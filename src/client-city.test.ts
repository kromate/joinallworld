import assert from 'node:assert/strict'
import test from 'node:test'
import { createClient } from './client.ts'
import { createLife } from './life.ts'
import { cachedCityContent, loadCityContent, registerCityForTest } from './game/cities/registry.ts'
import { fictionalCity } from './game/cities/testing/fictionalCity.test-fixture.ts'

const now = Date.UTC(2026, 9, 5, 9)
const session = { id: '00000000-0000-4000-8000-000000000001', name: 'Tester', cities: ['lagos'] }
const response = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

test('a stale-city action loads the authoritative city without replaying the mutation', async () => {
  let setup = registerCityForTest(fictionalCity)
  await loadCityContent(fictionalCity.id)
  const destination = createLife({ cash: 9876, name: 'Tester' }, { now, cityId: fictionalCity.id })
  setup.dispose()
  setup = registerCityForTest(fictionalCity)
  let actions = 0
  const client = createClient({
    now: () => now, storage: { getItem: () => null, setItem: () => {} },
    setTimeout: () => 0, clearTimeout: () => {},
    fetch: async (path) => {
      if (path === '/api/session') return response({ session, serverTime: now })
      if (path === '/api/life?city=lagos') return response({ state: createLife({ name: 'Tester' }, { now, cityId: 'lagos' }), serverTime: now })
      if (path === '/api/action') { actions += 1; return response({ error: 'city_moved', city: fictionalCity.id, reason: 'Your character is elsewhere.', serverTime: now }, 409) }
      if (path === `/api/life?city=${fictionalCity.id}`) return response({ state: destination, serverTime: now })
      throw new Error(`Unexpected request ${path}`)
    },
  })
  try {
    assert.equal(await client.connect(), true)
    assert.equal(cachedCityContent(fictionalCity.id), null)
    const result = await client.command('spot', { id: 'kitchen' })
    assert.equal(result.code, 'city_moved')
    assert.equal(result.ok, false)
    assert.equal(actions, 1)
    assert.equal(client.cityId, fictionalCity.id)
    assert.equal(client.state.estate.city, fictionalCity.id)
    assert.equal(client.state.cash, 9876)
    assert.ok(cachedCityContent(fictionalCity.id))
  } finally { client.stop(); setup.dispose() }
})
