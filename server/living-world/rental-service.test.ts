/** Public-route proof: the permission is derived from actual driving packets and remains non-allocating. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, flakyDisk, snapshot } from '../test-fixture.ts'
import { ROUTE_MODULES } from '../routes/index.ts'
import livingWorldRoutes from '../routes/living-world.ts'
import { PRACTICE_COURSE } from '../../src/game/living-world/course.ts'
import type { DrivingPoint } from '../../src/game/living-world/driving.ts'
import type { DrivingResponse, QualificationResponse, StarterRentalResponse } from '../../src/types/living-world.ts'

const LOOK = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
const driving = '/api/living-world/driving', qualification = '/api/living-world/qualification', rental = '/api/living-world/rental'
const road = PRACTICE_COURSE.roads[0]!
const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n))
function projection(point: DrivingPoint): number {
  let distance = Infinity, progress = 0, total = 0
  for (let i = 1; i < road.length; i++) {
    const a = road[i - 1]!, b = road[i]!, dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz)
    const fraction = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / (length * length), 0, 1)
    const separation = Math.hypot(point.x - a.x - dx * fraction, point.z - a.z - dz * fraction)
    if (separation < distance) { distance = separation; progress = total + length * fraction }
    total += length
  }
  return progress
}
function pointAt(progress: number): DrivingPoint {
  for (let i = 1; i < road.length; i++) {
    const a = road[i - 1]!, b = road[i]!, length = Math.hypot(b.x - a.x, b.z - a.z)
    if (progress <= length) return { x: a.x + (b.x - a.x) * progress / length, z: a.z + (b.z - a.z) * progress / length }
    progress -= length
  }
  return road[road.length - 1]!
}

async function liveFixture(t: Parameters<typeof fixture>[0], extra: Parameters<typeof fixture>[1] = {}) {
  assert.ok(ROUTE_MODULES.includes(livingWorldRoutes), 'the real production route registry includes rental routes')
  return fixture(t, extra)
}
async function guest(f: Awaited<ReturnType<typeof fixture>>, name = 'Ada') {
  const created = await f.request('/api/session', { name, onboarding: true })
  assert.equal(created.status, 200)
  const cookie = (created.headers.get('set-cookie') ?? '').split(';')[0]!
  const publicId = (await created.json() as { session: { id: string } }).session.id
  assert.ok(cookie && publicId)
  assert.equal((await f.action(cookie, { type: 'onboarding.quick-start', payload: { look: LOOK } })).code, 'playing')
  await f.request('/api/life?city=lagos', null, cookie)
  return { cookie, publicId }
}
async function json<T>(f: Awaited<ReturnType<typeof fixture>>, path: string, body: object, cookie: string): Promise<T> {
  return await (await f.request(path, body, cookie)).json() as T
}
async function completeCourse(f: Awaited<ReturnType<typeof fixture>>, cookie: string): Promise<string> {
  const post = (suffix: string, body: object) => json<DrivingResponse>(f, driving + suffix, body, cookie)
  let answer = await post('/start', { cityId: 'lagos', requestId: f.id() })
  assert.ok(answer.ok && answer.session)
  let progress = 0, packets = 0
  while (answer.session!.state.status === 'running' && packets < 500) {
    const state = answer.session!.state
    progress = Math.max(progress, projection(state.position))
    const target = pointAt(progress + 3.5), targetHeading = Math.atan2(target.x - state.position.x, target.z - state.position.z)
    const headingError = Math.atan2(Math.sin(targetHeading - state.heading), Math.cos(targetHeading - state.heading))
    const steer = clamp(Math.atan2(2 * 2.6 * Math.sin(headingError), 3.5) / 0.62, -1, 1)
    const checkpoint = PRACTICE_COURSE.checkpoints[state.checkpointIndex]!
    const stopping = checkpoint.stopRequired && Math.hypot(state.position.x - checkpoint.center.x, state.position.z - checkpoint.center.z) <= checkpoint.radius - 0.2 + state.speed * state.speed / 16
    const input = { throttle: stopping ? 0 : state.speed < 3 ? 1 : 0, brake: stopping || state.speed > 3.3 ? 1 : 0, steer }
    f.advance(100)
    answer = await post('/input', { cityId: 'lagos', journeyId: answer.session!.journeyId, sequence: answer.session!.nextSequence, frames: [input] })
    assert.equal(answer.ok, true, `course packet ${packets}: ${answer.code}`)
    packets++
  }
  assert.deepEqual([answer.session?.state.status, answer.session?.state.assessment], ['complete', 'passed'], 'only live control packets complete the authored assessment')
  return answer.session!.journeyId
}
async function cashAndLedger(f: Awaited<ReturnType<typeof fixture>>, cookie: string) {
  const body = await (await f.request('/api/life?city=lagos', null, cookie)).json() as { state: { cash: number; ledger: unknown } }
  return { cash: body.state.cash, ledger: snapshot(body.state.ledger) }
}

test('actual driving pass grants one zero-cash starter permission, with no vehicle allocation or wallet effect', async t => {
  const disk = flakyDisk()
  const f = await liveFixture(t, { disk })
  const player = await guest(f)
  await f.server.store.transact(db => {
    const owner = Object.values(db.sessions).find(record => record.publicId === player.publicId)
    assert.ok(owner?.cities.lagos)
    owner.cities.lagos.state.cash = 0
  })
  const walletBefore = await cashAndLedger(f, player.cookie)
  assert.equal(walletBefore.cash, 0)
  const denied = await json<StarterRentalResponse>(f, rental + '/claim', {
    cityId: 'lagos', requestId: f.id(), qualificationJourneyId: 'client-says-pass', qualificationVersion: 1,
  }, player.cookie)
  assert.deepEqual([denied.ok, denied.code, denied.permission], [false, 'qualification_required', null])

  const journeyId = await completeCourse(f, player.cookie)
  const qualified = await json<QualificationResponse>(f, qualification + '/claim', { cityId: 'lagos', requestId: f.id(), journeyId }, player.cookie)
  assert.ok(qualified.ok && qualified.valid && qualified.qualification)
  const body = { cityId: 'lagos', requestId: f.id(), qualificationJourneyId: journeyId, qualificationVersion: qualified.qualification.version }
  const wrongJourney = await json<StarterRentalResponse>(f, rental + '/claim', { ...body, requestId: f.id(), qualificationJourneyId: 'other-pass' }, player.cookie)
  const wrongVersion = await json<StarterRentalResponse>(f, rental + '/claim', { ...body, requestId: f.id(), qualificationVersion: 2 }, player.cookie)
  const other = await guest(f, 'Bola')
  const wrongActor = await json<StarterRentalResponse>(f, rental + '/claim', { ...body, requestId: f.id() }, other.cookie)
  assert.deepEqual([wrongJourney.code, wrongVersion.code, wrongActor.code], ['qualification_mismatch', 'qualification_mismatch', 'qualification_required'])
  disk.fail = 'ENOSPC'
  const failed = await f.request(rental + '/claim', body, player.cookie)
  assert.deepEqual([failed.status, (await failed.json() as { error: string }).error], [503, 'storage_unavailable'])
  disk.fail = null
  const absent = await f.server.store.read(db => Object.hasOwn((db.livingWorld as { rentals?: Record<string, unknown> } | undefined)?.rentals ?? {}, player.publicId))
  assert.equal(absent, false, 'a failed transaction leaves neither a permission nor a once receipt')
  const requestA = body, requestB = { ...body, requestId: f.id() }
  const [one, two] = await Promise.all([
    json<StarterRentalResponse>(f, rental + '/claim', requestA, player.cookie),
    json<StarterRentalResponse>(f, rental + '/claim', requestB, player.cookie),
  ])
  const granted = one.code === 'permission_issued' ? one : two, retained = one.code === 'permission_issued' ? two : one
  const grantedRequest = one.code === 'permission_issued' ? requestA : requestB
  assert.deepEqual([granted.ok, retained.ok, retained.code, retained.valid, granted.permission?.resourceId, retained.permission],
    [true, true, 'permission_retained', true, 'marina-starter-sedan', granted.permission])
  assert.equal([one, two].filter(reply => reply.code === 'permission_issued').length, 1, 'distinct concurrent requests write exactly one permission')
  const retry = await json<StarterRentalResponse>(f, rental + '/claim', grantedRequest, player.cookie)
  assert.deepEqual([retry.ok, retry.duplicate, retry.permission], [true, true, granted.permission])
  assert.deepEqual([granted.tripAvailable, retry.tripAvailable, granted.allocation, retry.allocation], [false, false, 'none', 'none'])
  assert.match(granted.reason ?? '', /mapped driving route is not available yet; no car has been allocated/i)
  assert.equal(granted.permission?.scope, 'district-driving')

  const anotherReceipt = await json<StarterRentalResponse>(f, rental + '/claim', { ...body, requestId: f.id() }, player.cookie)
  assert.deepEqual([anotherReceipt.ok, anotherReceipt.code, anotherReceipt.valid, anotherReceipt.permission], [true, 'permission_retained', true, granted.permission])
  const staleProof = await json<StarterRentalResponse>(f, rental + '/claim', { ...body, requestId: f.id(), qualificationVersion: 2 }, player.cookie)
  assert.deepEqual([staleProof.ok, staleProof.valid, staleProof.permission], [false, false, granted.permission], 'a retained row cannot bypass current qualification matching')
  const current = await (await f.request(rental + '?city=lagos', null, player.cookie)).json() as StarterRentalResponse
  assert.deepEqual([current.valid, current.tripAvailable, current.allocation, current.permission], [true, false, 'none', granted.permission])
  await f.server.store.transact(db => {
    const owner = Object.values(db.sessions).find(record => record.publicId === player.publicId)
    assert.ok(owner?.cities.lagos)
    owner.cities.lagos.state.location = 'library' as typeof owner.cities.lagos.state.location
  })
  const moved = await (await f.request(rental + '?city=lagos', null, player.cookie)).json() as StarterRentalResponse
  assert.deepEqual([moved.code, moved.valid, moved.permission], ['permission_retained', true, granted.permission], 'a stable permission survives walking within Lagos')
  assert.deepEqual(await cashAndLedger(f, player.cookie), walletBefore, 'practice, qualification, and permission do not credit or debit cash or ledger')
  const saved = await f.server.store.read(db => snapshot((db.livingWorld as { rentals: Record<string, unknown> }).rentals[player.publicId]))
  assert.deepEqual(saved, { version: 1, revision: 1, generation: 0, entitlement: granted.permission, trip: null })
  // Negative authority fixtures only: no revoked or corrupted evidence may authorize a retained permission.
  const sourceBefore = await f.server.store.read(db => snapshot(db.livingWorld))
  await f.server.store.transact(db => {
    const root = db.livingWorld as { qualifications: Record<string, { qualification: { status: string } }>; driving: Record<string, { location: string }> }
    root.qualifications[player.publicId]!.qualification.status = 'revoked'
    const owner = Object.values(db.sessions).find(record => record.publicId === player.publicId)!
    assert.ok(owner.cities.lagos)
    owner.cities.lagos.state.location = root.driving[player.publicId]!.location as typeof owner.cities.lagos.state.location
  })
  const revokedRead = await (await f.request(rental + '?city=lagos', null, player.cookie)).json() as StarterRentalResponse
  const revokedRetry = await json<StarterRentalResponse>(f, rental + '/claim', grantedRequest, player.cookie)
  const revokedFresh = await json<StarterRentalResponse>(f, rental + '/claim', { ...body, requestId: f.id() }, player.cookie)
  assert.deepEqual([revokedRead.ok, revokedRead.valid, revokedRetry.ok, revokedRetry.valid, revokedFresh.ok, revokedFresh.valid],
    [false, false, false, false, false, false], 'saved receipts and fresh IDs cannot bypass revoked qualification')
  assert.deepEqual(revokedRetry.permission, granted.permission, 'revocation invalidates authority without destroying custody/permission history')
  assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { rentals: Record<string, unknown> }).rentals[player.publicId])), saved)
  await f.server.store.transact(db => {
    const root = db.livingWorld as { qualifications: Record<string, unknown>; driving: Record<string, unknown> }
    root.qualifications = snapshot((sourceBefore as typeof root).qualifications)
    root.driving[player.publicId] = { future: true }
  })
  const corruptRead = await (await f.request(rental + '?city=lagos', null, player.cookie)).json() as StarterRentalResponse
  assert.deepEqual([corruptRead.ok, corruptRead.valid], [false, false], 'a qualification alone cannot replace missing control-derived pass evidence')
  assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { rentals: Record<string, unknown> }).rentals[player.publicId])), saved)
})

test('rental rows are strict and malformed/future saves remain unchanged', async t => {
  const f = await liveFixture(t)
  const player = await guest(f)
  const malformed = { version: 2, revision: 0, generation: 0, entitlement: null, trip: null, future: true }
  await f.server.store.transact(db => {
    db.livingWorld = { rentals: { [player.publicId]: malformed } }
  })
  const before = await f.server.store.read(db => snapshot((db.livingWorld as { rentals: Record<string, unknown> }).rentals[player.publicId]))
  const current = await (await f.request(rental + '?city=lagos', null, player.cookie)).json() as StarterRentalResponse
  const after = await f.server.store.read(db => snapshot((db.livingWorld as { rentals: Record<string, unknown> }).rentals[player.publicId]))
  assert.deepEqual([current.ok, current.code, current.permission, after], [false, 'invalid_saved_rental', null, before])
})
