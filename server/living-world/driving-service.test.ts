import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, flakyDisk, snapshot } from '../test-fixture.ts'
import { ROUTE_MODULES } from '../routes/index.ts'
import livingWorldRoutes from '../routes/living-world.ts'
import { createDrivingService } from './driving-service.ts'
import { PRACTICE_COURSE } from '../../src/game/living-world/course.ts'
import type { DrivingResponse } from '../../src/types/living-world.ts'
import type { Look } from '../../src/types/life.ts'
import type { RouteModule } from '../types.ts'

const LOOK: Look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
const drivingPath = '/api/living-world/driving'
async function livingFixture(t: Parameters<typeof fixture>[0], extra: Parameters<typeof fixture>[1] = {}) {
  assert.ok(ROUTE_MODULES.includes(livingWorldRoutes), 'the production route registry includes living-world routes')
  return fixture(t, extra)
}
function configuredDrivingRoutes(option: unknown): RouteModule[] {
  const configured: RouteModule = ctx => {
    const driving = createDrivingService(ctx, { reverseGearIssuance: option as boolean })
    return {
      'GET /api/living-world/driving': async request => ({ body: await driving.current(request, request.query.get('city')), renew: true }),
      'POST /api/living-world/driving/start': async request => ({ body: await driving.start(request, await request.json()), renew: true }),
      'POST /api/living-world/driving/restart': async request => ({ body: await driving.restart(request, await request.json()), renew: true }),
      'POST /api/living-world/driving/input': async request => ({ body: await driving.input(request, await request.json()), renew: true }),
      'POST /api/living-world/driving/resume': async request => ({ body: await driving.resume(request, await request.json()), renew: true }),
      'POST /api/living-world/driving/pause': async request => ({ body: await driving.pause(request, await request.json()), renew: true }),
    }
  }
  return [...ROUTE_MODULES.filter(module => module !== livingWorldRoutes), configured]
}
function drivingOptionModes(options: unknown[]) {
  let selected = 0
  const module: RouteModule = ctx => {
    const services = options.map(option => createDrivingService(ctx, { reverseGearIssuance: option as boolean }))
    const driving = () => services[selected]!
    return {
      'GET /api/living-world/driving': async request => ({ body: await driving().current(request, request.query.get('city')), renew: true }),
      'POST /api/living-world/driving/start': async request => ({ body: await driving().start(request, await request.json()), renew: true }),
      'POST /api/living-world/driving/restart': async request => ({ body: await driving().restart(request, await request.json()), renew: true }),
      'POST /api/living-world/driving/input': async request => ({ body: await driving().input(request, await request.json()), renew: true }),
      'POST /api/living-world/driving/resume': async request => ({ body: await driving().resume(request, await request.json()), renew: true }),
      'POST /api/living-world/driving/pause': async request => ({ body: await driving().pause(request, await request.json()), renew: true }),
    }
  }
  return { routes: [...ROUTE_MODULES.filter(route => route !== livingWorldRoutes), module], select(index: number) { selected = index } }
}

type Reply = DrivingResponse & { error?: string }
async function onboard(f: Awaited<ReturnType<typeof fixture>>) {
  const created = await f.request('/api/session', { name: 'Ada', onboarding: true })
  assert.equal(created.status, 200)
  const body = await created.json() as { session?: { id?: string } }
  const player = { cookie: (created.headers.get('set-cookie') ?? '').split(';')[0] ?? '', id: body.session?.id ?? '' }
  assert.ok(player.cookie)
  const action = async (fields: Record<string, unknown>) => f.action(player.cookie, fields as Parameters<typeof f.action>[1])
  assert.equal((await action({ type: 'onboarding.quick-start', payload: { look: LOOK } })).code, 'playing')
  return player
}
async function post(f: Awaited<ReturnType<typeof fixture>>, path: string, body: object, cookie: string): Promise<Reply> {
  const response = await f.request(path, body, cookie)
  return await response.json() as Reply
}
const id = (f: Awaited<ReturnType<typeof fixture>>) => f.id()
async function cash(f: Awaited<ReturnType<typeof fixture>>, cookie: string): Promise<number> {
  const body = await (await f.request('/api/life?city=lagos', null, cookie)).json() as { state?: { cash?: number } }
  return body.state?.cash ?? NaN
}
async function ledger(f: Awaited<ReturnType<typeof fixture>>, publicId: string): Promise<unknown> {
  return f.server.store.read(db => snapshot(Object.values(db.sessions).find(record => record.publicId === publicId)?.cities.lagos?.state.ledger))
}
async function qualificationSlice(f: Awaited<ReturnType<typeof fixture>>, publicId: string): Promise<{ present: true; value: unknown } | { present: false }> {
  return f.server.store.read(db => {
    const rows = (db.livingWorld as { qualifications?: Record<string, unknown> } | undefined)?.qualifications
    return rows && Object.hasOwn(rows, publicId) ? { present: true as const, value: snapshot(rows[publicId]) } : { present: false as const }
  })
}

test('driving packets are server-stepped, sequenced, retryable and bootstrap always pauses', async t => {
  const f = await livingFixture(t)
  const player = await onboard(f)
  await f.server.store.transact(db => {
    const owner = Object.values(db.sessions).find(record => record.publicId === player.id)
    assert.ok(owner?.cities.lagos)
    owner.cities.lagos.state.cash = 0
  })
  const beforeCash = await cash(f, player.cookie)
  const beforeLedger = await ledger(f, player.id)
  assert.equal(beforeCash, 0)
  const start = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, player.cookie)
  assert.deepEqual([start.ok, start.code, start.session?.revision, start.session?.nextSequence], [true, 'started', 1, 1])
  assert.equal(await cash(f, player.cookie), beforeCash, 'free practice never changes the wallet')
  assert.deepEqual(await ledger(f, player.id), beforeLedger, 'free practice writes no wallet ledger effects')
  const session = start.session!
  f.advance(100)
  const packet = { cityId: 'lagos', journeyId: session.journeyId, sequence: 1, frames: [{ throttle: 1, brake: 0, steer: 0 }] }
  const moved = await post(f, `${drivingPath}/input`, packet, player.cookie)
  assert.deepEqual([moved.ok, moved.code, moved.session?.revision, moved.session?.nextSequence], [true, 'controls_accepted', 2, 2])
  const retry = await post(f, `${drivingPath}/input`, packet, player.cookie)
  assert.deepEqual([retry.ok, retry.code, retry.duplicate, retry.session?.revision, retry.session?.state.speed], [true, moved.code, true, 2, moved.session?.state.speed])
  const boot = await (await f.request(`${drivingPath}?city=lagos`, null, player.cookie)).json() as Reply
  assert.deepEqual([boot.ok, boot.session?.state.status, boot.session?.state.speed, boot.session?.revision], [true, 'paused', 0, 3])
  const resumed = await post(f, `${drivingPath}/resume`, { cityId: 'lagos', requestId: id(f), journeyId: session.journeyId, revision: boot.session!.revision }, player.cookie)
  assert.deepEqual([resumed.ok, resumed.code, resumed.session?.state.status, resumed.session?.revision], [true, 'resumed', 'running', 4])
  assert.deepEqual([await cash(f, player.cookie), await ledger(f, player.id)], [0, beforeLedger])
})

test('reverse issuance is literal trusted true; OFF refuses atomically and retains v1/v2 journeys', async t => {
  const modes = drivingOptionModes([true, undefined, false, 'true'])
  const f = await fixture(t, { routes: modes.routes })
  const player = await onboard(f)
  const started = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, player.cookie)
  assert.equal(started.reverseGearControls, true, 'only the literal trusted true option advertises the ephemeral capability')
  assert.ok(started.session)
  const journey = started.session
  const row = () => f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))

  const reversePacket = { cityId: 'lagos', journeyId: journey.journeyId, sequence: 1,
    frames: [{ throttle: 1, brake: 0, steer: 0, gear: 'reverse' }] }
  modes.select(1)
  f.advance(100)
  const beforeOmitted = await row()
  const omittedRefusal = await post(f, `${drivingPath}/input`, reversePacket, player.cookie)
  assert.deepEqual([omittedRefusal.ok, omittedRefusal.code, Object.hasOwn(omittedRefusal, 'reverseGearControls')], [false, 'reverse_gear_disabled', false])
  assert.deepEqual(await row(), beforeOmitted, 'omitted issuance cannot mutate or upgrade a v1 row')

  for (const [index, frames] of [[2, [{ throttle: 1, brake: 0, steer: 0, gear: 'forward' }]],
    [3, [{ throttle: 1, brake: 0, steer: 0 }, { throttle: 0, brake: 1, steer: 0, gear: 'reverse' }]]] as const) {
    modes.select(index)
    const before = await row()
    const refused = await post(f, `${drivingPath}/input`, { ...reversePacket, frames }, player.cookie)
    assert.deepEqual([refused.ok, refused.code, Object.hasOwn(refused, 'reverseGearControls')], [false, 'reverse_gear_disabled', false])
    assert.deepEqual(await row(), before, 'false and string options cannot enable or partially apply explicit gear input')
  }

  modes.select(0)
  f.advance(100)
  const accepted = await post(f, `${drivingPath}/input`, reversePacket, player.cookie)
  assert.deepEqual([accepted.ok, accepted.session?.state.gear, accepted.reverseGearControls], [true, 'reverse', true])
  f.advance(100)
  const nextPacket = { ...reversePacket, sequence: 2, frames: [{ throttle: 0, brake: 1, steer: 0, gear: 'forward' }] }
  const secondAccepted = await post(f, `${drivingPath}/input`, nextPacket, player.cookie)
  assert.deepEqual([secondAccepted.ok, secondAccepted.session?.nextSequence], [true, 3])
  const committed = await row() as Record<string, unknown> & { v: number; revision: number; state: unknown; creditMs: number; updatedAt: number }
  assert.equal(committed.v, 2)

  modes.select(1)
  f.advance(1600)
  const exactRetry = await post(f, `${drivingPath}/input`, nextPacket, player.cookie)
  assert.deepEqual([exactRetry.ok, exactRetry.duplicate, exactRetry.code, Object.hasOwn(exactRetry, 'reverseGearControls')], [true, true, 'controls_accepted', false])
  assert.deepEqual(await row(), committed, 'a successful exact retry after timeout does not pause, spend credit or rewrite the driving row')
  const conflict = await post(f, `${drivingPath}/input`, { ...nextPacket, frames: [{ throttle: 0.5, brake: 0, steer: 0, gear: 'forward' }] }, player.cookie)
  assert.deepEqual([conflict.ok, conflict.code], [false, 'packet_conflict'])
  assert.deepEqual(await row(), committed, 'a conflicting retry does not mutate the saved row')
  const oldUnretained = await post(f, `${drivingPath}/input`, reversePacket, player.cookie)
  assert.deepEqual([oldUnretained.ok, oldUnretained.code], [false, 'sequence_conflict'], 'an older explicit packet outside the retained receipt is a sequence conflict while OFF')
  assert.deepEqual(await row(), committed, 'an unretained old packet cannot mutate the saved row')
  const newGear = await post(f, `${drivingPath}/input`, { ...reversePacket, sequence: 3, frames: [{ throttle: 1, brake: 0, steer: 0, gear: 'forward' }] }, player.cookie)
  assert.deepEqual([newGear.ok, newGear.code], [false, 'reverse_gear_disabled'])
  assert.deepEqual(await row(), committed, 'OFF refuses new explicit forward gear without upgrading or mutating v2')

  const loaded = await (await f.request(`${drivingPath}?city=lagos`, null, player.cookie)).json() as Reply
  assert.deepEqual([loaded.ok, loaded.session?.state.status, loaded.session?.state.speed, loaded.session?.state.gear,
    Object.hasOwn(loaded, 'reverseGearControls')], [true, 'paused', 0, 'forward', false])
  const pausedRow = await row() as { v: number; state: { status: string }; revision: number }
  assert.deepEqual([pausedRow.v, pausedRow.state.status], [2, 'paused'], 'OFF current reads and safely pauses the issued v2 record without downgrading it')
  const resumed = await post(f, `${drivingPath}/resume`, { cityId: 'lagos', requestId: id(f), journeyId: journey.journeyId,
    revision: loaded.session!.revision }, player.cookie)
  assert.deepEqual([resumed.ok, resumed.code, Object.hasOwn(resumed, 'reverseGearControls')], [true, 'resumed', false])
  f.advance(100)
  const legacyForward = await post(f, `${drivingPath}/input`, { cityId: 'lagos', journeyId: journey.journeyId, sequence: 3,
    frames: [{ throttle: 1, brake: 0, steer: 0 }] }, player.cookie)
  assert.deepEqual([legacyForward.ok, legacyForward.session?.state.gear, (await row() as { v: number }).v], [true, 'forward', 2],
    'OFF accepts an old three-field forward frame on v2 and keeps the v2 writer shape')

  modes.select(1)
  const second = await onboard(f)
  const offStart = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, second.cookie)
  assert.deepEqual([offStart.ok, Object.hasOwn(offStart, 'reverseGearControls')], [true, false])
  const offRow = () => f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[second.id]))
  const offBefore = await offRow()
  f.advance(100)
  const explicitOff = await post(f, `${drivingPath}/input`, { cityId: 'lagos', journeyId: offStart.session!.journeyId, sequence: 1,
    frames: [{ throttle: 1, brake: 0, steer: 0, gear: 'forward' }] }, second.cookie)
  assert.deepEqual([explicitOff.ok, explicitOff.code], [false, 'reverse_gear_disabled'])
  assert.deepEqual(await offRow(), offBefore)
  assert.equal((offBefore as { v: number }).v, 1, 'normal OFF journeys remain v1')
})

test('every exact retained input retry precedes timeout and clock pausing; stale retries refuse without writes', async t => {
  const f = await fixture(t, { routes: configuredDrivingRoutes(true) })
  const cases = [
    { name: 'ON explicit timeout', explicit: true, clockReversed: false },
    { name: 'ON legacy timeout', explicit: false, clockReversed: false },
    { name: 'ON explicit reversed clock', explicit: true, clockReversed: true },
    { name: 'ON legacy reversed clock', explicit: false, clockReversed: true },
  ] as const
  for (const scenario of cases) {
    const player = await onboard(f)
    const started = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, player.cookie)
    assert.ok(started.session, scenario.name)
    f.advance(100)
    const frames = [scenario.explicit
      ? { throttle: 1, brake: 0, steer: 0, gear: 'forward' }
      : { throttle: 1, brake: 0, steer: 0 }]
    const packet = { cityId: 'lagos', journeyId: started.session.journeyId, sequence: 1, frames }
    const accepted = await post(f, `${drivingPath}/input`, packet, player.cookie)
    assert.deepEqual([accepted.ok, accepted.code, accepted.session?.revision], [true, 'controls_accepted', 2], scenario.name)
    const readRow = () => f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
    let expected = await readRow()

    const altered = { ...packet, frames: [{ throttle: 0, brake: 1, steer: 0, ...(scenario.explicit ? { gear: 'forward' } : {}) }] }
    const conflict = await post(f, `${drivingPath}/input`, altered, player.cookie)
    assert.deepEqual([conflict.ok, conflict.code], [false, 'packet_conflict'], scenario.name)
    assert.deepEqual(await readRow(), expected, 'a conflicting same-sequence retry cannot pause or rewrite the row')
    const stale = await post(f, `${drivingPath}/input`, { ...packet, sequence: 9 }, player.cookie)
    assert.deepEqual([stale.ok, stale.code], [false, 'sequence_conflict'], scenario.name)
    assert.deepEqual(await readRow(), expected, 'a stale or future sequence refusal cannot pause or rewrite the row')

    if (scenario.clockReversed) {
      await f.server.store.transact(db => {
        const row = (db.livingWorld as { driving: Record<string, Record<string, unknown>> }).driving[player.id]
        assert.ok(row, 'the scenario has a saved driving row')
        row.updatedAt = f.now() + 5000
        row.lastInputAt = f.now() + 5000
      })
      expected = await readRow()
    } else f.advance(1600)
    const retry = await post(f, `${drivingPath}/input`, packet, player.cookie)
    assert.deepEqual([retry.ok, retry.duplicate, retry.code, retry.session?.revision], [true, true, 'controls_accepted', 2], scenario.name)
    assert.deepEqual(await readRow(), expected, 'an exact successful receipt retry leaves the full row untouched')
  }
})

test('legacy forward packets remain valid and reverse requests brake before a saved backward step', async t => {
  const f = await livingFixture(t, { routes: configuredDrivingRoutes(true) })
  const player = await onboard(f)
  const start = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, player.cookie)
  assert.ok(start.ok && start.session, 'the ordinary start returns a saved driving session')
  const journey = start.session
  f.advance(100)
  const legacy = { cityId: 'lagos', journeyId: journey.journeyId, sequence: 1,
    frames: [{ throttle: 1, brake: 0, steer: 0 }] }
  const forward = await post(f, `${drivingPath}/input`, legacy, player.cookie)
  assert.ok(forward.ok && forward.session, 'accepted legacy controls return canonical motion')
  assert.deepEqual([forward.ok, forward.session?.state.speed > 0, forward.session?.state.position.z > journey.state.position.z], [true, true, true])
  const legacyRow = await f.server.store.read(db => (db.livingWorld as { driving: Record<string, { v: number }> }).driving[player.id])
  assert.ok(legacyRow, 'the accepted legacy packet has a saved row')
  assert.equal(legacyRow.v, 1, 'old three-field controls retain the strict v1 save format')
  const replay = await post(f, `${drivingPath}/input`, legacy, player.cookie)
  assert.deepEqual([replay.ok, replay.duplicate, replay.session?.revision], [true, true, forward.session?.revision])

  const reverse = { cityId: 'lagos', journeyId: journey.journeyId, sequence: 2,
    frames: [{ throttle: 1, brake: 0, steer: 0, gear: 'reverse' }] }
  f.advance(100)
  const stopped = await post(f, `${drivingPath}/input`, reverse, player.cookie)
  assert.ok(stopped.ok && stopped.session, 'accepted reverse selection returns canonical stopped motion')
  assert.deepEqual([stopped.ok, stopped.session?.state.speed, stopped.session?.state.position], [true, 0, forward.session?.state.position],
    'requesting the opposite direction brakes to zero without flipping velocity')
  const reverseReplay = await post(f, `${drivingPath}/input`, reverse, player.cookie)
  assert.deepEqual([reverseReplay.ok, reverseReplay.duplicate, reverseReplay.session?.revision], [true, true, stopped.session.revision])
  const changedGearRetry = await post(f, `${drivingPath}/input`, { ...reverse,
    frames: [{ throttle: 1, brake: 0, steer: 0, gear: 'forward' }] }, player.cookie)
  assert.deepEqual([changedGearRetry.ok, changedGearRetry.code, changedGearRetry.session?.revision], [false, 'packet_conflict', stopped.session.revision])
  f.advance(100)
  const backing = await post(f, `${drivingPath}/input`, { ...reverse, sequence: 3 }, player.cookie)
  assert.ok(backing.ok && backing.session)
  assert.ok(backing.session.state.speed > 0 && backing.session.state.speed <= 3)
  assert.equal(backing.session.state.gear, 'reverse')
  assert.ok(backing.session.state.position.z < stopped.session.state.position.z, 'the server computes backward movement from accepted controls')
  const reverseRow = await f.server.store.read(db => (db.livingWorld as { driving: Record<string, { v: number; state: { speed: number; gear?: string } }> }).driving[player.id])
  assert.ok(reverseRow, 'the accepted reverse packet has a saved row')
  assert.deepEqual([reverseRow.v, reverseRow.state.speed > 0, reverseRow.state.gear], [2, true, 'reverse'], 'reverse motion upgrades only the driving row to its explicit v2 contract')

  const loaded = await (await f.request(`${drivingPath}?city=lagos`, null, player.cookie)).json() as Reply
  assert.deepEqual([loaded.ok, loaded.session?.state.status, loaded.session?.state.speed, loaded.session?.state.gear, loaded.session?.state.position],
    [true, 'paused', 0, 'forward', backing.session.state.position], 'v2 reload pauses at the accepted position with a forward default and no carried motion')

  const before = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  const malformed = await f.request(`${drivingPath}/input`, { cityId: 'lagos', journeyId: journey.journeyId, sequence: 4,
    frames: [{ throttle: 1, brake: 0, steer: 0, gear: 'park' }] }, player.cookie)
  assert.deepEqual([malformed.status, (await malformed.json() as { error: string }).error], [400, 'invalid_driving_packet'])
  const after = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  assert.deepEqual(after, before, 'unknown gear values do not mutate the saved journey')

  await f.server.store.transact(db => {
    const row = (db.livingWorld as { driving: Record<string, { v: number }> }).driving[player.id]!
    row.v = 1
  })
  const mismatchedV1 = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  const v1Refusal = await (await f.request(`${drivingPath}?city=lagos`, null, player.cookie)).json() as Reply
  assert.deepEqual([v1Refusal.ok, v1Refusal.code], [false, 'invalid_saved_journey'], 'v1 never accepts a v2 state shape')
  assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id])), mismatchedV1,
    'strict version refusal preserves the source row')

  await f.server.store.transact(db => {
    const row = (db.livingWorld as { driving: Record<string, { v: number; state: Record<string, unknown> }> }).driving[player.id]!
    row.v = 2
    delete row.state.gear
  })
  const incompleteV2 = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  const v2Refusal = await (await f.request(`${drivingPath}?city=lagos`, null, player.cookie)).json() as Reply
  assert.deepEqual([v2Refusal.ok, v2Refusal.code], [false, 'invalid_saved_journey'], 'v2 requires its explicit gear field')
  assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id])), incompleteV2,
    'strict v2 refusal quarantines without rewriting the original row')
})

test('only a held quick-start is blocked; confirmed guests and legacy lives remain eligible', async t => {
  const f = await livingFixture(t)
  const heldResponse = await f.request('/api/session', { name: 'Held', onboarding: true })
  const held = (heldResponse.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
  assert.ok(held)
  await f.request('/api/life?city=lagos', null, held)
  const heldStart = await f.request(`${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, held)
  assert.deepEqual([heldStart.status, (await heldStart.json() as { error: string }).error], [403, 'onboarding_required'])

  const legacy = await f.device('Legacy')
  await f.request('/api/life?city=lagos', null, legacy.cookie)
  const legacyStart = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, legacy.cookie)
  assert.deepEqual([legacyStart.ok, legacyStart.code], [true, 'started'])
  const confirmedGuest = await onboard(f)
  const guestStart = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, confirmedGuest.cookie)
  assert.deepEqual([guestStart.ok, guestStart.code], [true, 'started'])
})

test('stale lifecycle CAS and excessive or early control packets do not move the journey', async t => {
  const f = await livingFixture(t)
  const player = await onboard(f)
  const start = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, player.cookie)
  const session = start.session!
  const early = await post(f, `${drivingPath}/input`, { cityId: 'lagos', journeyId: session.journeyId, sequence: 1, frames: [{ throttle: 0, brake: 0, steer: 0 }] }, player.cookie)
  assert.deepEqual([early.ok, early.code, early.session?.revision], [false, 'insufficient_time_credit', 1])
  f.advance(500)
  const tooMany = await post(f, `${drivingPath}/input`, { cityId: 'lagos', journeyId: session.journeyId, sequence: 1, frames: Array(6).fill({ throttle: 0, brake: 0, steer: 0 }) }, player.cookie)
  assert.equal(tooMany.error, 'invalid_driving_packet')
  const paused = await post(f, `${drivingPath}/pause`, { cityId: 'lagos', requestId: id(f), journeyId: session.journeyId, revision: 1 }, player.cookie)
  assert.deepEqual([paused.ok, paused.code, paused.session?.revision], [true, 'paused', 2])
  const stale = await post(f, `${drivingPath}/resume`, { cityId: 'lagos', requestId: id(f), journeyId: session.journeyId, revision: 1 }, player.cookie)
  assert.deepEqual([stale.ok, stale.code, stale.session?.revision, stale.session?.state.status], [false, 'revision_conflict', 2, 'paused'])
  const replace = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, player.cookie)
  assert.deepEqual([replace.ok, replace.code, replace.session?.journeyId, replace.session?.revision, replace.session?.state.status], [false, 'journey_exists', session.journeyId, 2, 'paused'])
})

test('paused pending attempt can restart once; old journey receipts and packets cannot affect its replacement', async t => {
  const f = await livingFixture(t)
  const player = await onboard(f)
  await f.server.store.transact(db => {
    const owner = Object.values(db.sessions).find(record => record.publicId === player.id)
    assert.ok(owner?.cities.lagos)
    owner.cities.lagos.state.cash = 0
  })
  const beforeCash = await cash(f, player.cookie), beforeLedger = await ledger(f, player.id)
  const startRequest = { cityId: 'lagos', requestId: id(f) }
  const initial = await post(f, `${drivingPath}/start`, startRequest, player.cookie)
  const firstJourney = initial.session!
  const paused = await post(f, `${drivingPath}/pause`, { cityId: 'lagos', requestId: id(f), journeyId: firstJourney.journeyId, revision: firstJourney.revision }, player.cookie)
  const oldResumeRequest = { cityId: 'lagos', requestId: id(f), journeyId: firstJourney.journeyId, revision: paused.session!.revision }
  const resumed = await post(f, `${drivingPath}/resume`, oldResumeRequest, player.cookie)
  const pausedAgain = await post(f, `${drivingPath}/pause`, { cityId: 'lagos', requestId: id(f), journeyId: firstJourney.journeyId, revision: resumed.session!.revision }, player.cookie)
  assert.deepEqual([paused.code, resumed.code, pausedAgain.code], ['paused', 'resumed', 'paused'])

  const qualificationBefore = await qualificationSlice(f, player.id)
  const request = { cityId: 'lagos', requestId: id(f), journeyId: firstJourney.journeyId, revision: pausedAgain.session!.revision }
  const [one, two] = await Promise.all([
    post(f, `${drivingPath}/restart`, request, player.cookie),
    post(f, `${drivingPath}/restart`, request, player.cookie),
  ])
  const fresh = one.session!
  assert.deepEqual([one.ok, two.ok, one.code, two.code, [one.duplicate, two.duplicate].filter(Boolean).length], [true, true, 'restarted', 'restarted', 1])
  assert.notEqual(fresh.journeyId, firstJourney.journeyId)
  assert.deepEqual([fresh.revision, fresh.nextSequence, fresh.state.status, fresh.state.speed, fresh.state.checkpointIndex],
    [pausedAgain.session!.revision + 1, 1, 'running', 0, 0])
  assert.equal(one.session?.journeyId, two.session?.journeyId)
  assert.deepEqual(await qualificationSlice(f, player.id), qualificationBefore, 'restart does not award or alter qualification state')
  assert.deepEqual([await cash(f, player.cookie), await ledger(f, player.id)], [beforeCash, beforeLedger])

  const changedRetry = await f.request(`${drivingPath}/restart`, { ...request, journeyId: 'changed-journey' }, player.cookie)
  assert.deepEqual([changedRetry.status, (await changedRetry.json() as { error: string }).error], [409, 'client_id_conflict'])
  const oldInput = await post(f, `${drivingPath}/input`, { cityId: 'lagos', journeyId: firstJourney.journeyId, sequence: 1,
    frames: [{ throttle: 1, brake: 0, steer: 0 }] }, player.cookie)
  assert.deepEqual([oldInput.ok, oldInput.code, oldInput.session?.journeyId], [false, 'journey_mismatch', fresh.journeyId])
  const oldResumeReplay = await post(f, `${drivingPath}/resume`, oldResumeRequest, player.cookie)
  assert.deepEqual([oldResumeReplay.ok, oldResumeReplay.duplicate, oldResumeReplay.session?.journeyId], [false, true, fresh.journeyId])
  const oldStartReplay = await post(f, `${drivingPath}/start`, startRequest, player.cookie)
  assert.deepEqual([oldStartReplay.ok, oldStartReplay.code, oldStartReplay.session?.journeyId], [false, 'superseded_journey', fresh.journeyId])
  const staleNewResume = await post(f, `${drivingPath}/resume`, { ...oldResumeRequest, requestId: id(f) }, player.cookie)
  assert.deepEqual([staleNewResume.ok, staleNewResume.code, staleNewResume.session?.journeyId], [false, 'journey_mismatch', fresh.journeyId])
  const persisted = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  assert.equal((persisted as { journeyId: string }).journeyId, fresh.journeyId)
  assert.deepEqual([await cash(f, player.cookie), await ledger(f, player.id)], [beforeCash, beforeLedger])

  const pauseFresh = await post(f, `${drivingPath}/pause`, { cityId: 'lagos', requestId: id(f), journeyId: fresh.journeyId, revision: fresh.revision }, player.cookie)
  const secondRestartRequest = { cityId: 'lagos', requestId: id(f), journeyId: fresh.journeyId, revision: pauseFresh.session!.revision }
  const qualificationBeforeSupersededReplay = await qualificationSlice(f, player.id)
  const secondRestart = await post(f, `${drivingPath}/restart`, secondRestartRequest, player.cookie)
  const beforeOldReceiptReplay = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  const oldRestartReplay = await post(f, `${drivingPath}/restart`, request, player.cookie)
  const afterOldReceiptReplay = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  assert.deepEqual([oldRestartReplay.ok, oldRestartReplay.code, oldRestartReplay.duplicate, oldRestartReplay.session?.journeyId],
    [false, 'superseded_journey', true, secondRestart.session?.journeyId])
  assert.deepEqual(afterOldReceiptReplay, beforeOldReceiptReplay, 'an old restart receipt cannot claim or replace a later journey')
  assert.deepEqual(await qualificationSlice(f, player.id), qualificationBeforeSupersededReplay, 'superseded receipts do not alter qualifications')
})

test('distinct concurrent restart IDs against one paused revision have one winner', async t => {
  const f = await livingFixture(t)
  const player = await onboard(f)
  const started = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, player.cookie)
  const paused = await post(f, `${drivingPath}/pause`, { cityId: 'lagos', requestId: id(f), journeyId: started.session!.journeyId, revision: started.session!.revision }, player.cookie)
  const body = (requestId: string) => ({ cityId: 'lagos', requestId, journeyId: started.session!.journeyId, revision: paused.session!.revision })
  const [left, right] = await Promise.all([
    post(f, `${drivingPath}/restart`, body(id(f)), player.cookie),
    post(f, `${drivingPath}/restart`, body(id(f)), player.cookie),
  ])
  const results = [left, right]
  assert.equal(results.filter(result => result.ok && result.code === 'restarted').length, 1)
  assert.equal(results.filter(result => !result.ok && result.code === 'journey_mismatch').length, 1)
  const canonical = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id])) as { journeyId: string; revision: number; nextSequence: number }
  assert.equal(canonical.revision, paused.session!.revision + 1, 'the loser cannot advance the record a second time')
  assert.equal(canonical.nextSequence, 1)
  assert.ok(results.some(result => result.ok && result.session?.journeyId === canonical.journeyId))
})

test('malformed restart payload and reversed server time leave the paused save unchanged', async t => {
  const f = await livingFixture(t)
  const player = await onboard(f)
  const started = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, player.cookie)
  const paused = await post(f, `${drivingPath}/pause`, { cityId: 'lagos', requestId: id(f), journeyId: started.session!.journeyId, revision: started.session!.revision }, player.cookie)
  const request = { cityId: 'lagos', requestId: id(f), journeyId: started.session!.journeyId, revision: paused.session!.revision }
  const before = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  const malformed = await f.request(`${drivingPath}/restart`, { ...request, extra: true }, player.cookie)
  assert.deepEqual([malformed.status, (await malformed.json() as { error: string }).error], [400, 'invalid_driving_request'])
  assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id])), before)

  f.advance(-1)
  const reversed = await post(f, `${drivingPath}/restart`, { ...request, requestId: id(f) }, player.cookie)
  assert.deepEqual([reversed.ok, reversed.code], [false, 'clock_reversed'])
  assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id])), before)
})

test('restart refuses running, moved, failed-terminal, and passed attempts without replacing their record', async t => {
  const f = await livingFixture(t)
  const player = await onboard(f)
  const started = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, player.cookie)
  const runningRow = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  const running = await post(f, `${drivingPath}/restart`, { cityId: 'lagos', requestId: id(f), journeyId: started.session!.journeyId, revision: started.session!.revision }, player.cookie)
  const afterRunning = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  assert.deepEqual([running.ok, running.code, afterRunning], [false, 'journey_active', runningRow])
  const foreign = await onboard(f)
  const foreignRestart = await post(f, `${drivingPath}/restart`, { cityId: 'lagos', requestId: id(f), journeyId: started.session!.journeyId, revision: started.session!.revision }, foreign.cookie)
  const afterForeign = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  assert.deepEqual([foreignRestart.ok, foreignRestart.code, foreignRestart.session], [false, 'no_journey', null])
  assert.deepEqual(afterForeign, runningRow, 'another actor cannot restart or alter the owner’s row')

  const paused = await post(f, `${drivingPath}/pause`, { cityId: 'lagos', requestId: id(f), journeyId: started.session!.journeyId, revision: started.session!.revision }, player.cookie)
  await f.server.store.transact(db => {
    const life = Object.values(db.sessions).find(record => record.publicId === player.id)!.cities.lagos!.state
    life.location = 'library' as typeof life.location
  })
  const moved = await post(f, `${drivingPath}/restart`, { cityId: 'lagos', requestId: id(f), journeyId: started.session!.journeyId, revision: paused.session!.revision }, player.cookie)
  assert.deepEqual([moved.ok, moved.code, moved.session?.journeyId, moved.session?.revision], [false, 'location_changed', started.session!.journeyId, paused.session!.revision])

  for (const assessment of ['failed', 'passed'] as const) {
    const terminalPlayer = await onboard(f)
    const attempt = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, terminalPlayer.cookie)
    // This is a structurally valid fabricated terminal refusal fixture, not a course run or pass-evidence claim.
    await f.server.store.transact(db => {
      const rows = (db.livingWorld as { driving: Record<string, Record<string, unknown>> }).driving
      const row = rows[terminalPlayer.id]!
      row.revision = 2; row.nextSequence = 2
      row.lastPacket = { sequence: 1, fingerprint: 'valid-terminal-fixture-packet', code: 'lesson_completed' }
      row.state = { ...(row.state as object), speed: 0, checkpointIndex: PRACTICE_COURSE.checkpoints.length, checkpointEntry: 'blocked', stopDwellMs: 0,
        score: assessment === 'passed' ? 70 : 69, status: 'complete', assessment, feedback: assessment === 'passed' ? 'Assessment passed.' : 'Assessment not passed.' }
    })
    const before = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[terminalPlayer.id]))
    const response = await post(f, `${drivingPath}/restart`, { cityId: 'lagos', requestId: id(f), journeyId: attempt.session!.journeyId, revision: 2 }, terminalPlayer.cookie)
    const after = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[terminalPlayer.id]))
    assert.deepEqual([response.ok, response.code, after], [false, assessment === 'passed' ? 'assessment_retained' : 'restart_unavailable', before])
  }

  const exhausted = await onboard(f)
  const exhaustedStart = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, exhausted.cookie)
  const exhaustedPause = await post(f, `${drivingPath}/pause`, { cityId: 'lagos', requestId: id(f), journeyId: exhaustedStart.session!.journeyId, revision: exhaustedStart.session!.revision }, exhausted.cookie)
  await f.server.store.transact(db => {
    const row = (db.livingWorld as { driving: Record<string, Record<string, unknown>> }).driving[exhausted.id]!
    row.revision = Number.MAX_SAFE_INTEGER
  })
  const exhaustedBefore = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[exhausted.id]))
  const overflow = await post(f, `${drivingPath}/restart`, { cityId: 'lagos', requestId: id(f), journeyId: exhaustedStart.session!.journeyId, revision: Number.MAX_SAFE_INTEGER }, exhausted.cookie)
  const exhaustedAfter = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[exhausted.id]))
  assert.deepEqual([overflow.ok, overflow.code, exhaustedAfter], [false, 'revision_exhausted', exhaustedBefore])
  assert.ok(exhaustedPause.session)
})

test('failed restart transaction leaves the paused attempt intact and permits the same-ID retry', async t => {
  const disk = flakyDisk()
  const f = await livingFixture(t, { disk })
  const player = await onboard(f)
  const started = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, player.cookie)
  const paused = await post(f, `${drivingPath}/pause`, { cityId: 'lagos', requestId: id(f), journeyId: started.session!.journeyId, revision: started.session!.revision }, player.cookie)
  const request = { cityId: 'lagos', requestId: id(f), journeyId: started.session!.journeyId, revision: paused.session!.revision }
  const before = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  const qualificationBefore = await qualificationSlice(f, player.id)
  disk.fail = 'ENOSPC'
  const failure = await f.request(`${drivingPath}/restart`, request, player.cookie)
  assert.deepEqual([failure.status, (await failure.json() as { error: string }).error], [503, 'storage_unavailable'])
  disk.fail = null
  const unchanged = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  assert.deepEqual(unchanged, before)
  assert.deepEqual(await qualificationSlice(f, player.id), qualificationBefore, 'failed restart does not alter qualification state')
  const retry = await post(f, `${drivingPath}/restart`, request, player.cookie)
  assert.deepEqual([retry.ok, retry.code, retry.session?.revision, retry.session?.state.status], [true, 'restarted', paused.session!.revision + 1, 'running'])
  assert.notEqual(retry.session?.journeyId, started.session?.journeyId)
  assert.deepEqual(await qualificationSlice(f, player.id), qualificationBefore)
})

test('revision and sequence exhaustion refuse writes while the last safe legacy and v2 steps remain readable', async t => {
  const f = await fixture(t, { routes: configuredDrivingRoutes(true) })
  const max = Number.MAX_SAFE_INTEGER
  const mutateRow = async (publicId: string, update: (row: Record<string, unknown>) => void): Promise<void> => {
    await f.server.store.transact(db => {
      const row = (db.livingWorld as { driving: Record<string, Record<string, unknown>> }).driving[publicId]
      assert.ok(row, 'the fixture has a saved driving row')
      update(row)
    })
  }
  const readRow = (publicId: string) => f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[publicId]))

  const exhausted = await onboard(f)
  const exhaustedStart = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, exhausted.cookie)
  assert.ok(exhaustedStart.session)
  await mutateRow(exhausted.id, row => { row.revision = max })
  const exhaustedBefore = await readRow(exhausted.id)
  const current = await (await f.request(`${drivingPath}?city=lagos`, null, exhausted.cookie)).json() as Reply
  assert.deepEqual([current.ok, current.code], [false, 'revision_exhausted'])
  assert.deepEqual(await readRow(exhausted.id), exhaustedBefore, 'current refuses before its reload pause can overflow revision')
  const paused = await post(f, `${drivingPath}/pause`, { cityId: 'lagos', requestId: id(f), journeyId: exhaustedStart.session.journeyId, revision: max }, exhausted.cookie)
  assert.deepEqual([paused.ok, paused.code], [false, 'revision_exhausted'])
  assert.deepEqual(await readRow(exhausted.id), exhaustedBefore, 'pause refuses without changing a max-revision row')
  const exhaustedInput = await post(f, `${drivingPath}/input`, { cityId: 'lagos', journeyId: exhaustedStart.session.journeyId, sequence: 1,
    frames: [{ throttle: 1, brake: 0, steer: 0 }] }, exhausted.cookie)
  assert.deepEqual([exhaustedInput.ok, exhaustedInput.code], [false, 'revision_exhausted'])
  assert.deepEqual(await readRow(exhausted.id), exhaustedBefore, 'input refuses without changing a max-revision row')

  const resumeOwner = await onboard(f)
  const resumeStart = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, resumeOwner.cookie)
  assert.ok(resumeStart.session)
  const ordinaryPause = await post(f, `${drivingPath}/pause`, { cityId: 'lagos', requestId: id(f), journeyId: resumeStart.session.journeyId,
    revision: resumeStart.session.revision }, resumeOwner.cookie)
  assert.ok(ordinaryPause.session)
  await mutateRow(resumeOwner.id, row => { row.revision = max })
  const resumeBefore = await readRow(resumeOwner.id)
  const exhaustedResume = await post(f, `${drivingPath}/resume`, { cityId: 'lagos', requestId: id(f), journeyId: resumeStart.session.journeyId,
    revision: max }, resumeOwner.cookie)
  assert.deepEqual([exhaustedResume.ok, exhaustedResume.code], [false, 'revision_exhausted'])
  assert.deepEqual(await readRow(resumeOwner.id), resumeBefore, 'resume refuses before changing state or timestamps')

  const sequenceOwner = await onboard(f)
  const sequenceStart = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, sequenceOwner.cookie)
  assert.ok(sequenceStart.session)
  await mutateRow(sequenceOwner.id, row => {
    row.revision = max
    row.nextSequence = max
    row.lastPacket = { sequence: max - 1, fingerprint: 'prior-safe-receipt', code: 'controls_accepted' }
  })
  const sequenceBefore = await readRow(sequenceOwner.id)
  const exhaustedSequence = await post(f, `${drivingPath}/input`, { cityId: 'lagos', journeyId: sequenceStart.session.journeyId, sequence: max,
    frames: [{ throttle: 1, brake: 0, steer: 0 }] }, sequenceOwner.cookie)
  assert.deepEqual([exhaustedSequence.ok, exhaustedSequence.code], [false, 'sequence_exhausted'])
  assert.deepEqual(await readRow(sequenceOwner.id), sequenceBefore, 'sequence exhaustion preserves the complete row')

  const legacyOwner = await onboard(f)
  const legacyStart = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, legacyOwner.cookie)
  assert.ok(legacyStart.session)
  await mutateRow(legacyOwner.id, row => { row.revision = max - 1 })
  f.advance(100)
  const legacyPacket = { cityId: 'lagos', journeyId: legacyStart.session.journeyId, sequence: 1,
    frames: [{ throttle: 1, brake: 0, steer: 0 }] }
  const lastSafeLegacy = await post(f, `${drivingPath}/input`, legacyPacket, legacyOwner.cookie)
  assert.deepEqual([lastSafeLegacy.ok, lastSafeLegacy.session?.revision], [true, max])
  const legacyAtMax = await readRow(legacyOwner.id)
  const legacyReplay = await post(f, `${drivingPath}/input`, legacyPacket, legacyOwner.cookie)
  assert.deepEqual([legacyReplay.ok, legacyReplay.duplicate, legacyReplay.session?.revision], [true, true, max])
  assert.deepEqual(await readRow(legacyOwner.id), legacyAtMax, 'a retained legacy receipt remains readable and replayable at max revision')

  const v2Owner = await onboard(f)
  const v2Start = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, v2Owner.cookie)
  assert.ok(v2Start.session)
  f.advance(100)
  const explicitPacket = { cityId: 'lagos', journeyId: v2Start.session.journeyId, sequence: 1,
    frames: [{ throttle: 1, brake: 0, steer: 0, gear: 'forward' }] }
  const firstV2 = await post(f, `${drivingPath}/input`, explicitPacket, v2Owner.cookie)
  assert.ok(firstV2.ok && firstV2.session)
  await mutateRow(v2Owner.id, row => { row.revision = max - 1 })
  f.advance(100)
  const legacyV2Packet = { cityId: 'lagos', journeyId: v2Start.session.journeyId, sequence: 2,
    frames: [{ throttle: 0, brake: 1, steer: 0 }] }
  const lastSafeV2 = await post(f, `${drivingPath}/input`, legacyV2Packet, v2Owner.cookie)
  assert.deepEqual([lastSafeV2.ok, lastSafeV2.session?.revision, lastSafeV2.session?.state.gear], [true, max, 'forward'])
  const v2AtMax = await readRow(v2Owner.id)
  const v2Replay = await post(f, `${drivingPath}/input`, legacyV2Packet, v2Owner.cookie)
  assert.deepEqual([v2Replay.ok, v2Replay.duplicate, v2Replay.session?.revision], [true, true, max])
  assert.deepEqual(await readRow(v2Owner.id), v2AtMax, 'the v2 writer shape and retained receipt remain readable at max revision')
})

test('the last safe sequence and revision are accepted once; max receipts replay before timeout and clock reversal', async t => {
  const f = await fixture(t, { routes: configuredDrivingRoutes(true) })
  const max = Number.MAX_SAFE_INTEGER
  for (const scenario of [
    { name: 'v1 timeout', version: 1, clockReversed: false },
    { name: 'v1 reversed clock', version: 1, clockReversed: true },
    { name: 'retained v2 timeout', version: 2, clockReversed: false },
    { name: 'retained v2 reversed clock', version: 2, clockReversed: true },
  ] as const) {
    const player = await onboard(f)
    const started = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, player.cookie)
    assert.ok(started.ok && started.session, scenario.name)
    if (scenario.version === 2) {
      f.advance(100)
      const v2 = await post(f, `${drivingPath}/input`, { cityId: 'lagos', journeyId: started.session!.journeyId, sequence: 1,
        frames: [{ throttle: 0, brake: 0, steer: 0, gear: 'forward' }] }, player.cookie)
      assert.ok(v2.ok && v2.session, `${scenario.name} fixture must first retain a valid v2 row`)
    }
    await f.server.store.transact(db => {
      const row = (db.livingWorld as { driving: Record<string, Record<string, unknown>> }).driving[player.id]
      assert.ok(row, `${scenario.name} fixture has its journey`)
      assert.equal(row['v'], scenario.version)
      row['revision'] = max - 1
      row['nextSequence'] = max - 1
      row['lastPacket'] = { sequence: max - 2, fingerprint: 'prior-safe-boundary-receipt', code: 'controls_accepted' }
    })
    f.advance(100)
    const packet = { cityId: 'lagos', journeyId: started.session!.journeyId, sequence: max - 1,
      frames: [{ throttle: 1, brake: 0, steer: 0 }] }
    const accepted = await post(f, `${drivingPath}/input`, packet, player.cookie)
    assert.deepEqual([accepted.ok, accepted.code, accepted.session?.revision, accepted.session?.nextSequence],
      [true, 'controls_accepted', max, max], `${scenario.name}: MAX_SAFE_INTEGER - 1 is the final accepted revision and sequence`)
    const readRow = () => f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
    let expected = await readRow()
    const boundary = expected as { v: number; revision: number; nextSequence: number; lastPacket: { sequence: number } }
    assert.deepEqual([boundary.v, boundary.revision, boundary.nextSequence, boundary.lastPacket.sequence],
      [scenario.version, max, max, max - 1], `${scenario.name}: the successful boundary packet is retained without overflow`)

    if (scenario.clockReversed) {
      await f.server.store.transact(db => {
        const row = (db.livingWorld as { driving: Record<string, Record<string, unknown>> }).driving[player.id]
        assert.ok(row)
        row['updatedAt'] = f.now() + 5000
        row['lastInputAt'] = f.now() + 5000
      })
      expected = await readRow()
    } else f.advance(1600)

    const replay = await post(f, `${drivingPath}/input`, packet, player.cookie)
    assert.deepEqual([replay.ok, replay.code, replay.duplicate, replay.session?.revision, replay.session?.nextSequence],
      [true, 'controls_accepted', true, max, max], `${scenario.name}: retained MAX - 1 success replays before timeout/clock processing`)
    assert.deepEqual(await readRow(), expected, `${scenario.name}: delayed exact replay leaves the complete v${scenario.version} driving row unchanged`)

    const overflow = await post(f, `${drivingPath}/input`, { ...packet, sequence: max }, player.cookie)
    assert.deepEqual([overflow.ok, overflow.code, overflow.session?.revision, overflow.session?.nextSequence],
      [false, 'sequence_exhausted', max, max], `${scenario.name}: MAX itself cannot be accepted`)
    assert.deepEqual(await readRow(), expected, `${scenario.name}: exhausted sequence refusal leaves the complete row unchanged`)
  }
})

test('an exhausted running row refuses every lifecycle and control route on location mismatch without rewriting it', async t => {
  const f = await fixture(t, { routes: configuredDrivingRoutes(true) })
  const max = Number.MAX_SAFE_INTEGER
  const player = await onboard(f)
  const started = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, player.cookie)
  assert.ok(started.ok && started.session)
  await f.server.store.transact(db => {
    const row = (db.livingWorld as { driving: Record<string, Record<string, unknown>> }).driving[player.id]
    assert.ok(row)
    row['revision'] = max
    const life = Object.values(db.sessions).find(record => record.publicId === player.id)!.cities.lagos!.state
    life.location = 'library' as typeof life.location
  })
  const readRow = () => f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  const before = await readRow()
  const body = { cityId: 'lagos', journeyId: started.session!.journeyId, revision: max }
  const attempts: Array<[string, () => Promise<Reply>]> = [
    ['current', async () => await (await f.request(`${drivingPath}?city=lagos`, null, player.cookie)).json() as Reply],
    ['start', () => post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, player.cookie)],
    ['input', () => post(f, `${drivingPath}/input`, { cityId: 'lagos', journeyId: body.journeyId, sequence: 1, frames: [{ throttle: 1, brake: 0, steer: 0 }] }, player.cookie)],
    ['pause', () => post(f, `${drivingPath}/pause`, { ...body, requestId: id(f) }, player.cookie)],
    ['resume', () => post(f, `${drivingPath}/resume`, { ...body, requestId: id(f) }, player.cookie)],
    ['restart', () => post(f, `${drivingPath}/restart`, { ...body, requestId: id(f) }, player.cookie)],
  ]
  for (const [route, perform] of attempts) {
    const answer = await perform()
    assert.deepEqual([answer.ok, answer.code], [false, 'revision_exhausted'], `${route} must stop before its context-mismatch pause can overflow`)
    assert.deepEqual(await readRow(), before, `${route} must preserve the entire exhausted driving row; life settling is outside this assertion`)
  }
})

test('replaying a start receipt after a failed run is superseded by the canonical fresh journey', async t => {
  const f = await livingFixture(t)
  const player = await onboard(f)
  const originalStart = { cityId: 'lagos', requestId: id(f) }
  const first = await post(f, `${drivingPath}/start`, originalStart, player.cookie)
  const failedJourneyId = first.session!.journeyId

  // Seed a valid failed terminal assessment as if its final accepted control packet settled.
  await f.server.store.transact(db => {
    const rows = (db.livingWorld as { driving: Record<string, Record<string, unknown>> }).driving
    const row = rows[player.id]!
    row.revision = 2; row.nextSequence = 2
    row.lastPacket = { sequence: 1, fingerprint: 'completed-failed-practice-packet', code: 'lesson_completed' }
    row.state = { ...(row.state as object), speed: 0, checkpointIndex: 3, checkpointEntry: 'blocked', stopDwellMs: 0,
      score: 69, status: 'complete', assessment: 'failed', feedback: 'Assessment not passed.' }
  })
  const fresh = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, player.cookie)
  assert.deepEqual([fresh.ok, fresh.code, fresh.session?.state.status], [true, 'started', 'running'])
  assert.notEqual(fresh.session?.journeyId, failedJourneyId)
  const beforeReplay = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))

  const replay = await post(f, `${drivingPath}/start`, originalStart, player.cookie)
  const afterReplay = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  assert.deepEqual([replay.ok, replay.code, replay.duplicate, replay.session?.journeyId, replay.session?.revision, replay.session?.state.status],
    [false, 'superseded_journey', true, fresh.session?.journeyId, fresh.session?.revision, 'running'])
  assert.deepEqual(afterReplay, beforeReplay, 'an old start receipt cannot reset or move the newer journey')
})

test('server timeout and clock reversal pause without granting hidden simulation time', async t => {
  const f = await livingFixture(t)
  const player = await onboard(f)
  const start = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, player.cookie)
  const journey = start.session!
  f.advance(1501)
  const timedOut = await post(f, `${drivingPath}/input`, { cityId: 'lagos', journeyId: journey.journeyId, sequence: 1, frames: [{ throttle: 1, brake: 0, steer: 0 }] }, player.cookie)
  assert.deepEqual([timedOut.ok, timedOut.code, timedOut.session?.state.status, timedOut.session?.state.speed, timedOut.session?.revision], [false, 'input_timeout', 'paused', 0, 2])
  const resumed = await post(f, `${drivingPath}/resume`, { cityId: 'lagos', requestId: id(f), journeyId: journey.journeyId, revision: 2 }, player.cookie)
  assert.equal(resumed.code, 'resumed')
  f.advance(-1)
  const reversed = await post(f, `${drivingPath}/input`, { cityId: 'lagos', journeyId: journey.journeyId, sequence: 1, frames: [{ throttle: 1, brake: 0, steer: 0 }] }, player.cookie)
  assert.deepEqual([reversed.ok, reversed.code, reversed.session?.state.status, reversed.session?.state.speed, reversed.session?.revision], [false, 'clock_reversed', 'paused', 0, 4])
  const readBack = await (await f.request(`${drivingPath}?city=lagos`, null, player.cookie)).json() as Reply
  const times = await f.server.store.read(db => {
    const row = (db.livingWorld as { driving: Record<string, { updatedAt: number; lastInputAt: number }> }).driving[player.id]
    return [row?.updatedAt, row?.lastInputAt]
  })
  assert.deepEqual([readBack.code, readBack.session?.revision, readBack.session?.state.status, ...times], ['current', 4, 'paused', 101501, 101501])
  const stillReversed = await post(f, `${drivingPath}/resume`, { cityId: 'lagos', requestId: id(f), journeyId: journey.journeyId, revision: 4 }, player.cookie)
  assert.deepEqual([stillReversed.ok, stillReversed.code, stillReversed.session?.revision, stillReversed.session?.state.status], [false, 'clock_reversed', 4, 'paused'])
  f.advance(1)
  const caughtUp = await post(f, `${drivingPath}/resume`, { cityId: 'lagos', requestId: id(f), journeyId: journey.journeyId, revision: 4 }, player.cookie)
  assert.deepEqual([caughtUp.ok, caughtUp.code, caughtUp.session?.revision, caughtUp.session?.state.status], [true, 'resumed', 5, 'running'])
})

test('the public route isolates actors, pins city and location, and rejects altered packets', async t => {
  const f = await livingFixture(t)
  const player = await onboard(f)
  const other = await onboard(f)
  const start = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, player.cookie)
  const journey = start.session!
  const wrongActor = await (await f.request(`${drivingPath}?city=lagos`, null, other.cookie)).json() as Reply
  assert.deepEqual([wrongActor.ok, wrongActor.code, wrongActor.session], [true, 'no_journey', null])
  const wrongCity = await f.request(`${drivingPath}?city=ibadan`, null, player.cookie)
  assert.deepEqual([wrongCity.status, (await wrongCity.json() as { error: string }).error], [409, 'city_moved'])
  f.advance(100)
  const extraField = await post(f, `${drivingPath}/input`, { cityId: 'lagos', journeyId: journey.journeyId, sequence: 1,
    frames: [{ throttle: 0, brake: 0, steer: 0 }], position: { x: 0, z: 1000 } }, player.cookie)
  assert.equal(extraField.error, 'invalid_driving_packet')
  const packet = { cityId: 'lagos', journeyId: journey.journeyId, sequence: 1, frames: [{ throttle: 0, brake: 0, steer: 0 }] }
  const outOfOrder = await post(f, `${drivingPath}/input`, { ...packet, sequence: 2 }, player.cookie)
  assert.deepEqual([outOfOrder.ok, outOfOrder.code, outOfOrder.session?.revision], [false, 'sequence_conflict', 1])
  f.advance(100)
  const [one, two] = await Promise.all([post(f, `${drivingPath}/input`, packet, player.cookie), post(f, `${drivingPath}/input`, packet, player.cookie)])
  assert.deepEqual([one.session?.revision, two.session?.revision, [one.duplicate, two.duplicate].filter(Boolean).length], [2, 2, 1])
  const conflict = await post(f, `${drivingPath}/input`, { ...packet, frames: [{ throttle: 0, brake: 1, steer: 0 }] }, player.cookie)
  assert.deepEqual([conflict.ok, conflict.code, conflict.session?.revision], [false, 'packet_conflict', 2])

  await f.server.store.transact(db => {
    const rows = (db.livingWorld as { driving: Record<string, Record<string, unknown>> }).driving
    const state = rows[player.id]!.state as { status: string; speed: number; stopDwellMs: number }
    state.status = 'running'; state.speed = 1; state.stopDwellMs = 0
    const life = Object.values(db.sessions).find(record => record.publicId === player.id)!.cities.lagos!.state
    life.location = 'library' as typeof life.location
  })
  const locationChanged = await post(f, `${drivingPath}/input`, { ...packet, sequence: 2 }, player.cookie)
  assert.deepEqual([locationChanged.ok, locationChanged.code, locationChanged.session?.state.status, locationChanged.session?.state.speed], [false, 'location_changed', 'paused', 0])
})

test('malformed saved journey is left intact and a failed durable start leaves no record', async t => {
  const f = await livingFixture(t)
  const player = await onboard(f)
  const start = await post(f, `${drivingPath}/start`, { cityId: 'lagos', requestId: id(f) }, player.cookie)
  assert.equal(start.code, 'started')
  await f.server.store.transact(db => {
    const rows = (db.livingWorld as { driving: Record<string, Record<string, unknown>> }).driving
    rows[player.id]!.lastPacket = { sequence: 1, fingerprint: 'fabricated-first-receipt', code: 'controls_accepted' }
  })
  const receiptBefore = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  const malformedRestart = await post(f, `${drivingPath}/restart`, { cityId: 'lagos', requestId: id(f), journeyId: start.session!.journeyId, revision: start.session!.revision }, player.cookie)
  const afterMalformedRestart = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  assert.deepEqual([malformedRestart.ok, malformedRestart.code, afterMalformedRestart], [false, 'invalid_saved_journey', receiptBefore])
  const badReceipt = await (await f.request(`${drivingPath}?city=lagos`, null, player.cookie)).json() as Reply
  const receiptAfter = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  assert.deepEqual([badReceipt.code, badReceipt.session, receiptAfter], ['invalid_saved_journey', null, receiptBefore])

  await f.server.store.transact(db => {
    const rows = (db.livingWorld as { driving: Record<string, Record<string, unknown>> }).driving
    rows[player.id]!.lastPacket = null
    const state = rows[player.id]!.state as { score: number }
    state.score = 101
  })
  const before = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  const invalid = await (await f.request(`${drivingPath}?city=lagos`, null, player.cookie)).json() as Reply
  const after = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  assert.deepEqual([invalid.ok, invalid.code, invalid.session], [false, 'invalid_saved_journey', null])
  assert.deepEqual(after, before)

  await f.server.store.transact(db => {
    const rows = (db.livingWorld as { driving: Record<string, Record<string, unknown>> }).driving
    const row = rows[player.id]!
    row.revision = 2; row.nextSequence = 2
    row.lastPacket = { sequence: 1, fingerprint: 'wrong-terminal-receipt', code: 'controls_accepted' }
    row.state = { ...(row.state as object), speed: 0, checkpointIndex: 3, checkpointEntry: 'blocked', stopDwellMs: 0,
      score: 69, status: 'complete', assessment: 'failed', feedback: 'Assessment not passed.' }
  })
  const terminalBefore = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  const wrongTerminal = await (await f.request(`${drivingPath}?city=lagos`, null, player.cookie)).json() as Reply
  const terminalAfter = await f.server.store.read(db => snapshot((db.livingWorld as { driving: Record<string, unknown> }).driving[player.id]))
  assert.deepEqual([wrongTerminal.ok, wrongTerminal.code, wrongTerminal.session, terminalAfter],
    [false, 'invalid_saved_journey', null, terminalBefore], 'a terminal save requires its matching completion receipt and stays quarantined')

  const disk = flakyDisk()
  const broken = await livingFixture(t, { disk })
  const next = await onboard(broken)
  disk.fail = 'ENOSPC'
  const refused = await broken.request(`${drivingPath}/start`, { cityId: 'lagos', requestId: id(broken) }, next.cookie)
  assert.deepEqual([refused.status, (await refused.json() as { error: string }).error], [503, 'storage_unavailable'])
  disk.fail = null
  const absent = await (await broken.request(`${drivingPath}?city=lagos`, null, next.cookie)).json() as Reply
  assert.deepEqual([absent.ok, absent.code, absent.session], [true, 'no_journey', null])
})
