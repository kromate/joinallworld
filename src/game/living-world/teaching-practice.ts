/** Pure fictional NPC teaching practice. No time, wallet, career, network, or persistence effects. */

import {
  MAX_TEACHING_PRACTICE_BYTES, MAX_TEACHING_PRACTICE_REVISION,
  readTeachingPractice, type TeachingPractice, type TeachingPracticeStage,
} from './teaching-state.ts'

export {
  MAX_TEACHING_PRACTICE_BYTES, MAX_TEACHING_PRACTICE_REVISION, newTeachingPractice, readTeachingPractice,
} from './teaching-state.ts'
export type { TeachingPractice, TeachingPracticeFeedback, TeachingPracticeStage } from './teaching-state.ts'

const stages: readonly TeachingPracticeStage[] = ['diagnose', 'explain', 'check', 'complete']
const idPattern = /^[a-z][a-z0-9-]{0,39}$/

export interface TeachingPracticeInput {
  revision: number
  stage: TeachingPracticeStage
  choice: string
}

export type TeachingPracticeCode = 'answered' | 'retry' | 'invalid_request' | 'revision_conflict'
  | 'stage_conflict' | 'complete' | 'state_exhausted' | 'invalid_saved_practice'

export interface TeachingPracticeResult {
  ok: boolean
  code: TeachingPracticeCode
  state: TeachingPractice | null
}

export interface TeachingPracticeOption { id: string; label: string }
export interface TeachingPracticeStep {
  title: string
  prompt: string
  learnerAnswers?: string[]
  options: TeachingPracticeOption[]
  feedback: string | null
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    return prototype === Object.prototype || prototype === null
  } catch { return false }
}

function exactDataKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  let own: PropertyKey[]
  try { own = Reflect.ownKeys(value) } catch { return false }
  return own.length === keys.length && own.every(key => {
    if (typeof key !== 'string' || !keys.includes(key)) return false
    try {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return Boolean(descriptor && descriptor.enumerable && Object.hasOwn(descriptor, 'value'))
    } catch { return false }
  })
}

function validRevision(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= MAX_TEACHING_PRACTICE_REVISION
}

const choices: Readonly<Record<Exclude<TeachingPracticeStage, 'complete'>, readonly TeachingPracticeOption[]>> = /* @__PURE__ */ Object.freeze({
  diagnose: /* @__PURE__ */ Object.freeze([
    /* @__PURE__ */ Object.freeze({ id: 'denominator-count', label: 'They think a larger denominator makes the fraction larger.' }),
    /* @__PURE__ */ Object.freeze({ id: 'numerator-count', label: 'They think the numerator is the number of equal parts in the whole.' }),
    /* @__PURE__ */ Object.freeze({ id: 'unequal-wholes', label: 'They assume both fractions use differently sized wholes.' }),
  ]),
  explain: /* @__PURE__ */ Object.freeze([
    /* @__PURE__ */ Object.freeze({ id: 'same-whole-pieces', label: 'Show equal-sized wholes split into thirds and fourths; one third is the larger piece.' }),
    /* @__PURE__ */ Object.freeze({ id: 'change-whole', label: 'Use a larger whole for the fourth so its shaded piece looks larger.' }),
    /* @__PURE__ */ Object.freeze({ id: 'memorize-rule', label: 'Ask them to memorize that the larger denominator wins.' }),
  ]),
  check: /* @__PURE__ */ Object.freeze([
    /* @__PURE__ */ Object.freeze({ id: 'one-fifth', label: 'One fifth is larger than one sixth when the wholes are equal.' }),
    /* @__PURE__ */ Object.freeze({ id: 'one-sixth', label: 'One sixth is larger because six is greater than five.' }),
    /* @__PURE__ */ Object.freeze({ id: 'same-size', label: 'They are the same size because both numerators are one.' }),
  ]),
})

const correctChoice: Readonly<Record<Exclude<TeachingPracticeStage, 'complete'>, string>> = /* @__PURE__ */ Object.freeze({
  diagnose: 'denominator-count', explain: 'same-whole-pieces', check: 'one-fifth',
})

function refusal(code: TeachingPracticeCode, state: TeachingPractice | null): TeachingPracticeResult {
  return { ok: false, code, state }
}

/** Apply one authored choice. A caller must CAS and settle any external career effect separately. */
export function answerTeachingPractice(source: unknown, input: unknown): TeachingPracticeResult {
  const state = readTeachingPractice(source)
  if (!state) return refusal('invalid_saved_practice', null)
  try {
    if (!isPlainObject(input) || !exactDataKeys(input, ['revision', 'stage', 'choice'])
      || !validRevision(input.revision) || typeof input.stage !== 'string' || !stages.includes(input.stage as TeachingPracticeStage)
      || typeof input.choice !== 'string' || !idPattern.test(input.choice)) return refusal('invalid_request', state)
    if (input.revision !== state.revision) return refusal('revision_conflict', state)
    if (state.stage === 'complete') return refusal('complete', state)
    if (input.stage !== state.stage) return refusal('stage_conflict', state)
    const stage = state.stage
    if (!choices[stage].some(option => option.id === input.choice)) return refusal('invalid_request', state)
    if (state.revision >= MAX_TEACHING_PRACTICE_REVISION) return refusal('state_exhausted', state)

    const accepted = input.choice === correctChoice[stage]
    const nextStage = accepted ? stages[stages.indexOf(stage) + 1]! : stage
    const next: TeachingPractice = {
      version: 1,
      lessonId: 'fractions-v1',
      revision: state.revision + 1,
      stage: nextStage,
      feedback: accepted ? 'correct' : 'retry',
    }
    if (JSON.stringify(next).length > MAX_TEACHING_PRACTICE_BYTES) return refusal('state_exhausted', state)
    return { ok: true, code: accepted ? 'answered' : 'retry', state: next }
  } catch { return refusal('invalid_request', state) }
}

/** Fresh authored view projection; mutating a caller's view cannot change later projections. */
export function teachingStep(source: unknown): TeachingPracticeStep | null {
  const state = readTeachingPractice(source)
  if (!state) return null
  const base: TeachingPracticeStep = {
    title: 'Teach equivalent wholes',
    prompt: '',
    options: [],
    feedback: state.feedback === null ? null : state.feedback === 'retry'
      ? 'Try again: keep the whole the same size and explain what the denominator counts.'
      : 'Good work. Continue with the next teaching step.',
  }
  if (state.stage === 'diagnose') {
    base.prompt = 'Nneka says 1/4 is larger than 1/3 because four is greater than three. What misunderstanding should you address?'
    base.learnerAnswers = ['“Four is greater than three, so one fourth must be larger than one third.”']
    base.options = choices.diagnose.map(option => ({ ...option }))
  } else if (state.stage === 'explain') {
    base.prompt = 'Choose a way to show Nneka why 1/3 is larger than 1/4 when both fractions use equal-sized wholes.'
    base.options = choices.explain.map(option => ({ ...option }))
  } else if (state.stage === 'check') {
    base.prompt = 'Check the idea with a fresh comparison: which piece is larger, 1/5 or 1/6, when the wholes are equal?'
    base.options = choices.check.map(option => ({ ...option }))
  } else {
    base.prompt = 'Nneka correctly chose one fifth as the larger piece of equal wholes. Teaching practice complete.'
    base.learnerAnswers = ['“One fifth is larger than one sixth when the wholes are equal.”']
  }
  return base
}
