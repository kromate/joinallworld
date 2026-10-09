/** Server-owned cpe-101 practice and the one assignment mark it may settle. */
import { characterCity } from '../character.ts'
import {
  assessmentPracticeView, readAssessmentPracticeState, startAssessmentPractice, stepAssessmentPractice,
  MAX_ASSESSMENT_PRACTICE_BYTES,
  type AssessmentPracticeOperation, type AssessmentPracticeState,
} from '../../src/campus/unilag/assessment-practice.ts'
import { UNILAG_BETA_RULES, programmeOf } from '../../src/campus/unilag/curriculum.ts'
import type { AssessmentOperation, AssessmentResponse, AssessmentStartRequest, AssessmentStepRequest } from '../../src/types/living-world-assessment.ts'
import type { ActiveTerm, AssessmentState, UnilagStudentState } from '../../src/types/campus.ts'
import type { CityId } from '../../src/types/protocol.ts'
import type { LifeState } from '../../src/types/life.ts'
import type { Db, RouteContext, RouteRequest, SessionRecord } from '../types.ts'

const CITY: CityId = 'lagos'
const PROGRAMME = 'computer' as const
const COURSE = 'cpe-101' as const
const MAX_ACTORS = 1024
const MAX_ATTEMPTS = 8
const MAX_RECORD_BYTES = 18_000
const MAX_TIME = Number.MAX_SAFE_INTEGER

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const isPlainRecord = (value: unknown): value is Record<string, unknown> => isRecord(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
const safeTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/.test(value)
const requestIdentifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,100}$/.test(value)

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  try { const own = Reflect.ownKeys(value); return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key)) }
  catch { return false }
}
function byteSize(value: unknown): number | null {
  try {
    const text = JSON.stringify(value)
    return text === undefined || /[^\x00-\x7f]/.test(text) ? null : text.length
  } catch { return null }
}

export interface AssessmentTermAttempt {
  semester: 1
  startDay: number
  practice: AssessmentPracticeState
}
export interface AssessmentRecord {
  v: 1
  publicId: string
  account: string | null
  cityId: typeof CITY
  programmeId: typeof PROGRAMME
  courseId: typeof COURSE
  attempts: AssessmentTermAttempt[]
  createdAt: number
  updatedAt: number
}

/** Strict reader for privacy/rebind integration. Invalid and future values remain untouched. */
export function readValidatedAssessmentRecord(value: unknown, publicId: string): AssessmentRecord | null {
  try {
    if (!identifier(publicId) || !isPlainRecord(value)
      || !exactKeys(value, ['v', 'publicId', 'account', 'cityId', 'programmeId', 'courseId', 'attempts', 'createdAt', 'updatedAt'])
      || value.v !== 1 || value.publicId !== publicId || !(value.account === null || identifier(value.account))
      || value.cityId !== CITY || value.programmeId !== PROGRAMME || value.courseId !== COURSE
      || !safeTime(value.createdAt) || !safeTime(value.updatedAt) || value.createdAt > value.updatedAt
      || !Array.isArray(value.attempts) || value.attempts.length < 1 || value.attempts.length > MAX_ATTEMPTS) return null
    let previousStartDay = -1
    const attempts: AssessmentTermAttempt[] = []
    for (const raw of value.attempts) {
      if (!isPlainRecord(raw) || !exactKeys(raw, ['semester', 'startDay', 'practice']) || raw.semester !== 1
        || !safeTime(raw.startDay) || raw.startDay <= previousStartDay) return null
      const practice = readAssessmentPracticeState(raw.practice, publicId)
      if (!practice || byteSize(practice) === null || byteSize(practice)! > MAX_ASSESSMENT_PRACTICE_BYTES) return null
      previousStartDay = raw.startDay
      attempts.push({ semester: 1, startDay: raw.startDay, practice })
    }
    const parsed: AssessmentRecord = { v: 1, publicId, account: value.account as string | null, cityId: CITY,
      programmeId: PROGRAMME, courseId: COURSE, attempts, createdAt: value.createdAt, updatedAt: value.updatedAt }
    const size = byteSize(parsed)
    return size !== null && size <= MAX_RECORD_BYTES ? parsed : null
  } catch { return null }
}

type AssessmentCollection = Record<string, unknown> & { assessments?: Record<string, unknown> }
type CurrentTerm = { term: ActiveTerm; assessment: AssessmentState }
type Access = { session: SessionRecord; life: LifeState | null }
type StartResult = { ok: boolean; code: string; startDay: number; revision?: number; duplicate?: true }
type StepResult = { ok: boolean; code: string; startDay: number; revision: number | null; feedback?: string; mark?: number; duplicate?: true }

function countRows(rows: Record<string, unknown>): number {
  try {
    let count = 0
    for (const key of Reflect.ownKeys(rows)) if (typeof key === 'string' && Object.hasOwn(rows, key) && ++count > MAX_ACTORS) return count
    return count
  } catch { return MAX_ACTORS + 1 }
}

function readRows(db: Db): Record<string, unknown> | null | false {
  try {
    const root: unknown = db.livingWorld
    if (root === undefined) return null
    if (!isPlainRecord(root)) return false
    if (!Object.hasOwn(root, 'assessments')) return null
    return isPlainRecord(root.assessments) ? root.assessments : false
  } catch { return false }
}

function rowsForWrite(ctx: RouteContext, db: Db): Record<string, unknown> {
  try {
    const root = ctx.collection(db, 'livingWorld', { assessments: {} }) as AssessmentCollection
    if (!isPlainRecord(root)) throw new Error('invalid root')
    if (!Object.hasOwn(root, 'assessments')) Object.defineProperty(root, 'assessments', { value: {}, enumerable: true, configurable: true, writable: true })
    if (!isPlainRecord(root.assessments)) throw new Error('invalid map')
    return root.assessments
  } catch (error) {
    if (isRecord(error) && error.status === 503) throw error
    throw ctx.fail(503, 'assessment_storage_unavailable')
  }
}

function readRow(rows: Record<string, unknown> | null | false, publicId: string): AssessmentRecord | null | false {
  if (rows === false) return false
  if (rows === null || !Object.hasOwn(rows, publicId)) return null
  return readValidatedAssessmentRecord(rows[publicId], publicId) ?? false
}

function writeRow(rows: Record<string, unknown>, row: AssessmentRecord, ctx: RouteContext): void {
  const size = byteSize(row)
  if (size === null || size > MAX_RECORD_BYTES) throw ctx.fail(507, 'assessment_record_too_large')
  try { Object.defineProperty(rows, row.publicId, { value: row, enumerable: true, configurable: true, writable: true }) }
  catch { throw ctx.fail(503, 'assessment_storage_unavailable') }
}

function cityOf(ctx: RouteContext, value: unknown): CityId | null {
  return typeof value === 'string' && ctx.cityIds.some(city => city === value) ? value as CityId : null
}

/** Reads the current computer-engineering semester-one assessment without creating or normalizing state. */
function currentTerm(life: LifeState | null): CurrentTerm | null {
  if (!life) return null
  const student = life.unilagStudent as UnilagStudentState | undefined
  if (!student || !['studying', 'deferred'].includes(student.status) || student.programme !== PROGRAMME) return null
  const programme = programmeOf(student.programme)
  const term = student.term
  if (!programme || !term || term.semester !== 1 || !safeTime(term.startDay) || !Number.isSafeInteger(term.attempt) || term.attempt < 1
    || !Array.isArray(term.registeredCourses) || !term.registeredCourses.includes(COURSE)) return null
  if (!isPlainRecord(term.assessments)) return null
  const rawAssessment: unknown = term.assessments[COURSE]
  if (!isPlainRecord(rawAssessment) || !exactKeys(rawAssessment, ['assignment', 'test'])) return null
  const mark = rawAssessment.assignment
  if (!(mark === null || (typeof mark === 'number' && Number.isSafeInteger(mark) && mark >= 0 && mark <= UNILAG_BETA_RULES.assignmentWeight))) return null
  return { term, assessment: rawAssessment as AssessmentState }
}

function response(
  code: string,
  ok: boolean,
  term: CurrentTerm | null,
  record: AssessmentRecord | null,
  duplicate = false,
): AssessmentResponse {
  const attempt = term ? record?.attempts.find(item => item.semester === term.term.semester && item.startDay === term.term.startDay) ?? null : null
  const assignmentMark = term?.assessment.assignment ?? null
  const practice = attempt && (assignmentMark === null || attempt.practice.phase === 'complete') ? attempt.practice : null
  return {
    ok, code,
    ...(duplicate ? { duplicate: true } : {}),
    term: term ? { semester: 1, startDay: term.term.startDay, courseId: COURSE } : null,
    practice: practice ? assessmentPracticeView(practice) : null,
    revision: practice?.revision ?? null,
    assignmentMark,
  }
}

function recordMatches(row: AssessmentRecord, session: SessionRecord): string | null {
  return row.publicId !== session.publicId || row.account !== (session.account ?? null) ? 'account_changed' : null
}

function isTermReceiptConflict(error: unknown, session: SessionRecord, requestId: string, startDay: number): boolean {
  if (!isRecord(error) || error.status !== 409 || error.code !== 'client_id_conflict') return false
  const priorResult = session.once?.[requestId]?.result
  return isRecord(priorResult) && safeTime(priorResult.startDay) && priorResult.startDay !== startDay
}

function operationOf(value: unknown): AssessmentOperation | null {
  if (!isPlainRecord(value) || typeof value.kind !== 'string') return null
  if (value.kind === 'probe' || value.kind === 'inspect') {
    if (!exactKeys(value, ['kind', 'a', 'b']) || typeof value.a !== 'boolean' || typeof value.b !== 'boolean') return null
    return { kind: value.kind, a: value.a, b: value.b }
  }
  if (value.kind === 'repair') {
    if (!exactKeys(value, ['kind', 'gate']) || (value.gate !== 'or' && value.gate !== 'and' && value.gate !== 'xor')) return null
    return { kind: 'repair', gate: value.gate }
  }
  if (value.kind === 'submit') return exactKeys(value, ['kind']) ? { kind: 'submit' } : null
  return null
}

function requestBody(value: unknown): AssessmentStartRequest | null {
  return isPlainRecord(value) && exactKeys(value, ['cityId', 'requestId']) && typeof value.cityId === 'string'
    && requestIdentifier(value.requestId) ? { cityId: value.cityId as CityId, requestId: value.requestId } : null
}
function stepBody(value: unknown): AssessmentStepRequest | null {
  if (!isPlainRecord(value) || !exactKeys(value, ['cityId', 'requestId', 'expectedRevision', 'operation'])
    || typeof value.cityId !== 'string' || !requestIdentifier(value.requestId)
    || typeof value.expectedRevision !== 'number' || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 1) return null
  const operation = operationOf(value.operation)
  return operation ? { cityId: value.cityId as CityId, requestId: value.requestId, expectedRevision: value.expectedRevision, operation } : null
}

export function createAssessmentService(ctx: RouteContext) {
  function authenticated(db: Db, request: RouteRequest, cityId: CityId, write: boolean): Access {
    const session = request.requireSession(db, { renew: true })
    if (!ctx.allow(`living-world:assessment:${session.publicId}`, 120, 60_000)) throw ctx.fail(429, 'rate_limited')
    ctx.checks?.cityGate?.(session, cityId)
    if (characterCity(session) !== cityId) throw ctx.fail(409, 'city_moved')
    const life = write ? ctx.settle(session, cityId) : session.cities[cityId]?.state
    if (life?.onboarding.required) throw ctx.fail(403, 'onboarding_required')
    return { session, life: life ?? null }
  }

  function current(request: RouteRequest, cityUnknown: unknown): Promise<AssessmentResponse> {
    const cityId = cityOf(ctx, cityUnknown)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    if (cityId !== CITY) throw ctx.fail(409, 'assessment_scenario_unavailable')
    return ctx.store.transact(db => {
      const { session, life } = authenticated(db, request, cityId, false)
      const term = currentTerm(life)
      if (!term) return response('assessment_not_registered', true, null, null)
      const rowMap = readRows(db), row = readRow(rowMap, session.publicId)
      if (row === false) return response('invalid_saved_assessment', false, term, null)
      if (row) {
        const mismatch = recordMatches(row, session)
        if (mismatch) return response(mismatch, false, term, null)
      }
      const attempt = row?.attempts.find(item => item.semester === 1 && item.startDay === term.term.startDay) ?? null
      if (attempt?.practice.phase === 'complete' && term.assessment.assignment !== attempt.practice.score) {
        return response('assessment_record_mismatch', false, term, null)
      }
      if (term.assessment.assignment !== null) return response('assignment_retained', true, term, row)
      return response(attempt ? 'assessment_loaded' : 'assessment_ready', true, term, row)
    })
  }

  function start(request: RouteRequest, value: unknown): Promise<AssessmentResponse> {
    const body = requestBody(value)
    if (!body) throw ctx.fail(400, 'invalid_assessment_request')
    const cityId = cityOf(ctx, body.cityId)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    if (cityId !== CITY) throw ctx.fail(409, 'assessment_scenario_unavailable')
    const receiptAt = ctx.onceId(body.requestId)
    return ctx.store.transact(db => {
      const { session, life } = authenticated(db, request, cityId, true)
      if (!life) throw ctx.fail(409, 'assessment_scenario_unavailable')
      const term = currentTerm(life)
      const rows = readRows(db)
      if (rows === false) return response('assessment_storage_unavailable', false, term, null)
      const existing = readRow(rows, session.publicId)
      if (existing === false) return response('invalid_saved_assessment', false, term, null)
      if (existing && recordMatches(existing, session)) return response('account_changed', false, term, null)
      if (!term) return response('assessment_not_registered', false, null, existing)
      const existingAttempt = existing?.attempts.find(item => item.semester === 1 && item.startDay === term.term.startDay) ?? null
      if (existingAttempt?.practice.phase === 'complete' && term.assessment.assignment !== existingAttempt.practice.score) {
        return response('assessment_record_mismatch', false, term, null)
      }

      const fingerprint = { cityId, publicId: session.publicId, account: session.account ?? null, programmeId: PROGRAMME,
        semester: 1, startDay: term.term.startDay, attempt: term.term.attempt, courseId: COURSE }
      let result: StartResult
      try { result = ctx.once(db, session, { id: body.requestId, kind: 'living-world.assessment.start', fingerprint }, () => {
        const now = ctx.now()
        if (!safeTime(now) || !safeTime(receiptAt)) return { ok: false, code: 'invalid_server_clock', startDay: term.term.startDay }
        if (life.unilagStudent.status !== 'studying') return { ok: false, code: 'student_not_studying', startDay: term.term.startDay }
        if (life.location !== 'unilag' || life.spot !== programmeOf(PROGRAMME)?.spot) return { ok: false, code: 'assessment_location_required', startDay: term.term.startDay }
        if (life.activeAction !== null) return { ok: false, code: 'busy', startDay: term.term.startDay }
        if (term.assessment.assignment !== null) return { ok: false, code: 'assignment_retained', startDay: term.term.startDay }
        const latestRows = rowsForWrite(ctx, db), latest = readRow(latestRows, session.publicId)
        if (latest === false) return { ok: false, code: 'invalid_saved_assessment', startDay: term.term.startDay }
        if (latest && recordMatches(latest, session)) return { ok: false, code: 'account_changed', startDay: term.term.startDay }
        const attempts = latest?.attempts ?? []
        if (latest === null && countRows(latestRows) >= MAX_ACTORS) return { ok: false, code: 'assessment_capacity', startDay: term.term.startDay }
        if (attempts.some(item => item.startDay === term.term.startDay)) return { ok: false, code: 'assessment_retained', startDay: term.term.startDay }
        if (attempts.length >= MAX_ATTEMPTS) return { ok: false, code: 'assessment_capacity', startDay: term.term.startDay }
        if (latest && now < latest.updatedAt) return { ok: false, code: 'invalid_server_clock', startDay: term.term.startDay }
        if (latest && term.term.startDay <= latest.attempts.at(-1)!.startDay) return { ok: false, code: 'assessment_term_not_newer', startDay: term.term.startDay }
        if (term.assessment.assignment !== null || life.unilagStudent.status !== 'studying'
          || life.location !== 'unilag' || life.spot !== programmeOf(PROGRAMME)?.spot || life.activeAction !== null) {
          return { ok: false, code: 'assessment_unavailable', startDay: term.term.startDay }
        }
        const practice = startAssessmentPractice(session.publicId)
        const next: AssessmentRecord = {
          v: 1, publicId: session.publicId, account: session.account ?? null, cityId: CITY,
          programmeId: PROGRAMME, courseId: COURSE,
          attempts: [...attempts, { semester: 1, startDay: term.term.startDay, practice }],
          createdAt: latest?.createdAt ?? now, updatedAt: now,
        }
        writeRow(latestRows, next, ctx)
        return { ok: true, code: 'assessment_started', startDay: term.term.startDay, revision: practice.revision }
      }) } catch (error) {
        if (!isTermReceiptConflict(error, session, body.requestId, term.term.startDay)) throw error
        return response('term_changed', false, term, existing)
      }
      const freshTerm = currentTerm(life), freshRows = readRows(db), fresh = readRow(freshRows, session.publicId)
      if (fresh === false) return response('invalid_saved_assessment', false, freshTerm, null, 'duplicate' in result && result.duplicate === true)
      if (fresh && recordMatches(fresh, session)) return response('account_changed', false, freshTerm, null)
      if (!freshTerm || result.startDay !== freshTerm.term.startDay) return response('term_changed', false, freshTerm, fresh, 'duplicate' in result && result.duplicate === true)
      const freshAttempt = fresh?.attempts.find(item => item.semester === 1 && item.startDay === freshTerm.term.startDay) ?? null
      if (freshTerm.assessment.assignment !== null && freshAttempt?.practice.phase !== 'complete') {
        return response('assignment_retained', false, freshTerm, fresh, 'duplicate' in result && result.duplicate === true)
      }
      return response(String(result.code ?? 'assessment_refused'), result.ok === true, freshTerm, fresh, 'duplicate' in result && result.duplicate === true)
    })
  }

  function step(request: RouteRequest, value: unknown): Promise<AssessmentResponse> {
    const body = stepBody(value)
    if (!body) throw ctx.fail(400, 'invalid_assessment_request')
    const cityId = cityOf(ctx, body.cityId)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    if (cityId !== CITY) throw ctx.fail(409, 'assessment_scenario_unavailable')
    ctx.onceId(body.requestId)
    return ctx.store.transact(db => {
      const { session, life } = authenticated(db, request, cityId, true)
      if (!life) throw ctx.fail(409, 'assessment_scenario_unavailable')
      const term = currentTerm(life)
      const rows = readRows(db), row = readRow(rows, session.publicId)
      if (rows === false || row === false) return response('invalid_saved_assessment', false, term, null)
      if (row && recordMatches(row, session)) return response('account_changed', false, term, null)
      if (!term) return response('assessment_not_registered', false, null, row)
      const existingAttempt = row?.attempts.find(item => item.semester === 1 && item.startDay === term.term.startDay) ?? null
      if (existingAttempt?.practice.phase === 'complete' && term.assessment.assignment !== existingAttempt.practice.score) {
        return response('assessment_record_mismatch', false, term, null)
      }
      const fingerprint = { cityId, publicId: session.publicId, account: session.account ?? null, programmeId: PROGRAMME,
        semester: 1, startDay: term.term.startDay, attempt: term.term.attempt, courseId: COURSE,
        expectedRevision: body.expectedRevision, operation: body.operation }
      let result: StepResult
      try { result = ctx.once(db, session, { id: body.requestId, kind: 'living-world.assessment.step', fingerprint }, () => {
        const now = ctx.now()
        const currentRows = readRow(readRows(db), session.publicId)
        if (currentRows === false || (currentRows && recordMatches(currentRows, session))) {
          return { ok: false, code: 'invalid_saved_assessment', startDay: term.term.startDay, revision: null }
        }
        const attempt = currentRows?.attempts.find(item => item.semester === 1 && item.startDay === term.term.startDay) ?? null
        if (!attempt) return { ok: false, code: 'assessment_not_started', startDay: term.term.startDay, revision: null }
        if (!safeTime(now) || (currentRows !== null && now < currentRows.updatedAt)) {
          return { ok: false, code: 'invalid_server_clock', startDay: term.term.startDay, revision: attempt.practice.revision }
        }
        if (life.activeAction !== null || life.unilagStudent.status !== 'studying' || life.location !== 'unilag'
          || life.spot !== programmeOf(PROGRAMME)?.spot || currentTerm(life)?.term.startDay !== term.term.startDay) {
          return { ok: false, code: 'assessment_unavailable', startDay: term.term.startDay, revision: attempt.practice.revision }
        }
        if (term.assessment.assignment !== null) return { ok: false, code: 'assignment_retained', startDay: term.term.startDay, revision: attempt.practice.revision }
        if (body.expectedRevision !== attempt.practice.revision) return { ok: false, code: 'revision_conflict', startDay: term.term.startDay, revision: attempt.practice.revision }
        const operation: AssessmentPracticeOperation = { ...body.operation, requestId: body.requestId, expectedRevision: body.expectedRevision }
        const applied = stepAssessmentPractice(attempt.practice, session.publicId, operation)
        let pendingMark: number | null = null
        if (applied.mark !== undefined) {
          if (!applied.ok || applied.code !== 'completed' || applied.state.phase !== 'complete'
            || applied.mark !== UNILAG_BETA_RULES.assignmentWeight || applied.state.score !== applied.mark
            || term.assessment.assignment !== null || applied.state === attempt.practice) {
            return { ok: false, code: 'assessment_mark_refused', startDay: term.term.startDay, revision: attempt.practice.revision }
          }
          pendingMark = applied.mark
        }
        if (applied.state !== attempt.practice) {
          const latestRows = rowsForWrite(ctx, db), latest = readRow(latestRows, session.publicId)
          if (latest === null || latest === false || recordMatches(latest, session)) return { ok: false, code: 'assessment_storage_unavailable', startDay: term.term.startDay, revision: attempt.practice.revision }
          const index = latest.attempts.findIndex(item => item.semester === 1 && item.startDay === term.term.startDay)
          if (index < 0 || latest.attempts[index]!.practice.revision !== attempt.practice.revision) return { ok: false, code: 'revision_conflict', startDay: term.term.startDay, revision: attempt.practice.revision }
          const attempts = [...latest.attempts]
          attempts[index] = { ...attempts[index]!, practice: applied.state }
          writeRow(latestRows, { ...latest, attempts, updatedAt: now }, ctx)
        }
        if (pendingMark !== null) term.assessment.assignment = pendingMark
        return { ok: applied.ok, code: applied.code, feedback: applied.feedback, startDay: term.term.startDay,
          revision: applied.state.revision, ...(applied.mark !== undefined ? { mark: applied.mark } : {}),
          ...(applied.duplicate ? { duplicate: true as const } : {}) }
      }) } catch (error) {
        if (!isTermReceiptConflict(error, session, body.requestId, term.term.startDay)) throw error
        return response('term_changed', false, term, row)
      }
      const freshTerm = currentTerm(life), freshRows = readRows(db), fresh = readRow(freshRows, session.publicId)
      if (fresh === false || freshRows === false) return response('invalid_saved_assessment', false, freshTerm, null, 'duplicate' in result && result.duplicate === true)
      if (fresh && recordMatches(fresh, session)) return response('account_changed', false, freshTerm, null)
      if (!freshTerm || result.startDay !== freshTerm.term.startDay) return response('term_changed', false, freshTerm, fresh, 'duplicate' in result && result.duplicate === true)
      if (freshTerm.assessment.assignment !== null) {
        const currentAttempt = fresh?.attempts.find(item => item.startDay === freshTerm.term.startDay) ?? null
        if (currentAttempt?.practice.phase === 'complete' && freshTerm.assessment.assignment !== currentAttempt.practice.score) {
          return response('assessment_record_mismatch', false, freshTerm, null, 'duplicate' in result && result.duplicate === true)
        }
        if (currentAttempt?.practice.phase !== 'complete') {
          return { ...response('assignment_retained', false, freshTerm, fresh, 'duplicate' in result && result.duplicate === true),
            ...(typeof result.feedback === 'string' ? { feedback: result.feedback } : {}) }
        }
      }
      return {
        ...response(String(result.code ?? 'assessment_refused'), result.ok === true, freshTerm, fresh, 'duplicate' in result && result.duplicate === true),
        ...(typeof result.feedback === 'string' ? { feedback: result.feedback } : {}),
      }
    })
  }

  return { current, start, step }
}
