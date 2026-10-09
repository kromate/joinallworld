import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, flakyDisk, snapshot } from '../test-fixture.ts'
import { ROUTE_MODULES } from '../routes/index.ts'
import type { RouteContext, RouteHandler, RouteKey, RouteModule } from '../types.ts'
import { createQualificationService, type DrivingEvidence, type QualificationResponse, type ReadDrivingEvidence } from './qualification-service.ts'
import { PRACTICE_COURSE } from '../../src/game/living-world/course.ts'
import type { Look } from '../../src/types/life.ts'

const LOOK: Look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
const TEST_CURRENT = '/api/test/living-world/qualification'
const TEST_CLAIM = `${TEST_CURRENT}/claim`
const ROUTE = PRACTICE_COURSE
type Player = { cookie: string; id: string }
type Reply = QualificationResponse & { error?: string }
type EvidenceTable = Map<string, DrivingEvidence | null | false>

/** Test-only mount: the evidence callback is trusted server fixture data, never a request field. */
const qualificationTestRoutes = (evidence: EvidenceTable): RouteModule => (ctx: RouteContext) => {
  const service = createQualificationService(ctx, ((db, publicId) => evidence.has(publicId) ? evidence.get(publicId)! : null) as ReadDrivingEvidence)
  return {
    [ `GET ${TEST_CURRENT}` as RouteKey ]: (async request => ({ body: await service.current(request, request.query.get('city')), renew: true })) as RouteHandler,
    [ `POST ${TEST_CLAIM}` as RouteKey ]: (async request => ({ body: await service.claim(request, await request.json()), renew: true })) as RouteHandler,
  }
}

async function mountedFixture(t: Parameters<typeof fixture>[0], options: Parameters<typeof fixture>[1] = {}) {
  const evidence: EvidenceTable = new Map()
  const f = await fixture(t, { ...options, routes: [...ROUTE_MODULES, qualificationTestRoutes(evidence)] })
  return { f, evidence }
}
async function onboard(f: Awaited<ReturnType<typeof fixture>>, name = 'Ada'): Promise<Player> {
  const created = await f.request('/api/session', { name, onboarding: true })
  assert.equal(created.status, 200)
  const body = await created.json() as { session?: { id?: string } }
  const player = { cookie: (created.headers.get('set-cookie') ?? '').split(';')[0] ?? '', id: body.session?.id ?? '' }
  assert.ok(player.cookie && player.id)
  const action = async (fields: Record<string, unknown>) => f.action(player.cookie, fields as Parameters<typeof f.action>[1])
  assert.equal((await action({ type: 'onboarding.quick-start', payload: { look: LOOK } })).code, 'playing')
  await f.request('/api/life?city=lagos', null, player.cookie)
  return player
}
async function location(f: Awaited<ReturnType<typeof fixture>>, publicId: string): Promise<string> {
  return f.server.store.read(db => {
    const owner = Object.values(db.sessions).find(record => record.publicId === publicId)
    assert.ok(owner?.cities.lagos)
    return owner.cities.lagos.state.location
  })
}
function evidenceFor(journeyId: string, place: string, at = 100000, patch: Partial<DrivingEvidence> = {}): DrivingEvidence {
  return { journeyId, cityId: 'lagos', location: place as DrivingEvidence['location'], routeId: ROUTE.id, routeVersion: ROUTE.version, earnedAt: at, ...patch }
}
const id = (f: Awaited<ReturnType<typeof fixture>>) => f.id()
async function post(f: Awaited<ReturnType<typeof fixture>>, body: object, cookie: string): Promise<Reply> {
  return await (await f.request(TEST_CLAIM, body, cookie)).json() as Reply
}
async function current(f: Awaited<ReturnType<typeof fixture>>, cookie: string): Promise<Reply> {
  return await (await f.request(`${TEST_CURRENT}?city=lagos`, null, cookie)).json() as Reply
}
async function wallet(f: Awaited<ReturnType<typeof fixture>>, player: Player): Promise<{ cash: number; ledger: unknown }> {
  return f.server.store.read(db => {
    const state = Object.values(db.sessions).find(record => record.publicId === player.id)?.cities.lagos?.state
    return { cash: state?.cash ?? -1, ledger: snapshot(state?.ledger) }
  })
}
const claimBody = (f: Awaited<ReturnType<typeof fixture>>, journeyId: string, requestId = id(f)) => ({ cityId: 'lagos', requestId, journeyId })

test('a retained pass can be claimed once with zero cash and canonical duplicate responses', async t => {
  const { f, evidence } = await mountedFixture(t)
  const player = await onboard(f)
  evidence.set(player.id, evidenceFor('road-test-1', await location(f, player.id)))
  const beforeWallet = await wallet(f, player)
  await f.server.store.transact(db => {
    const owner = Object.values(db.sessions).find(record => record.publicId === player.id)
    assert.ok(owner?.cities.lagos)
    owner.cities.lagos.state.cash = 0
  })
  const zeroWallet = await wallet(f, player)
  assert.equal(zeroWallet.cash, 0)
  const available = await current(f, player.cookie)
  assert.deepEqual([available.code, available.qualification, available.valid], ['claim_available', null, false])

  const request = claimBody(f, 'road-test-1')
  const [one, two] = await Promise.all([post(f, request, player.cookie), post(f, request, player.cookie)])
  assert.deepEqual([one.ok, two.ok, one.qualification?.id, two.qualification?.id, [one.duplicate, two.duplicate].filter(Boolean).length],
    [true, true, 'district-driving', 'district-driving', 1])
  assert.deepEqual(await current(f, player.cookie).then(row => [row.code, row.valid, row.qualification?.evidenceJourneyId]), ['qualified', true, 'road-test-1'])
  assert.deepEqual(await wallet(f, player), { ...zeroWallet, cash: 0 }, 'claiming a simulated qualification never credits or debits cash')
  assert.deepEqual(beforeWallet.ledger, zeroWallet.ledger)

  const before = await f.server.store.read(db => snapshot((db.livingWorld as { qualifications: Record<string, unknown> }).qualifications[player.id]))
  const anotherId = await post(f, claimBody(f, 'road-test-1'), player.cookie)
  const after = await f.server.store.read(db => snapshot((db.livingWorld as { qualifications: Record<string, unknown> }).qualifications[player.id]))
  assert.deepEqual([anotherId.ok, anotherId.code, anotherId.valid, after], [false, 'qualification_retained', false, before], 'a new receipt cannot award the same qualification again')
})

test('claim gates actor, journey, course and current city/location before storing a result', async t => {
  const { f, evidence } = await mountedFixture(t)
  const player = await onboard(f)
  const other = await onboard(f, 'Bola')
  const place = await location(f, player.id)
  evidence.set(player.id, evidenceFor('road-test-2', place))

  const otherActor = await post(f, claimBody(f, 'road-test-2'), other.cookie)
  const wrongJourney = await post(f, claimBody(f, 'other-journey'), player.cookie)
  assert.deepEqual([otherActor.code, wrongJourney.code], ['assessment_required', 'assessment_mismatch'])
  const wrongCity = await f.request(TEST_CLAIM, { cityId: 'ibadan', requestId: id(f), journeyId: 'road-test-2' }, player.cookie)
  assert.deepEqual([wrongCity.status, (await wrongCity.json() as { error: string }).error], [409, 'city_moved'])
  evidence.set(player.id, evidenceFor('road-test-2', place, 100000, { routeVersion: 'stale-course' }))
  const staleCourse = await post(f, claimBody(f, 'road-test-2'), player.cookie)
  assert.equal(staleCourse.code, 'reassessment_required')
  evidence.set(player.id, evidenceFor('road-test-2', place))

  await f.server.store.transact(db => {
    const owner = Object.values(db.sessions).find(record => record.publicId === player.id)
    assert.ok(owner?.cities.lagos)
    owner.cities.lagos.state.location = 'library' as typeof owner.cities.lagos.state.location
  })
  const departed = await post(f, claimBody(f, 'road-test-2'), player.cookie)
  assert.equal(departed.code, 'assessment_location_changed')
  assert.equal(await f.server.store.read(db => Object.hasOwn((db.livingWorld as { qualifications?: Record<string, unknown> }).qualifications ?? {}, player.id)), false)
})

test('malformed qualification data stays quarantined and old receipts cannot validate newer evidence', async t => {
  const { f, evidence } = await mountedFixture(t)
  const player = await onboard(f)
  evidence.set(player.id, evidenceFor('old-pass', await location(f, player.id)))
  const oldClaim = claimBody(f, 'old-pass')
  assert.equal((await post(f, oldClaim, player.cookie)).code, 'qualified')

  evidence.set(player.id, evidenceFor('new-pass', await location(f, player.id), 100010))
  const replayOld = await post(f, oldClaim, player.cookie)
  assert.deepEqual([replayOld.ok, replayOld.code, replayOld.valid, replayOld.qualification?.evidenceJourneyId], [false, 'qualification_receipt_superseded', false, 'old-pass'])
  const newReceipt = await post(f, claimBody(f, 'new-pass'), player.cookie)
  assert.deepEqual([newReceipt.ok, newReceipt.code, newReceipt.qualification?.evidenceJourneyId], [false, 'qualification_retained', 'old-pass'])
  assert.deepEqual(await current(f, player.cookie).then(row => [row.code, row.valid]), ['reassessment_required', false])

  await f.server.store.transact(db => {
    const rows = (db.livingWorld as { qualifications: Record<string, unknown> }).qualifications
    rows[player.id] = { v: 2, publicId: player.id, qualification: { id: 'district-driving', version: 1, evidenceJourneyId: 'old-pass', earnedAt: 100000, status: 'active' }, courseId: ROUTE.id, courseVersion: ROUTE.version, cityId: 'lagos' }
  })
  const malformedBefore = await f.server.store.read(db => snapshot((db.livingWorld as { qualifications: Record<string, unknown> }).qualifications[player.id]))
  const malformed = await current(f, player.cookie)
  const malformedAfter = await f.server.store.read(db => snapshot((db.livingWorld as { qualifications: Record<string, unknown> }).qualifications[player.id]))
  assert.deepEqual([malformed.code, malformed.valid, malformed.qualification, malformedAfter], ['invalid_saved_qualification', false, null, malformedBefore])
})

test('durable write failure leaves no partial qualification; the same evidence is safely claimable after recovery', async t => {
  const disk = flakyDisk()
  const { f, evidence } = await mountedFixture(t, { disk })
  const player = await onboard(f)
  evidence.set(player.id, evidenceFor('durable-pass', await location(f, player.id)))
  const request = claimBody(f, 'durable-pass')
  disk.fail = 'ENOSPC'
  const failed = await f.request(TEST_CLAIM, request, player.cookie)
  assert.deepEqual([failed.status, (await failed.json() as { error: string }).error], [503, 'storage_unavailable'])
  disk.fail = null
  const absent = await f.server.store.read(db => Object.hasOwn((db.livingWorld as { qualifications?: Record<string, unknown> } | undefined)?.qualifications ?? {}, player.id))
  assert.equal(absent, false)
  const recovered = await post(f, request, player.cookie)
  assert.deepEqual([recovered.ok, recovered.code, recovered.qualification?.evidenceJourneyId, recovered.duplicate ?? false], [true, 'qualified', 'durable-pass', false], 'failed writes roll back the once receipt as well as the qualification')
})
