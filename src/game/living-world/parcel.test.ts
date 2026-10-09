import assert from 'node:assert/strict'
import test from 'node:test'
import {
  acceptParcel, cancelParcel, collectParcel, deliverParcel, emptyParcelState, expireParcel,
  MAX_PARCEL_RECORD_BYTES, offerParcel, readValidatedParcelState, returnParcel,
} from './parcel.ts'
import type { ParcelState, TrustedParcelPose, TrustedParcelRecipient, TrustedParcelTrip } from './parcel.ts'

const trip = (at = 1_000, overrides: Partial<TrustedParcelTrip> = {}): TrustedParcelTrip => ({
  actor: 'guest-1', tripId: 'trip-1', resourceId: 'starter-car', qualificationId: 'district-driving', qualificationVersion: 1,
  qualificationStatus: 'active', cityId: 'district-1', routeId: 'delivery-route', routeVersion: 'v1', active: true,
  expiresAt: 60_000, at, ...overrides,
})
const pose = (at: number, placeId: string, overrides: Partial<TrustedParcelPose> = {}): TrustedParcelPose => ({
  actor: 'guest-1', tripId: 'trip-1', placeId, at, stopped: true, verified: true, ...overrides,
})
const recipient = (overrides: Partial<TrustedParcelRecipient> = {}): TrustedParcelRecipient => ({
  shopId: 'shop-1', product: 'water', revision: 7, availableUnits: 10, open: true, ...overrides,
})
const input = (state: ParcelState) => ({ parcelId: state.parcel!.id, expectedRevision: state.revision, generation: state.generation })
function offer(state = emptyParcelState('guest-1'), evidence = trip(), overrides: Partial<Parameters<typeof offerParcel>[1]> = {}) {
  return offerParcel(state, { parcelId: 'parcel-1', expectedRevision: state.revision, expectedGeneration: state.generation,
    resourceId: 'starter-car', qualificationId: 'district-driving', qualificationVersion: 1, cityId: 'district-1', routeId: 'delivery-route', routeVersion: 'v1',
    originId: 'supplier-1', destinationId: 'shop-1', product: 'water', quantity: 3, wage: 120, expiresAt: 30_000, ...overrides }, evidence)
}
function collected() {
  const offered = offer().state
  const accepted = acceptParcel(offered, input(offered), trip(2_000))
  assert.equal(accepted.code, 'accepted')
  const state = accepted.state
  const result = collectParcel(state, input(state), trip(3_000), pose(3_000, 'supplier-1'))
  assert.equal(result.code, 'collected')
  return result.state
}

test('one server-bound offer can be collected and delivered with one immutable proposed effect', () => {
  const original = emptyParcelState('guest-1'), before = structuredClone(original)
  const offered = offer(original)
  assert.equal(offered.code, 'offered')
  assert.deepEqual(original, before)
  assert.deepEqual([offered.state.generation, offered.state.revision, offered.state.parcel?.status, offered.state.parcel?.custody], [1, 1, 'offered', 'supplier'])
  assert.deepEqual(readValidatedParcelState(offered.state), offered.state)

  const accepted = acceptParcel(offered.state, input(offered.state), trip(2_000))
  const collectedState = collectParcel(accepted.state, input(accepted.state), trip(3_000), pose(3_000, 'supplier-1')).state
  const delivered = deliverParcel(collectedState, input(collectedState), trip(4_000), pose(4_000, 'shop-1'), recipient())
  assert.equal(delivered.code, 'delivered')
  assert.ok(delivered.ok)
  assert.ok(delivered.effect)
  assert.deepEqual(delivered.effect, { parcelId: 'parcel-1', generation: 1,
    stockDelta: { shopId: 'shop-1', product: 'water', quantity: 3, expectedShopRevision: 7 }, wage: 120 })
  assert.equal(Object.isFrozen(delivered.effect), true)
  assert.equal(Object.isFrozen(delivered.effect?.stockDelta), true)
  assert.equal(Reflect.set(delivered.effect, 'wage', 0), false)
  assert.equal(Reflect.set(delivered.effect.stockDelta, 'quantity', 0), false)
  assert.deepEqual([delivered.effect.wage, delivered.effect.stockDelta.quantity], [120, 3])
  assert.equal(delivered.state.parcel?.custody, 'destination')
  assert.equal('cash' in delivered.state.parcel!, false)
  assert.deepEqual(readValidatedParcelState(delivered.state), delivered.state)

  const replay = deliverParcel(delivered.state, input(delivered.state), trip(5_000), pose(5_000, 'shop-1'), recipient())
  assert.deepEqual([replay.ok, replay.code, 'effect' in replay], [false, 'parcel_terminal', false])
  const next = offer(delivered.state, trip(6_000, { tripId: 'trip-2' }), { parcelId: 'parcel-2', expiresAt: 20_000 })
  assert.deepEqual([next.code, next.state.generation, next.state.parcel?.id], ['offered', 2, 'parcel-2'])
  const oldGeneration = acceptParcel(next.state, { parcelId: 'parcel-1', expectedRevision: next.state.revision, generation: 1 }, trip(7_000, { tripId: 'trip-2' }))
  assert.deepEqual([oldGeneration.code, oldGeneration.state], ['generation_conflict', next.state])
})

test('stale, wrong-actor, and forged caller evidence cannot collect or settle', () => {
  const offered = offer().state, savedOffer = structuredClone(offered)
  const wrongActor = acceptParcel(offered, input(offered), trip(2_000, { actor: 'guest-2' }))
  assert.deepEqual([wrongActor.ok, wrongActor.code, wrongActor.state], [false, 'evidence_mismatch', offered])
  const stale = acceptParcel(offered, { ...input(offered), expectedRevision: offered.revision + 1 }, trip(2_000))
  assert.equal(stale.code, 'revision_conflict')
  const accepted = acceptParcel(offered, input(offered), trip(2_000)).state
  const reversed = collectParcel(accepted, input(accepted), trip(1_999), pose(1_999, 'supplier-1'))
  assert.deepEqual([reversed.code, reversed.state], ['clock_reversed', accepted])
  const badPose = collectParcel(accepted, input(accepted), trip(3_000), pose(2_999, 'supplier-1'))
  assert.deepEqual([badPose.ok, badPose.code, badPose.state], [false, 'origin_pose_required', accepted])
  const wrongPlace = collectParcel(accepted, input(accepted), trip(3_000), pose(3_000, 'other-supplier'))
  const wrongPoseActor = collectParcel(accepted, input(accepted), trip(3_000), pose(3_000, 'supplier-1', { actor: 'guest-2' }))
  assert.deepEqual([wrongPlace.code, wrongPlace.state, wrongPoseActor.code, wrongPoseActor.state], ['origin_pose_required', accepted, 'origin_pose_required', accepted])
  const collectedState = collectParcel(accepted, input(accepted), trip(3_000), pose(3_000, 'supplier-1')).state
  const badRecipient = deliverParcel(collectedState, input(collectedState), trip(4_000), pose(4_000, 'shop-1'), recipient({ availableUnits: 2 }))
  assert.deepEqual([badRecipient.ok, badRecipient.code, badRecipient.state], [false, 'recipient_capacity', collectedState])
  assert.deepEqual(offered, savedOffer)

  const wrongOffer = offer(emptyParcelState('guest-1'), trip(1_000, { actor: 'guest-2' }))
  assert.deepEqual([wrongOffer.ok, wrongOffer.code, wrongOffer.state.parcel], [false, 'trip_permission_required', null])
  const wrongTrip = acceptParcel(offered, input(offered), trip(2_000, { tripId: 'trip-other' }))
  const wrongResource = acceptParcel(offered, input(offered), trip(2_000, { resourceId: 'other-car' }))
  const changedQualification = acceptParcel(offered, input(offered), trip(2_000, { qualificationVersion: 2 }))
  assert.deepEqual([wrongTrip.code, wrongTrip.state.parcel?.status, wrongTrip.state.parcel?.custody], ['cancelled', 'cancelled', 'supplier'])
  assert.deepEqual([wrongResource.code, wrongResource.state.parcel?.status, wrongResource.state.parcel?.custody], ['cancelled', 'cancelled', 'supplier'])
  assert.deepEqual([changedQualification.code, changedQualification.state.parcel?.status, changedQualification.state.parcel?.custody], ['cancelled', 'cancelled', 'supplier'])
  const routeChangedBeforeCollection = acceptParcel(offered, input(offered), trip(2_000, { routeVersion: 'v2' }))
  const leaseRevokedBeforeCollection = acceptParcel(offered, input(offered), trip(2_000, { active: false }))
  assert.deepEqual([routeChangedBeforeCollection.code, routeChangedBeforeCollection.state.parcel?.custody, leaseRevokedBeforeCollection.code, leaseRevokedBeforeCollection.state.parcel?.custody], ['cancelled', 'supplier', 'cancelled', 'supplier'])
  const extraInput = acceptParcel(offered, { ...input(offered), amount: 500 } as never, trip(2_000))
  assert.equal(extraInput.code, 'invalid_request')
})

test('expiry before collection closes at supplier; expiry after collection retains carrier custody until return', () => {
  const offered = offer().state
  const cancelled = cancelParcel(offered, input(offered), trip(2_000))
  assert.deepEqual([cancelled.code, cancelled.state.parcel?.status, cancelled.state.parcel?.custody, 'effect' in cancelled], ['cancelled', 'cancelled', 'supplier', false])
  const expired = expireParcel(offered, input(offered), offered.parcel!.expiresAt)
  assert.deepEqual([expired.code, expired.state.parcel?.status, expired.state.parcel?.custody], ['expired', 'expired', 'supplier'])
  const nextFromOrigin = offer(expired.state, trip(31_000, { tripId: 'trip-2' }), { parcelId: 'parcel-2', expiresAt: 50_000 })
  assert.deepEqual([nextFromOrigin.code, nextFromOrigin.state.generation], ['offered', 2])

  const carried = collected()
  const recovery = expireParcel(carried, input(carried), carried.parcel!.expiresAt)
  assert.deepEqual([recovery.code, recovery.state.parcel?.status, recovery.state.parcel?.custody, recovery.state.parcel?.recoveryReason],
    ['recovery_required', 'recovery', 'carrier', 'parcel_expired'])
  const repeatedExpiry = expireParcel(recovery.state, input(recovery.state), carried.parcel!.expiresAt + 1)
  assert.deepEqual([repeatedExpiry.code, repeatedExpiry.state], ['recovery_required', recovery.state])
  assert.equal(offer(recovery.state, trip(31_000, { tripId: 'trip-2' }), { parcelId: 'parcel-2', expiresAt: 50_000 }).code, 'recovery_required')
  const returned = returnParcel(recovery.state, input(recovery.state), pose(carried.parcel!.expiresAt + 1, 'supplier-1'), carried.parcel!.expiresAt + 1)
  assert.deepEqual([returned.code, returned.state.parcel?.status, returned.state.parcel?.custody, 'effect' in returned], ['returned', 'returned', 'supplier', false])
  assert.deepEqual(readValidatedParcelState(returned.state), returned.state)
  assert.equal(offer(returned.state, trip(carried.parcel!.expiresAt + 2, { tripId: 'trip-2' }), { parcelId: 'parcel-2', expiresAt: 50_000 }).state.generation, 2)
})

test('post-collection revocation retains custody and pure CAS refuses stale delivery/cancel transitions', () => {
  const carried = collected()
  const invalidated = deliverParcel(carried, input(carried), trip(4_000, { qualificationStatus: 'revoked' }), pose(4_000, 'shop-1'), recipient())
  assert.deepEqual([invalidated.code, invalidated.state.parcel?.status, invalidated.state.parcel?.custody, invalidated.state.parcel?.recoveryReason],
    ['recovery_required', 'recovery', 'carrier', 'qualification_revoked'])
  const routeChanged = deliverParcel(carried, input(carried), trip(4_000, { routeVersion: 'v2' }), pose(4_000, 'shop-1'), recipient())
  assert.deepEqual([routeChanged.code, routeChanged.state.parcel?.status, routeChanged.state.parcel?.recoveryReason], ['recovery_required', 'recovery', 'route_changed'])
  const leaseEnded = deliverParcel(carried, input(carried), trip(4_000, { active: false }), pose(4_000, 'shop-1'), recipient())
  assert.deepEqual([leaseEnded.code, leaseEnded.state.parcel?.status, leaseEnded.state.parcel?.recoveryReason], ['recovery_required', 'recovery', 'lease_revoked'])

  const cancelled = cancelParcel(carried, input(carried), trip(4_000))
  assert.deepEqual([cancelled.code, cancelled.state.parcel?.status, cancelled.state.parcel?.custody, cancelled.state.parcel?.recoveryReason],
    ['recovery_required', 'recovery', 'carrier', 'cancelled_after_collection'])
  const delivered = deliverParcel(carried, input(carried), trip(4_000), pose(4_000, 'shop-1'), recipient())
  assert.equal(delivered.code, 'delivered')
  const cancelAfterDelivery = cancelParcel(delivered.state, { ...input(delivered.state), expectedRevision: carried.revision }, trip(5_000))
  assert.deepEqual([cancelAfterDelivery.code, 'effect' in delivered], ['revision_conflict', true])
  const deliveryAfterCancel = deliverParcel(cancelled.state, { ...input(cancelled.state), expectedRevision: carried.revision }, trip(5_000), pose(5_000, 'shop-1'), recipient())
  assert.deepEqual([deliveryAfterCancel.code, 'effect' in deliveryAfterCancel], ['revision_conflict', false])
})

test('strict reader quarantines malformed source and bounded counters refuse overflow without mutation', () => {
  const state = offer().state, saved = structuredClone(state)
  assert.deepEqual(readValidatedParcelState(state), state)
  const future = { ...state, version: 2 }
  const extra = { ...state, unknown: 'future data' }
  const invalidCustody = { ...state, parcel: { ...state.parcel!, status: 'offered', custody: 'carrier' } }
  const oversized = { ...state, parcel: { ...state.parcel!, product: 'x'.repeat(5_000) } }
  assert.equal(readValidatedParcelState(future), null)
  assert.equal(readValidatedParcelState(extra), null)
  assert.equal(readValidatedParcelState(invalidCustody), null)
  assert.equal(readValidatedParcelState(oversized), null)
  assert.equal(readValidatedParcelState({ ...emptyParcelState('guest-1'), lastAt: 1 }), null)
  assert.deepEqual(state, saved)
  assert.ok(new TextEncoder().encode(JSON.stringify(state)).byteLength <= MAX_PARCEL_RECORD_BYTES)

  const long = `a${'b'.repeat(99)}`
  const longTrip = trip(1_000, { actor: long, tripId: long, resourceId: long, qualificationId: long, cityId: long, routeId: long, routeVersion: long })
  const maxBounded = offer(emptyParcelState(long), longTrip, { parcelId: long, resourceId: long, qualificationId: long,
    cityId: long, routeId: long, routeVersion: long, originId: long, product: long })
  assert.equal(maxBounded.code, 'offered')
  assert.deepEqual(readValidatedParcelState(maxBounded.state), maxBounded.state, 'the established 100-character identifier boundary remains valid')
  assert.ok(new TextEncoder().encode(JSON.stringify(maxBounded.state)).byteLength <= MAX_PARCEL_RECORD_BYTES)

  const firstOffer = offer().state
  const cancelled = cancelParcel(firstOffer, input(firstOffer), trip(2_000)).state
  const exhausted: ParcelState = { ...cancelled, revision: Number.MAX_SAFE_INTEGER }
  const before = structuredClone(exhausted)
  const refused = offer(exhausted, trip(3_000), { expectedRevision: Number.MAX_SAFE_INTEGER, parcelId: 'parcel-2' })
  assert.equal(refused.code, 'state_exhausted')
  assert.deepEqual(exhausted, before)
})

test('strict reader quarantines impossible anchor and custody timestamps without rewriting source', () => {
  const offered = offer().state
  const carried = collected()
  const delivered = deliverParcel(carried, input(carried), trip(4_000), pose(4_000, 'shop-1'), recipient()).state
  const recovery = expireParcel(carried, input(carried), carried.parcel!.expiresAt).state
  const returned = returnParcel(recovery, input(recovery), pose(carried.parcel!.expiresAt + 1, 'supplier-1'), carried.parcel!.expiresAt + 1).state
  const expired = expireParcel(offered, input(offered), offered.parcel!.expiresAt).state
  const invalidRows = [
    { ...offered, parcel: { ...offered.parcel!, destinationId: offered.parcel!.originId } },
    { ...carried, parcel: { ...carried.parcel!, collectedAt: carried.parcel!.expiresAt } },
    { ...recovery, parcel: { ...recovery.parcel!, collectedAt: recovery.parcel!.tripExpiresAt } },
    { ...delivered, parcel: { ...delivered.parcel!, terminalAt: delivered.parcel!.expiresAt } },
    { ...returned, parcel: { ...returned.parcel!, collectedAt: returned.parcel!.expiresAt } },
    { ...expired, parcel: { ...expired.parcel!, terminalAt: expired.parcel!.expiresAt - 1 } },
  ]
  for (const row of invalidRows) {
    const source = structuredClone(row)
    assert.equal(readValidatedParcelState(row), null)
    assert.deepEqual(row, source, 'invalid persisted source is returned for caller quarantine unchanged')
  }
})

test('server-authored parcel bounds allow zero wage and quantity one, while refusing out-of-range offers', () => {
  const zero = offer(emptyParcelState('guest-1'), trip(), { quantity: 1, wage: 0 })
  assert.deepEqual([zero.code, zero.state.parcel?.quantity, zero.state.parcel?.wage], ['offered', 1, 0])
  const maximum = offer(emptyParcelState('guest-1'), trip(), { quantity: 10, wage: 500 })
  assert.deepEqual([maximum.code, maximum.state.parcel?.quantity, maximum.state.parcel?.wage], ['offered', 10, 500])
  assert.equal(offer(emptyParcelState('guest-1'), trip(), { quantity: 0 }).code, 'invalid_offer')
  assert.equal(offer(emptyParcelState('guest-1'), trip(), { quantity: 11 }).code, 'invalid_offer')
  assert.equal(offer(emptyParcelState('guest-1'), trip(), { wage: 501 }).code, 'invalid_offer')
})
