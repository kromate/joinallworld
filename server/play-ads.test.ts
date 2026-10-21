import { loadCityContent as preloadCityContent } from '../src/game/cities/registry.ts'
await preloadCityContent('lagos')

import test from 'node:test'
import assert from 'node:assert/strict'
import type { TestContext } from 'node:test'
import { fixture } from './test-fixture.ts'
import { promoteOf } from './promote/service.ts'

interface ListingAnswer { id: string; name: string; boosted: boolean }
interface DirectoryAnswer { ok: true; listings: ListingAnswer[] }
interface StreetAnswer { ok: true; groups: { listings: ListingAnswer[] }[] }
interface FeedAnswer { ok: true; sponsored?: ListingAnswer[] }

async function read<T>(base: string, path: string, play = false): Promise<T> {
  const response = await fetch(`${base}${path}`, { headers: play ? { 'X-Allworld-App': 'play' } : undefined })
  assert.equal(response.status, 200, path)
  return await response.json() as T
}

async function seeded(t: TestContext) {
  const fixtureState = await fixture(t)
  await fixtureState.server.store.transact((db) => {
    const promote = promoteOf(fixtureState.server.context, db)
    promote.listings = {
      B2: { id: 'B2', owner: 'owner-z', name: 'Zulu Foods', category: 'food', city: 'lagos', area: 'Yaba', about: 'Lunch', at: 1, status: 'live' },
      B1: { id: 'B1', owner: 'owner-b', name: 'Alpha Foods', category: 'food', city: 'lagos', area: 'Ikeja', about: 'Dinner', at: 3, status: 'live' },
      B0: { id: 'B0', owner: 'owner-a', name: 'Alpha Foods', category: 'food', city: 'lagos', area: 'Surulere', about: 'Breakfast', at: 2, status: 'live' },
    }
    promote.owners = {
      'owner-z': { listings: ['B2'], orders: ['O1'] },
      'owner-b': { listings: ['B1'], orders: [] },
      'owner-a': { listings: ['B0'], orders: [] },
    }
    promote.cities = { lagos: { listings: ['B2', 'B1', 'B0'] } }
    promote.orders = {
      O1: { id: 'O1', listing: 'B2', owner: 'owner-z', tier: 'boost', weeks: 1, amount: 2500, city: 'lagos', at: 1, status: 'paid', ref: 'AW-TEST-ONE', startsAt: 1, endsAt: fixtureState.now() + 86400000, shown: 7 },
    }
  })
  return fixtureState
}

test('Play business discovery is neutral and carries no boost metadata', async (t) => {
  const state = await seeded(t)
  const webDirectory = await read<DirectoryAnswer>(state.base, '/api/promote/directory?city=lagos')
  assert.deepEqual(webDirectory.listings.map((listing) => listing.id), ['B2', 'B1', 'B0'], 'web keeps paid ranking')
  assert.equal(webDirectory.listings[0]?.boosted, true)

  const directory = await read<DirectoryAnswer>(state.base, '/api/promote/directory?city=lagos', true)
  assert.deepEqual(directory.listings.map((listing) => [listing.name, listing.id, listing.boosted]), [
    ['Alpha Foods', 'B0', false],
    ['Alpha Foods', 'B1', false],
    ['Zulu Foods', 'B2', false],
  ])

  const street = await read<StreetAnswer>(state.base, '/api/promote/street?city=lagos', true)
  assert.deepEqual(street.groups.flatMap((group) => group.listings).map((listing) => [listing.name, listing.id, listing.boosted]), [
    ['Alpha Foods', 'B0', false],
    ['Alpha Foods', 'B1', false],
    ['Zulu Foods', 'B2', false],
  ])
})

test('Play feed omits sponsored payloads without recording an impression', async (t) => {
  const state = await seeded(t)
  const page = await read<FeedAnswer>(state.base, '/api/feed/list?tab=city&city=lagos', true)
  assert.deepEqual(page.sponsored, [])
  assert.equal(await state.server.store.read((db) => promoteOf(state.server.context, db).orders.O1?.shown), 7)
})
