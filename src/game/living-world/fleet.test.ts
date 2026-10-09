import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AUTHORED_FLEET_UNITS, MAX_FLEET_RECORD_BYTES, allocateFleetUnit, emptyFleetState,
  readValidatedFleetState, revalidateFleetLease, returnFleetUnit,
  type TrustedFleetEvidence, type TrustedFleetReturnPose,
} from './fleet.ts'
import { STARTER_TRIP_LEASE_MS } from './rental.ts'

// These are pure contract fixtures only. A future adapter must construct these proofs from trusted same-transaction
// qualification, rental, mapped-route/depot, and server-pose authorities; none is a real vehicle or live permission.
const evidence = (actor: string, at: number, patch: Partial<TrustedFleetEvidence> = {}): TrustedFleetEvidence => ({
  actor, cityId: 'lagos', at, resourceId: 'marina-starter-sedan',
  qualification: { id: 'district-driving', version: 1, status: 'active' },
  permission: { actor, resourceId: 'marina-starter-sedan', scope: 'district-driving', qualificationId: 'district-driving', qualificationVersion: 1, issuedAt: 50, status: 'active' },
  route: { id: 'fictional-marina-route', version: '1', cityId: 'lagos', depotId: 'marina-fictional-depot', verified: true, available: true },
  depot: { id: 'marina-fictional-depot', cityId: 'lagos', available: true }, ...patch,
})
function allocation(state: ReturnType<typeof emptyFleetState>, who: string, at: number, requestId = `start-${who}-${state.revision}`, expectedRevision = state.revision) {
  return allocateFleetUnit(state, { cityId: 'lagos', requestId, expectedRevision }, evidence(who, at))
}
function pose(lease: NonNullable<ReturnType<typeof emptyFleetState>['units'][number]['lease']>, unitId: string, at: number,
  patch: Partial<TrustedFleetReturnPose> = {}): TrustedFleetReturnPose {
  return { actor: lease.actor, tripId: lease.tripId, unitId, cityId: lease.cityId, depotId: lease.depotId, verified: true, stopped: true, at, ...patch }
}
function snapshot<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }

test('separate catalogue permission allocates one unique custodial unit with stable start replay and strict storage', () => {
  const initial = emptyFleetState()
  assert.equal(Object.isFrozen(AUTHORED_FLEET_UNITS), true)
  assert.equal(Object.isFrozen(AUTHORED_FLEET_UNITS[0]), true)
  assert.equal(AUTHORED_FLEET_UNITS.length <= 8, true)
  assert.equal(new Set(AUTHORED_FLEET_UNITS.map(unit => unit.id)).size, AUTHORED_FLEET_UNITS.length)
  assert.equal(new Set(AUTHORED_FLEET_UNITS.map(unit => unit.resourceId)).size, 1)
  assert.notEqual(AUTHORED_FLEET_UNITS[0]!.id, AUTHORED_FLEET_UNITS[0]!.resourceId)
  assert.deepEqual(readValidatedFleetState(initial), initial)
  const before = snapshot(initial)
  const request = { cityId: 'lagos', requestId: 'start-ada-0', expectedRevision: 0 }
  const started = allocateFleetUnit(initial, request, evidence('ada', 100))
  assert.ok(started.ok)
  assert.deepEqual([started.ok, started.code, started.unitId], [true, 'unit_allocated', 'marina-sedan-01'])
  assert.deepEqual(initial, before, 'allocation copies the state instead of mutating the stored source')
  assert.deepEqual(readValidatedFleetState(started.state), started.state)
  const lease = started.state.units[0]!.lease!
  assert.deepEqual([lease.resourceId, lease.status, lease.startedAt, lease.expiresAt], ['marina-starter-sedan', 'active', 100, 100 + STARTER_TRIP_LEASE_MS])
  assert.equal('owner' in lease, false, 'custody does not transfer ownership')

  const duplicate = allocateFleetUnit(started.state, request, evidence('ada', 101))
  assert.ok(duplicate.ok)
  assert.deepEqual([duplicate.ok, duplicate.code, duplicate.unitId, duplicate.state], [true, 'duplicate', started.unitId, started.state])
  const changed = allocateFleetUnit(started.state, { ...request, expectedRevision: 1 }, evidence('ada', 101))
  assert.deepEqual([changed.ok, changed.code, changed.state], [false, 'request_conflict', started.state])
  const secondForAda = allocation(started.state, 'ada', 102)
  assert.deepEqual([secondForAda.ok, secondForAda.code, secondForAda.state], [false, 'custody_retained', started.state])

  const bob = allocation(started.state, 'bob', 103)
  assert.ok(bob.ok)
  assert.deepEqual([bob.ok, bob.unitId, bob.state.units[1]!.lease?.actor], [true, 'marina-sedan-02', 'bob'])
  const clockReversedReplay = allocateFleetUnit(bob.state, request, evidence('ada', 102))
  assert.deepEqual([clockReversedReplay.ok, clockReversedReplay.code, clockReversedReplay.state], [false, 'request_conflict', bob.state])
  assert.equal(readValidatedFleetState(bob.state)?.units.length, 4)
  assert.equal(JSON.stringify(bob.state).length <= MAX_FLEET_RECORD_BYTES, true)

  const expired = revalidateFleetLease(started.state, { tripId: lease.tripId, expectedRevision: started.state.revision }, evidence('ada', lease.expiresAt))
  assert.ok(expired.ok)
  const recoveryReplay = allocateFleetUnit(expired.state, request, evidence('ada', lease.expiresAt))
  assert.deepEqual([recoveryReplay.ok, recoveryReplay.code, recoveryReplay.state], [false, 'request_conflict', expired.state])
})

test('a stale competing actor loses CAS; only one winner can retain a unit from the same snapshot', () => {
  const empty = emptyFleetState()
  const adaRequest = { cityId: 'lagos', requestId: 'race-ada', expectedRevision: 0 }
  const bobRequest = { cityId: 'lagos', requestId: 'race-bob', expectedRevision: 0 }
  const adaCandidate = allocateFleetUnit(empty, adaRequest, evidence('ada', 100))
  const bobCandidate = allocateFleetUnit(empty, bobRequest, evidence('bob', 100))
  assert.ok(adaCandidate.ok && bobCandidate.ok, 'pure calculations over one snapshot each propose the same first unit')
  assert.deepEqual([adaCandidate.unitId, bobCandidate.unitId], ['marina-sedan-01', 'marina-sedan-01'])
  // The service transaction commits exactly one candidate, then retries the other against the winning revision.
  const committed = adaCandidate.state
  const loser = allocateFleetUnit(committed, bobRequest, evidence('bob', 101))
  assert.deepEqual([loser.ok, loser.code, loser.state], [false, 'revision_conflict', committed])
  const ada = committed
  assert.equal(ada.units.filter(unit => unit.lease && unit.lease.status !== 'returned').length, 1)
  const nextActor = allocation(ada, 'bob', 102)
  assert.ok(nextActor.ok)
  assert.deepEqual([nextActor.ok, nextActor.unitId], [true, 'marina-sedan-02'])
})

test('unverified route, unavailable depot, revoked qualification, mismatched grant and bad requests refuse unchanged', () => {
  const state = emptyFleetState(), request = { cityId: 'lagos', requestId: 'blocked-start', expectedRevision: 0 }
  const cases: [string, TrustedFleetEvidence, string][] = [
    ['unverified', evidence('ada', 100, { route: { ...evidence('ada', 100).route, verified: false } }), 'route_unverified'],
    ['route absent', evidence('ada', 100, { route: { ...evidence('ada', 100).route, available: false } }), 'fleet_unavailable'],
    ['depot absent', evidence('ada', 100, { depot: { ...evidence('ada', 100).depot, available: false } }), 'fleet_unavailable'],
    ['qualification revoked', evidence('ada', 100, { qualification: { id: 'district-driving', version: 1, status: 'revoked' } }), 'qualification_required'],
    ['permission revoked', evidence('ada', 100, { permission: { ...evidence('ada', 100).permission, status: 'revoked' } }), 'permission_required'],
    ['foreign permission', evidence('ada', 100, { permission: { ...evidence('ada', 100).permission, actor: 'bob' } }), 'permission_required'],
    ['route city mismatch', evidence('ada', 100, { route: { ...evidence('ada', 100).route, cityId: 'ibadan' } }), 'route_changed'],
    ['permission predates grant', evidence('ada', 49), 'permission_not_issued'],
  ]
  for (const [label, proof, code] of cases) {
    const result = allocateFleetUnit(state, request, proof)
    assert.deepEqual([label, result.ok, result.code, result.state], [label, false, code, state])
  }
  assert.deepEqual(allocateFleetUnit(state, { ...request, extra: true }, evidence('ada', 100)), { ok: false, code: 'invalid_request', state })
  assert.deepEqual(allocateFleetUnit(state, request, evidence('ada', 100, { at: -1 })), { ok: false, code: 'evidence_required', state })
  assert.deepEqual(allocateFleetUnit(state, request, evidence('ada', Number.MAX_SAFE_INTEGER - 1)), { ok: false, code: 'invalid_time', state })
  const exhausted = { ...state, revision: Number.MAX_SAFE_INTEGER }
  assert.deepEqual(allocateFleetUnit(exhausted, { ...request, expectedRevision: Number.MAX_SAFE_INTEGER }, evidence('ada', 100)),
    { ok: false, code: 'counter_exhausted', state: exhausted })
})

test('expiry and revocation retain custody until verified stopped depot return; only then can the unit be reused', () => {
  const started = allocation(emptyFleetState(), 'ada', 100)
  assert.ok(started.ok)
  const unitId = started.unitId!, lease = started.state.units[0]!.lease!
  const current = revalidateFleetLease(started.state, { tripId: lease.tripId, expectedRevision: started.state.revision }, evidence('ada', 101))
  assert.deepEqual([current.ok, current.code, current.state], [true, 'lease_current', started.state])
  const expired = revalidateFleetLease(started.state, { tripId: lease.tripId, expectedRevision: started.state.revision }, evidence('ada', lease.expiresAt))
  assert.ok(expired.ok && expired.code === 'recovery_required')
  assert.deepEqual([expired.state.units[0]!.lease?.status, expired.state.units[0]!.lease?.recoveryReason], ['recovery', 'lease_expired'])
  assert.deepEqual(readValidatedFleetState(expired.state), expired.state)
  const before = snapshot(expired.state)
  const held = allocation(expired.state, 'ada', lease.expiresAt + 1)
  assert.deepEqual([held.ok, held.code, held.state], [false, 'custody_retained', expired.state])
  const wrongActor = revalidateFleetLease(expired.state, { tripId: lease.tripId, expectedRevision: expired.state.revision }, evidence('bob', lease.expiresAt + 2))
  assert.deepEqual([wrongActor.ok, wrongActor.code, wrongActor.state], [false, 'wrong_actor', expired.state])

  const returnInput = { cityId: 'lagos', requestId: 'return-ada', tripId: lease.tripId, expectedRevision: expired.state.revision }
  const wrongPlace = returnFleetUnit(expired.state, returnInput, pose(lease, unitId, lease.expiresAt + 3, { depotId: 'wrong-depot' }))
  const moving = returnFleetUnit(expired.state, returnInput, pose(lease, unitId, lease.expiresAt + 3, { stopped: false }))
  const wrongOwner = returnFleetUnit(expired.state, returnInput, pose(lease, unitId, lease.expiresAt + 3, { actor: 'bob' }))
  assert.deepEqual([wrongPlace.code, wrongPlace.state, moving.code, moving.state, wrongOwner.code, wrongOwner.state],
    ['return_evidence_required', before, 'return_evidence_required', before, 'wrong_actor', before])
  const returned = returnFleetUnit(expired.state, returnInput, pose(lease, unitId, lease.expiresAt + 4))
  assert.ok(returned.ok && returned.code === 'unit_returned')
  assert.deepEqual([returned.state.units[0]!.lease?.status, returned.state.units[0]!.lease?.returnedAt], ['returned', lease.expiresAt + 4])
  assert.deepEqual(readValidatedFleetState(returned.state), returned.state)
  const replay = returnFleetUnit(returned.state, returnInput, pose(lease, unitId, lease.expiresAt + 4))
  assert.deepEqual([replay.ok, replay.code, replay.state], [true, 'duplicate', returned.state], 'same return request cannot increment chronology twice')
  for (const badPose of [
    pose(lease, unitId, lease.expiresAt + 4, { cityId: 'ibadan' }),
    pose(lease, unitId, lease.expiresAt + 4, { depotId: 'wrong-depot' }),
    pose(lease, unitId, lease.expiresAt + 4, { stopped: false }),
    pose(lease, unitId, lease.expiresAt + 4, { verified: false }),
    pose(lease, unitId, lease.expiresAt + 3),
  ]) {
    const refusedReplay = returnFleetUnit(returned.state, returnInput, badPose)
    assert.deepEqual([refusedReplay.ok, refusedReplay.state], [false, returned.state])
  }
  const next = allocation(returned.state, 'ada', lease.expiresAt + 5)
  assert.ok(next.ok)
  assert.deepEqual([next.ok, next.unitId, next.state.generation, next.state.units[0]!.lease?.tripId], [true, unitId, 2, 'fleet-lease-2'])
  const staleStart = allocateFleetUnit(next.state, { cityId: 'lagos', requestId: 'start-ada-0', expectedRevision: 0 }, evidence('ada', lease.expiresAt + 6))
  assert.deepEqual([staleStart.ok, staleStart.code, staleStart.state], [false, 'revision_conflict', next.state])
  assert.notEqual(next.state.units[0]!.lease?.startRequestId, 'start-ada-0', 'the exact old receipt cannot reset a reused unit or claim its new generation')
})

test('an early returned lease cannot be revived by its original start receipt', () => {
  const started = allocation(emptyFleetState(), 'ada', 100)
  assert.ok(started.ok)
  const lease = started.state.units[0]!.lease!
  const returned = returnFleetUnit(started.state,
    { cityId: 'lagos', requestId: 'early-return', tripId: lease.tripId, expectedRevision: started.state.revision },
    pose(lease, started.unitId!, 101))
  assert.ok(returned.ok)
  const replay = allocateFleetUnit(returned.state,
    { cityId: 'lagos', requestId: 'start-ada-0', expectedRevision: 0 }, evidence('ada', 102))
  assert.deepEqual([replay.ok, replay.code, replay.state], [false, 'request_conflict', returned.state])
  assert.equal(returned.state.units[0]!.lease?.status, 'returned')
})

test('qualification and permission loss also stop authority while preserving the assigned unit for recovery', () => {
  const started = allocation(emptyFleetState(), 'ada', 100)
  assert.ok(started.ok)
  const lease = started.state.units[0]!.lease!
  const revokedQualification = revalidateFleetLease(started.state, { tripId: lease.tripId, expectedRevision: started.state.revision }, evidence('ada', 110,
    { qualification: { id: 'district-driving', version: 1, status: 'revoked' } }))
  assert.ok(revokedQualification.ok && revokedQualification.state.units[0]!.lease?.recoveryReason === 'qualification_revoked')
  const revokedPermission = revalidateFleetLease(started.state, { tripId: lease.tripId, expectedRevision: started.state.revision }, evidence('ada', 110,
    { permission: { ...evidence('ada', 110).permission, status: 'revoked' } }))
  assert.ok(revokedPermission.ok && revokedPermission.state.units[0]!.lease?.recoveryReason === 'permission_revoked')
  const changedRoute = revalidateFleetLease(started.state, { tripId: lease.tripId, expectedRevision: started.state.revision }, evidence('ada', 110,
    { route: { ...evidence('ada', 110).route, version: '2' } }))
  assert.ok(changedRoute.ok && changedRoute.state.units[0]!.lease?.recoveryReason === 'route_changed')
  for (const recovered of [revokedQualification, revokedPermission, changedRoute]) {
    assert.ok(recovered.ok)
    assert.equal(recovered.state.units[0]!.lease?.actor, 'ada')
    assert.deepEqual(readValidatedFleetState(recovered.state), recovered.state)
  }
})

test('strict reader quarantines impossible chronology, duplicate custody, unknown units, and future fields unchanged', () => {
  const state = allocation(emptyFleetState(), 'ada', 100).state
  const lease = state.units[0]!.lease!
  const mutations: unknown[] = [
    { ...state, future: true },
    { ...state, units: state.units.slice(1) },
    { ...state, units: [{ ...state.units[0], id: 'unknown-unit' }, ...state.units.slice(1)] },
    { ...state, lastAt: lease.startedAt - 1 },
    { ...state, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...state, units: state.units.map((unit, index) => index === 0 ? { ...unit, lease: { ...lease, actor: 'not-the-unit-owner' } } : unit) },
    { ...state, units: state.units.map((unit, index) => index === 1 ? { ...unit, generation: 1, lease: { ...lease, tripId: 'fleet-lease-1' } } : unit) },
    { ...state, units: state.units.map((unit, index) => index === 0 ? { ...unit, lease: { ...lease, expiresAt: lease.startedAt + 1 } } : unit) },
  ]
  for (const source of mutations) {
    const before = snapshot(source)
    assert.equal(readValidatedFleetState(source), null)
    assert.deepEqual(source, before, 'invalid state is never repaired or reset')
  }
  assert.deepEqual(readValidatedFleetState({ ...state, units: state.units.map((unit, index) => index === 0 ? { ...unit, lease: { ...lease, recoveryReason: 'future-reason' } } : unit) }), null)
})
