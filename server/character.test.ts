import { loadCityContent as preloadCityContent } from '../src/game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan'].map(preloadCityContent));
import assert from 'node:assert/strict'
import test from 'node:test'
import { createLife, dispatch, advanceLife } from '../src/life.ts'
import { characterCity, normalizeCharacter, swapLegacyLife, fileCharacter } from './character.ts'
import { settleCity } from './life-service.ts'
import type { SessionRecord } from './types.ts'

const record = (): SessionRecord => ({ secret: 'test', publicId: 'test-public', name: 'Player', expiresAt: 1e15, cities: {}, actions: {} })
const held = (cityId: 'lagos' | 'ibadan', cash: number) => ({ state: createLife({ cash }, { cityId }), updatedAt: 1000, salt: 'a'.repeat(32) })

test('a second city read cannot create a second character', () => {
  const session = record()
  settleCity(session, 'lagos', 1000)
  assert.throws(() => settleCity(session, 'ibadan', 1000), { code: 'city_moved', city: 'lagos' })
  assert.deepEqual(Object.keys(session.cities), ['lagos'])
})

test('legacy normalization and repeated swaps retain each complete saved record', () => {
  const session = record(), lagos = held('lagos', 12000), ibadan = held('ibadan', 21000)
  session.cities = { lagos, ibadan }
  session.legacyLives = { 'ibadan:1': held('ibadan', 7) }
  normalizeCharacter(session)
  assert.equal(characterCity(session), 'lagos')
  assert.equal(session.legacyLives['ibadan:2'], ibadan)
  assert.equal(session.legacyLives['ibadan:1']?.state.cash, 7)
  swapLegacyLife(session, 'ibadan:2')
  assert.equal(session.cities.ibadan, ibadan)
  assert.equal(session.legacyLives['ibadan:2'], lagos)
  swapLegacyLife(session, 'ibadan:2')
  assert.equal(session.cities.lagos, lagos)
  assert.equal(session.legacyLives['ibadan:2'], ibadan)
})

test('arrival is filed synchronously and keeps a displaced record without timestamp collisions', () => {
  const session = record(), lagos = held('lagos', 15000), oldIbadan = held('ibadan', 9000)
  session.cities = { lagos, ibadan: oldIbadan }
  lagos.state.estate.city = 'ibadan'
  session.legacyLives = { 'ibadan:1': held('ibadan', 3) }
  fileCharacter(session, 'lagos', 1000)
  assert.equal(session.cities.ibadan, lagos)
  assert.equal(session.cities.lagos, undefined)
  assert.equal(session.legacyLives['ibadan:2'], oldIbadan)
  fileCharacter(session, 'lagos', 1000)
  assert.equal(Object.keys(session.legacyLives).length, 2)
})

test('a travelling character supplies its actual city to subsequent engine calls', () => {
  const state = createLife({ cash: 30000 }, { cityId: 'lagos' })
  state.estate.city = 'ibadan'
  const viewed = createLife(state, { cityId: 'lagos' })
  assert.equal(viewed.estate.city, 'ibadan')
  assert.equal(viewed.cash, state.cash)
  assert.deepEqual(viewed.needs, state.needs)
})
