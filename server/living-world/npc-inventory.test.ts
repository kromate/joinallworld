import assert from 'node:assert/strict'
import test from 'node:test'
import { acceptParcel, cancelParcel, collectParcel, deliverParcel, emptyParcelState, offerParcel } from '../../src/game/living-world/parcel.ts'
import type { ParcelState, TrustedParcelPose, TrustedParcelRecipient, TrustedParcelTrip } from '../../src/game/living-world/parcel.ts'
import { NPC_RESTOCK_POLICY, eraseNpcRestockProgress, readNpcInventoryView, readNpcRestockActorSummary, readValidatedNpcParcelEnvelope, settleNpcInventoryRestock } from './npc-inventory.ts'
import type { Db } from '../types.ts'

const actor = 'guest-1'
const account = 'account-1'
const trip = (at: number, overrides: Partial<TrustedParcelTrip> = {}): TrustedParcelTrip => ({
  actor, tripId: 'trip-1', resourceId: 'starter-car', qualificationId: 'district-driving', qualificationVersion: 1,
  qualificationStatus: 'active', cityId: 'lagos', routeId: 'fictional-restock-route', routeVersion: 'v1',
  active: true, expiresAt: 60_000, at, ...overrides,
})
const pose = (at: number, placeId: string, overrides: Partial<TrustedParcelPose> = {}): TrustedParcelPose => ({
  actor, tripId: 'trip-1', placeId, at, stopped: true, verified: true, ...overrides,
})
const recipient = (product: string = NPC_RESTOCK_POLICY.product, shopId: string = NPC_RESTOCK_POLICY.destinationId): TrustedParcelRecipient => ({
  shopId, product, revision: 0, availableUnits: NPC_RESTOCK_POLICY.capacity, open: true,
})

function delivered(generation = 1, at = 4_000, overrides: { actor?: string; parcelId?: string; product?: string; quantity?: number; wage?: number; originId?: string; destinationId?: string } = {}) {
  const owner = overrides.actor ?? actor
  let state = emptyParcelState(owner)
  for (let priorGeneration = 1; priorGeneration < generation; priorGeneration++) {
    const priorId = `parcel-${priorGeneration}`
    const priorOffer = offerParcel(state, { parcelId: priorId, expectedRevision: state.revision, expectedGeneration: state.generation,
      resourceId: 'starter-car', qualificationId: 'district-driving', qualificationVersion: 1, cityId: 'lagos',
      routeId: 'fictional-restock-route', routeVersion: 'v1', originId: NPC_RESTOCK_POLICY.originId,
      destinationId: NPC_RESTOCK_POLICY.destinationId, product: NPC_RESTOCK_POLICY.product, quantity: NPC_RESTOCK_POLICY.quantity,
      wage: NPC_RESTOCK_POLICY.wage, expiresAt: at + 10_000 }, trip(1_000 + (priorGeneration - 1) * 1_000,
      { actor: owner, tripId: 'trip-1', expiresAt: at + 20_000 }))
    assert.equal(priorOffer.code, 'offered')
    const canceled = cancelParcel(priorOffer.state, { parcelId: priorId, expectedRevision: priorOffer.state.revision,
      generation: priorOffer.state.generation }, trip(1_500 + (priorGeneration - 1) * 1_000,
      { actor: owner, tripId: 'trip-1', expiresAt: at + 20_000 }))
    assert.equal(canceled.code, 'cancelled')
    state = canceled.state
  }
  const terms = {
    parcelId: overrides.parcelId ?? `parcel-${generation}`,
    expectedRevision: state.revision,
    expectedGeneration: state.generation,
    resourceId: 'starter-car', qualificationId: 'district-driving', qualificationVersion: 1,
    cityId: 'lagos', routeId: 'fictional-restock-route', routeVersion: 'v1',
    originId: overrides.originId ?? NPC_RESTOCK_POLICY.originId,
    destinationId: overrides.destinationId ?? NPC_RESTOCK_POLICY.destinationId,
    product: overrides.product ?? NPC_RESTOCK_POLICY.product,
    quantity: overrides.quantity ?? NPC_RESTOCK_POLICY.quantity,
    wage: overrides.wage ?? NPC_RESTOCK_POLICY.wage,
    expiresAt: at + 10_000,
  }
  const startedAt = 1_000 + (generation - 1) * 1_000
  const offer = offerParcel(state, terms, trip(startedAt, { actor: owner, tripId: 'trip-1', expiresAt: at + 20_000 }))
  assert.equal(offer.code, 'offered')
  const accepted = acceptParcel(offer.state, { parcelId: terms.parcelId, expectedRevision: offer.state.revision, generation: offer.state.generation },
    trip(startedAt + 1_000, { actor: owner, tripId: 'trip-1', expiresAt: at + 20_000 }))
  assert.equal(accepted.code, 'accepted')
  const collected = collectParcel(accepted.state, { parcelId: terms.parcelId, expectedRevision: accepted.state.revision, generation: accepted.state.generation },
    trip(startedAt + 2_000, { actor: owner, tripId: 'trip-1', expiresAt: at + 20_000 }),
    pose(startedAt + 2_000, terms.originId, { actor: owner, tripId: 'trip-1' }))
  assert.equal(collected.code, 'collected')
  const result = deliverParcel(collected.state, { parcelId: terms.parcelId, expectedRevision: collected.state.revision, generation: collected.state.generation },
    trip(at, { actor: owner, tripId: 'trip-1', expiresAt: at + 20_000 }),
    pose(at, terms.destinationId, { actor: owner, tripId: 'trip-1' }), recipient(terms.product, terms.destinationId))
  assert.equal(result.code, 'delivered')
  assert.equal(result.ok, true)
  return result.state
}

function dbWithParcel(parcel: ParcelState, parcelAccount: string | null = account): Db {
  const publicId = parcel.actor
  return {
    version: 1,
    sessions: { 'session-fixture': { publicId, cash: 250, ledger: [], social: { earned: 17 } } },
    livingWorld: { parcels: { [publicId]: { v: 1, publicId, account: parcelAccount, state: structuredClone(parcel) } } },
    business: { shops: { 'unrelated-player': { stock: { water: 8 }, till: 40 } } },
  } as unknown as Db
}
const snapshot = (value: unknown) => structuredClone(value)
const fingerprint = (state: ParcelState): string => JSON.stringify(state)

test('a persisted delivered fixed-term parcel updates only the fictional NPC outlet and returns one fixed wage effect', () => {
  const parcel = delivered()
  const db = dbWithParcel(parcel)
  const beforeBusiness = snapshot(db.business)
  const result = settleNpcInventoryRestock(db, actor, account, 0)
  assert.equal(result.ok, true)
  if (!result.ok || result.code !== 'restocked') return
  assert.deepEqual(result.effect, { actorId: actor, parcelId: 'parcel-1', generation: 1,
    stock: { outletId: NPC_RESTOCK_POLICY.outletId, product: 'water', quantity: 3, expectedRevision: 0, revision: 1 }, wage: 120 })
  assert.equal(Object.isFrozen(result.effect), true)
  assert.equal(Object.isFrozen(result.effect.stock), true)
  assert.deepEqual((db.livingWorld as { npcInventory: unknown }).npcInventory, {
    version: 2,
    outlet: { id: NPC_RESTOCK_POLICY.outletId, cityId: 'lagos', product: 'water', capacity: 60, stock: 3, revision: 1 },
    erasedSettlements: 0,
    delivered: { [actor]: { settlements: 1, generation: 1, parcelId: 'parcel-1', deliveredAt: 4_000, parcelFingerprint: fingerprint(parcel) } },
  })
  assert.deepEqual(db.business, beforeBusiness, 'NPC stock never enters a player shop or its closure cashout')
  assert.deepEqual(db.sessions, { 'session-fixture': { publicId: actor, cash: 250, ledger: [], social: { earned: 17 } } },
    'the helper does not touch a session wallet, ledger, or earned-work total')
  assert.equal('walletEffects' in db, false)
  assert.deepEqual(readNpcInventoryView(db), { revision: 1, stock: 3 })
  assert.deepEqual(readNpcRestockActorSummary(db, actor), { settlements: 1, generation: 1, deliveredAt: 4_000 })
})

test('validated v1 inventory stays v1 on reads and no-op retries, then migrates on successful restock', () => {
  const first = delivered(1, 4_000, { actor })
  const db = dbWithParcel(first)
  assert.equal(settleNpcInventoryRestock(db, actor, account, 0).code, 'restocked')
  const current = (db.livingWorld as { npcInventory: { outlet: unknown; delivered: unknown } }).npcInventory
  ;(db.livingWorld as { npcInventory: unknown }).npcInventory = { version: 1, outlet: snapshot(current.outlet), delivered: snapshot(current.delivered) }
  const v1 = snapshot((db.livingWorld as { npcInventory: unknown }).npcInventory)
  assert.deepEqual(readNpcInventoryView(db), { revision: 1, stock: 3 })
  assert.deepEqual(readNpcRestockActorSummary(db, actor), { settlements: 1, generation: 1, deliveredAt: 4_000 })
  assert.deepEqual(settleNpcInventoryRestock(db, actor, account, 0), { ok: true, code: 'already_restocked', duplicate: true })
  assert.deepEqual((db.livingWorld as { npcInventory: unknown }).npcInventory, v1, 'a valid v1 no-op read does not silently rewrite storage')

  const next = delivered(2, 5_000, { parcelId: 'parcel-2' })
  ;(db.livingWorld as { parcels: Record<string, unknown> }).parcels[actor] = { v: 1, publicId: actor, account, state: next }
  assert.equal(settleNpcInventoryRestock(db, actor, account, 1).code, 'restocked')
  const migrated = (db.livingWorld as { npcInventory: { version: number; erasedSettlements: number; outlet: { revision: number; stock: number } } }).npcInventory
  assert.deepEqual([migrated.version, migrated.erasedSettlements, migrated.outlet.revision, migrated.outlet.stock], [2, 0, 2, 6])
})

test('privacy erasure removes actor parcel and watermark while preserving shared stock and anonymous settlement count', () => {
  const db = dbWithParcel(delivered(1, 4_000, { actor }))
  assert.equal(settleNpcInventoryRestock(db, actor, account, 0).code, 'restocked')
  const rows = (db.livingWorld as { parcels: Record<string, unknown> }).parcels
  for (const [who, at] of [['guest-2', 4_100], ['guest-3', 4_200]] as const) {
    rows[who] = { v: 1, publicId: who, account, state: delivered(1, at, { actor: who }) }
    assert.equal(settleNpcInventoryRestock(db, who, account, who === 'guest-2' ? 1 : 2).code, 'restocked')
  }
  const before = (db.livingWorld as { npcInventory: { outlet: unknown; delivered: Record<string, unknown> } }).npcInventory
  const outletBefore = snapshot(before.outlet)
  assert.deepEqual(readNpcRestockActorSummary(db, actor), { settlements: 1, generation: 1, deliveredAt: 4_000 })
  eraseNpcRestockProgress(db, [actor, 'guest-2'], account)

  const living = db.livingWorld as { npcInventory: { version: number; erasedSettlements: number; outlet: unknown; delivered: Record<string, unknown> }; parcels: Record<string, unknown> }
  assert.deepEqual(living.npcInventory.outlet, outletBefore, 'privacy erasure does not alter outlet stock or revision')
  assert.deepEqual([living.npcInventory.version, living.npcInventory.erasedSettlements], [2, 2])
  assert.deepEqual(Object.keys(living.npcInventory.delivered), ['guest-3'])
  assert.deepEqual(Object.keys(living.parcels).sort(), ['guest-3'])
  assert.deepEqual(readNpcRestockActorSummary(db, actor), null)
  assert.deepEqual(readNpcRestockActorSummary(db, 'guest-2'), null)
  assert.deepEqual(readNpcRestockActorSummary(db, 'guest-3'), { settlements: 1, generation: 1, deliveredAt: 4_200 })
  assert.equal(JSON.stringify(living.npcInventory).includes(actor), false, 'the erased actor is not retained in the shared inventory record')
  assert.deepEqual(readNpcInventoryView(db), { revision: 3, stock: 9 })
  const nextActor = 'guest-4'
  ;(living.parcels as Record<string, unknown>)[nextActor] = { v: 1, publicId: nextActor, account, state: delivered(1, 4_300, { actor: nextActor }) }
  assert.equal(settleNpcInventoryRestock(db, nextActor, account, 3).code, 'restocked')
  const afterNext = (db.livingWorld as { npcInventory: { version: number; erasedSettlements: number; outlet: { revision: number; stock: number }; delivered: Record<string, { settlements: number }> } }).npcInventory
  assert.deepEqual([afterNext.version, afterNext.erasedSettlements, afterNext.outlet.revision, afterNext.outlet.stock,
    Object.values(afterNext.delivered).reduce((sum, row) => sum + row.settlements, afterNext.erasedSettlements)], [2, 2, 4, 12, 4])
})

test('erasing a watermark from validated v1 migrates it and preserves revision with an anonymous count', () => {
  const db = dbWithParcel(delivered())
  assert.equal(settleNpcInventoryRestock(db, actor, account, 0).code, 'restocked')
  const current = (db.livingWorld as { npcInventory: { outlet: unknown; delivered: unknown } }).npcInventory
  ;(db.livingWorld as { npcInventory: unknown }).npcInventory = { version: 1, outlet: snapshot(current.outlet), delivered: snapshot(current.delivered) }
  const legacy = snapshot((db.livingWorld as { npcInventory: unknown }).npcInventory)
  assert.deepEqual(readNpcInventoryView(db), { revision: 1, stock: 3 })
  assert.deepEqual((db.livingWorld as { npcInventory: unknown }).npcInventory, legacy)
  eraseNpcRestockProgress(db, [actor], account)
  const inventory = (db.livingWorld as { npcInventory: { version: number; erasedSettlements: number; outlet: { revision: number; stock: number }; delivered: Record<string, unknown> } }).npcInventory
  assert.deepEqual([inventory.version, inventory.erasedSettlements, inventory.outlet.revision, inventory.outlet.stock, Object.keys(inventory.delivered)], [2, 1, 1, 3, []])
  assert.equal(Object.hasOwn((db.livingWorld as { parcels: Record<string, unknown> }).parcels, actor), false)
})

test('erasure preflights all supplied IDs and quarantined/frozen rows before mutating any actor', () => {
  const db = dbWithParcel(delivered())
  assert.throws(() => eraseNpcRestockProgress(db, [actor, actor], account), /Invalid NPC restock erasure actors/)
  assert.throws(() => eraseNpcRestockProgress(db, Array.from({ length: 7 }, (_, i) => `guest-${i}`), account), /Invalid NPC restock erasure actors/)
  const future = dbWithParcel(delivered())
  ;(future.livingWorld as { npcInventory: unknown }).npcInventory = { version: 3, outlet: {}, delivered: {}, erasedSettlements: 0 }
  const futureBefore = snapshot(future.livingWorld)
  assert.throws(() => eraseNpcRestockProgress(future, [actor], account), /NPC inventory is quarantined/)
  assert.deepEqual(future.livingWorld, futureBefore)
  assert.equal(readNpcRestockActorSummary(future, actor), false)

  const first = dbWithParcel(delivered())
  const secondActor = 'guest-2'
  ;(first.livingWorld as { parcels: Record<string, unknown> }).parcels[secondActor] = {
    v: 1, publicId: secondActor, account, state: delivered(1, 4_100, { actor: secondActor }),
  }
  assert.equal(settleNpcInventoryRestock(first, actor, account, 0).code, 'restocked')
  const prior = snapshot(first.livingWorld)
  assert.throws(() => eraseNpcRestockProgress(first, [actor, secondActor], 'different-account'), /NPC parcel row is quarantined/)
  assert.deepEqual(first.livingWorld, prior, 'an envelope for a different owner aborts the whole batch before mutation')
  Object.freeze((first.livingWorld as { parcels: Record<string, unknown> }).parcels[secondActor])
  Object.defineProperty((first.livingWorld as { parcels: Record<string, unknown> }).parcels, secondActor, { configurable: false })
  assert.throws(() => eraseNpcRestockProgress(first, [actor, secondActor], account), /NPC parcel row is quarantined/)
  assert.deepEqual(first.livingWorld, prior, 'a later bad descriptor prevents earlier actor erasure')

  const inconsistent = dbWithParcel(delivered())
  assert.equal(settleNpcInventoryRestock(inconsistent, actor, account, 0).code, 'restocked')
  ;(inconsistent.livingWorld as { parcels: Record<string, { state: ParcelState }> }).parcels[actor]!.state = delivered(1, 4_000, { parcelId: 'changed-same-generation' })
  const inconsistentBefore = snapshot(inconsistent.livingWorld)
  assert.throws(() => eraseNpcRestockProgress(inconsistent, [actor], account), /NPC parcel watermark does not match/)
  assert.deepEqual(inconsistent.livingWorld, inconsistentBefore)
  ;(inconsistent.livingWorld as { parcels: Record<string, { state: ParcelState }> }).parcels[actor]!.state = delivered(2, 5_000, { parcelId: 'valid-newer-generation' })
  eraseNpcRestockProgress(inconsistent, [actor], account)
  assert.deepEqual(readNpcInventoryView(inconsistent), { revision: 1, stock: 3 }, 'a newer unpaid parcel and its older paid watermark are erased together')
  assert.equal(readNpcRestockActorSummary(inconsistent, actor), null)
})

test('same parcel retries and replaced old generations cannot restock again; changed same-generation content conflicts', () => {
  const first = delivered()
  const db = dbWithParcel(first)
  assert.equal(settleNpcInventoryRestock(db, actor, account, 0).code, 'restocked')
  const afterFirst = snapshot((db.livingWorld as { npcInventory: unknown }).npcInventory)
  assert.deepEqual(settleNpcInventoryRestock(db, actor, account, 0), { ok: true, code: 'already_restocked', duplicate: true })
  assert.deepEqual((db.livingWorld as { npcInventory: unknown }).npcInventory, afterFirst)

  const changedId = delivered(1, 4_000, { parcelId: 'parcel-other' })
  ;(db.livingWorld as { parcels: Record<string, unknown> }).parcels[actor] = { v: 1, publicId: actor, account, state: changedId }
  assert.equal(settleNpcInventoryRestock(db, actor, account, 0).code, 'parcel_generation_conflict')
  assert.deepEqual((db.livingWorld as { npcInventory: unknown }).npcInventory, afterFirst)

  const changedContent: ParcelState = { ...first, parcel: { ...first.parcel!, tripId: 'trip-altered' } }
  ;(db.livingWorld as { parcels: Record<string, unknown> }).parcels[actor] = { v: 1, publicId: actor, account, state: changedContent }
  assert.equal(settleNpcInventoryRestock(db, actor, account, 0).code, 'parcel_generation_conflict')
  assert.deepEqual((db.livingWorld as { npcInventory: unknown }).npcInventory, afterFirst)

  const second = delivered(2, 5_000, { parcelId: 'parcel-2' })
  ;(db.livingWorld as { parcels: Record<string, unknown> }).parcels[actor] = { v: 1, publicId: actor, account, state: second }
  assert.equal(settleNpcInventoryRestock(db, actor, account, 1).code, 'restocked')
  const afterSecond = snapshot((db.livingWorld as { npcInventory: unknown }).npcInventory)
  ;(db.livingWorld as { parcels: Record<string, unknown> }).parcels[actor] = { v: 1, publicId: actor, account, state: first }
  assert.deepEqual(settleNpcInventoryRestock(db, actor, account, 0), { ok: true, code: 'already_restocked', duplicate: true })
  assert.deepEqual((db.livingWorld as { npcInventory: unknown }).npcInventory, afterSecond)
})

test('sequential outlet revisions make a prior effect stale and the next settlement CAS advances from current stock', () => {
  const first = delivered(1, 4_000, { actor })
  const secondActor = 'guest-2'
  const second = delivered(1, 4_500, { actor: secondActor })
  const db = dbWithParcel(first)
  const rows = (db.livingWorld as { parcels: Record<string, unknown> }).parcels
  rows[secondActor] = { v: 1, publicId: secondActor, account: 'account-2', state: second }
  const firstResult = settleNpcInventoryRestock(db, actor, account, 0)
  const secondResult = settleNpcInventoryRestock(db, secondActor, 'account-2', 1)
  assert.equal(firstResult.ok && firstResult.code === 'restocked' ? firstResult.effect.stock.expectedRevision : null, 0)
  assert.equal(secondResult.ok && secondResult.code === 'restocked' ? secondResult.effect.stock.expectedRevision : null, 1)
  assert.deepEqual((db.livingWorld as { npcInventory: { outlet: { stock: number; revision: number } } }).npcInventory.outlet,
    { id: NPC_RESTOCK_POLICY.outletId, cityId: 'lagos', product: 'water', capacity: 60, stock: 6, revision: 2 })
})

test('stale server-side inventory revision refuses without changing outlet or watermark', () => {
  const priorActor = 'prior-carrier'
  const db = dbWithParcel(delivered(1, 4_000, { actor: priorActor }))
  assert.equal(settleNpcInventoryRestock(db, priorActor, account, 0).code, 'restocked')
  ;(db.livingWorld as { parcels: Record<string, unknown> }).parcels[actor] = { v: 1, publicId: actor, account, state: delivered() }
  const before = snapshot(db.livingWorld)
  assert.equal(settleNpcInventoryRestock(db, actor, account, 0).code, 'revision_conflict')
  assert.deepEqual(db.livingWorld, before)
  const current = settleNpcInventoryRestock(db, actor, account, 1)
  assert.equal(current.ok && current.code === 'restocked' ? current.effect.stock.expectedRevision : null, 1)
})

test('only the persisted actor/account-bound envelope and authored delivered terms are eligible', () => {
  const good = delivered()
  assert.deepEqual(readValidatedNpcParcelEnvelope({ v: 1, publicId: actor, account, state: good }, actor, account), good)
  const empty = emptyParcelState(actor)
  assert.deepEqual(readValidatedNpcParcelEnvelope({ v: 1, publicId: actor, account, state: empty }, actor, account), empty,
    'the privacy/export reader accepts an actor-bound canonical empty state')
  const emptyDb = dbWithParcel(empty)
  const emptyBefore = snapshot(emptyDb.livingWorld)
  assert.equal(settleNpcInventoryRestock(emptyDb, actor, account, 0).code, 'parcel_not_delivered')
  assert.deepEqual(emptyDb.livingWorld, emptyBefore)
  for (const envelope of [
    { v: 2, publicId: actor, account, state: good },
    { v: 1, publicId: 'guest-other', account, state: good },
    { v: 1, publicId: actor, account: 'account-other', state: good },
    { v: 1, publicId: actor, account, state: { ...good, unknown: true } },
  ]) assert.equal(readValidatedNpcParcelEnvelope(envelope, actor, account), null)

  const notDelivered = { ...good, parcel: { ...good.parcel!, status: 'collected', custody: 'carrier', terminalAt: undefined } } as unknown
  const db = dbWithParcel(good)
  const rows = (db.livingWorld as { parcels: Record<string, Record<string, unknown>> }).parcels
  rows[actor] = { v: 1, publicId: actor, account, state: notDelivered }
  assert.equal(settleNpcInventoryRestock(db, actor, account, 0).code, 'parcel_unavailable')
  assert.equal('npcInventory' in (db.livingWorld as object), false)

  for (const altered of [
    delivered(1, 4_000, { originId: 'other-supplier' }),
    delivered(1, 4_000, { destinationId: 'player-shop' }),
    delivered(1, 4_000, { product: 'bread' }),
    delivered(1, 4_000, { quantity: 4 }),
    delivered(1, 4_000, { wage: 121 }),
  ]) {
    const isolated = dbWithParcel(altered)
    assert.equal(settleNpcInventoryRestock(isolated, actor, account, 0).code, 'parcel_terms_mismatch')
    assert.equal('npcInventory' in (isolated.livingWorld as object), false)
  }
})

test('wrong actor/account, malformed source, and absent source never bootstrap or rewrite storage', () => {
  const source = delivered()
  const db = dbWithParcel(source)
  const before = snapshot(db.livingWorld)
  assert.equal(settleNpcInventoryRestock(db, 'guest-other', account, 0).code, 'parcel_missing')
  assert.equal(settleNpcInventoryRestock(db, actor, 'account-other', 0).code, 'parcel_unavailable')
  assert.deepEqual(db.livingWorld, before)

  const absent = { version: 1, sessions: {} } as unknown as Db
  assert.equal(settleNpcInventoryRestock(absent, actor, account, 0).code, 'parcel_source_unavailable')
  assert.equal('livingWorld' in absent, false)

  const malformed = dbWithParcel(source)
  ;(malformed.livingWorld as { parcels: unknown }).parcels = null
  const malformedBefore = snapshot(malformed.livingWorld)
  assert.equal(settleNpcInventoryRestock(malformed, actor, account, 0).code, 'parcel_source_unavailable')
  assert.deepEqual(malformed.livingWorld, malformedBefore)
})

test('lost or understated settlement witnesses quarantine retained terminal parcels without a new wage', () => {
  const db = dbWithParcel(delivered())
  assert.equal(settleNpcInventoryRestock(db, actor, account, 0).code, 'restocked')
  ;(db.livingWorld as { parcels: Record<string, unknown> }).parcels[actor] = {
    v: 1, publicId: actor, account, state: delivered(2, 5_000),
  }
  assert.equal(settleNpcInventoryRestock(db, actor, account, 1).code, 'restocked')
  const valid = snapshot(db.livingWorld) as {
    npcInventory: { delivered: Record<string, { settlements: number }> }
  }
  assert.equal(valid.npcInventory.delivered[actor]!.settlements, 2, 'repeated deliveries retain their count in the latest watermark')
  for (const loseWitness of [false, true]) {
    const corrupt = snapshot(valid) as typeof valid
    if (loseWitness) delete corrupt.npcInventory.delivered[actor]
    else corrupt.npcInventory.delivered[actor]!.settlements = 1
    db.livingWorld = corrupt
    const before = snapshot(db.livingWorld)
    assert.deepEqual(settleNpcInventoryRestock(db, actor, account, 2), { ok: false, code: 'inventory_quarantined' })
    assert.deepEqual(db.livingWorld, before)
  }
})

test('throwing parcel metadata and frozen storage cannot produce a partial inventory effect', () => {
  const state = delivered()
  const envelope = { v: 1, publicId: actor, account, state }
  Object.defineProperty(envelope, 'account', { get() { throw Error('unavailable ownership') }, enumerable: true })
  assert.equal(readValidatedNpcParcelEnvelope(envelope, actor, account), null)
  const db = dbWithParcel(state)
  Object.freeze(db.livingWorld)
  const before = snapshot(db.livingWorld)
  assert.deepEqual(settleNpcInventoryRestock(db, actor, account, 0), { ok: false, code: 'inventory_unavailable' })
  assert.deepEqual(db.livingWorld, before)
})

test('finite stock capacity, watermark clock and inconsistent or future rows fail closed', () => {
  const source = delivered()
  const capped = dbWithParcel(source)
  for (let i = 0; i < 20; i++) {
    const carrier = `capacity-carrier-${i}`
    ;(capped.livingWorld as { parcels: Record<string, unknown> }).parcels[carrier] = {
      v: 1, publicId: carrier, account, state: delivered(1, 4_000 + i, { actor: carrier }),
    }
    assert.equal(settleNpcInventoryRestock(capped, carrier, account, i).code, 'restocked')
  }
  const cappedBefore = snapshot(capped.livingWorld)
  assert.equal(settleNpcInventoryRestock(capped, actor, account, 20).code, 'outlet_capacity')
  assert.deepEqual(capped.livingWorld, cappedBefore)

  const exhausted = dbWithParcel(source)
  ;(exhausted.livingWorld as { npcInventory: unknown }).npcInventory = {
    version: 1, outlet: { id: NPC_RESTOCK_POLICY.outletId, cityId: 'lagos', product: 'water', capacity: 60, stock: 0, revision: Number.MAX_SAFE_INTEGER }, delivered: {},
  }
  assert.equal(settleNpcInventoryRestock(exhausted, actor, account, Number.MAX_SAFE_INTEGER).code, 'inventory_quarantined',
    'a revision beyond the finite authored stock capacity is malformed saved state')

  const laterGeneration = delivered(2, 5_000, { parcelId: 'parcel-2' })
  const reversed = dbWithParcel(laterGeneration)
  const prior = delivered(1, 6_000)
  ;(reversed.livingWorld as { npcInventory: unknown }).npcInventory = {
    version: 1, outlet: { id: NPC_RESTOCK_POLICY.outletId, cityId: 'lagos', product: 'water', capacity: 60, stock: 3, revision: 1 },
    delivered: { [actor]: { settlements: 1, generation: 1, parcelId: 'parcel-1', deliveredAt: 6_000, parcelFingerprint: fingerprint(prior) } },
  }
  assert.equal(settleNpcInventoryRestock(reversed, actor, account, 1).code, 'clock_reversed')

  const future = dbWithParcel(source)
  ;(future.livingWorld as { npcInventory: unknown }).npcInventory = { version: 3, outlet: {}, delivered: {}, erasedSettlements: 0 }
  const futureBefore = snapshot(future.livingWorld)
  assert.equal(settleNpcInventoryRestock(future, actor, account, 0).code, 'inventory_quarantined')
  assert.deepEqual(future.livingWorld, futureBefore)

  const mismatchedStock = dbWithParcel(source)
  ;(mismatchedStock.livingWorld as { npcInventory: unknown }).npcInventory = {
    version: 1, outlet: { id: NPC_RESTOCK_POLICY.outletId, cityId: 'lagos', product: 'water', capacity: 60, stock: 2, revision: 1 }, delivered: {},
  }
  const mismatchedStockBefore = snapshot(mismatchedStock.livingWorld)
  assert.equal(settleNpcInventoryRestock(mismatchedStock, actor, account, 1).code, 'inventory_quarantined',
    'with no consumption path, stock must equal the fixed quantity times the monotonic revision')
  assert.deepEqual(mismatchedStock.livingWorld, mismatchedStockBefore)

  const otherActorState = delivered(1, 4_000, { actor: 'guest-2' })
  const wrongFingerprint = dbWithParcel(source)
  ;(wrongFingerprint.livingWorld as { npcInventory: unknown }).npcInventory = {
    version: 1, outlet: { id: NPC_RESTOCK_POLICY.outletId, cityId: 'lagos', product: 'water', capacity: 60, stock: 3, revision: 1 },
    delivered: { [actor]: { settlements: 1, generation: 1, parcelId: 'parcel-1', deliveredAt: 4_000, parcelFingerprint: fingerprint(otherActorState) } },
  }
  assert.equal(settleNpcInventoryRestock(wrongFingerprint, actor, account, 1).code, 'inventory_quarantined',
    'a watermark fingerprint must decode to this actor and this exact delivered parcel')

  const impossibleCounters = dbWithParcel(source)
  ;(impossibleCounters.livingWorld as { npcInventory: unknown }).npcInventory = {
    version: 1, outlet: { id: NPC_RESTOCK_POLICY.outletId, cityId: 'lagos', product: 'water', capacity: 60, stock: 3, revision: 1 },
    delivered: {
      [actor]: { settlements: 1, generation: 1, parcelId: 'parcel-1', deliveredAt: 4_000, parcelFingerprint: fingerprint(source) },
      'guest-2': { settlements: 1, generation: 1, parcelId: 'parcel-1', deliveredAt: 4_000, parcelFingerprint: fingerprint(otherActorState) },
    },
  }
  const impossibleBefore = snapshot(impossibleCounters.livingWorld)
  assert.equal(settleNpcInventoryRestock(impossibleCounters, actor, account, 1).code, 'inventory_quarantined',
    'watermark fingerprints must be a matching strict terminal row, and row count cannot exceed total settlements')
  assert.deepEqual(impossibleCounters.livingWorld, impossibleBefore)
})
