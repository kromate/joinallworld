import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture } from './test-fixture.ts'
import { fictionalCity } from '../src/game/cities/testing/fictionalCity.test-fixture.ts'
import { loadCityContent, registerCityForTest } from '../src/game/cities/registry.ts'
import type { LifeResponse, SessionResponse } from '../src/types/protocol.ts'

test('a first-visit invitation reaches a host at a city-defined venue', async t => {
  const registration = registerCityForTest(fictionalCity)
  t.after(() => registration.dispose())
  await loadCityContent(fictionalCity.id)
  const f = await fixture(t)
  const host = await f.device('City Host')
  const read = async (cookie: string): Promise<LifeResponse> => (await f.request(`/api/life?city=${fictionalCity.id}`, null, cookie)).json() as Promise<LifeResponse>
  await read(host.cookie)
  await f.request('/api/social/me', null, host.cookie)
  const socket = await f.socket(host)
  socket.ws.send(JSON.stringify({ type: 'join', cityId: fictionalCity.id, venueId: 'test-square' }))
  const frame = await socket.next()
  assert.equal(frame.type, 'presence')

  const response = await f.request('/api/session', { name: 'City Guest', onboarding: true })
  const guest = await response.json() as SessionResponse
  assert.ok(guest.session.id)
  const cookie = response.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie)
  await read(cookie)
  const look = { body: 'woman', hair: 'braids', outfit: 'casual', fabric: 'ankara', skin: 'skin-6', hairColor: 'soft-black', outfitColor: 'orange', bottomsColor: 'teal' }
  assert.equal((await f.action(cookie, { cityId: fictionalCity.id, type: 'onboarding.quick-start', payload: { look } })).code, 'playing')
  assert.equal((await f.action(cookie, { cityId: fictionalCity.id, type: 'travel', payload: { id: 'polling-unit', mode: 'trek' } })).code, 'started')
  f.advance(60000)
  const before = (await read(cookie)).state
  assert.equal(before.location, 'polling-unit')
  const joined: unknown = await (await f.request('/api/social/join', { host: host.id, cityId: fictionalCity.id }, cookie)).json()
  assert.ok(typeof joined === 'object' && joined !== null)
  assert.equal(Reflect.get(joined, 'code'), 'joined')
  const after = (await read(cookie)).state
  assert.equal(after.location, 'test-square')
  assert.equal(after.cash, before.cash)
  assert.equal(after.onboarding.joined, true)
})
