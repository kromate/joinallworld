import test from 'node:test'
import assert from 'node:assert/strict'
import { barberLesson } from '../../src/game/living-world/barber-catalogue.ts'
import { startBarberPractice, stepBarberPractice } from '../../src/game/living-world/barber.ts'
import { createDriving } from '../../src/game/living-world/driving.ts'
import { PRACTICE_COURSE } from '../../src/game/living-world/course.ts'
import type { Db } from '../types.ts'
import { eraseLivingWorldProgress, exportLivingWorldProgress, rebindBarberAccount } from './privacy.ts'

const actors = { active: 'privacy-active', parked: 'privacy-parked', unrelated: 'privacy-unrelated' } as const
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const dbWith = (livingWorld: unknown): Db => ({ version: 1, sessions: {}, livingWorld }) as Db

function completedBarberRecord(publicId: string, account: string | null): Record<string, unknown> {
  const basic = barberLesson('basic')!
  let practice = startBarberPractice(basic.plan)!
  const strokes = [
    { tool: 'comb', y: 0.4, xs: [0.25, 0.4, 0.55] },
    { tool: 'clippers', y: 0.69, xs: [0.25, 0.4, 0.55] },
    { tool: 'brush', y: 0.47, xs: [0.4, 0.55, 0.7] },
  ] as const
  for (const stroke of strokes) for (const x of stroke.xs) {
    const result = stepBarberPractice(practice, { tool: stroke.tool, x, y: stroke.y, pressed: true }, basic.plan)
    assert.ok(result.state)
    practice = result.state
  }
  assert.equal(practice.status, 'complete')

  const advanced = barberLesson('advanced')!
  const advancedPractice = startBarberPractice(advanced.plan)!
  const finalFrames = strokes[2]!.xs.map(x => ({ tool: 'brush', x, y: 0.47, pressed: true }))
  return {
    v: 1,
    publicId,
    account,
    starterTool: true,
    currentLesson: 'advanced',
    results: { basic: { lessonId: 'basic', styleId: basic.resultStyleId, look: basic.look, earnedAt: 30 } },
    lessons: {
      basic: {
        lessonId: 'basic', sessionId: `private-basic-${publicId}`, cityId: 'lagos', location: 'barber-shop',
        createdAt: 10, updatedAt: 30, lastInputAt: 30, creditMs: 0, revision: 4, nextSequence: 4,
        practice, lastPacket: { cityId: 'lagos', sessionId: `private-basic-${publicId}`, revision: 3, sequence: 3, frames: finalFrames, code: 'lesson_completed' }, claimed: true,
      },
      advanced: {
        lessonId: 'advanced', sessionId: `private-advanced-${publicId}`, cityId: 'lagos', location: 'barber-shop',
        createdAt: 31, updatedAt: 32, lastInputAt: 32, creditMs: 0, revision: 2, nextSequence: 2,
        practice: advancedPractice,
        lastPacket: { cityId: 'lagos', sessionId: `private-advanced-${publicId}`, revision: 1, sequence: 1,
          frames: [{ tool: 'comb', x: 0.25, y: 0.4, pressed: false }], code: 'controls_accepted' },
        claimed: false,
      },
    },
  }
}

function drivingRecord(publicId: string): Record<string, unknown> {
  return {
    v: 1, publicId, journeyId: `journey-${publicId}`, cityId: 'lagos', location: 'driving-school',
    createdAt: 1, updatedAt: 1, lastInputAt: 1, creditMs: 0, revision: 1, nextSequence: 1,
    state: createDriving(PRACTICE_COURSE), lastPacket: null,
  }
}
function qualificationRecord(publicId: string): Record<string, unknown> {
  return {
    v: 1, publicId,
    qualification: { id: 'district-driving', version: 1, evidenceJourneyId: `journey-${publicId}`, earnedAt: 20, status: 'active' },
    courseId: 'district-practice', courseVersion: '1', cityId: 'lagos',
  }
}
function withoutAccount(value: Record<string, unknown>): Record<string, unknown> {
  const copy = structuredClone(value)
  delete copy.account
  return copy
}

test('same-character account rebinding changes only the barber owner on strict rows', () => {
  const original = completedBarberRecord(actors.active, null)
  const rows = { [actors.active]: original }
  const db = dbWith({ barber: rows })
  const before = structuredClone(original)

  assert.equal(rebindBarberAccount(db, actors.active, null, 'account-verified'), true)
  assert.strictEqual(rows[actors.active], original, 'rebinding mutates the original row instead of replacing or resetting it')
  assert.equal(original.account, 'account-verified')
  assert.deepEqual(withoutAccount(original), withoutAccount(before), 'claimed result, tool, active practice, revisions and packet receipts remain exact')

  const afterLink = structuredClone(original)
  assert.equal(rebindBarberAccount(db, actors.active, 'account-verified', null), true)
  assert.equal(original.account, null)
  assert.deepEqual(withoutAccount(original), withoutAccount(afterLink), 'account-to-guest preserves the same character progress')

  const wrongOwner = structuredClone(original)
  assert.equal(rebindBarberAccount(db, actors.active, 'somebody-else', 'account-other'), false)
  assert.deepEqual(original, wrongOwner, 'wrong-owner transition is unchanged')

  const malformed = { ...completedBarberRecord(actors.active, null), futureField: { private: true } }
  const malformedBefore = structuredClone(malformed)
  const malformedDb = dbWith({ barber: { [actors.active]: malformed } })
  assert.equal(rebindBarberAccount(malformedDb, actors.active, null, 'account-verified'), false)
  assert.deepEqual(malformed, malformedBefore, 'strict-parser refusal leaves malformed source intact')

  const hostile = completedBarberRecord(actors.active, null)
  Object.defineProperty(hostile, 'account', { configurable: true, enumerable: true, get() { throw new Error('hostile getter') } })
  const hostileDescriptor = Object.getOwnPropertyDescriptor(hostile, 'account')
  assert.equal(rebindBarberAccount(dbWith({ barber: { [actors.active]: hostile } }), actors.active, null, 'account-verified'), false)
  assert.deepEqual(Object.getOwnPropertyDescriptor(hostile, 'account'), hostileDescriptor, 'throwing saved property is refused unchanged')
})

test('progress export point-reads owned active and parked IDs and emits only whitelisted summaries', () => {
  const barber = {
    [actors.active]: completedBarberRecord(actors.active, 'private-account-id'),
    [actors.parked]: completedBarberRecord(actors.parked, 'private-account-id'),
    [actors.unrelated]: { secret: 'unrelated-hostile-record', account: 'other-account', unexpected: true },
  }
  const db = dbWith({
    driving: { [actors.active]: drivingRecord(actors.active), [actors.parked]: drivingRecord(actors.parked), [actors.unrelated]: { privateToken: 'unread' } },
    qualifications: { [actors.active]: qualificationRecord(actors.active), [actors.parked]: qualificationRecord(actors.parked), [actors.unrelated]: { future: true } },
    barber,
  })
  const before = structuredClone(db.livingWorld)
  const exported = exportLivingWorldProgress(db, 'private-account-id', [actors.active, actors.parked])
  assert.deepEqual(exported.actors.map(actor => actor.publicId), [actors.active, actors.parked])
  assert.deepEqual(exported.actors.map(actor => [actor.driving.status, actor.qualification.status, actor.barber.status]), [
    ['present', 'present', 'present'], ['present', 'present', 'present'],
  ])
  assert.deepEqual(exported.actors[0]?.barber, {
    status: 'present',
    progress: {
      starterTool: true,
      lessons: {
        basic: { status: 'claimed', revision: 4, styleId: 'man-low-cut-v1', earnedAt: 30 },
        advanced: { status: 'running', revision: 2, styleId: null, earnedAt: null },
      },
    },
  })
  const json = JSON.stringify(exported)
  for (const privateValue of ['private-account-id', 'private-basic-', 'private-advanced-', 'lastPacket', 'frames', 'unrelated-hostile-record', 'privateToken', 'unexpected']) {
    assert.equal(json.includes(privateValue), false, `export omits ${privateValue}`)
  }
  assert.deepEqual(db.livingWorld, before, 'export does not initialize or mutate stored rows')

  const wrongOwner = exportLivingWorldProgress(db, 'different-server-account', [actors.active])
  assert.equal(wrongOwner.actors[0]?.driving.status, 'present')
  assert.equal(wrongOwner.actors[0]?.qualification.status, 'present')
  assert.deepEqual(wrongOwner.actors[0]?.barber, { status: 'quarantined' }, 'strict barber data for another account is not exported')
  assert.deepEqual(db.livingWorld, before, 'wrong-owner export is also read-only')
})

test('empty legacy and malformed future data are represented without bootstrap or overwrite', () => {
  const legacy = dbWith(undefined)
  const legacyBefore = structuredClone(legacy)
  const empty = exportLivingWorldProgress(legacy, 'account-verified', [actors.active])
  assert.deepEqual(empty.actors[0], {
    publicId: actors.active,
    driving: { status: 'empty' }, qualification: { status: 'empty' }, barber: { status: 'empty' },
  })
  assert.deepEqual(legacy, legacyBefore, 'missing legacy collection remains absent')
  eraseLivingWorldProgress(dbWith(null), [])

  const malformed = dbWith({
    driving: [],
    qualifications: 'future-layout',
    barber: { [actors.active]: { v: 2, opaqueFuture: 'never disclose' } },
    futureSlice: { [actors.active]: { data: 'preserve' } },
  })
  const before = structuredClone(malformed)
  const exported = exportLivingWorldProgress(malformed, 'account-verified', [actors.active])
  assert.deepEqual(exported.actors[0], {
    publicId: actors.active,
    driving: { status: 'quarantined' }, qualification: { status: 'quarantined' }, barber: { status: 'quarantined' },
  })
  assert.equal(JSON.stringify(exported).includes('never disclose'), false)
  assert.deepEqual(malformed, before, 'malformed roots and future slices are read-only')
  assert.equal(rebindBarberAccount(malformed, actors.active, null, 'account-verified'), false, 'a future barber row cannot be rebound')
  assert.deepEqual(malformed, before, 'refusing a future row leaves it unchanged')
  assert.throws(() => eraseLivingWorldProgress(malformed, [actors.active]), /privacy-erasure-unavailable/)
  assert.deepEqual(malformed, before, 'malformed known maps refuse erasure before any slice is changed')

  const malformedRoot = dbWith(null)
  const rootBefore = structuredClone(malformedRoot)
  assert.deepEqual(exportLivingWorldProgress(malformedRoot, 'account-verified', [actors.active]).actors[0], {
    publicId: actors.active,
    driving: { status: 'quarantined' }, qualification: { status: 'quarantined' }, barber: { status: 'quarantined' },
  })
  assert.throws(() => eraseLivingWorldProgress(malformedRoot, [actors.active]), /privacy-erasure-unavailable/)
  assert.deepEqual(malformedRoot, rootBefore)
})

test('erasure preflights every known map before deleting from earlier valid maps', () => {
  const db = dbWith({
    driving: { [actors.active]: drivingRecord(actors.active) },
    qualifications: { [actors.active]: qualificationRecord(actors.active) },
    barber: 'malformed-map',
    futureSlice: { preserve: true },
  })
  const before = structuredClone(db)
  assert.throws(() => eraseLivingWorldProgress(db, [actors.active]), /privacy-erasure-unavailable/)
  assert.deepEqual(db, before, 'malformed later barber map leaves valid driving and qualification rows unchanged')
})

test('explicit erasure deletes only supplied IDs, including malformed owned rows', () => {
  const activeBarber = completedBarberRecord(actors.active, 'private-account-id')
  const unrelatedBarber = completedBarberRecord(actors.unrelated, 'other-account')
  const db = dbWith({
    driving: { [actors.active]: drivingRecord(actors.active), [actors.parked]: { malformed: true }, [actors.unrelated]: drivingRecord(actors.unrelated) },
    qualifications: { [actors.active]: qualificationRecord(actors.active), [actors.parked]: { malformed: true }, [actors.unrelated]: qualificationRecord(actors.unrelated) },
    barber: { [actors.active]: activeBarber, [actors.parked]: { v: 99 }, [actors.unrelated]: unrelatedBarber },
    futureSlice: { [actors.parked]: { preserve: true } },
  })
  const root = db.livingWorld as Record<string, unknown>
  const futureBefore = structuredClone(root.futureSlice)
  const activeBefore = {
    driving: structuredClone((root.driving as Record<string, unknown>)[actors.active]),
    qualifications: structuredClone((root.qualifications as Record<string, unknown>)[actors.active]),
    barber: structuredClone((root.barber as Record<string, unknown>)[actors.active]),
  }
  const unrelatedBefore = {
    driving: structuredClone((root.driving as Record<string, unknown>)[actors.unrelated]),
    qualifications: structuredClone((root.qualifications as Record<string, unknown>)[actors.unrelated]),
    barber: structuredClone((root.barber as Record<string, unknown>)[actors.unrelated]),
  }
  eraseLivingWorldProgress(db, [actors.parked])
  for (const slice of ['driving', 'qualifications', 'barber']) {
    const rows = root[slice] as Record<string, unknown>
    assert.equal(Object.hasOwn(rows, actors.parked), false)
    assert.deepEqual(rows[actors.active], activeBefore[slice as keyof typeof activeBefore])
    assert.deepEqual(rows[actors.unrelated], unrelatedBefore[slice as keyof typeof unrelatedBefore])
  }
  assert.deepEqual(root.futureSlice, futureBefore, 'unknown future slices are never traversed or deleted')
})

test('invalid or oversized erasure identity input refuses before effects', () => {
  const db = dbWith({ driving: { [actors.active]: drivingRecord(actors.active) }, futureSlice: { retain: true } })
  const before = structuredClone(db)
  assert.throws(() => eraseLivingWorldProgress(db, ['bad id']), TypeError)
  assert.throws(() => eraseLivingWorldProgress(db, Array.from({ length: 7 }, (_, i) => `actor-${i}`)), TypeError)
  assert.deepEqual(db, before, 'invalid and over-cap lists have no effects')
})

test('erasure reports a nonconfigurable owned row refusal and leaves unrelated rows intact', () => {
  const target = drivingRecord(actors.active)
  const other = drivingRecord(actors.unrelated)
  const rows: Record<string, unknown> = { [actors.unrelated]: other }
  Object.defineProperty(rows, actors.active, { value: target, enumerable: true, configurable: false, writable: true })
  const db = dbWith({ driving: rows })
  assert.throws(() => eraseLivingWorldProgress(db, [actors.active]), Error)
  assert.strictEqual(rows[actors.active], target, 'failed deletion does not remove a nonconfigurable row')
  assert.strictEqual(rows[actors.unrelated], other, 'unrelated row remains unchanged')
})
