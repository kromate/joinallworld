/** Thin bounded teaching-practice state API for eager save sanitizers. */

export type TeachingPracticeStage = 'diagnose' | 'explain' | 'check' | 'complete'
export type TeachingPracticeFeedback = 'retry' | 'correct'

export interface TeachingPractice {
  version: 1
  lessonId: 'fractions-v1'
  revision: number
  stage: TeachingPracticeStage
  feedback: TeachingPracticeFeedback | null
}

export const MAX_TEACHING_PRACTICE_BYTES = 512
export const MAX_TEACHING_PRACTICE_REVISION = 1_000_000

const stages: readonly TeachingPracticeStage[] = ['diagnose', 'explain', 'check', 'complete']
const feedbacks: readonly TeachingPracticeFeedback[] = ['retry', 'correct']

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

function canonicalState(value: Record<string, unknown>): TeachingPractice | null {
  if (!exactDataKeys(value, ['version', 'lessonId', 'revision', 'stage', 'feedback'])
    || value.version !== 1 || value.lessonId !== 'fractions-v1' || !validRevision(value.revision)
    || typeof value.stage !== 'string' || !stages.includes(value.stage as TeachingPracticeStage)
    || !(value.feedback === null || (typeof value.feedback === 'string' && feedbacks.includes(value.feedback as TeachingPracticeFeedback)))) return null

  const stage = value.stage as TeachingPracticeStage
  const feedback = value.feedback as TeachingPracticeFeedback | null
  const minimumRevision = stages.indexOf(stage) + 1 + (feedback === 'retry' ? 1 : 0)
  if (value.revision < minimumRevision
    || (feedback === null && !(stage === 'diagnose' && value.revision === 1))
    || (stage === 'diagnose' && feedback === 'correct')
    || (stage === 'complete' && feedback !== 'correct')) return null
  const parsed: TeachingPractice = { version: 1, lessonId: 'fractions-v1', revision: value.revision, stage, feedback }
  const encoded = JSON.stringify(parsed)
  return encoded.length <= MAX_TEACHING_PRACTICE_BYTES ? parsed : null
}

/** Start a blank lesson after the caller has authorized the teaching activity. */
export function newTeachingPractice(): TeachingPractice {
  return { version: 1, lessonId: 'fractions-v1', revision: 1, stage: 'diagnose', feedback: null }
}

/** Strict non-mutating reader. Null means preserve the source row unchanged for recovery. */
export function readTeachingPractice(value: unknown): TeachingPractice | null {
  if (!isPlainObject(value)) return null
  try { return canonicalState(value) } catch { return null }
}
