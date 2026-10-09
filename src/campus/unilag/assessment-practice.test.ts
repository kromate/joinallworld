import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_ASSESSMENT_PRACTICE_BYTES, assessmentPracticeView, readAssessmentPracticeState,
  startAssessmentPractice, stepAssessmentPractice, type AssessmentPracticeOperation, type AssessmentPracticeState,
} from './assessment-practice.ts'
import { UNILAG_BETA_RULES } from './curriculum.ts'

const actor = 'guest-ada'
type OperationFields = AssessmentPracticeOperation extends infer Operation
  ? Operation extends AssessmentPracticeOperation ? Omit<Operation, 'requestId' | 'expectedRevision'> : never : never
const send = (state: AssessmentPracticeState, fields: OperationFields, requestId = `op-${state.revision}`) =>
  stepAssessmentPractice(state, actor, { ...fields, requestId, expectedRevision: state.revision })
const snapshot = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function finishLab(): { state: AssessmentPracticeState; resultMark: number } {
  let state = enterVerification()
  for (const [a, b] of [[false, false], [false, true], [true, false], [true, true]] as const) {
    const result = send(state, { kind: 'probe', a, b })
    assert.ok(result.ok)
    state = result.state
  }
  const submitted = send(state, { kind: 'submit' })
  assert.ok(submitted.ok && submitted.mark !== undefined)
  return { state: submitted.state, resultMark: submitted.mark }
}

function enterVerification(): AssessmentPracticeState {
  let state = startAssessmentPractice(actor)
  for (const [a, b] of [[false, false], [false, true], [true, false], [true, true]] as const) {
    const result = send(state, { kind: 'probe', a, b })
    assert.ok(result.ok)
    state = result.state
  }
  const inspect = send(state, { kind: 'inspect', a: false, b: true })
  assert.ok(inspect.ok)
  state = inspect.state
  const repair = send(state, { kind: 'repair', gate: 'and' })
  assert.ok(repair.ok)
  return repair.state
}

test('assessment requires probing, counterexample inspection, repair, and all four verification probes', () => {
  let state = startAssessmentPractice(actor)
  assert.deepEqual(readAssessmentPracticeState(state, actor), state)
  assert.ok(JSON.stringify(state).length <= MAX_ASSESSMENT_PRACTICE_BYTES)
  assert.deepEqual(assessmentPracticeView(state).targetTable.map((row) => row.output), [false, false, false, true])

  const waitingOrSubmitting = send(state, { kind: 'submit' })
  assert.deepEqual([waitingOrSubmitting.ok, waitingOrSubmitting.code, waitingOrSubmitting.state], [false, 'verification_required', state])
  const earlyInspect = send(state, { kind: 'inspect', a: false, b: true })
  assert.deepEqual([earlyInspect.ok, earlyInspect.code, earlyInspect.state], [false, 'probe_required', state])

  const matchingProbe = send(state, { kind: 'probe', a: false, b: false }, 'probe-00')
  assert.ok(matchingProbe.ok)
  assert.deepEqual(matchingProbe.observation, { a: false, b: false, output: false })
  state = matchingProbe.state
  const repeatedInitial = send(state, { kind: 'probe', a: false, b: false }, 'probe-00-again')
  assert.deepEqual([repeatedInitial.ok, repeatedInitial.duplicate, repeatedInitial.state.revision, repeatedInitial.observation],
    [true, true, state.revision, { a: false, b: false, output: false }])
  assert.deepEqual(repeatedInitial.state, state, 'a new touch of the same input does not consume a revision')
  const falseCounterexample = send(state, { kind: 'inspect', a: false, b: false })
  assert.deepEqual([falseCounterexample.ok, falseCounterexample.code, falseCounterexample.state], [false, 'not_counterexample', state])
  const unprobedCounterexample = send(state, { kind: 'inspect', a: true, b: false })
  assert.deepEqual([unprobedCounterexample.ok, unprobedCounterexample.code, unprobedCounterexample.state], [false, 'probe_required', state])

  const counterexample = send(state, { kind: 'probe', a: false, b: true }, 'probe-01')
  assert.ok(counterexample.ok)
  assert.deepEqual(counterexample.observation, { a: false, b: true, output: true })
  state = counterexample.state
  const inspected = send(state, { kind: 'inspect', a: false, b: true })
  assert.ok(inspected.ok)
  assert.equal(inspected.state.phase, 'repair')
  state = inspected.state
  assert.match(assessmentPracticeView(state).instructions, /Choose a gate repair/)

  const prematureRepair = send(state, { kind: 'probe', a: true, b: true })
  assert.deepEqual([prematureRepair.ok, prematureRepair.code, prematureRepair.state], [false, 'wrong_step', state])
  const wrongRepair = send(state, { kind: 'repair', gate: 'xor' })
  assert.deepEqual([wrongRepair.ok, wrongRepair.code, wrongRepair.state], [false, 'repair_mismatch', state])
  assert.match(wrongRepair.feedback, /Try the AND gate/)
  const repaired = send(state, { kind: 'repair', gate: 'and' })
  assert.ok(repaired.ok)
  state = repaired.state
  assert.equal(state.phase, 'verify')

  const notReady = send(state, { kind: 'submit' })
  assert.deepEqual([notReady.ok, notReady.code, notReady.state], [false, 'verification_required', state])
  const expected = new Map<string, boolean>([['00', false], ['01', false], ['10', false], ['11', true]])
  for (const [a, b] of [[false, false], [false, true], [true, false], [true, true]] as const) {
    const result = send(state, { kind: 'probe', a, b })
    assert.ok(result.ok)
    assert.equal(result.observation?.output, expected.get(`${Number(a)}${Number(b)}`))
    state = JSON.parse(JSON.stringify(result.state)) as AssessmentPracticeState
    assert.deepEqual(readAssessmentPracticeState(state, actor), state, 'a reload preserves the exact active verification state')
    const repeated = send(state, { kind: 'probe', a, b }, `repeat-verify-${Number(a)}${Number(b)}`)
    assert.deepEqual([repeated.ok, repeated.duplicate, repeated.state], [true, true, state], 'reprobing an already verified row cannot consume the revision budget')
  }
  assert.equal(state.phase, 'submit')
  const done = send(state, { kind: 'submit' })
  assert.deepEqual([done.ok, done.code, done.mark, done.state.phase, done.state.score], [true, 'completed', UNILAG_BETA_RULES.assignmentWeight, 'complete', UNILAG_BETA_RULES.assignmentWeight])
  assert.deepEqual(readAssessmentPracticeState(done.state, actor), done.state)
})

test('CAS, actor binding, exact payloads, and immediate request retries are deterministic', () => {
  const state = startAssessmentPractice(actor)
  const before = snapshot(state)
  const cases: [string, unknown, string][] = [
    ['wrong actor', { kind: 'probe', requestId: 'bad-actor', expectedRevision: state.revision, a: false, b: false }, 'invalid_state'],
    ['stale revision', { kind: 'probe', requestId: 'stale', expectedRevision: state.revision + 1, a: false, b: false }, 'revision_conflict'],
    ['client score', { kind: 'probe', requestId: 'score', expectedRevision: state.revision, a: false, b: false, score: 30 }, 'invalid_input'],
    ['client pass flag', { kind: 'submit', requestId: 'passed', expectedRevision: state.revision, passed: true }, 'invalid_input'],
    ['client actor', { kind: 'probe', requestId: 'actor', expectedRevision: state.revision, actorId: actor, a: false, b: false }, 'invalid_input'],
    ['non-boolean input', { kind: 'probe', requestId: 'truthy', expectedRevision: state.revision, a: 1, b: false }, 'invalid_input'],
    ['future operation', { kind: 'tick', requestId: 'wait', expectedRevision: state.revision }, 'invalid_input'],
  ]
  for (const [label, input, code] of cases) {
    const result = stepAssessmentPractice(state, label === 'wrong actor' ? 'guest-bob' : actor, input)
    assert.equal(result.code, code, label)
    assert.deepEqual(result.state, state, label)
  }
  assert.deepEqual(state, before, 'refusals do not mutate the caller state')

  const first = send(state, { kind: 'probe', a: false, b: true }, 'stable-request')
  assert.ok(first.ok)
  const retry = stepAssessmentPractice(first.state, actor, { kind: 'probe', requestId: 'stable-request', expectedRevision: state.revision, a: false, b: true })
  assert.deepEqual([retry.ok, retry.duplicate, retry.state, retry.mark], [true, true, first.state, undefined])
  const changedRetry = stepAssessmentPractice(first.state, actor, { kind: 'probe', requestId: 'stable-request', expectedRevision: state.revision, a: false, b: false })
  assert.deepEqual([changedRetry.ok, changedRetry.code, changedRetry.state], [false, 'request_conflict', first.state])
})

test('strict reader quarantines malformed/future/inconsistent rows and never normalizes the input', () => {
  const state = startAssessmentPractice(actor)
  const inVerification = enterVerification()
  const verifiedHigh = send(inVerification, { kind: 'probe', a: true, b: true })
  assert.ok(verifiedHigh.ok)
  const malformedRows: unknown[] = [
    { ...state, version: 2 },
    { ...state, unexpected: true },
    { ...state, actorId: 'guest-bob' },
    { ...state, revision: Number.MAX_SAFE_INTEGER + 1 },
    { ...state, initialMask: 16 },
    { ...state, phase: 'verify' },
    { ...state, phase: 'complete', score: UNILAG_BETA_RULES.assignmentWeight },
    { ...state, lastOperation: { requestId: 'bad', fingerprint: 'probe:1:0:1', code: 'future-code' } },
    { ...state, lastOperation: { requestId: 'bad', fingerprint: 'probe:1:0:1', code: 'probe_recorded', extra: 1 } },
    { ...state, lastOperation: { requestId: 'bad', fingerprint: 'probe:1:0:1', code: 'probe_recorded' }, revision: 2 },
    { ...inVerification, revision: inVerification.revision + 1 },
    { ...verifiedHigh.state, verifyOutputMask: 0 },
    { ...verifiedHigh.state, verifyOutputMask: verifiedHigh.state.verifyOutputMask | 1 },
  ]
  for (const raw of malformedRows) {
    const before = snapshot(raw)
    assert.equal(readAssessmentPracticeState(raw, actor), null)
    assert.deepEqual(raw, before, 'invalid source is preserved for caller quarantine')
  }
  assert.equal(readAssessmentPracticeState({ ...state, actorId: 'a'.repeat(101) }, actor), null)
  assert.equal(readAssessmentPracticeState(state, 'guest-bob'), null)
  const withSymbol = { ...state }
  Object.defineProperty(withSymbol, Symbol('extra'), { value: true })
  assert.equal(readAssessmentPracticeState(withSymbol, actor), null)
})

test('correct terminal mark is bounded and cannot be minted again with a fresh request ID', () => {
  const { state, resultMark } = finishLab()
  assert.equal(resultMark, UNILAG_BETA_RULES.assignmentWeight)
  assert.ok(resultMark <= UNILAG_BETA_RULES.assignmentWeight)
  const before = snapshot(state)
  const replay = stepAssessmentPractice(state, actor, { kind: 'submit', requestId: 'fresh-after-terminal', expectedRevision: state.revision })
  assert.deepEqual([replay.ok, replay.code, replay.mark, replay.state], [false, 'already_complete', undefined, state])
  assert.deepEqual(state, before)
  const retryLatest = stepAssessmentPractice(state, actor, {
    kind: 'submit', requestId: state.lastOperation!.requestId, expectedRevision: state.revision - 1,
  })
  assert.deepEqual([retryLatest.ok, retryLatest.duplicate, retryLatest.mark, retryLatest.state], [true, true, undefined, state])
})
