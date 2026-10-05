// Lives as the build before this one stored them (before skipping a trip, the one main home and players' businesses) are read by
// this engine with exactly the fields those features add, and with nothing else changed. The two samples were written by that
// build's own engine: a settled Lagos life with a job and a few trips behind it, and the same life a few days later, standing in
// Ibadan with a starter house in each city (the earlier rule gave one wherever a local government was chosen), as that build
// stored it after reading it there. The fields added since: `travel.skipped`, `estate.home`, `estate.homeAt`, the `business` slice,
// and the day of the last job transfer (`career.transferDay`).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { createLife, viewLife } from '../../life.ts'
import { hasPlace } from '../systems/estate.ts'
import { loadCityContent } from './registry.ts'
import type { LifeState } from '../../types/life.ts'

await Promise.all(['lagos', 'ibadan'].map(loadCityContent))

type Json = Record<string, unknown>
const saved = (name: string): Json => JSON.parse(readFileSync(new URL(`./testing/${name}.json`, import.meta.url), 'utf8')) as Json
const plain = (state: LifeState): Json => JSON.parse(JSON.stringify(state)) as Json
const EMPTY_BUSINESS = { opened: 0, sales: 0, spent: 0, buys: { day: 0, spent: 0, count: 0 }, bag: {} }
/** Everything a life from that build gains when it is read now. */
const ADDED = { 'career.transferDay': null, 'travel.skipped': false, 'estate.home': 'lagos', 'estate.homeAt': null, business: EMPTY_BUSINESS }

/** Every path at which two JSON values differ, with what the second one has there. */
function differences(before: unknown, after: unknown, path = ''): Record<string, unknown> {
  const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (isObject(before) && isObject(after)) {
    const found: Record<string, unknown> = {}
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) Object.assign(found, key in before ? (key in after ? differences(before[key], after[key], `${path}${key}.`) : { [`${path}${key}`]: '(gone)' }) : { [`${path}${key}`]: after[key] })
    return found
  }
  return JSON.stringify(before) === JSON.stringify(after) ? {} : { [path.slice(0, -1)]: after }
}

test('a settled Lagos life from the build before: the free skip not yet used, Lagos as the main home, an empty business slice — and nothing else', () => {
  const old = saved('live-build-lagos-life')
  for (const [slice, field] of [['career', 'transferDay'], ['travel', 'skipped'], ['estate', 'home'], ['estate', 'homeAt']] as const) assert.equal(field in (old[slice] as object), false, `${slice}.${field} is new`)
  assert.equal('business' in old, false)
  const now = Number(old.t)
  // The server's own read of its stored copy (trustedSave), at the moment it was stored.
  const state = createLife(structuredClone(old), { now, cityId: 'lagos', trustedSave: true })
  assert.deepEqual(differences(old, plain(state)), ADDED)
  // The same holds for the copy a browser kept, and reading the result again changes nothing.
  assert.deepEqual(plain(createLife(structuredClone(old), { now, cityId: 'lagos' })), plain(state))
  assert.deepEqual(plain(createLife(plain(state), { now, cityId: 'lagos', trustedSave: true })), plain(state))
  // It plays on as it was: at home in Lagos, employed, not a visitor, with nothing to choose.
  const view = viewLife(state, { now, cityId: 'lagos' })
  assert.deepEqual([view.estate.visiting, view.estate.settle, view.estate.makeMain, view.estate.home], [false, null, null, { city: 'lagos', name: 'Lagos', here: true }])
  assert.deepEqual([view.career.employed, hasPlace(state), view.business.opened, view.business.bag], [true, true, 0, []])
})

test('a life from the build before with a house in two cities keeps both, and the one it settled in first is its main home', () => {
  const old = saved('live-build-two-homes-life'), stored = old.estate as { city: string; lga: string; lgaAt: number; away: Record<string, { lga: string; lgaAt: number; tier: string; plot: unknown }> }
  assert.deepEqual([stored.city, Object.keys(stored.away)], ['ibadan', ['lagos']])
  assert.ok(must(stored.away.lagos).lgaAt < stored.lgaAt, 'Lagos was settled first')
  const now = Number(old.t)
  const state = createLife(structuredClone(old), { now, cityId: 'ibadan', trustedSave: true })
  assert.deepEqual(differences(old, plain(state)), ADDED)
  assert.deepEqual(plain(createLife(plain(state), { now, cityId: 'ibadan', trustedSave: true })), plain(state))
  // Both houses are held: it is at home in Ibadan (not a visitor, no guest house needed) and may name Ibadan its main home at once.
  assert.deepEqual([state.estate.lga, state.estate.tier, must(state.estate.away.lagos).lga, must(state.estate.away.lagos).tier], [stored.lga, 'starter', must(stored.away.lagos).lga, 'starter'])
  const view = viewLife(state, { now, cityId: 'ibadan' })
  assert.deepEqual([view.estate.visiting, view.estate.settle, view.estate.makeMain, view.estate.home], [false, null, { blocked: null }, { city: 'lagos', name: 'Lagos', here: false }])
  assert.deepEqual(view.estate.away.map((home) => home.city), ['lagos'])
  assert.match(String(view.estate.lodging.blocked), /^You have a home in Ibadan/)
  assert.equal(hasPlace(state), true)
})

function must<T>(value: T | undefined): T { assert.ok(value !== undefined); return value }
