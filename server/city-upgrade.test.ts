// Records written before cities were data: a session with no `legacyLifeCities` and a legacy life keyed by a timestamp, first-party metrics and
// table ratings kept in one book, table results with no city. Each is read where it is, filed under Lagos where it has no city, and never lost.
import assert from 'node:assert/strict'
import test from 'node:test'
import { createLife } from '../src/life.ts'
import { archivedLife } from './protocol.ts'
import { characterCity, legacyLifeCity, normalizeCharacter, swapLegacyLife } from './character.ts'
import { count, report } from './growth/metrics.ts'
import { ratingsForCity, takePendingTableResults } from './growth/tables.ts'
import type { CityLifeRecord, GrowthCollection, GrowthPlayerRecord, SessionRecord } from './types.ts'
import { loadCityContent } from '../src/game/cities/registry.ts'
await loadCityContent('lagos'); await loadCityContent('ibadan')

const NOW = Date.UTC(2026, 0, 5, 9)
const held = (cityId: 'lagos' | 'ibadan', cash: number, updatedAt: number): CityLifeRecord => ({ state: createLife({ cash }, { cityId, now: NOW }), updatedAt, salt: 'a'.repeat(32) })
/** A session record as it was stored before `legacyLifeCities` and sequence keys existed: no character, a timestamp-keyed set-aside life. */
const oldRecord = (): SessionRecord => ({
  secret: 'old-key', publicId: 'old-public', name: 'Ada', expiresAt: 1e15, actions: {},
  cities: { lagos: held('lagos', 12000, NOW), ibadan: held('ibadan', 21000, NOW - 5000) },
  legacyLives: { 'ibadan:1767600000000': held('ibadan', 7, NOW - 9000) },
})

test('an older session record is read as it is: the newest life is the character, the others stay whole, and nothing needs the new fields', () => {
  const session = oldRecord(), ibadan = session.cities.ibadan
  assert.equal(characterCity(session), 'lagos')
  assert.equal(normalizeCharacter(session), 'lagos')
  assert.deepEqual(session.character, { v: 2, city: 'lagos' })
  assert.equal(session.cities.ibadan, undefined)
  const kept = Object.entries(session.legacyLives ?? {})
  assert.equal(kept.length, 2, 'the timestamp-keyed life and the displaced one are both kept')
  assert.ok(kept.some(([id, entry]) => id === 'ibadan:1767600000000' && entry.state.cash === 7))
  assert.ok(kept.some(([, entry]) => entry === ibadan))
  // The city of each set-aside life is its own: the state it holds, then the recorded origin, then the key's prefix.
  for (const [id, entry] of kept) assert.equal(legacyLifeCity(session, id, entry), 'ibadan')
  const bare = { ...held('ibadan', 1, NOW), state: { ...held('ibadan', 1, NOW).state, estate: undefined as never } }
  assert.equal(legacyLifeCity({ ...session, legacyLifeCities: undefined }, 'ibadan:1767600000000', bare), 'ibadan', 'a life with no estate falls back to the key prefix')
  assert.equal(legacyLifeCity({ ...session, legacyLifeCities: { x: 'lagos' } }, 'x', bare), 'lagos', 'and to the recorded origin before that')
})

test('switching to an older life swaps whole records and the archive carries where each belongs', () => {
  const session = oldRecord(), lagos = session.cities.lagos
  normalizeCharacter(session)
  const id = Object.keys(session.legacyLives ?? {}).find((key) => key !== 'ibadan:1767600000000') ?? ''
  assert.deepEqual(swapLegacyLife(session, id), { ok: true, city: 'ibadan' })
  assert.equal(session.character?.city, 'ibadan')
  assert.equal(session.legacyLives?.[id], lagos)
  assert.equal(session.legacyLifeCities?.[id], 'lagos')
  // A set-aside or expired record keeps the origins with the lives, so it comes back as it left.
  const archived = archivedLife(session, session.publicId, NOW)
  assert.deepEqual(archived.legacyLifeCities, session.legacyLifeCities)
  assert.deepEqual(Object.keys(archived.legacyLives ?? {}).sort(), Object.keys(session.legacyLives ?? {}).sort())
  assert.equal(archivedLife({ name: 'x', cities: {} }, 'p', NOW).legacyLifeCities, undefined, 'a record without origins archives without them')
})

const growth = (): GrowthCollection => ({ salt: 's'.repeat(16), players: {}, shares: {}, metrics: {}, tables: {}, sweptAt: 0 })

test('metrics kept before cities had books are the Lagos book: a count lands beside them, and another city counts apart', () => {
  const g = growth(), day = String(Math.floor(NOW / 86400000))
  g.metrics = { days: { [day]: { sessions: 4, new: 2 } }, cohorts: { [day]: { size: 2, r: { 1: 1 } } }, lives: { 'p-1': { first: Number(day), last: null, steps: 3 } } }
  count(g, NOW, 'sessions')
  count(g, NOW, 'lagos', 'sessions')
  count(g, NOW, 'ibadan', 'sessions')
  assert.equal(g.metrics.cities?.lagos?.days?.[day]?.sessions, 6, 'the old counters are the Lagos book, and untouched ones carry on')
  assert.equal(g.metrics.cities?.ibadan?.days?.[day]?.sessions, 1)
  assert.equal(g.metrics.days?.[day]?.sessions, 6, 'the old keys still mirror Lagos')
  assert.deepEqual(g.metrics.cities?.lagos?.cohorts?.[day], { size: 2, r: { 1: 1 } })
  const all = report(g, NOW + 1000)
  assert.equal(JSON.stringify(all).includes('"sessions":7'), true, 'the report adds the books')
})

test('table ratings kept before cities had books belong to Lagos, and a result with no city is paid only there', () => {
  const g = growth()
  g.tables = { ratings: { 'p-1': { whot: { rating: 1210, played: 7, won: 4 } } } }
  assert.equal(ratingsForCity(g, 'lagos')['p-1']?.whot?.rating, 1210)
  assert.deepEqual(ratingsForCity(g, 'ibadan'), {}, 'another city starts empty')
  const player: GrowthPlayerRecord = { seen: 0, devices: [], ref: null, invited: {}, counted: 0, owed: [], shares: { day: 0, n: 0 }, consent: null, table: null,
    wins: [{ id: 'a', game: 'whot', label: 'Whot', won: true, human: false, counted: false }, { cityId: 'ibadan', id: 'b', game: 'whot', label: 'Whot', won: true, human: false, counted: false }] }
  assert.deepEqual(takePendingTableResults(player, 'lagos').map((item) => item.id), ['a'])
  assert.deepEqual(player.wins.map((item) => item.id), ['b'], 'the other city’s result waits for the character to be there')
})
