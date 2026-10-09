import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyParcelState } from '../../src/game/living-world/parcel.ts'
import type { Db } from '../types.ts'
import { deliveredNpcParcel } from './restock-fixture.ts'
import { readNpcInventoryView, settleNpcInventoryRestock } from './npc-inventory.ts'
import { eraseLivingWorldProgress, exportLivingWorldProgress, rebindParcelAccount } from './privacy.ts'

const dbWith = (livingWorld: unknown): Db => ({ version: 1, sessions: {}, livingWorld }) as Db
const envelope = (actor: string, account: string | null) => ({ v: 1, publicId: actor, account, state: emptyParcelState(actor) })

test('parcel ownership changes preserve the same actor state and refuse foreign, future or frozen rows', () => {
  const row = envelope('ada', null), before = structuredClone(row), db = dbWith({ parcels: { ada: row } })
  assert.equal(rebindParcelAccount(db, 'ada', null, 'owner'), true)
  assert.deepEqual(row, { ...before, account: 'owner' })
  assert.equal(rebindParcelAccount(db, 'ada', 'foreign', null), false)
  assert.equal(rebindParcelAccount(db, 'ada', 'owner', null), true)
  assert.deepEqual(row, before)
  const future = { ...before, v: 2 }, frozen = Object.freeze({ ...before })
  assert.equal(rebindParcelAccount(dbWith({ parcels: { ada: future } }), 'ada', null, 'owner'), false)
  assert.equal(rebindParcelAccount(dbWith({ parcels: { ada: frozen } }), 'ada', null, 'owner'), false)
  assert.deepEqual(future, { ...before, v: 2 })
})

test('delivery export is owner-bound and omits parcel, trip and reward fingerprints', () => {
  const state = deliveredNpcParcel('ada', 4_000)
  const db = dbWith({ parcels: {
    ada: { v: 1, publicId: 'ada', account: 'owner', state },
    bob: envelope('bob', 'foreign'),
  } })
  assert.equal(settleNpcInventoryRestock(db, 'ada', 'owner', 0).code, 'restocked')
  const before = structuredClone(db.livingWorld)
  const delivery = exportLivingWorldProgress(db, 'owner', ['ada']).actors[0]?.delivery
  assert.deepEqual(delivery, { status: 'present', progress: {
    revision: state.revision, generation: 1, status: 'delivered',
    restock: { settlements: 1, generation: 1, deliveredAt: 4_000 },
  } })
  assert.doesNotMatch(JSON.stringify(delivery), /restock-parcel|restock-trip|parcelFingerprint|account|owner|bob/)
  assert.deepEqual(exportLivingWorldProgress(db, 'foreign', ['ada']).actors[0]?.delivery, { status: 'quarantined' })
  assert.deepEqual(db.livingWorld, before)
  assert.equal(Object.hasOwn(exportLivingWorldProgress(dbWith({}), 'owner', ['ada']).actors[0]!, 'delivery'), false)
})

test('privacy erasure removes custody and reward identity together while retaining anonymous shared stock', () => {
  const ada = deliveredNpcParcel('ada', 4_000), bob = deliveredNpcParcel('bob', 4_001)
  const db = dbWith({ parcels: {
    ada: { v: 1, publicId: 'ada', account: 'owner', state: ada },
    bob: { v: 1, publicId: 'bob', account: 'other', state: bob },
  }, unknown: { ada: 'preserve' } })
  assert.equal(settleNpcInventoryRestock(db, 'ada', 'owner', 0).code, 'restocked')
  assert.equal(settleNpcInventoryRestock(db, 'bob', 'other', 1).code, 'restocked')
  eraseLivingWorldProgress(db, ['ada'], 'owner')
  const root = db.livingWorld as { parcels: Record<string, unknown>; npcInventory: { erasedSettlements: number; delivered: Record<string, unknown> }; unknown: unknown }
  assert.equal(Object.hasOwn(root.parcels, 'ada'), false)
  assert.equal(Object.hasOwn(root.npcInventory.delivered, 'ada'), false)
  assert.equal(root.npcInventory.erasedSettlements, 1)
  assert.deepEqual(readNpcInventoryView(db), { revision: 2, stock: 6 })
  assert.equal(settleNpcInventoryRestock(db, 'ada', 'owner', 2).code, 'parcel_missing')
  assert.equal(settleNpcInventoryRestock(db, 'bob', 'other', 2).code, 'already_restocked')
  assert.deepEqual(root.unknown, { ada: 'preserve' })
})

test('erasure preflights every privacy map before any deletion and preserves quarantined delivery data', () => {
  const db = dbWith({ parcels: { ada: envelope('ada', 'owner') }, clerk: { ada: 'preserve' },
    justicePractice: Object.freeze({ ada: 'preserve' }) })
  const before = structuredClone(db.livingWorld)
  assert.throws(() => eraseLivingWorldProgress(db, ['ada'], 'owner'), /privacy-erasure-unavailable/)
  assert.deepEqual(db.livingWorld, before)
  const future = dbWith({ parcels: { ada: envelope('ada', 'owner') }, npcInventory: { version: 99 }, clerk: { ada: 'preserve' } })
  const futureBefore = structuredClone(future.livingWorld)
  assert.throws(() => eraseLivingWorldProgress(future, ['ada'], 'owner'), /privacy-erasure-unavailable/)
  assert.deepEqual(future.livingWorld, futureBefore)
})

test('delivery erasure requires the proven account owner and refuses a contradictory envelope unchanged', () => {
  const db = dbWith({ parcels: { ada: envelope('ada', 'foreign') }, clerk: { ada: 'preserve' } })
  const before = structuredClone(db.livingWorld)
  assert.throws(() => eraseLivingWorldProgress(db, ['ada'], 'owner'), /privacy-erasure-unavailable/)
  assert.deepEqual(db.livingWorld, before)
  assert.throws(() => eraseLivingWorldProgress(db, ['ada']), /privacy-erasure-unavailable/)
  assert.deepEqual(db.livingWorld, before)
})
