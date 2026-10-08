import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, flakyDisk, snapshot } from '../test-fixture.ts'
import { ROUTE_MODULES } from '../routes/index.ts'
import livingWorldRoutes from '../routes/living-world.ts'
import type { DrivingResponse } from '../../src/types/living-world.ts'
import type { Look } from '../../src/types/life.ts'

const LOOK: Look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
const drivingPath = '/api/living-world/driving'
async function livingFixture(t: Parameters<typeof fixture>[0], extra: Parameters<typeof fixture>[1] = {}) {
  assert.ok(ROUTE_MODULES.includes(livingWorldRoutes), 'the production route registry includes living-world routes')
  return fixture(t, extra)
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
