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

// A bare `{v:1, city}` is the start-up pin of an earlier build: fixed at one moment, never updated.
const withLegacyPin = (lagosAt: number, ibadanAt: number, pin = 'ibadan'): SessionRecord => {
  const session = record(), lagos = held('lagos', 76000), ibadan = held('ibadan', 300)
  lagos.updatedAt = lagosAt; ibadan.updatedAt = ibadanAt
  session.cities = { lagos, ibadan }
  session.character = { v: 1, city: pin }
  return session
}

test('a stale legacy pin: the newest life is the character, the other goes to older characters, nothing is lost', () => {
  const session = withLegacyPin(5000, 2000), lagos = session.cities.lagos, ibadan = session.cities.ibadan
  assert.equal(characterCity(session), 'lagos')
  assert.equal(normalizeCharacter(session), 'lagos')
  assert.equal(session.cities.lagos, lagos)
  assert.equal(session.cities.ibadan, undefined)
  assert.equal(Object.values(session.legacyLives ?? {})[0], ibadan)
  assert.equal(session.character?.v, 2)
  const stored = structuredClone(session)
  assert.equal(normalizeCharacter(session), 'lagos', 'stable once the pin is written')
  assert.deepEqual(session, stored, 'running it twice changes nothing')
})

test('a legacy pin that is still right (the other life is older) keeps that city', () => {
  const session = withLegacyPin(2000, 5000)
  assert.equal(normalizeCharacter(session), 'ibadan')
  assert.equal(session.cities.lagos, undefined)
})

test('only one life, pinned to its city: it stays the character', () => {
  const session = record()
  session.cities = { ibadan: held('ibadan', 300) }
  session.character = { v: 1, city: 'ibadan' }
  assert.equal(normalizeCharacter(session), 'ibadan')
  assert.deepEqual(session.character, { v: 2, city: 'ibadan' })
})

test('a tie goes to the life with a house, then to Lagos', () => {
  assert.equal(characterCity(withLegacyPin(1000, 1000)), 'lagos')
  const settled = withLegacyPin(1000, 1000)
  settled.cities.lagos!.state.estate.lga = null as never
  const estate = settled.cities.ibadan!.state.estate
  estate.lga = 'iyaganku' as typeof estate.lga
  estate.lgaConfirmed = true
  if (settled.cities.ibadan!.state.onboarding) settled.cities.ibadan!.state.onboarding.done = true
  assert.equal(characterCity(settled), 'ibadan')
})

test('a pin written by this code (a real move) is honoured even when another life is newer', () => {
  const session = withLegacyPin(9000, 1000)
  session.character = { v: 2, city: 'ibadan', movedAt: 500, from: 'lagos' }
  assert.equal(characterCity(session), 'ibadan')
  session.character = { v: 1, city: 'ibadan', movedAt: 500, from: 'lagos' }
  assert.equal(characterCity(session), 'ibadan', 'a recorded move is current whatever its version')
})

test('an account character and a set-aside character follow the same rule (a record carries its pin through the archive and back)', () => {
  const session = withLegacyPin(5000, 2000)
  session.account = 'fb:Ada'
  const archived = { publicId: session.publicId, name: session.name, cities: structuredClone(session.cities), character: structuredClone(session.character) }
  const restored: SessionRecord = { ...record(), ...structuredClone(archived), account: 'fb:Ada' }
  assert.equal(normalizeCharacter(session), 'lagos')
  assert.equal(normalizeCharacter(restored), 'lagos')
  assert.deepEqual(Object.keys(restored.legacyLives ?? {}), ['ibadan:1'])
  const current = { ...archived, character: { v: 2 as const, city: 'ibadan', movedAt: 1, from: 'lagos' } }
  assert.equal(normalizeCharacter({ ...record(), ...structuredClone(current) }), 'ibadan')
})
