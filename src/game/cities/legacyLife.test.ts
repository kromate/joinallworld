// A life saved before cities were data has no `career.city` and no `civic.hunt.city`. Reading it files the job and today's hunt under the
// life's own city, changes nothing else, and reading the result again changes nothing more. The sample is a real settled Lagos life
// (a job, two venues visited, standing at one of them) as the earlier engine wrote it.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createLife, viewLife } from '../../life.ts'
import type { LifeState } from '../../types/life.ts'
import { loadCityContent } from '../../game/cities/registry.ts'
await loadCityContent('lagos')
await loadCityContent('ibadan')

const saved = (): Record<string, unknown> => JSON.parse(readFileSync(new URL('./testing/legacy-lagos-life.json', import.meta.url), 'utf8')) as Record<string, unknown>
const plain = (state: LifeState): Record<string, unknown> => JSON.parse(JSON.stringify(state)) as Record<string, unknown>
const NOW = Date.UTC(2026, 0, 5, 14)

test('a Lagos life saved without the city fields is read as it was, with its job and hunt filed under Lagos', () => {
  const old = saved()
  assert.equal('city' in (old.career as object), false)
  assert.equal('city' in ((old.civic as { hunt: object }).hunt), false)
  const state = createLife(old, { now: NOW, cityId: 'lagos' })
  assert.equal(state.career.city, 'lagos')
  assert.equal(state.civic.hunt?.city, 'lagos')
  assert.equal(state.job, 'community-helper')
  // Nothing else moved: with the two new fields taken out, the life is exactly what was stored.
  const read = plain(state) as { t: number; career: Record<string, unknown>; civic: { hunt: Record<string, unknown> | null } }
  delete read.career.city; if (read.civic.hunt) delete read.civic.hunt.city
  assert.deepEqual(read, { ...old, t: read.t })
  assert.deepEqual(plain(createLife(plain(state), { now: NOW, cityId: 'lagos' })), plain(state), 'reading it again changes nothing')
  assert.equal(viewLife(state, { now: NOW, cityId: 'lagos' }).career.employed, true)
})

test('an older life filed under Ibadan keeps its city and its job, and its old venues become the local ones', () => {
  const old = saved()
  ;(old.estate as { city: string }).city = 'ibadan'
  const state = createLife(old, { now: NOW, cityId: 'ibadan' })
  assert.equal(state.estate.city, 'ibadan')
  assert.deepEqual([state.job, state.career.city, state.location], ['community-helper', 'ibadan', 'dugbe-amala'])
  assert.equal(state.civic.hunt, null, 'the old hunt named places that are not in the new city: today starts a new one')
  assert.equal(state.cash, old.cash, 'the wallet is kept')
  assert.equal(state.estate.lga, 'ibadan-north', 'a local government of the new city, to be chosen once')
  // The same record read where the engine is asked for Lagos still belongs to the city it names.
  assert.equal(createLife(old, { now: NOW, cityId: 'lagos' }).estate.city, 'ibadan')
})

test('a Lagos life that holds a home in another city keeps it, and a life with no stored city falls to the one asked for', () => {
  const old = saved()
  ;(old.estate as { away: object }).away = { ibadan: { living: 'rent', house: 'yaba', tier: 'house', lga: null } }
  const state = createLife(old, { now: NOW, cityId: 'lagos' })
  assert.deepEqual(Object.keys(state.estate.away), ['ibadan'])
  const bare = createLife({ name: 'Ada' }, { now: NOW, cityId: 'ibadan' })
  assert.equal(bare.estate.city, 'ibadan')
})
