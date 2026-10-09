import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, snapshot } from '../test-fixture.ts'
import { ROUTE_MODULES } from '../routes/index.ts'
import livingWorldRoutes from '../routes/living-world.ts'
import { PROGRAMMES } from '../../src/campus/unilag/curriculum.ts'
import { readValidatedAssessmentRecord } from './assessment-service.ts'
import type { AssessmentResponse } from '../../src/types/living-world-assessment.ts'
import type { Look } from '../../src/types/life.ts'
import { lagosTime } from '../../src/game/clock.ts'

const PATH = '/api/living-world/assessment'
const LOOK: Look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
type Player = { cookie: string; id: string }
type Reply = AssessmentResponse & { error?: string; serverTime?: number }

async function setup(t: Parameters<typeof fixture>[0]) {
  assert.ok(ROUTE_MODULES.includes(livingWorldRoutes), 'assessment acceptance uses the production living-world route module')
  return fixture(t, { log: () => {} })
}

/** Synthetic setup positioning/skill, followed by real admission, matriculation and registration actions. */
async function computerStudent(f: Awaited<ReturnType<typeof fixture>>, name: string): Promise<Player> {
  const created = await f.request('/api/session', { name, onboarding: true })
  assert.equal(created.status, 200)
  const body = await created.json() as { session?: { id?: string } }
  const player = { cookie: (created.headers.get('set-cookie') ?? '').split(';')[0] ?? '', id: body.session?.id ?? '' }
  assert.ok(player.cookie && player.id)
  assert.equal((await f.action(player.cookie, { type: 'onboarding.quick-start', payload: { look: LOOK } })).code, 'playing')
  await f.server.store.transact(db => {
    const session = Object.values(db.sessions).find(row => row.publicId === player.id)
    assert.ok(session?.cities.lagos)
    const life = session.cities.lagos.state
    life.location = 'unilag'
    life.spot = 'senate'
    life.skills.coding = Math.max(life.skills.coding, 100)
  })
  assert.equal((await f.action(player.cookie, { type: 'unilag.apply', payload: { programme: 'computer' } })).code, 'admitted')
  assert.equal((await f.action(player.cookie, { type: 'unilag.matriculate' })).code, 'matriculated')
  const courses = PROGRAMMES.computer.semesters[0]!.courses.map(course => course.id)
  assert.equal((await f.action(player.cookie, { type: 'unilag.register-semester', payload: { courses } })).code, 'registered')
  assert.equal((await f.action(player.cookie, { type: 'spot', payload: { id: PROGRAMMES.computer.spot } })).code, 'selected')
  return player
}

async function get(f: Awaited<ReturnType<typeof fixture>>, who: Player): Promise<Reply> {
  return await (await f.request(`${PATH}?city=lagos`, null, who.cookie)).json() as Reply
}
async function post(f: Awaited<ReturnType<typeof fixture>>, suffix: string, body: object, who: Player): Promise<Reply> {
  return await (await f.request(`${PATH}${suffix}`, body, who.cookie)).json() as Reply
}
async function currentTerm(f: Awaited<ReturnType<typeof fixture>>, who: Player) {
  return f.server.store.read(db => {
    const session = Object.values(db.sessions).find(row => row.publicId === who.id)
    assert.ok(session?.cities.lagos)
    const term = session.cities.lagos.state.unilagStudent.term
    assert.ok(term)
    assert.ok(term.assessments['cpe-101'])
    return snapshot({ ...term, assignment: term.assessments['cpe-101'].assignment })
  })
}
async function effects(f: Awaited<ReturnType<typeof fixture>>, who: Player) {
  return f.server.store.read(db => {
    const session = Object.values(db.sessions).find(row => row.publicId === who.id)
    const life = session?.cities.lagos?.state
    return snapshot({ cash: life?.cash ?? null, ledger: life?.ledger ?? null, politics: db.politics ?? null })
  })
}

test('the registered cpe-101 lab requires active probes and writes its one fixed assignment mark atomically', async t => {
  const f = await setup(t), learner = await computerStudent(f, 'CPE learner'), other = await computerStudent(f, 'Other learner')
  const effectsBefore = await effects(f, learner), otherBefore = await effects(f, other)
  const hadLivingWorld = await f.server.store.read(db => Object.hasOwn(db, 'livingWorld'))
  const ready = await get(f, learner)
  assert.deepEqual([ready.ok, ready.code, ready.practice?.phase, ready.assignmentMark], [true, 'assessment_ready', undefined, null])
  assert.equal(await f.server.store.read(db => Object.hasOwn(db, 'livingWorld')), hadLivingWorld, 'an unstarted current read creates no collection')
  await f.server.store.transact(db => {
    const session = Object.values(db.sessions).find(row => row.publicId === learner.id)
    assert.ok(session?.cities.lagos)
    session.cities.lagos.state.spot = 'senate'
  })
  const wrongSpot = await post(f, '/start', { cityId: 'lagos', requestId: f.id() }, learner)
  assert.deepEqual([wrongSpot.ok, wrongSpot.code, wrongSpot.practice], [false, 'assessment_location_required', null])
  await f.server.store.transact(db => {
    const session = Object.values(db.sessions).find(row => row.publicId === learner.id)
    assert.ok(session?.cities.lagos)
    session.cities.lagos.state.spot = PROGRAMMES.computer.spot
  })

  const started = await post(f, '/start', { cityId: 'lagos', requestId: f.id() }, learner)
  assert.deepEqual([started.ok, started.code, started.term?.courseId, started.practice?.phase, started.revision],
    [true, 'assessment_started', 'cpe-101', 'inspect', 1])
  const otherCurrent = await get(f, other)
  assert.equal(otherCurrent.practice, null, 'another registered actor cannot read this learner practice')
  assert.equal(otherCurrent.term?.courseId, 'cpe-101', 'the other actor still sees their own registered course')

  const step = async (operation: object, revision: number, requestId = f.id()) => post(f, '/step', {
    cityId: 'lagos', requestId, expectedRevision: revision, operation,
  }, learner)
  const forged = await f.request(`${PATH}/step`, {
    cityId: 'lagos', requestId: f.id(), expectedRevision: 1, operation: { kind: 'submit', score: 30 },
  }, learner.cookie)
  assert.deepEqual([forged.status, (await forged.json() as Reply).error], [400, 'invalid_assessment_request'])
  const premature = await step({ kind: 'submit' }, 1)
  assert.deepEqual([premature.ok, premature.code, premature.revision, premature.assignmentMark], [false, 'verification_required', 1, null])

  const firstId = f.id()
  const firstBody = { cityId: 'lagos', requestId: firstId, expectedRevision: 1, operation: { kind: 'probe', a: false, b: false } }
  const first = await post(f, '/step', firstBody, learner)
  assert.deepEqual([first.ok, first.revision, first.practice?.initialProbes.length], [true, 2, 1])
  const retry = await post(f, '/step', firstBody, learner)
  assert.deepEqual([retry.ok, retry.duplicate, retry.practice], [true, true, first.practice])
  const changedRetry = await f.request(`${PATH}/step`, { ...firstBody, operation: { kind: 'probe', a: false, b: true } }, learner.cookie)
  assert.deepEqual([changedRetry.status, (await changedRetry.json() as Reply).error], [409, 'client_id_conflict'])

  // Distinct requests race on one revision; the store serializes them and the pure CAS allows one winner.
  const raceRevision = 2
  const [raceA, raceB] = await Promise.all([
    step({ kind: 'probe', a: false, b: true }, raceRevision),
    step({ kind: 'probe', a: true, b: false }, raceRevision),
  ])
  assert.equal([raceA.ok, raceB.ok].filter(Boolean).length, 1)
  let loaded = await get(f, learner)
  assert.deepEqual([loaded.practice?.initialProbes.length, loaded.assignmentMark], [2, null])
  let revision = loaded.revision!
  const seen = loaded.practice!.initialProbes.map(row => `${Number(row.a)}${Number(row.b)}`)
  const missing = (['00', '01', '10', '11'] as const).filter(key => !seen.includes(key))
  for (const pair of missing) {
    const probe = await step({ kind: 'probe', a: pair[0] === '1', b: pair[1] === '1' }, revision)
    assert.equal(probe.ok, true)
    revision = probe.revision!
  }
  assert.equal((await get(f, learner)).practice?.initialProbes.length, 4)

  const wrongInspect = await step({ kind: 'inspect', a: false, b: false }, revision)
  assert.deepEqual([wrongInspect.ok, wrongInspect.code, wrongInspect.revision], [false, 'not_counterexample', revision])
  const inspected = await step({ kind: 'inspect', a: false, b: true }, revision)
  assert.deepEqual([inspected.ok, inspected.practice?.phase], [true, 'repair'])
  revision = inspected.revision!
  const wrongRepair = await step({ kind: 'repair', gate: 'xor' }, revision)
  assert.deepEqual([wrongRepair.ok, wrongRepair.code, wrongRepair.revision], [false, 'repair_mismatch', revision])
  const repaired = await step({ kind: 'repair', gate: 'and' }, revision)
  assert.deepEqual([repaired.ok, repaired.practice?.phase], [true, 'verify'])
  revision = repaired.revision!

  for (const [a, b] of [[false, false], [false, true], [true, false], [true, true]] as const) {
    const verified = await step({ kind: 'probe', a, b }, revision)
    assert.equal(verified.ok, true)
    revision = verified.revision!
  }
  assert.equal((await get(f, learner)).practice?.phase, 'submit')
  const completedId = f.id()
  const completed = await step({ kind: 'submit' }, revision, completedId)
  assert.deepEqual([completed.ok, completed.code, completed.practice?.phase, completed.practice?.score, completed.assignmentMark],
    [true, 'completed', 'complete', 30, 30])
  const completedRetry = await step({ kind: 'submit' }, revision, completedId)
  assert.deepEqual([completedRetry.ok, completedRetry.duplicate, completedRetry.assignmentMark], [true, true, 30])
  assert.equal((await get(f, learner)).assignmentMark, 30)
  assert.deepEqual(await currentTerm(f, learner).then(term => term.assignment), 30)
  const saved = await f.server.store.read(db => snapshot((db.livingWorld as { assessments: Record<string, unknown> }).assessments[learner.id]))
  const parsed = readValidatedAssessmentRecord(saved, learner.id)
  assert.ok(parsed)
  assert.equal(parsed.attempts[0]?.practice.phase, 'complete')
  assert.deepEqual(await effects(f, learner), effectsBefore, 'training changes only the one registered assignment mark, not cash, ledger, or live politics')
  assert.deepEqual(await effects(f, other), otherBefore, 'another actor receives no assessment-side effects')
})

test('legacy timed assignment marks win, while a new registered startDay keeps earlier practice without carrying its score', async t => {
  const f = await setup(t), learner = await computerStudent(f, 'Term learner')
  const firstStart = await post(f, '/start', { cityId: 'lagos', requestId: f.id() }, learner)
  assert.equal(firstStart.ok, true)
  const oldStepId = f.id()
  const oldStep = await post(f, '/step', {
    cityId: 'lagos', requestId: oldStepId, expectedRevision: 1, operation: { kind: 'probe', a: false, b: true },
  }, learner)
  assert.deepEqual([oldStep.ok, oldStep.practice?.initialProbes.length], [true, 1])

  const firstTerm = await currentTerm(f, learner)
  await f.server.store.transact(db => {
    const session = Object.values(db.sessions).find(row => row.publicId === learner.id)
    assert.ok(session?.cities.lagos?.state.unilagStudent.term)
    const term = session.cities.lagos.state.unilagStudent.term
    term.startDay += 1
    term.deadlineDay += 1
    assert.ok(term.assessments['cpe-101'])
    term.assessments['cpe-101'].assignment = null
  })
  const secondStart = await post(f, '/start', { cityId: 'lagos', requestId: f.id() }, learner)
  assert.deepEqual([secondStart.ok, secondStart.practice?.phase, secondStart.revision], [true, 'inspect', 1])
  assert.notEqual(secondStart.term?.startDay, firstTerm.startDay, 'synthetic fixture changes only the registered-term identity')
  const staleGenerationRetry = await post(f, '/step', {
    cityId: 'lagos', requestId: oldStepId, expectedRevision: 1, operation: { kind: 'probe', a: false, b: true },
  }, learner)
  assert.deepEqual([staleGenerationRetry.ok, staleGenerationRetry.code, staleGenerationRetry.term?.startDay,
    staleGenerationRetry.practice?.phase, staleGenerationRetry.revision, staleGenerationRetry.assignmentMark],
    [false, 'term_changed', secondStart.term?.startDay, 'inspect', 1, null], 'an old receipt cannot replay an observation or mark into the new term')
  const stored = await f.server.store.read(db => snapshot((db.livingWorld as { assessments: Record<string, unknown> }).assessments[learner.id]))
  const record = readValidatedAssessmentRecord(stored, learner.id)
  assert.ok(record)
  assert.deepEqual(record.attempts.map(attempt => [attempt.startDay, attempt.practice.initialMask]), [
    [firstTerm.startDay, 0b0010], [secondStart.term!.startDay, 0],
  ])

  const other = await computerStudent(f, 'Legacy mark learner')
  assert.equal((await f.action(other.cookie, { type: 'unilag.assignment', payload: { course: 'cpe-101' } })).code, 'interactive_required')
  // Simulate only an assignment already persisted by the prior release; new actions cannot start it.
  await f.server.store.transact(db => {
    const session = Object.values(db.sessions).find(row => row.publicId === other.id)
    assert.ok(session?.cities.lagos?.state.unilagStudent.term)
    const life = session.cities.lagos.state, time = lagosTime(f.now())
    life.activeAction = { kind: 'campus-study', id: 'cpe-101', task: 'assignment', semester: life.unilagStudent.term!.semester,
      duration: 45, remaining: 45, startedDay: time.day, startedMinute: time.minuteOfDay }
  })
  f.advance(45_000)
  await f.request('/api/life?city=lagos', null, other.cookie)
  const legacyMark = await currentTerm(f, other).then(term => term.assignment)
  assert.ok(typeof legacyMark === 'number')
  const beforeGet = await currentTerm(f, other)
  const legacyCurrent = await get(f, other)
  assert.deepEqual([legacyCurrent.code, legacyCurrent.practice, legacyCurrent.assignmentMark], ['assignment_retained', null, legacyMark])
  assert.deepEqual(await currentTerm(f, other), beforeGet, 'GET does not roll, overwrite, or settle the legacy assessment')
  const refusedStart = await post(f, '/start', { cityId: 'lagos', requestId: f.id() }, other)
  assert.deepEqual([refusedStart.ok, refusedStart.assignmentMark], [false, legacyMark])
  assert.deepEqual(await currentTerm(f, other), beforeGet, 'the existing timed mark remains authoritative')
})

test('future assessment data is hidden and preserved instead of reset', async t => {
  const f = await setup(t), learner = await computerStudent(f, 'Assessment recovery')
  assert.equal((await post(f, '/start', { cityId: 'lagos', requestId: f.id() }, learner)).ok, true)
  await f.server.store.transact(db => {
    const rows = (db.livingWorld as { assessments: Record<string, Record<string, unknown>> }).assessments
    rows[learner.id]!.v = 2
  })
  const before = await f.server.store.read(db => snapshot((db.livingWorld as { assessments: Record<string, unknown> }).assessments[learner.id]))
  const current = await get(f, learner)
  assert.deepEqual([current.ok, current.code, current.practice], [false, 'invalid_saved_assessment', null])
  assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { assessments: Record<string, unknown> }).assessments[learner.id])), before)
  assert.equal(readValidatedAssessmentRecord(before, learner.id), null)
})
