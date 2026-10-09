import assert from 'node:assert/strict'
import test from 'node:test'
import {
  answerTeachingPractice, MAX_TEACHING_PRACTICE_BYTES, MAX_TEACHING_PRACTICE_REVISION,
  newTeachingPractice, readTeachingPractice, teachingStep,
  type TeachingPractice, type TeachingPracticeStage,
} from './teaching-practice.ts'

function answer(state: TeachingPractice, choice: string, patch: Record<string, unknown> = {}) {
  return answerTeachingPractice(state, { revision: state.revision, stage: state.stage, choice, ...patch })
}

function completePractice(): TeachingPractice {
  let state = newTeachingPractice()
  for (const choice of ['denominator-count', 'same-whole-pieces', 'one-fifth']) {
    const result = answer(state, choice)
    assert.deepEqual([result.ok, result.code], [true, 'answered'])
    assert.ok(result.state)
    state = result.state
  }
  return state
}

test('teaching advances only through diagnosis, a same-whole explanation, and a fresh learner check', () => {
  let state = newTeachingPractice()
  assert.deepEqual(state, { version: 1, lessonId: 'fractions-v1', revision: 1, stage: 'diagnose', feedback: null })
  assert.deepEqual(readTeachingPractice(state), state)
  assert.ok(JSON.stringify(state).length <= MAX_TEACHING_PRACTICE_BYTES)
  const diagnose = teachingStep(state)!
  assert.match(diagnose.prompt, /1\/4.*1\/3/)
  assert.equal(diagnose.learnerAnswers?.length, 1)
  assert.equal(diagnose.options.length, 3)

  const wrongDiagnosis = answer(state, 'numerator-count')
  assert.deepEqual([wrongDiagnosis.ok, wrongDiagnosis.code, wrongDiagnosis.state?.stage,
    wrongDiagnosis.state?.revision, wrongDiagnosis.state?.feedback], [true, 'retry', 'diagnose', 2, 'retry'])
  assert.equal(state.revision, 1, 'the source save is immutable')
  const stale = answerTeachingPractice(state, { revision: state.revision, stage: state.stage, choice: 'denominator-count' })
  assert.equal(stale.code, 'answered', 'the old state remains a valid independent input')
  state = wrongDiagnosis.state!

  const diagnosis = answer(state, 'denominator-count')
  assert.deepEqual([diagnosis.code, diagnosis.state?.stage, diagnosis.state?.revision, diagnosis.state?.feedback],
    ['answered', 'explain', 3, 'correct'])
  state = diagnosis.state!
  const explanation = teachingStep(state)!
  assert.match(explanation.prompt, /equal-sized wholes/)
  assert.ok(explanation.options.some(option => option.id === 'same-whole-pieces'))
  const wrongExplanation = answer(state, 'change-whole')
  assert.deepEqual([wrongExplanation.code, wrongExplanation.state?.stage, wrongExplanation.state?.revision], ['retry', 'explain', 4])
  const repaired = answer(wrongExplanation.state!, 'same-whole-pieces')
  assert.deepEqual([repaired.code, repaired.state?.stage, repaired.state?.revision], ['answered', 'check', 5])

  const check = teachingStep(repaired.state!)!
  assert.match(check.prompt, /1\/5 or 1\/6/)
  const wrongCheck = answer(repaired.state!, 'one-sixth')
  assert.deepEqual([wrongCheck.code, wrongCheck.state?.stage, wrongCheck.state?.revision], ['retry', 'check', 6])
  const verified = answer(wrongCheck.state!, 'one-fifth')
  assert.deepEqual([verified.code, verified.state?.stage, verified.state?.revision, verified.state?.feedback],
    ['answered', 'complete', 7, 'correct'])
  assert.equal(teachingStep(verified.state!)?.learnerAnswers?.[0], '“One fifth is larger than one sixth when the wholes are equal.”')
  assert.deepEqual(readTeachingPractice(verified.state!), verified.state)

  const terminalReplay = answer(verified.state!, 'one-fifth')
  assert.deepEqual([terminalReplay.ok, terminalReplay.code, terminalReplay.state], [false, 'complete', verified.state])
})

test('out-of-order, stale, unsupported and extra-field input cannot advance practice', () => {
  const state = newTeachingPractice()
  const before = { ...state }
  const replies = [
    answerTeachingPractice(state, { revision: 2, stage: 'diagnose', choice: 'denominator-count' }),
    answerTeachingPractice(state, { revision: 1, stage: 'explain', choice: 'same-whole-pieces' }),
    answerTeachingPractice(state, { revision: 1, stage: 'diagnose', choice: 'made-up' }),
    answerTeachingPractice(state, { revision: 1, stage: 'diagnose', choice: 'denominator-count', passed: true }),
    answerTeachingPractice(state, { revision: 1, stage: 'diagnose', choice: 'denominator-count', actorId: 'ada' }),
  ]
  assert.deepEqual(replies.map(reply => reply.code), [
    'revision_conflict', 'stage_conflict', 'invalid_request', 'invalid_request', 'invalid_request',
  ])
  for (const reply of replies) assert.deepEqual(reply.state, before)
  const hostileProxy = new Proxy({ revision: state.revision, stage: state.stage, choice: 'denominator-count' }, {
    get(target, key, receiver) {
      if (key === 'choice') throw new Error('hostile proxy read')
      return Reflect.get(target, key, receiver)
    },
  })
  assert.deepEqual(answerTeachingPractice(state, hostileProxy), { ok: false, code: 'invalid_request', state: before })
  assert.deepEqual(state, before)
})

test('strict reader quarantines unsupported keys, accessors, prototypes, impossible feedback and revisions', () => {
  const initial = newTeachingPractice()
  let getterCalled = false
  const accessor = { ...initial }
  Object.defineProperty(accessor, 'feedback', { enumerable: true, get() { getterCalled = true; return null } })
  const hiddenExtra = { ...initial }
  Object.defineProperty(hiddenExtra, 'private', { enumerable: false, value: 'unexpected' })
  const symbolExtra = { ...initial, [Symbol('extra')]: true }
  const invalid: unknown[] = [
    null, [], Object.assign(Object.create({ inherited: true }), initial),
    { ...initial, future: true }, { ...initial, version: 2 },
    { ...initial, revision: 0 }, { ...initial, revision: MAX_TEACHING_PRACTICE_REVISION + 1 },
    { ...initial, revision: 2, feedback: null },
    { ...initial, stage: 'explain', revision: 1, feedback: 'correct' },
    { ...initial, stage: 'explain', revision: 2, feedback: null },
    { ...initial, stage: 'check', revision: 3, feedback: null },
    { ...initial, stage: 'diagnose', revision: 1, feedback: 'retry' },
    { ...initial, stage: 'complete', revision: 4, feedback: 'retry' },
    accessor, hiddenExtra, symbolExtra,
    { version: 1, lessonId: 'fractions-v1', revision: 1, stage: 'diagnose', feedback: null, text: 'é' },
  ]
  for (const source of invalid) {
    const serializedBefore = source === accessor ? Object.getOwnPropertyDescriptors(accessor)
      : (() => { try { return JSON.stringify(source) } catch { return null } })()
    assert.equal(readTeachingPractice(source), null)
    assert.deepEqual(source === accessor ? Object.getOwnPropertyDescriptors(accessor)
      : (() => { try { return JSON.stringify(source) } catch { return null } })(), serializedBefore,
      'invalid state remains untouched for caller quarantine')
  }
  assert.equal(getterCalled, false, 'strict validation never evaluates an accessor')
  assert.equal(teachingStep({ ...initial, unsupported: true }), null)
})

test('view projection is fresh and terminal state cannot be reopened or earn a repeat effect', () => {
  const complete = completePractice()
  assert.deepEqual([complete.stage, complete.revision, complete.feedback], ['complete', 4, 'correct'])
  const view = teachingStep(complete)!
  view.options.push({ id: 'forged', label: 'forged' })
  if (view.learnerAnswers) view.learnerAnswers[0] = 'forged'
  const again = teachingStep(complete)!
  assert.deepEqual(again.options, [])
  assert.equal(again.learnerAnswers?.[0], '“One fifth is larger than one sixth when the wholes are equal.”')
  assert.deepEqual(answer(complete, 'one-fifth'), { ok: false, code: 'complete', state: complete })
})

test('revision exhaustion refuses without resetting and reader enforces stage/revision coherence', () => {
  const exhausted: TeachingPractice = {
    version: 1, lessonId: 'fractions-v1', revision: MAX_TEACHING_PRACTICE_REVISION,
    stage: 'check', feedback: 'retry',
  }
  assert.deepEqual(readTeachingPractice(exhausted), exhausted)
  const before = { ...exhausted }
  const result = answer(exhausted, 'one-fifth')
  assert.deepEqual([result.ok, result.code, result.state], [false, 'state_exhausted', before])
  const wrongStage = { ...exhausted, stage: 'explain' as TeachingPracticeStage, revision: 2 }
  assert.equal(readTeachingPractice(wrongStage), null)
})
