import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyRentalState, earnStarterEntitlement, readValidatedRentalState, revalidateRental, returnRental, revokeStarterEntitlement, startRental, STARTER_TRIP_LEASE_MS } from './rental.ts'
import type { RentalState, TrustedTripEvidence } from './rental.ts'

const evidence = (at = 1_000, overrides: Partial<TrustedTripEvidence> = {}): TrustedTripEvidence => ({
  actor: 'guest-1', resourceId: 'starter-car', custodyPointId: 'depot-1',
  qualification: { id: 'district-driving', version: 1, status: 'active' }, resourceAvailable: true, at,
  cityId: 'district-1', routeId: 'course-1', routeVersion: 'v1', ...overrides,
})
function earned(): RentalState {
  const result = earnStarterEntitlement(emptyRentalState(), evidence())
  assert.equal(result.ok, true)
  return result.state
}
function start(state: RentalState, ev = evidence(2_000), overrides: Partial<Parameters<typeof startRental>[1]> = {}) {
  return startRental(state, { requestId: 'req-1', tripId: 'trip-1', expectedRevision: state.revision, expectedGeneration: state.generation,
    actor: 'guest-1', resourceId: 'starter-car', cityId: 'district-1', routeId: 'course-1', routeVersion: 'v1', at: ev.at, ...overrides }, ev)
}

test('starter entitlement is stable and separate from a finite no-cash vehicle lease', () => {
  const initial = emptyRentalState(), before = structuredClone(initial)
  const earnedState = earned()
  assert.deepEqual(initial, before)
  assert.equal(earnedState.entitlement?.status, 'active')
  assert.equal('expiresAt' in (earnedState.entitlement ?? {}), false)
  assert.equal('owner' in earnedState, false)
  const result = start(earnedState)
  assert.equal(result.ok, true)
  const trip = result.state.trip!
  assert.equal(trip.status, 'active'); assert.equal(trip.custody, 'renter')
  assert.equal(trip.scope, 'district-driving')
  assert.equal(trip.expiresAt - trip.startedAt, STARTER_TRIP_LEASE_MS)
  assert.equal('cash' in trip, false); assert.equal('ownership' in trip, false)
  assert.deepEqual(earnedState, earned(), 'transitions leave prior state unchanged')
  const retry = startRental(result.state, { requestId: 'req-1', tripId: 'trip-1', expectedRevision: earnedState.revision, expectedGeneration: 0,
    actor: 'guest-1', resourceId: 'starter-car', cityId: 'district-1', routeId: 'course-1', routeVersion: 'v1', at: 99_000 }, evidence(99_000))
  assert.equal(retry.code, 'duplicate')
  assert.deepEqual(retry.state, result.state)
  const second = start(result.state, evidence(3_000), { requestId: 'req-2', tripId: 'trip-2' })
  assert.equal(second.code, 'trip_active')
})

test('expiry and revoked qualification stop the trip while custody stays with renter until verified return', () => {
  const begun = start(earned()).state, trip = begun.trip!
  const expired = revalidateRental(begun, begun.revision, trip.expiresAt, evidence(trip.expiresAt))
  assert.equal(expired.code, 'recovery_required')
  assert.equal(expired.state.trip?.status, 'recovery'); assert.equal(expired.state.trip?.recoveryReason, 'lease_expired')
  assert.equal(expired.state.trip?.custody, 'renter')
  assert.equal(start(expired.state, evidence(trip.expiresAt + 1), { requestId: 'req-2', tripId: 'trip-2' }).code, 'recovery_required')
  const badReturn = returnRental(expired.state, { requestId: 'return-bad', tripId: trip.id, expectedRevision: expired.state.revision, actor: trip.actor, at: trip.expiresAt + 2 },
    { verified: true, tripId: trip.id, actor: trip.actor, resourceId: trip.resourceId, custodyPointId: 'elsewhere' })
  assert.equal(badReturn.code, 'return_evidence_required')
  assert.deepEqual(badReturn.state, expired.state)
  const returned = returnRental(expired.state, { requestId: 'return-1', tripId: trip.id, expectedRevision: expired.state.revision, actor: trip.actor, at: trip.expiresAt + 2 },
    { verified: true, tripId: trip.id, actor: trip.actor, resourceId: trip.resourceId, custodyPointId: trip.custodyPointId })
  assert.equal(returned.code, 'returned'); assert.equal(returned.state.trip?.custody, 'depot')
  assert.equal('recoveryReason' in (returned.state.trip ?? {}), false)
  assert.deepEqual(readValidatedRentalState(returned.state), returned.state, 'recovery rows return as a canonical readable terminal row')
  const next = start(returned.state, evidence(trip.expiresAt + 3), { requestId: 'req-2', tripId: 'trip-2' })
  assert.equal(next.code, 'lease_started'); assert.equal(next.state.generation, trip.generation + 1)
  const replayOldStart = startRental(next.state, { requestId: 'req-1', tripId: 'trip-1', expectedRevision: 1, expectedGeneration: 0,
    actor: 'guest-1', resourceId: 'starter-car', cityId: 'district-1', routeId: 'course-1', routeVersion: 'v1', at: 2_000 }, evidence(2_000))
  assert.equal(replayOldStart.ok, false)
  assert.equal(replayOldStart.code, 'generation_conflict')
})

test('revocation and changed qualification or route enter recovery without releasing custody', () => {
  const begun = start(earned()).state
  const revoked = revokeStarterEntitlement(begun, begun.revision)
  assert.equal(revoked.code, 'recovery_required'); assert.equal(revoked.state.trip?.recoveryReason, 'entitlement_revoked')
  assert.equal(revoked.state.trip?.custody, 'renter')
  const current = start(earned()).state
  const changed = revalidateRental(current, current.revision, 3_000, evidence(3_000, { routeVersion: 'v2' }))
  assert.equal(changed.state.trip?.recoveryReason, 'route_changed')
  const qual = revalidateRental(current, current.revision, 3_000, evidence(3_000, { qualification: { id: 'district-driving', version: 2, status: 'active' } }))
  assert.equal(qual.state.trip?.recoveryReason, 'qualification_changed')
  const unavailable = revalidateRental(current, current.revision, 3_000, evidence(3_000, { resourceAvailable: false }))
  assert.equal(unavailable.state.trip?.recoveryReason, 'resource_unavailable')
  const revokedQualification = revalidateRental(current, current.revision, 3_000, evidence(3_000, { qualification: { id: 'district-driving', version: 1, status: 'revoked' } }))
  assert.equal(revokedQualification.state.trip?.recoveryReason, 'qualification_revoked')
})

test('start requires exact trusted actor, active qualification, route, and available resource evidence', () => {
  const state = earned(), before = structuredClone(state)
  assert.equal(start(state, evidence(2_000, { actor: 'other-actor' })).code, 'evidence_required')
  assert.equal(start(state, evidence(2_000, { qualification: { id: 'district-driving', version: 1, status: 'revoked' } })).code, 'evidence_required')
  assert.equal(start(state, evidence(2_000, { resourceAvailable: false })).code, 'evidence_required')
  assert.equal(start(state, evidence(2_000, { routeId: 'other-route' })).code, 'evidence_required')
  assert.deepEqual(state, before)
})

test('strict bounded reader accepts a public actor ID at the established 100-character limit', () => {
  const actor = `a${'b'.repeat(99)}`
  const actorEvidence = evidence(1_000, { actor })
  const entitlement = earnStarterEntitlement(emptyRentalState(), actorEvidence).state
  const input = { requestId: 'req-long-actor', tripId: 'trip-long-actor', expectedRevision: entitlement.revision, expectedGeneration: 0,
    actor, resourceId: 'starter-car', cityId: 'district-1', routeId: 'course-1', routeVersion: 'v1', at: 2_000 }
  const state = startRental(entitlement, input, evidence(2_000, { actor })).state
  assert.equal(state.trip?.actor.length, 100)
  assert.deepEqual(readValidatedRentalState(state), state)
})

test('strict reader rejects malformed, future, extra, and inconsistent persisted source without repairing it', () => {
  const valid = start(earned()).state, saved = structuredClone(valid)
  assert.deepEqual(readValidatedRentalState(valid), valid)
  const badStatus = { ...valid, trip: { ...valid.trip!, status: 'active', custody: 'depot' } }
  const future = { ...valid, version: 2 }
  const extra = { ...valid, unknown: true }
  assert.equal(readValidatedRentalState(badStatus), null)
  assert.equal(readValidatedRentalState(future), null)
  assert.equal(readValidatedRentalState(extra), null)
  assert.deepEqual(valid, saved)
  assert.equal(readValidatedRentalState(null), null)
})

test('every monotonic counter refuses exhaustion without wrapping or mutating input', () => {
  const max = Number.MAX_SAFE_INTEGER

  const emptyAtLimit = { ...emptyRentalState(), revision: max }
  const emptyBefore = structuredClone(emptyAtLimit)
  assert.equal(earnStarterEntitlement(emptyAtLimit, evidence()).code, 'revision_exhausted')
  assert.deepEqual(emptyAtLimit, emptyBefore)

  const earnedAtLimit = { ...earned(), revision: max }
  const earnedBefore = structuredClone(earnedAtLimit)
  const blockedStart = start(earnedAtLimit, evidence(2_000), { expectedRevision: max })
  assert.equal(blockedStart.code, 'state_exhausted')
  assert.deepEqual(earnedAtLimit, earnedBefore)

  const active = start(earned()).state
  const activeAtLimit = { ...active, revision: max }
  const activeBefore = structuredClone(activeAtLimit)
  assert.equal(revalidateRental(activeAtLimit, max, active.trip!.expiresAt, evidence(active.trip!.expiresAt)).code, 'revision_exhausted')
  assert.equal(returnRental(activeAtLimit, { requestId: 'return-limit', tripId: active.trip!.id, expectedRevision: max, actor: active.trip!.actor, at: active.trip!.expiresAt },
    { verified: true, tripId: active.trip!.id, actor: active.trip!.actor, resourceId: active.trip!.resourceId, custodyPointId: active.trip!.custodyPointId }).code, 'revision_exhausted')
  assert.deepEqual(activeAtLimit, activeBefore)

  const entitlementAtLimit = { ...earned(), revision: max }
  const entitlementBefore = structuredClone(entitlementAtLimit)
  assert.equal(revokeStarterEntitlement(entitlementAtLimit, max).code, 'revision_exhausted')
  assert.deepEqual(entitlementAtLimit, entitlementBefore)

  const returned = returnRental(active, { requestId: 'return-ok', tripId: active.trip!.id, expectedRevision: active.revision, actor: active.trip!.actor, at: active.trip!.startedAt + 1 },
    { verified: true, tripId: active.trip!.id, actor: active.trip!.actor, resourceId: active.trip!.resourceId, custodyPointId: active.trip!.custodyPointId }).state
  const generationAtLimit = { ...returned, generation: max, trip: { ...returned.trip!, generation: max } }
  const generationBefore = structuredClone(generationAtLimit)
  const refused = startRental(generationAtLimit, { requestId: 'new-trip', tripId: 'new-id', expectedRevision: generationAtLimit.revision, expectedGeneration: max,
    actor: 'guest-1', resourceId: 'starter-car', cityId: 'district-1', routeId: 'course-1', routeVersion: 'v1', at: 2_000 }, evidence(2_000))
  assert.equal(refused.code, 'state_exhausted')
  assert.deepEqual(generationAtLimit, generationBefore)
})
