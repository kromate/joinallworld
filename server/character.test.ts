import { loadCityContent as preloadCityContent } from '../src/game/cities/registry.ts';
await Promise.all(['lagos', 'ibadan', 'abeokuta', 'ota'].map(preloadCityContent));
import assert from 'node:assert/strict'
import test from 'node:test'
import { createLife, dispatch, advanceLife } from '../src/life.ts'
import { characterCity, normalizeCharacter, swapLegacyLife, fileCharacter } from './character.ts'
import { settleCity } from './life-service.ts'
import type { SessionRecord } from './types.ts'

const record = (): SessionRecord => ({ secret: 'test', publicId: 'test-public', name: 'Player', expiresAt: 1e15, cities: {}, actions: {} })
const held = (cityId: 'lagos' | 'ibadan' | 'abeokuta' | 'ota', cash: number) => ({ state: createLife({ cash }, { cityId }), updatedAt: 1000, salt: 'a'.repeat(32) })

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

test('Ogun cities: a Lagos life that travelled to Ota is filed under Ota, a v:2 pin names it, and an old pin never overrules the newest life', () => {
  const session = record(), lagos = held('lagos', 15000)
  session.cities = { lagos }
  lagos.state.estate.city = 'ota'
  fileCharacter(session, 'lagos', 5000)
  assert.deepEqual(Object.keys(session.cities), ['ota'])
  assert.deepEqual(session.character, { v: 2, city: 'ota', from: 'lagos', movedAt: 5000 })
  assert.equal(characterCity(session), 'ota')
  // Ota to Abeokuta: the pin follows the life and records the move again.
  session.cities.ota!.state.estate.city = 'abeokuta'
  fileCharacter(session, 'ota', 6000)
  assert.deepEqual([Object.keys(session.cities), session.character], [['abeokuta'], { v: 2, city: 'abeokuta', from: 'ota', movedAt: 6000 }])
  // An older build's start-up pin names Lagos for a character that is now in Abeokuta: the newest life decides and the pin is rewritten.
  const old = record()
  old.cities = { lagos: { ...held('lagos', 1), updatedAt: 10 }, abeokuta: { ...held('abeokuta', 2), updatedAt: 20 } }
  old.character = { v: 1, city: 'lagos' }
  assert.equal(characterCity(old), 'abeokuta')
  assert.equal(normalizeCharacter(old), 'abeokuta')
  assert.deepEqual(old.character, { v: 2, city: 'abeokuta' })
  assert.deepEqual(Object.keys(old.cities), ['abeokuta'])
  assert.equal(Object.values(old.legacyLives ?? {}).length, 1, 'the other life is kept, not dropped')
  // A pin naming a city the character has no life in, or one this build does not know, is not trusted.
  const stray = record()
  stray.cities = { abeokuta: held('abeokuta', 3) }
  for (const city of ['ota', 'atlantis']) {
    stray.character = { v: 2, city }
    assert.equal(characterCity(stray), 'abeokuta')
  }
  assert.throws(() => settleCity(session, 'lagos', 7000), { code: 'city_moved', city: 'abeokuta' })
})
