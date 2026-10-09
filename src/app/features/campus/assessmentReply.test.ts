import test from 'node:test'
import assert from 'node:assert/strict'
import { assessmentPracticeView, startAssessmentPractice, stepAssessmentPractice, type AssessmentPracticeState } from '../../../campus/unilag/assessment-practice.ts'
import type { AssessmentResponse } from '../../../types/living-world-assessment.ts'
import type { ApiEnvelope } from '../../../types/protocol.ts'
import { readAssessmentReply } from './assessmentReply.ts'

type Payload = AssessmentResponse & ApiEnvelope
const term = { semester: 1 as const, startDay: 17, courseId: 'cpe-101' as const }
const actor = 'guest-ada'

function payload(overrides: Record<string, unknown> = {}): Payload {
  return {
    serverTime: 1_800_000_000_000, ok: true, code: 'assessment_ready', term, practice: null,
    revision: null, assignmentMark: null, ...overrides,
  } as Payload
}

function completedPractice(): AssessmentPracticeState {
  let state = startAssessmentPractice(actor)
  for (const [a, b] of [[false, false], [false, true], [true, false], [true, true]] as const) {
    const probe = stepAssessmentPractice(state, actor, { kind: 'probe', requestId: `initial-${Number(a)}${Number(b)}`, expectedRevision: state.revision, a, b })
    assert.ok(probe.ok); state = probe.state
  }
  const inspect = stepAssessmentPractice(state, actor, { kind: 'inspect', requestId: 'inspect', expectedRevision: state.revision, a: false, b: true })
  assert.ok(inspect.ok); state = inspect.state
  const repair = stepAssessmentPractice(state, actor, { kind: 'repair', requestId: 'repair', expectedRevision: state.revision, gate: 'and' })
  assert.ok(repair.ok); state = repair.state
  for (const [a, b] of [[false, false], [false, true], [true, false], [true, true]] as const) {
    const probe = stepAssessmentPractice(state, actor, { kind: 'probe', requestId: `verify-${Number(a)}${Number(b)}`, expectedRevision: state.revision, a, b })
    assert.ok(probe.ok); state = probe.state
  }
  const submit = stepAssessmentPractice(state, actor, { kind: 'submit', requestId: 'submit', expectedRevision: state.revision })
  assert.ok(submit.ok)
  return submit.state
}

test('reads ready, active, completed, and legacy-mark responses without inventing state', () => {
  const ready = readAssessmentReply(payload())
  assert.ok(ready)
  assert.equal(ready.practice, null)
  assert.equal(ready.revision, null)

  let active = startAssessmentPractice(actor)
  const started = readAssessmentReply(payload({ code: 'assessment_started', practice: assessmentPracticeView(active), revision: active.revision }))
  assert.ok(started, 'the actual initial server projection must be usable before the first probe')
  assert.match(started.practice!.feedback, /Select inputs/)
  const probe = stepAssessmentPractice(active, actor, { kind: 'probe', requestId: 'p00', expectedRevision: active.revision, a: false, b: false })
  assert.ok(probe.ok); active = probe.state
  const activeRead = readAssessmentReply(payload({ code: 'practice_active', practice: assessmentPracticeView(active), revision: active.revision }))
  assert.ok(activeRead)
  assert.deepEqual(activeRead.practice?.initialProbes, [{ a: false, b: false, output: false }])

  const completed = completedPractice()
  const finished = readAssessmentReply(payload({ code: 'assessment_recorded', practice: assessmentPracticeView(completed), revision: completed.revision, assignmentMark: completed.score }))
  assert.ok(finished)
  assert.equal(finished.practice?.phase, 'complete')
  assert.equal(finished.assignmentMark, completed.score)

  const legacyMark = readAssessmentReply(payload({ practice: null, revision: null, assignmentMark: 23 }))
  assert.ok(legacyMark)
  assert.equal(legacyMark.assignmentMark, 23, 'a prior academic mark can be shown without manufacturing an active lab row')
})

test('rejects malformed envelope, private state, bad truth table, and incoherent row revisions', () => {
  const base = payload()
  assert.equal(readAssessmentReply({ error: 'storage_unavailable' }), null)
  assert.equal(readAssessmentReply(payload({ unexpected: 'extra' })), null)
  assert.equal(readAssessmentReply(payload({ storage: 'failing' })), null)
  assert.equal(readAssessmentReply(payload({ duplicate: false })), null)
  assert.equal(readAssessmentReply(payload({ term: null, assignmentMark: 23 })), null, 'a mark requires its registered course context')
  assert.equal(readAssessmentReply(payload({ feedback: 'x'.repeat(401) })), null)

  const active = startAssessmentPractice(actor)
  const view = assessmentPracticeView(active)
  assert.equal(readAssessmentReply(payload({ practice: { ...view, actorId: actor }, revision: active.revision })), null)
  assert.equal(readAssessmentReply(payload({ practice: { ...view, scenario: 'future' }, revision: active.revision })), null)
  const badTarget = view.targetTable.map((row, index) => index === 0 ? { ...row, output: true } : row)
  assert.equal(readAssessmentReply(payload({ practice: { ...view, targetTable: badTarget }, revision: active.revision })), null)
  assert.equal(readAssessmentReply(payload({ practice: view, revision: active.revision + 1 })), null)
  assert.equal(readAssessmentReply(payload({ practice: view, revision: active.revision, term: { ...term, startDay: -1 } })), null)
  assert.equal(readAssessmentReply(payload({ practice: view, revision: active.revision, term: { ...term, courseId: 'eee-101' } })), null)
})

test('requires counterexample and all matching post-repair probes before accepting a completion mark', () => {
  const active = startAssessmentPractice(actor)
  const view = assessmentPracticeView(active)
  assert.equal(readAssessmentReply(payload({ practice: { ...view, phase: 'complete', score: 30 }, revision: view.revision })), null)

  const completed = completedPractice()
  const finishedView = assessmentPracticeView(completed)
  assert.equal(readAssessmentReply(payload({ practice: { ...finishedView, score: 29 }, revision: completed.revision, assignmentMark: 29 })), null)
  assert.equal(readAssessmentReply(payload({ practice: finishedView, revision: completed.revision, assignmentMark: null })), null)
})
