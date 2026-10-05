// A life saved before cities were data has no `career.city` and no `civic.hunt.city`. Reading it files the job and today's hunt under the
// life's own city, changes nothing else, and reading the result again changes nothing more. The sample is a real settled Lagos life
// (a job, two venues visited, standing at one of them) as the earlier engine wrote it.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createLife, dispatch, viewLife } from '../../life.ts'
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
  // Nothing else moved: with the new fields taken out (the job's city, its null last-move day, the not-yet-used free skip and the primary home, which is Lagos), the life is exactly what was stored.
  const read = plain(state) as { t: number; business?: unknown; career: Record<string, unknown>; travel: Record<string, unknown>; estate: Record<string, unknown>; civic: { hunt: Record<string, unknown> | null } }
  assert.equal(read.travel.skipped, false)
  assert.equal(read.estate.home, 'lagos')
  // A life saved before businesses existed gains the empty business slice and nothing else.
  assert.deepEqual(read.business, { opened: 0, sales: 0, spent: 0, buys: { day: 0, spent: 0, count: 0 }, bag: {} })
  delete read.business
  delete read.career.city; delete read.career.transferDay; delete read.travel.skipped; delete read.estate.home; delete read.estate.homeAt; if (read.civic.hunt) delete read.civic.hunt.city
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

test('the oldest Ibadan lives (before accounts, characters or the creator) keep cash, job, needs and skills, land at a real Ibadan place and are asked once for a local government, free', () => {
  const old = { v: 1, t: NOW, cash: 12345, job: 'tech', needs: { hunger: 71, energy: 68, fun: 59, social: 63, hygiene: 75, bladder: 82 }, skills: { coding: 80 }, property: { house: 'yaba' }, location: 'cchub', travel: { home: 'yaba', visited: ['park', 'cchub'] } }
  const state = createLife(old, { now: NOW, cityId: 'ibadan' })
  assert.deepEqual([state.cash, state.job, state.needs, state.skills.coding], [12345, 'tech', old.needs, 80])
  assert.equal(state.location, 'polytechnic', 'the old Lagos tech hub becomes the local one')
  assert.equal(state.estate.lga, null, 'the local government is chosen once')
  assert.equal(state.property.house, 'ibadan-bodija-flat', 'a home that exists in Ibadan, not the Lagos one')
  const view = viewLife(state, { now: NOW, cityId: 'ibadan' })
  assert.equal(view.estate.lgas.length, 11)
  assert.equal(dispatch(state, { type: 'estate.set-lga', payload: { lga: 'oluyole', via: 'manual' } }, { now: NOW, cityId: 'ibadan' }).code, 'lga_set')
  assert.equal(state.cash, 12345, 'the first choice costs nothing')
  assert.deepEqual(plain(createLife(plain(state), { now: NOW, cityId: 'ibadan', trustedSave: true })), plain(state), 'read again, nothing changes')
})
