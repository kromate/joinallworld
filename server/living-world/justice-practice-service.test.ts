/** HTTP fixtures use the registered production routes; Worker restart is a separate gate. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture, snapshot } from '../test-fixture.ts'
import { readValidatedJusticePracticeRecord } from './justice-practice-service.ts'
import type { Look } from '../../src/types/life.ts'
import type { JusticePracticeAction } from '../../src/game/living-world/justice-practice.ts'

const PATH = '/api/living-world/justice-practice'
const LOOK: Look = { body: 'man', hair: 'low-cut', outfit: 'casual', fabric: 'plain', skin: 'skin-4', hairColor: 'black', outfitColor: 'blue', bottomsColor: 'navy' }
type Player = { cookie: string; id: string }
type Reply = {
  ok?: boolean; code?: string; error?: string; feedback?: string; duplicate?: true
  practice?: { caseId: string; title: string; disclaimer: string; summary: string; phase: string; revision: number; prompt: string; evidence: unknown[]; trainingComplete: boolean } | null
  revision?: number | null
}

async function setup(t: Parameters<typeof fixture>[0]) {
  return fixture(t, { log: () => {} })
}

async function player(f: Awaited<ReturnType<typeof fixture>>, name: string): Promise<Player> {
  const response = await f.request('/api/session', { name, onboarding: true })
  assert.equal(response.status, 200)
  const payload = await response.json() as { session?: { id?: string } }
  const result = { cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '', id: payload.session?.id ?? '' }
  assert.ok(result.cookie && result.id)
  assert.equal((await f.action(result.cookie, { type: 'onboarding.quick-start', payload: { look: LOOK } })).code, 'playing')
  return result
}

async function get(f: Awaited<ReturnType<typeof fixture>>, who: Player): Promise<Reply> {
  return await (await f.request(`${PATH}?city=lagos`, null, who.cookie)).json() as Reply
}
async function post(f: Awaited<ReturnType<typeof fixture>>, suffix: string, body: object, who: Player): Promise<Reply> {
  return await (await f.request(`${PATH}${suffix}`, body, who.cookie)).json() as Reply
}
async function snapshotEffects(f: Awaited<ReturnType<typeof fixture>>, who: Player) {
  return f.server.store.read(db => {
    const life = Object.values(db.sessions).find(session => session.publicId === who.id)?.cities.lagos?.state
    return snapshot({ cash: life?.cash ?? null, ledger: life?.ledger ?? null, politics: db.politics ?? null })
  })
}

test('fictional NPC justice training requires ordered evidence, service notice, review, and leaves live justice/economy untouched', async t => {
  const f = await setup(t), learner = await player(f, 'Justice learner'), other = await player(f, 'Other learner')
  const effectsBefore = await snapshotEffects(f, learner)
  const beforeStart = await f.server.store.read(db => Object.hasOwn(db, 'livingWorld'))
  const ready = await get(f, learner)
  assert.deepEqual([ready.ok, ready.code, ready.practice, ready.revision], [true, 'practice_ready', null, null])
  assert.equal(await f.server.store.read(db => Object.hasOwn(db, 'livingWorld')), beforeStart, 'a current read does not create empty practice storage')
  for (const pathAndBody of [
    ['/start', { cityId: 'lagos', requestId: 'x'.repeat(65) }],
    ['/step', { cityId: 'lagos', requestId: 'x'.repeat(65), expectedRevision: 0, action: { kind: 'inspect', evidenceId: 'dispatch-copy' } }],
  ] as const) {
    const refused = await f.request(`${PATH}${pathAndBody[0]}`, pathAndBody[1], learner.cookie)
    assert.deepEqual([refused.status, (await refused.json() as Reply).error], [400, 'invalid_justice_practice_request'])
  }

  const requestId = f.id(), startBody = { cityId: 'lagos', requestId }
  const started = await post(f, '/start', startBody, learner)
  assert.deepEqual([started.ok, started.code, started.practice?.phase, started.revision], [true, 'practice_started', 'inspect-initial', 0])
  assert.match(started.practice?.disclaimer ?? '', /fictional.*not legal advice/i)
  assert.equal('receipts' in (started.practice ?? {}), false)
  assert.equal('inspectedEvidenceIds' in (started.practice ?? {}), false)
  const replayedStart = await post(f, '/start', { requestId, cityId: 'lagos' }, learner)
  assert.deepEqual([replayedStart.ok, replayedStart.duplicate, replayedStart.practice], [true, true, started.practice])
  const changedStart = await f.request(`${PATH}/start`, { ...startBody, cityId: 'ibadan' }, learner.cookie)
  assert.deepEqual([changedStart.status, (await changedStart.json() as Reply).error], [409, 'justice_practice_scenario_unavailable'])

  assert.deepEqual([(await get(f, other)).code, (await get(f, other)).practice], ['practice_ready', null], 'another authenticated actor cannot see the learner case')
  const crossActor = await post(f, '/step', { cityId: 'lagos', requestId: f.id(), expectedRevision: 0, action: { kind: 'inspect', evidenceId: 'dispatch-copy' } }, other)
  assert.deepEqual([crossActor.ok, crossActor.code, crossActor.practice], [false, 'practice_not_started', null])

  const badExtra = await f.request(`${PATH}/step`, {
    cityId: 'lagos', requestId: f.id(), expectedRevision: 0,
    action: { kind: 'inspect', evidenceId: 'dispatch-copy', completed: true },
  }, learner.cookie)
  assert.deepEqual([badExtra.status, (await badExtra.json() as Reply).error], [400, 'invalid_justice_practice_request'])

  let revision = 0
  const send = async (action: JusticePracticeAction, id = f.id()): Promise<Reply> => {
    const reply = await post(f, '/step', { cityId: 'lagos', requestId: id, expectedRevision: revision, action }, learner)
    assert.equal(reply.revision, revision + 1, `${action.kind} advances the receipt revision`)
    revision = reply.revision!
    return reply
  }
  const firstId = f.id(), firstAction: JusticePracticeAction = { kind: 'inspect', evidenceId: 'dispatch-copy' }
  const firstBody = { cityId: 'lagos', requestId: firstId, expectedRevision: revision, action: firstAction }
  const first = await post(f, '/step', firstBody, learner)
  assert.deepEqual([first.ok, first.revision, first.practice?.phase], [true, 1, 'inspect-initial'])
  revision = 1
  const sameRetry = await post(f, '/step', firstBody, learner)
  assert.deepEqual([sameRetry.ok, sameRetry.duplicate, sameRetry.practice], [true, true, first.practice])
  const changedRetry = await f.request(`${PATH}/step`, { ...firstBody, action: { kind: 'inspect', evidenceId: 'arrival-receipt' } }, learner.cookie)
  assert.deepEqual([changedRetry.status, (await changedRetry.json() as Reply).error], [409, 'client_id_conflict'])

  // Fixture-only race: two distinct requests contend for one revision. Only one evidence inspection applies.
  const raceRevision = revision
  const [raceA, raceB] = await Promise.all([
    post(f, '/step', { cityId: 'lagos', requestId: f.id(), expectedRevision: raceRevision, action: { kind: 'inspect', evidenceId: 'arrival-receipt' } }, learner),
    post(f, '/step', { cityId: 'lagos', requestId: f.id(), expectedRevision: raceRevision, action: { kind: 'inspect', evidenceId: 'seal-log' } }, learner),
  ])
  assert.equal([raceA.ok, raceB.ok].filter(Boolean).length, 1)
  const afterRace = await get(f, learner)
  assert.equal(afterRace.practice?.phase, 'inspect-initial')
  const rowAfterRace = await f.server.store.read(db => snapshot((db.livingWorld as { justicePractice: Record<string, unknown> }).justicePractice[learner.id]))
  const validAfterRace = readValidatedJusticePracticeRecord(rowAfterRace, learner.id)
  assert.ok(validAfterRace)
  assert.equal(validAfterRace.practice.inspectedEvidenceIds.length, 2, 'only dispatch and one CAS winner are recorded')
  revision = afterRace.revision!

  const initial = await send({ kind: 'inspect', evidenceId: validAfterRace.practice.inspectedEvidenceIds.includes('arrival-receipt') ? 'seal-log' : 'arrival-receipt' })
  assert.equal(initial.practice?.phase, 'initial-decision')
  const wrong = await send({ kind: 'initial-decision', choiceId: 'assign-responsibility', reasonEvidenceIds: ['dispatch-copy', 'arrival-receipt'] })
  assert.equal(wrong.practice?.phase, 'initial-decision', 'unsupported decision receives feedback without advancing')
  assert.match(wrong.feedback ?? '', /disagree|reconcile/i)
  const accepted = await send({ kind: 'initial-decision', choiceId: 'pause-and-reconcile', reasonEvidenceIds: ['arrival-receipt', 'dispatch-copy'] })
  assert.equal(accepted.practice?.phase, 'serve-notice')
  assert.equal((await send({ kind: 'send-service-notice' })).practice?.phase, 'inspect-review')
  assert.equal((await send({ kind: 'inspect-review' })).practice?.phase, 'review-decision')
  const wrongReview = await send({ kind: 'review-decision', choiceId: 'keep-hold', reasonEvidenceIds: ['dispatch-copy', 'npc-recount'] })
  assert.equal(wrongReview.practice?.phase, 'review-decision')
  const completed = await send({ kind: 'review-decision', choiceId: 'correct-duplicate-entry', reasonEvidenceIds: ['npc-recount', 'dispatch-copy'] })
  assert.deepEqual([completed.practice?.phase, completed.practice?.trainingComplete], ['complete', true])
  assert.equal('initialDecision' in (completed.practice ?? {}), false, 'saved answer keys are not projected')

  const saved = await f.server.store.read(db => snapshot((db.livingWorld as { justicePractice: Record<string, unknown> }).justicePractice[learner.id]))
  assert.ok(readValidatedJusticePracticeRecord(saved, learner.id), 'the terminal record strictly parses after persistence')
  const reloaded = await get(f, learner)
  assert.equal(reloaded.practice?.trainingComplete, true, 'a reload-style current read returns the same terminal practice')
  const terminalRefusal = await post(f, '/step', {
    cityId: 'lagos', requestId: f.id(), expectedRevision: reloaded.revision!,
    action: { kind: 'inspect', evidenceId: 'dispatch-copy' },
  }, learner)
  assert.deepEqual([terminalRefusal.ok, terminalRefusal.code, terminalRefusal.practice?.trainingComplete],
    [false, 'terminal', true], 'a new action after completion is refused rather than reported as accepted')
  const completedAfterRefusal = await f.server.store.read(db => snapshot((db.livingWorld as { justicePractice: Record<string, unknown> }).justicePractice[learner.id]))
  assert.ok(readValidatedJusticePracticeRecord(completedAfterRefusal, learner.id), 'the terminal refusal receipt preserves a strictly readable completed record')
  assert.deepEqual(await snapshotEffects(f, learner), effectsBefore, 'fictional training does not touch live justice, cash or ledger')
  assert.deepEqual(await snapshotEffects(f, other), await f.server.store.read(db => {
    const life = Object.values(db.sessions).find(session => session.publicId === other.id)?.cities.lagos?.state
    return snapshot({ cash: life?.cash ?? null, ledger: life?.ledger ?? null, politics: db.politics ?? null })
  }))
})

test('future/corrupt practice rows and account-mismatched case state are hidden and kept unchanged', async t => {
  const f = await setup(t), learner = await player(f, 'Quarantined learner')
  const begun = await post(f, '/start', { cityId: 'lagos', requestId: f.id() }, learner)
  assert.equal(begun.ok, true)
  const original = await f.server.store.read(db => snapshot((db.livingWorld as { justicePractice: Record<string, unknown> }).justicePractice[learner.id]))

  await f.server.store.transact(db => {
    const row = (db.livingWorld as { justicePractice: Record<string, Record<string, unknown>> }).justicePractice[learner.id]!
    row.account = 'fixture:other-account'
  })
  const mismatchRow = await f.server.store.read(db => snapshot((db.livingWorld as { justicePractice: Record<string, unknown> }).justicePractice[learner.id]))
  const hidden = await get(f, learner)
  assert.deepEqual([hidden.ok, hidden.code, hidden.practice, hidden.revision], [false, 'account_changed', null, null])
  assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { justicePractice: Record<string, unknown> }).justicePractice[learner.id])), mismatchRow,
    'an ownership mismatch is not sanitized or reset')

  await f.server.store.transact(db => {
    const row = (db.livingWorld as { justicePractice: Record<string, Record<string, unknown>> }).justicePractice[learner.id]!
    row.account = null
    row.v = 2
  })
  const futureRow = await f.server.store.read(db => snapshot((db.livingWorld as { justicePractice: Record<string, unknown> }).justicePractice[learner.id]))
  const quarantined = await get(f, learner)
  assert.deepEqual([quarantined.ok, quarantined.code, quarantined.practice], [false, 'invalid_saved_justice_practice', null])
  assert.deepEqual(await f.server.store.read(db => snapshot((db.livingWorld as { justicePractice: Record<string, unknown> }).justicePractice[learner.id])), futureRow,
    'a future row remains byte-for-byte data-equivalent for recovery')
  assert.deepEqual([readValidatedJusticePracticeRecord(original, learner.id)?.practice.revision, readValidatedJusticePracticeRecord(futureRow, learner.id)], [0, null])
})
