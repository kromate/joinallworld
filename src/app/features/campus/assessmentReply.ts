import { UNILAG_BETA_RULES } from '../../../campus/unilag/curriculum.ts'
import type { AssessmentPracticeObservation, AssessmentPracticePhase, AssessmentPracticeView } from '../../../campus/unilag/assessment-practice.ts'
import type { AssessmentResponse } from '../../../types/living-world-assessment.ts'
import type { ApiEnvelope } from '../../../types/protocol.ts'

export type AssessmentReply = AssessmentResponse & ApiEnvelope
const ROOT_KEYS = ['serverTime', 'ok', 'code', 'feedback', 'duplicate', 'term', 'practice', 'revision', 'assignmentMark', 'storage']
const VIEW_KEYS = ['courseId', 'scenario', 'revision', 'phase', 'title', 'instructions', 'targetTable', 'initialProbes', 'verificationProbes', 'counterexample', 'feedback', 'score']
const PHASES = new Set<AssessmentPracticePhase>(['inspect', 'repair', 'verify', 'submit', 'complete'])

function object(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  try {
    const proto = Object.getPrototypeOf(value)
    return proto === Object.prototype || proto === null
  } catch { return false }
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  try {
    const own = Reflect.ownKeys(value)
    return own.length === keys.length && own.every((key) => typeof key === 'string' && keys.includes(key))
  } catch { return false }
}
function onlyAllowedKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  try {
    return Reflect.ownKeys(value).every((key) => typeof key === 'string' && keys.includes(key))
  } catch { return false }
}

function safeString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}
function safeInteger(value: unknown, min: number, max: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
}
function bitIndex(a: boolean, b: boolean): number { return (a ? 2 : 0) | (b ? 1 : 0) }

function readObservation(value: unknown): AssessmentPracticeObservation | null {
  if (!object(value) || !exact(value, ['a', 'b', 'output']) || typeof value.a !== 'boolean'
    || typeof value.b !== 'boolean' || typeof value.output !== 'boolean') return null
  return { a: value.a, b: value.b, output: value.output }
}

function readObservations(value: unknown, expectedGate: 'or' | 'and' | 'target', maxLength: number): AssessmentPracticeObservation[] | null {
  if (!Array.isArray(value) || value.length > maxLength) return null
  const output: AssessmentPracticeObservation[] = []
  let priorIndex = -1
  for (const raw of value) {
    const row = readObservation(raw)
    if (!row) return null
    const index = bitIndex(row.a, row.b)
    if (index <= priorIndex) return null
    priorIndex = index
    const expected = expectedGate === 'or' ? row.a || row.b : expectedGate === 'and' ? row.a && row.b : row.a && row.b
    if (row.output !== expected) return null
    output.push(row)
  }
  return output
}

function readPractice(value: unknown): AssessmentPracticeView | null | undefined {
  if (value === null) return null
  if (!object(value) || !exact(value, VIEW_KEYS) || value.courseId !== 'cpe-101' || value.scenario !== 'logic-probe-lab-v1'
    || !safeInteger(value.revision, 1, 12) || typeof value.phase !== 'string' || !PHASES.has(value.phase as AssessmentPracticePhase)
    || !safeString(value.title, 120) || !safeString(value.instructions, 300) || !safeString(value.feedback, 300)
    || !(value.score === null || safeInteger(value.score, 0, UNILAG_BETA_RULES.assignmentWeight))) return undefined
  const targetTable = readObservations(value.targetTable, 'target', 4)
  const initialProbes = readObservations(value.initialProbes, 'or', 4)
  const verificationProbes = readObservations(value.verificationProbes, 'and', 4)
  if (!targetTable || !initialProbes || !verificationProbes || targetTable.length !== 4
    || targetTable.some((row, index) => row.a !== [false, false, true, true][index]
      || row.b !== [false, true, false, true][index])) return undefined

  let counterexample: AssessmentPracticeObservation | null = null
  if (value.counterexample !== null) {
    const parsed = readObservation(value.counterexample)
    if (!parsed || parsed.a === parsed.b || !parsed.output) return undefined
    counterexample = parsed
  }
  const phase = value.phase as AssessmentPracticePhase
  const score = value.score as number | null
  const hasCounterexampleProbe = counterexample !== null && initialProbes.some((row) => row.a === counterexample!.a && row.b === counterexample!.b)
  const expectedRevision = 1 + initialProbes.length
    + (phase === 'repair' || phase === 'verify' || phase === 'submit' || phase === 'complete' ? 1 : 0)
    + (phase === 'verify' || phase === 'submit' || phase === 'complete' ? 1 : 0)
    + verificationProbes.length + (phase === 'complete' ? 1 : 0)
  if (value.revision !== expectedRevision) return undefined
  if (phase === 'inspect' && (counterexample !== null || verificationProbes.length !== 0 || score !== null)) return undefined
  if (phase === 'repair' && (!hasCounterexampleProbe || verificationProbes.length !== 0 || score !== null)) return undefined
  if (phase === 'verify' && (!hasCounterexampleProbe || verificationProbes.length >= 4 || score !== null)) return undefined
  if (phase === 'submit' && (!hasCounterexampleProbe || verificationProbes.length !== 4 || score !== null)) return undefined
  if (phase === 'complete' && (!hasCounterexampleProbe || verificationProbes.length !== 4 || score !== UNILAG_BETA_RULES.assignmentWeight)) return undefined

  return {
    courseId: 'cpe-101', scenario: 'logic-probe-lab-v1', revision: value.revision, phase, title: value.title,
    instructions: value.instructions, targetTable, initialProbes, verificationProbes, counterexample,
    feedback: value.feedback, score,
  }
}

/** Validates only the public HTTP envelope/projection; private saved practice state is never exposed. */
export function readAssessmentReply(value: unknown): AssessmentReply | null {
  if (!object(value) || !onlyAllowedKeys(value, ROOT_KEYS)
    || !['serverTime', 'ok', 'code', 'term', 'practice', 'revision', 'assignmentMark'].every((key) => Object.hasOwn(value, key))
    || !safeInteger(value.serverTime, 1, Number.MAX_SAFE_INTEGER)
    || value.storage !== undefined
    || typeof value.ok !== 'boolean' || !safeString(value.code, 100)
    || (value.feedback !== undefined && (typeof value.feedback !== 'string' || value.feedback.length > 400))
    || (value.duplicate !== undefined && value.duplicate !== true)) return null

  let term: AssessmentResponse['term'] = null
  if (value.term !== null) {
    if (!object(value.term) || !exact(value.term, ['semester', 'startDay', 'courseId']) || value.term.semester !== 1
      || value.term.courseId !== 'cpe-101' || !safeInteger(value.term.startDay, 0, Number.MAX_SAFE_INTEGER)) return null
    term = { semester: 1, startDay: value.term.startDay, courseId: 'cpe-101' }
  }
  const practice = readPractice(value.practice)
  if (practice === undefined) return null
  const revision = value.revision
  if (!(revision === null || safeInteger(revision, 1, 12)) || (practice === null ? revision !== null : revision !== practice.revision || term === null)) return null
  const assignmentMark = value.assignmentMark
  if (!(assignmentMark === null || safeInteger(assignmentMark, 0, UNILAG_BETA_RULES.assignmentWeight))) return null
  if (term === null && assignmentMark !== null) return null
  if (practice && (practice.score === null ? assignmentMark !== null : practice.score !== assignmentMark)) return null

  return {
    serverTime: value.serverTime,
    ok: value.ok,
    code: value.code,
    ...(typeof value.feedback === 'string' ? { feedback: value.feedback } : {}),
    ...(value.duplicate === true ? { duplicate: true as const } : {}),
    term, practice, revision: revision as number | null, assignmentMark,
  }
}
