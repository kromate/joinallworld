import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture, flakyDisk, snapshot } from '../test-fixture.ts'
import { ROUTE_MODULES } from '../routes/index.ts'
import type { RouteContext, RouteHandler, RouteKey, RouteModule } from '../types.ts'
import type { MappedMotionVerifier, MappedPhysicalResolver, VerifiedMappedMotion } from './mapped-trip-service.ts'
import { createMappedTripService, eraseMappedTripForOwner, readMappedTripForOwner } from './mapped-trip-service.ts'
import { createDriving, readValidatedDrivingState } from '../../src/game/living-world/driving.ts'
import type { DrivingRoute, DrivingState } from '../../src/game/living-world/driving.ts'
import { PRACTICE_COURSE } from '../../src/game/living-world/course.ts'
import { earnStarterEntitlement, emptyRentalState, STARTER_TRIP_LEASE_MS } from '../../src/game/living-world/rental.ts'
import type { MappedTripResponse } from '../../src/types/mapped-trip.ts'
import type { Look } from '../../src/types/life.ts'

const PATH = '/api/test/living-world/mapped-trip'
const LOOK: Look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
type Player = { cookie: string; id: string }
type Reply = MappedTripResponse & { error?: string }
type Availability = { route: boolean; depot: boolean; actorAtDepot: boolean }
const availability: Availability = { route: true, depot: true, actorAtDepot: true }

/** Synthetic authority is injected only into these service fixtures; it is not production map evidence. */
const TEST_ROUTE: DrivingRoute = {
  id: 'fixture-route', version: 'fixture-1', roadWidth: 8, speedLimit: 8,
  roads: [[{ x: 0, z: 0 }, { x: 0, z: 20 }, { x: 0, z: 40 }, { x: 0, z: 20 }, { x: 0, z: 0 }]],
  checkpoints: [
    { id: 'supplier', center: { x: 0, z: 20 }, radius: 2, stopRequired: true },
    { id: 'shop', center: { x: 0, z: 40 }, radius: 2, stopRequired: true },
    { id: 'depot', center: { x: 0, z: 0 }, radius: 2, stopRequired: true },
  ],
}
function testResolver(current = availability): MappedPhysicalResolver {
  return ({ session, cityId, location, at }) => ({
    kind: 'accepted-complete-mapped-route', actor: session.publicId, cityId, location, checkedAt: at, route: TEST_ROUTE,
    resourceId: 'marina-starter-sedan', depotId: 'marina-fictional-depot',
    supplierCheckpointId: 'supplier', shopCheckpointId: 'shop', depotCheckpointId: 'depot',
    availability: { ...current }, pins: {
      manifestCanonicalSha256: 'a'.repeat(64), tileSha256: 'b'.repeat(64), packSha256: 'c'.repeat(64),
      routeClearanceSha256: 'd'.repeat(64), depotSiteSha256: '0'.repeat(64),
      vehicleDescriptorSha256: 'e'.repeat(64), boardingAndExitSha256: 'f'.repeat(64),
      actorEnvelopeSha256: '1'.repeat(64), terrainSupportSha256: '2'.repeat(64), yieldPolicySha256: '3'.repeat(64),
    },
  })
}
const testMotionVerifier = (input: Parameters<MappedMotionVerifier>[0]): VerifiedMappedMotion => ({ kind: 'verified-server-motion', actor: input.actor, cityId: input.cityId,
  location: input.location, tripId: input.tripId, fleetUnitId: input.fleetUnitId, leaseGeneration: input.leaseGeneration,
  leaseStartRevision: input.leaseStartRevision, fleetRevision: input.fleetRevision,
  routeId: input.route.id, routeVersion: input.route.version,
  checkedAt: input.at, fingerprint: input.fingerprint, pins: { ...input.pins } })
const routes = (resolver?: MappedPhysicalResolver, motionVerifier?: MappedMotionVerifier | null): RouteModule => (ctx: RouteContext) => {
  const service = createMappedTripService(ctx, resolver, motionVerifier ?? undefined)
  const wrap = (method: (request: Parameters<typeof service.start>[0], body: unknown) => Promise<unknown>) => (async (request: Parameters<typeof service.start>[0]) => ({ body: await method(request, await request.json()), renew: true })) as RouteHandler
  return {
    [`GET ${PATH}` as RouteKey]: (async (request: Parameters<typeof service.start>[0]) => ({ body: await service.current(request, request.query.get('city')), renew: true })) as RouteHandler,
    [`POST ${PATH}/start` as RouteKey]: wrap(service.start),
    [`POST ${PATH}/input` as RouteKey]: wrap(service.input),
    [`POST ${PATH}/pause` as RouteKey]: wrap(service.pause),
    [`POST ${PATH}/resume` as RouteKey]: wrap(service.resume),
    [`POST ${PATH}/recover` as RouteKey]: wrap(service.recover),
  }
}
async function setup(t: Parameters<typeof fixture>[0], resolver?: MappedPhysicalResolver, disk?: ReturnType<typeof flakyDisk>, motionVerifier?: MappedMotionVerifier | null) {
  const verifier = motionVerifier === null ? undefined : motionVerifier ?? (resolver ? testMotionVerifier : undefined)
  return fixture(t, { ...(disk ? { disk } : {}), routes: [...ROUTE_MODULES, routes(resolver, verifier)] })
}
async function onboard(f: Awaited<ReturnType<typeof fixture>>, name = 'Mapped driver'): Promise<Player> {
  const created = await f.request('/api/session', { name, onboarding: true })
  assert.equal(created.status, 200)
  const value = await created.json() as { session?: { id?: string } }
  const player = { cookie: (created.headers.get('set-cookie') ?? '').split(';')[0] ?? '', id: value.session?.id ?? '' }
  assert.ok(player.cookie && player.id)
  assert.equal((await f.action(player.cookie, { type: 'onboarding.quick-start', payload: { look: LOOK } })).code, 'playing')
  await f.request('/api/life?city=lagos', null, player.cookie)
  return player
}
async function post(f: Awaited<ReturnType<typeof fixture>>, path: string, body: object, player: Player): Promise<Reply> {
  const response = await f.request(`${PATH}/${path}`, body, player.cookie)
  return await response.json() as Reply
}

/** Seed canonical validated upstream records; this is a service fixture, not a gameplay qualification run. */
async function seedPermission(f: Awaited<ReturnType<typeof fixture>>, player: Player): Promise<void> {
  const now = f.now()
  await f.server.store.transact(db => {
    const owner = Object.values(db.sessions).find(row => row.publicId === player.id)
    assert.ok(owner?.cities.lagos)
    const location = owner.cities.lagos.state.location
    assert.equal(typeof location, 'string')
    const initial = createDriving(PRACTICE_COURSE)
    const terminal: DrivingState = { ...initial, position: { x: 25, z: 52 }, checkpointIndex: PRACTICE_COURSE.checkpoints.length,
      checkpointEntry: 'blocked', stopDwellMs: 0, speed: 0, score: 80, status: 'complete', assessment: 'passed', feedback: 'Assessment passed.' }
    assert.ok(readValidatedDrivingState(terminal, PRACTICE_COURSE))
    const q = { v: 1, publicId: player.id, qualification: { id: 'district-driving', version: 1, evidenceJourneyId: 'fixture-journey', earnedAt: now, status: 'active' },
      courseId: PRACTICE_COURSE.id, courseVersion: PRACTICE_COURSE.version, cityId: 'lagos' }
    const drivingRow = { v: 1, publicId: player.id, journeyId: 'fixture-journey', cityId: 'lagos', location,
      createdAt: now - 1, updatedAt: now, lastInputAt: now, creditMs: 0, revision: 2, nextSequence: 2,
      state: terminal, lastPacket: { sequence: 1, fingerprint: 'server-fixture-terminal', code: 'lesson_completed' } }
    const earned = earnStarterEntitlement(emptyRentalState(), {
      actor: player.id, resourceId: 'marina-starter-sedan', custodyPointId: 'marina-fictional-depot',
      qualification: { id: 'district-driving', version: 1, status: 'active' }, resourceAvailable: true, at: now,
    })
    assert.ok(earned.ok)
    const root = (db.livingWorld ??= {}) as Record<string, unknown>
    const qualifications = (root.qualifications ??= {}) as Record<string, unknown>
    const driving = (root.driving ??= {}) as Record<string, unknown>
    const rentals = (root.rentals ??= {}) as Record<string, unknown>
    qualifications[player.id] = q; driving[player.id] = drivingRow; rentals[player.id] = earned.state
  })
}
async function response(f: Awaited<ReturnType<typeof fixture>>, player: Player): Promise<Reply> {
  return await (await f.request(`${PATH}?city=lagos`, undefined, player.cookie)).json() as Reply
}

test('production-default service refuses without physical evidence and leaves fleet/trip collections absent', async t => {
  const f = await setup(t), player = await onboard(f)
  await seedPermission(f, player)
  const before = await f.server.store.read(db => snapshot(db.livingWorld))
  const current = await response(f, player)
  const start = await post(f, 'start', { cityId: 'lagos', requestId: f.id() }, player)
  const after = await f.server.store.read(db => snapshot(db.livingWorld))
  assert.deepEqual([current.ok, current.code, start.ok, start.code], [false, 'physical_evidence_unavailable', false, 'physical_evidence_unavailable'])
  assert.deepEqual(after, before, 'the absent production resolver cannot allocate, mutate, move, or award')
  assert.equal((after as Record<string, unknown>).fleet, undefined)
  assert.equal((after as Record<string, unknown>).mappedTrips, undefined)
})

test('a static route resolver cannot start a trip without the separate per-frame motion verifier', async t => {
  const f = await setup(t, testResolver(), undefined, null), player = await onboard(f)
  await seedPermission(f, player)
  const before = await f.server.store.read(db => snapshot(db.livingWorld))
  const current = await response(f, player)
  const start = await post(f, 'start', { cityId: 'lagos', requestId: f.id() }, player)
  const after = await f.server.store.read(db => snapshot(db.livingWorld))
  assert.deepEqual([current.ok, current.code, start.ok, start.code], [false, 'physical_evidence_unavailable', false, 'physical_evidence_unavailable'])
  assert.deepEqual(after, before, 'static route and named hash strings cannot allocate fleet or trip state by themselves')
})

test('future trip and corrupt fleet records are quarantined byte-for-byte without repair', async t => {
  const f = await setup(t, testResolver()), player = await onboard(f)
  await seedPermission(f, player)
  await f.server.store.transact(db => {
    const root = db.livingWorld as Record<string, unknown>
    root.mappedTrips = { [player.id]: { v: 77, tripId: 'future-trip', opaque: { keep: true } } }
    root.fleet = { version: 77, opaque: ['future'] }
  })
  const before = await f.server.store.read(db => snapshot(db.livingWorld))
  const current = await response(f, player)
  const afterCurrent = await f.server.store.read(db => snapshot(db.livingWorld))
  assert.deepEqual([current.ok, current.code], [false, 'mapped_trip_quarantined'])
  assert.deepEqual(afterCurrent, before)
  await f.server.store.transact(db => { delete (db.livingWorld as Record<string, unknown>).mappedTrips })
  const beforeStart = await f.server.store.read(db => snapshot(db.livingWorld))
  const start = await post(f, 'start', { cityId: 'lagos', requestId: f.id() }, player)
  const afterStart = await f.server.store.read(db => snapshot(db.livingWorld))
  assert.deepEqual([start.ok, start.code], [false, 'fleet_quarantined'])
  assert.deepEqual(afterStart, beforeStart)
})

test('an oversized per-actor map is quarantined before current, start, or erasure can mutate it', async t => {
  const f = await setup(t, testResolver()), player = await onboard(f)
  await seedPermission(f, player)
  await f.server.store.transact(db => {
    const rows: Record<string, unknown> = Object.fromEntries(Array.from({ length: 1025 }, (_, index) => [`actor-${index}`, { v: 77, tripId: `future-${index}` }]))
    rows[player.id] = { v: 1, publicId: player.id, tripId: 'owned-row' }
    ;(db.livingWorld as Record<string, unknown>).mappedTrips = rows
  })
  const before = await f.server.store.read(db => snapshot(db.livingWorld))
  const current = await response(f, player)
  const start = await post(f, 'start', { cityId: 'lagos', requestId: f.id() }, player)
  const erased = await f.server.store.read(db => eraseMappedTripForOwner(db, player.id))
  const after = await f.server.store.read(db => snapshot(db.livingWorld))
  assert.deepEqual([current.ok, current.code, start.ok, start.code, erased], [false, 'mapped_trip_quarantined', false, 'mapped_trip_quarantined', false])
  assert.deepEqual(after, before, 'over-cap actor maps remain byte-for-byte unchanged across every owner operation')
})

test('test-only accepted resolver exercises server controls, duplicate packets, pause/reload/resume and owner-scoped privacy helpers', async t => {
  const physical = { ...availability }, f = await setup(t, testResolver(physical)), player = await onboard(f)
  await seedPermission(f, player)
  const startBody = { cityId: 'lagos', requestId: f.id() }
  const [one, retry] = await Promise.all([post(f, 'start', startBody, player), post(f, 'start', startBody, player)])
  assert.deepEqual([one.ok, one.code, retry.ok, retry.duplicate, one.trip?.state.status], [true, 'trip_started', true, true, 'running'])
  const trip = one.trip!
  const badPose = await f.request(`${PATH}/input`, { cityId: 'lagos', tripId: trip.tripId, sequence: 1,
    frames: [{ throttle: 0, brake: 0, steer: 0 }], position: { x: 0, z: 99 }, passed: true }, player.cookie)
  assert.equal(badPose.status, 400, 'client positions and pass flags are rejected by exact packet validation')
  const badControls = await f.request(`${PATH}/input`, { cityId: 'lagos', tripId: trip.tripId, sequence: 1,
    frames: [{ throttle: 2, brake: 0, steer: 0 }] }, player.cookie)
  assert.equal(badControls.status, 400, 'control values are bounded before they enter the simulation')
  const foreign = await onboard(f, 'Other mapped actor')
  const foreignInput = await post(f, 'input', { cityId: 'lagos', tripId: trip.tripId, sequence: 1,
    frames: [{ throttle: 1, brake: 0, steer: 0 }] }, foreign)
  assert.deepEqual([foreignInput.ok, foreignInput.code, foreignInput.trip], [false, 'trip_missing', null])
  f.advance(100)
  const packet = { cityId: 'lagos', tripId: trip.tripId, sequence: 1, frames: [{ throttle: 1, brake: 0, steer: 0 }] }
  const moved = await post(f, 'input', packet, player)
  assert.deepEqual([moved.ok, moved.code, moved.trip?.state.speed, moved.trip?.revision, moved.trip?.nextSequence], [true, 'controls_accepted', 0.302, 2, 2])
  assert.deepEqual(await post(f, 'input', packet, player), { ...moved, duplicate: true }, 'same sequence and payload is acknowledged without stepping twice')
  const changed = await post(f, 'input', { ...packet, frames: [{ throttle: 0, brake: 1, steer: 0 }] }, player)
  assert.equal(changed.code, 'packet_conflict', 'same sequence with changed controls cannot replay')
  const paused = await post(f, 'pause', { cityId: 'lagos', requestId: f.id(), tripId: trip.tripId, revision: moved.trip!.revision }, player)
  assert.deepEqual([paused.ok, paused.code, paused.trip?.state.status, paused.trip?.state.speed], [true, 'paused', 'paused', 0])
  const staleResume = await post(f, 'resume', { cityId: 'lagos', requestId: f.id(), tripId: trip.tripId, revision: moved.trip!.revision }, player)
  assert.deepEqual([staleResume.ok, staleResume.code, staleResume.trip?.revision, staleResume.trip?.state.status], [false, 'revision_conflict', paused.trip?.revision, 'paused'])
  const boot = await response(f, player)
  assert.deepEqual([boot.ok, boot.code, boot.trip?.state.status, boot.trip?.state.speed], [true, 'current', 'paused', 0])
  const resumed = await post(f, 'resume', { cityId: 'lagos', requestId: f.id(), tripId: trip.tripId, revision: paused.trip!.revision }, player)
  assert.deepEqual([resumed.ok, resumed.code, resumed.trip?.state.status], [true, 'resumed', 'running'])
  await f.flush()
  const reloaded = await response(f, player)
  assert.deepEqual([reloaded.ok, reloaded.trip?.state.status, reloaded.trip?.state.speed], [true, 'paused', 0], 'reload pauses the durable server session rather than restoring held input')
  physical.route = false
  const recovery = await post(f, 'recover', { cityId: 'lagos', requestId: f.id(), tripId: trip.tripId, revision: reloaded.trip!.revision }, player)
  assert.deepEqual([recovery.ok, recovery.code, recovery.trip?.state.status, recovery.trip?.recovery], [true, 'recovery_required', 'paused', true])
  const owner = readMappedTripForOwner(await f.server.store.read(db => db), player.id)
  assert.equal(owner !== null && owner !== false ? owner.tripId : null, trip.tripId)
  assert.equal(eraseMappedTripForOwner(await f.server.store.read(db => db), player.id), false, 'the shared fleet schema retains the actor lease, so erasure fails closed')
  assert.equal(readMappedTripForOwner(await f.server.store.read(db => db), 'someone-else'), null, 'the helper never lists another actor’s fleet record')
})

test('a duplicate control packet cannot keep a trip running past timeout or a backwards server clock', async t => {
  const f = await setup(t, testResolver()), player = await onboard(f)
  await seedPermission(f, player)
  const started = await post(f, 'start', { cityId: 'lagos', requestId: f.id() }, player)
  assert.ok(started.ok && started.trip)
  f.advance(100)
  const packet = { cityId: 'lagos', tripId: started.trip!.tripId, sequence: 1, frames: [{ throttle: 1, brake: 0, steer: 0 }] }
  const accepted = await post(f, 'input', packet, player)
  assert.deepEqual([accepted.ok, accepted.code, accepted.trip?.state.status], [true, 'controls_accepted', 'running'])
  f.advance(1501)
  const timedOut = await post(f, 'input', packet, player)
  assert.deepEqual([timedOut.ok, timedOut.code, timedOut.trip?.state.status, timedOut.trip?.state.speed, timedOut.trip?.nextSequence],
    [false, 'input_timeout', 'paused', 0, 2])

  const clockPlayer = await onboard(f, 'Mapped clock rollback')
  await seedPermission(f, clockPlayer)
  const clockStarted = await post(f, 'start', { cityId: 'lagos', requestId: f.id() }, clockPlayer)
  assert.ok(clockStarted.ok && clockStarted.trip)
  f.advance(100)
  const clockPacket = { cityId: 'lagos', tripId: clockStarted.trip!.tripId, sequence: 1, frames: [{ throttle: 1, brake: 0, steer: 0 }] }
  assert.equal((await post(f, 'input', clockPacket, clockPlayer)).code, 'controls_accepted')
  await f.server.store.transact(db => {
    const row = (db.livingWorld as { mappedTrips: Record<string, { updatedAt: number; lastInputAt: number }> }).mappedTrips[clockPlayer.id]!
    row.updatedAt = f.now() + 10
    row.lastInputAt = f.now() + 10
  })
  const reversed = await post(f, 'input', clockPacket, clockPlayer)
  assert.deepEqual([reversed.ok, reversed.code, reversed.trip?.state.status, reversed.trip?.state.speed, reversed.trip?.nextSequence],
    [false, 'clock_reversed', 'paused', 0, 2])
})

test('a refused full-vehicle motion sweep saves no candidate position or checkpoint progress', async t => {
  let sawMovingCandidate = false
  // Synthetic fixture models a trusted verifier refusing the swept vehicle body; it is not geometry evidence.
  const rejectingSweep: MappedMotionVerifier = input => {
    sawMovingCandidate = input.from.position.x === 0 && input.from.position.z === 0 && input.to.position.z > input.from.position.z
    return null
  }
  const f = await setup(t, testResolver(), undefined, rejectingSweep), player = await onboard(f)
  await seedPermission(f, player)
  const started = await post(f, 'start', { cityId: 'lagos', requestId: f.id() }, player)
  assert.ok(started.ok && started.trip)
  f.advance(100)
  const refused = await post(f, 'input', { cityId: 'lagos', tripId: started.trip!.tripId, sequence: 1,
    frames: [{ throttle: 1, brake: 0, steer: 0 }] }, player)
  assert.deepEqual([refused.ok, refused.code, refused.trip?.state.status, refused.trip?.state.speed,
    refused.trip?.state.position.z, refused.trip?.state.checkpointIndex, refused.trip?.nextSequence],
  [false, 'motion_unverified', 'paused', 0, 0, 0, 1])
  assert.equal(sawMovingCandidate, true, 'the centerline simulation proposed movement but the whole-vehicle verifier refused it')
  const fleet = await f.server.store.read(db => (db.livingWorld as { fleet: { units: Array<{ lease: { tripId: string; status: string } | null }> } }).fleet)
  assert.equal(fleet.units.some(unit => unit.lease?.tripId === started.trip!.tripId && unit.lease.status === 'active'), true,
    'a verifier refusal halts the trip and retains custody without releasing the vehicle')
})

test('a throwing motion verifier fails closed without saving the candidate or releasing custody', async t => {
  const throwingSweep: MappedMotionVerifier = () => { throw new Error('swept-body check unavailable') }
  const f = await setup(t, testResolver(), undefined, throwingSweep), player = await onboard(f)
  await seedPermission(f, player)
  const started = await post(f, 'start', { cityId: 'lagos', requestId: f.id() }, player)
  assert.ok(started.ok && started.trip)
  f.advance(100)
  const refused = await post(f, 'input', { cityId: 'lagos', tripId: started.trip!.tripId, sequence: 1,
    frames: [{ throttle: 1, brake: 0, steer: 0 }] }, player)
  assert.deepEqual([refused.ok, refused.code, refused.trip?.state.status, refused.trip?.state.speed,
    refused.trip?.state.position.z, refused.trip?.state.checkpointIndex, refused.trip?.nextSequence],
  [false, 'motion_unverified', 'paused', 0, 0, 0, 1])
  const fleet = await f.server.store.read(db => (db.livingWorld as { fleet: { units: Array<{ lease: { tripId: string; status: string } | null }> } }).fleet)
  assert.equal(fleet.units.some(unit => unit.lease?.tripId === started.trip!.tripId && unit.lease.status === 'active'), true,
    'an exception stops candidate motion but leaves fleet custody retained')
})

test('motion verification binds the allocated lease and freezes callback inputs against mutation', async t => {
  let frozen = false, mutationSucceeded = true, forgeLease = false
  const inspectingVerifier: MappedMotionVerifier = input => {
    frozen = Object.isFrozen(input) && Object.isFrozen(input.route) && Object.isFrozen(input.from.position)
      && Object.isFrozen(input.to.position) && Object.isFrozen(input.pins)
    mutationSucceeded = Reflect.set(input.to.position, 'z', 999)
    const receipt = testMotionVerifier(input)
    return forgeLease ? { ...receipt, leaseGeneration: input.leaseGeneration + 1 } : receipt
  }
  const f = await setup(t, testResolver(), undefined, inspectingVerifier), player = await onboard(f)
  await seedPermission(f, player)
  const started = await post(f, 'start', { cityId: 'lagos', requestId: f.id() }, player)
  assert.ok(started.ok && started.trip)
  f.advance(100)
  const moved = await post(f, 'input', { cityId: 'lagos', tripId: started.trip!.tripId, sequence: 1,
    frames: [{ throttle: 1, brake: 0, steer: 0 }] }, player)
  assert.deepEqual([moved.ok, moved.code, frozen, mutationSucceeded], [true, 'controls_accepted', true, false])
  assert.ok(moved.trip!.state.position.z > 0 && moved.trip!.state.position.z < 1,
    'the committed point is the canonical simulation candidate, not a callback-mutated point')
  forgeLease = true
  f.advance(100)
  const refused = await post(f, 'input', { cityId: 'lagos', tripId: started.trip!.tripId, sequence: 2,
    frames: [{ throttle: 1, brake: 0, steer: 0 }] }, player)
  assert.deepEqual([refused.ok, refused.code, refused.trip?.state.position.z, refused.trip?.nextSequence],
    [false, 'motion_unverified', moved.trip!.state.position.z, 2], 'a receipt for a different lease generation cannot authorize movement')
})

test('slow motion verification cannot commit after lease expiry', async t => {
  let advanceClock = (_ms: number): void => {}
  const slowVerifier: MappedMotionVerifier = input => {
    advanceClock(STARTER_TRIP_LEASE_MS + 1)
    return testMotionVerifier(input)
  }
  const f = await setup(t, testResolver(), undefined, slowVerifier)
  advanceClock = f.advance
  const player = await onboard(f)
  await seedPermission(f, player)
  const started = await post(f, 'start', { cityId: 'lagos', requestId: f.id() }, player)
  assert.ok(started.ok && started.trip)
  f.advance(100)
  const expired = await post(f, 'input', { cityId: 'lagos', tripId: started.trip!.tripId, sequence: 1,
    frames: [{ throttle: 1, brake: 0, steer: 0 }] }, player)
  assert.deepEqual([expired.ok, expired.code, expired.trip?.state.position.z, expired.trip?.nextSequence, expired.trip?.recovery],
    [false, 'recovery_required', 0, 1, true])
  const fleet = await f.server.store.read(db => (db.livingWorld as { fleet: { units: Array<{ lease: { tripId: string; status: string } | null }> } }).fleet)
  assert.equal(fleet.units.some(unit => unit.lease?.tripId === started.trip!.tripId && unit.lease.status === 'recovery'), true)
})

test('a backwards clock during awaited motion verification stops before the candidate commit', async t => {
  let moveClock = (_ms: number): void => {}
  const reverseClockVerifier: MappedMotionVerifier = input => {
    moveClock(-1)
    return testMotionVerifier(input)
  }
  const f = await setup(t, testResolver(), undefined, reverseClockVerifier)
  moveClock = f.advance
  const player = await onboard(f)
  await seedPermission(f, player)
  const started = await post(f, 'start', { cityId: 'lagos', requestId: f.id() }, player)
  assert.ok(started.ok && started.trip)
  f.advance(100)
  const stopped = await post(f, 'input', { cityId: 'lagos', tripId: started.trip!.tripId, sequence: 1,
    frames: [{ throttle: 1, brake: 0, steer: 0 }] }, player)
  assert.deepEqual([stopped.ok, stopped.code, stopped.trip?.state.status, stopped.trip?.state.position.z, stopped.trip?.nextSequence],
    [false, 'clock_reversed', 'paused', 0, 1])
})

test('slow physical resolution is rechecked before the first fleet allocation', async t => {
  let advanceClock = (_ms: number): void => {}
  const base = testResolver()
  const slowResolver: MappedPhysicalResolver = async input => {
    const evidence = await base(input)
    advanceClock(STARTER_TRIP_LEASE_MS + 1)
    return evidence
  }
  const f = await setup(t, slowResolver)
  advanceClock = f.advance
  const player = await onboard(f)
  await seedPermission(f, player)
  const before = await f.server.store.read(db => snapshot(db.livingWorld))
  const started = await post(f, 'start', { cityId: 'lagos', requestId: f.id() }, player)
  const after = await f.server.store.read(db => snapshot(db.livingWorld))
  assert.deepEqual([started.ok, started.code], [false, 'physical_evidence_stale'])
  assert.deepEqual(after, before, 'expired resolver output cannot allocate a unit or persist a trip')
})

test('last-car race is serialized and stale permission causes server-side recovery without movement', async t => {
  const f = await setup(t, testResolver())
  const players: Player[] = []
  for (let i = 0; i < 5; i++) { const player = await onboard(f, `Mapped contender ${i}`); await seedPermission(f, player); players.push(player) }
  const starts = await Promise.all(players.map(player => post(f, 'start', { cityId: 'lagos', requestId: f.id() }, player)))
  assert.equal(starts.filter(result => result.ok && result.code === 'trip_started').length, 4)
  assert.equal(starts.filter(result => !result.ok && result.code === 'fleet_unavailable').length, 1)
  const winnerIndex = starts.findIndex(result => result.ok)
  const winner = players[winnerIndex]!, started = starts[winnerIndex]!
  await f.server.store.transact(db => {
    const rows = (db.livingWorld as { rentals: Record<string, { entitlement: { status: string } }> }).rentals
    rows[winner.id]!.entitlement.status = 'revoked'
  })
  f.advance(100)
  const denied = await post(f, 'input', { cityId: 'lagos', tripId: started.trip!.tripId, sequence: 1, frames: [{ throttle: 1, brake: 0, steer: 0 }] }, winner)
  assert.deepEqual([denied.ok, denied.code, denied.trip?.state.status, denied.trip?.state.speed, denied.trip?.recovery], [false, 'recovery_required', 'paused', 0, true])
  const saved = await f.server.store.read(db => snapshot((db.livingWorld as { mappedTrips: Record<string, unknown> }).mappedTrips[winner.id])) as { state: DrivingState }
  assert.equal(saved.state.position.z, 0, 'revoked permission creates no movement frame')
})

test('missing committed driving-course evidence stops a retained trip before controls advance', async t => {
  const f = await setup(t, testResolver()), player = await onboard(f)
  await seedPermission(f, player)
  const started = await post(f, 'start', { cityId: 'lagos', requestId: f.id() }, player)
  assert.ok(started.ok && started.trip)
  await f.server.store.transact(db => {
    const root = db.livingWorld as { driving: Record<string, unknown> }
    delete root.driving[player.id]
  })
  f.advance(100)
  const stopped = await post(f, 'input', { cityId: 'lagos', tripId: started.trip!.tripId, sequence: 1,
    frames: [{ throttle: 1, brake: 0, steer: 0 }] }, player)
  assert.deepEqual([stopped.ok, stopped.code, stopped.trip?.state.status, stopped.trip?.state.speed,
    stopped.trip?.state.position.z, stopped.trip?.nextSequence, stopped.trip?.recovery],
  [false, 'recovery_required', 'paused', 0, 0, 1, true])
  const saved = await f.server.store.read(db => {
    const world = db.livingWorld as { mappedTrips: Record<string, { fleetUnitId: string }>; fleet: { units: Array<{ id: string; lease: { tripId: string; status: string } | null }> } }
    return { trip: world.mappedTrips[player.id], unit: world.fleet.units.find(unit => unit.id === world.mappedTrips[player.id]?.fleetUnitId) }
  })
  assert.equal(saved.unit?.lease?.tripId, started.trip!.tripId)
  assert.equal(saved.unit?.lease?.status, 'recovery', 'lost witness stops motion but does not release vehicle custody')
})

test('city/qualification refusal and storage failure do not allocate or partially persist', async t => {
  const disk = flakyDisk(), f = await setup(t, testResolver(), disk), player = await onboard(f)
  await seedPermission(f, player)
  await f.server.store.transact(db => {
    const owner = Object.values(db.sessions).find(row => row.publicId === player.id)
    assert.ok(owner?.cities.lagos)
    owner.cities.ibadan = structuredClone(owner.cities.lagos)
    owner.character = { v: 2, city: 'ibadan' }
  })
  const cityMoved = await f.request(`${PATH}/start`, { cityId: 'lagos', requestId: f.id() }, player.cookie)
  assert.deepEqual([cityMoved.status, (await cityMoved.json() as { error?: string }).error], [409, 'city_moved'])
  await f.server.store.transact(db => {
    const owner = Object.values(db.sessions).find(row => row.publicId === player.id)
    assert.ok(owner?.cities.lagos)
    owner.character = { v: 2, city: 'lagos' }
  })
  await f.server.store.transact(db => {
    const rows = (db.livingWorld as { qualifications: Record<string, { qualification: { status: string } }> }).qualifications
    rows[player.id]!.qualification.status = 'revoked'
  })
  const refused = await post(f, 'start', { cityId: 'lagos', requestId: f.id() }, player)
  assert.deepEqual([refused.ok, refused.code], [false, 'starter_permission_required'])
  await f.server.store.transact(db => {
    const rows = (db.livingWorld as { qualifications: Record<string, { qualification: { status: string } }> }).qualifications
    rows[player.id]!.qualification.status = 'active'
  })
  disk.fail = 'ENOSPC'
  const failedWrite = await f.request(`${PATH}/start`, { cityId: 'lagos', requestId: f.id() }, player.cookie)
  assert.equal(failedWrite.status, 503)
  disk.fail = null
  const after = await f.server.store.read(db => snapshot(db.livingWorld)) as Record<string, unknown>
  assert.equal(after.fleet, undefined, 'storage rollback leaves no durable shared fleet allocation')
  assert.equal(after.mappedTrips, undefined, 'storage rollback leaves no actor trip record')
})
