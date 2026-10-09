/** Server authority for one authored fictional justice-process training case. It never reads or writes live politics justice. */
import { characterCity } from '../character.ts'
import {
  applyJusticePractice, createJusticePractice, justicePracticeFeedback, justicePracticeView, readJusticePracticeState,
  JUSTICE_PRACTICE_CASE_ID, JUSTICE_PRACTICE_MAX_STATE_BYTES,
  type JusticeEvidenceId, type JusticeFeedbackId, type JusticeOutcomeCode, type JusticePracticeAction,
  type JusticePracticeOutcome, type JusticePracticeState,
} from '../../src/game/living-world/justice-practice.ts'
import type { CityId } from '../../src/types/protocol.ts'
import type { Db, RouteContext, RouteRequest, SessionRecord } from '../types.ts'

const MAX_ROWS = 1024
const MAX_RECORD_BYTES = JUSTICE_PRACTICE_MAX_STATE_BYTES + 512
const MAX_TIME = Number.MAX_SAFE_INTEGER
const CITY: CityId = 'lagos'
const CASE_ID = JUSTICE_PRACTICE_CASE_ID

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const isPlainRecord = (value: unknown): value is Record<string, unknown> => isRecord(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
const safeTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/.test(value)
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  try {
    const own = Reflect.ownKeys(value)
    return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key))
  } catch { return false }
}
function sizeOf(value: unknown): number | null {
  try {
    const text = JSON.stringify(value)
    return text === undefined || /[^\x00-\x7f]/.test(text) ? null : text.length
  } catch { return null }
}

export interface JusticePracticeRecord {
  v: 1
  publicId: string
  account: string | null
  cityId: CityId
  caseId: typeof JUSTICE_PRACTICE_CASE_ID
  createdAt: number
  updatedAt: number
  practice: JusticePracticeState
}

/** Strict saved-row reader. Malformed and future rows are left in storage for recovery. */
export function readValidatedJusticePracticeRecord(value: unknown, publicId: string): JusticePracticeRecord | null {
  try {
    if (!identifier(publicId) || !isPlainRecord(value)
      || !exactKeys(value, ['v', 'publicId', 'account', 'cityId', 'caseId', 'createdAt', 'updatedAt', 'practice'])
      || value.v !== 1 || value.publicId !== publicId || !(value.account === null || identifier(value.account))
      || value.cityId !== CITY || value.caseId !== CASE_ID || !safeTime(value.createdAt) || !safeTime(value.updatedAt)
      || value.createdAt > value.updatedAt) return null
    const practice = readJusticePracticeState(value.practice)
    if (!practice || practice.caseId !== CASE_ID || sizeOf(practice) === null || sizeOf(practice)! > JUSTICE_PRACTICE_MAX_STATE_BYTES) return null
    const parsed: JusticePracticeRecord = {
      v: 1, publicId, account: value.account as string | null, cityId: CITY, caseId: CASE_ID,
      createdAt: value.createdAt, updatedAt: value.updatedAt, practice,
    }
    const bytes = sizeOf(parsed)
    return bytes !== null && bytes <= MAX_RECORD_BYTES ? parsed : null
  } catch { return null }
}

type PracticeCollection = Record<string, unknown> & { justicePractice?: Record<string, unknown> }
type PublicResult = {
  ok: boolean
  code: string
  feedback?: string
  duplicate?: true
  practice: ReturnType<typeof justicePracticeView>
  revision: number | null
}

function countRows(rows: Record<string, unknown>): number {
  try {
    let count = 0
    for (const key of Reflect.ownKeys(rows)) if (typeof key === 'string' && Object.hasOwn(rows, key) && ++count > MAX_ROWS) return count
    return count
  } catch { return MAX_ROWS + 1 }
}

function rowsForWrite(ctx: RouteContext, db: Db): Record<string, unknown> {
  try {
    const root = ctx.collection(db, 'livingWorld', { justicePractice: {} }) as PracticeCollection
    if (!isPlainRecord(root)) throw new Error('invalid root')
    if (!Object.hasOwn(root, 'justicePractice')) Object.defineProperty(root, 'justicePractice', { value: {}, enumerable: true, configurable: true, writable: true })
    if (!isPlainRecord(root.justicePractice)) throw new Error('invalid map')
    return root.justicePractice
  } catch (error) {
    if (isRecord(error) && error.status === 503) throw error
    throw ctx.fail(503, 'justice_practice_storage_unavailable')
  }
}

/** Read without bootstrapping the living-world root or an empty practice map. */
function rowsForRead(db: Db): Record<string, unknown> | null | false {
  try {
    const root: unknown = db.livingWorld
    if (root === undefined) return null
    if (!isPlainRecord(root)) return false
    if (!Object.hasOwn(root, 'justicePractice')) return null
    return isPlainRecord(root.justicePractice) ? root.justicePractice : false
  } catch { return false }
}

function readRow(rows: Record<string, unknown> | null, publicId: string): JusticePracticeRecord | null | false {
  if (rows === null || !Object.hasOwn(rows, publicId)) return null
  return readValidatedJusticePracticeRecord(rows[publicId], publicId) ?? false
}

function putRow(rows: Record<string, unknown>, row: JusticePracticeRecord, ctx: RouteContext): void {
  const size = sizeOf(row)
  if (size === null || size > MAX_RECORD_BYTES) throw ctx.fail(507, 'justice_practice_record_too_large')
  try { Object.defineProperty(rows, row.publicId, { value: row, enumerable: true, configurable: true, writable: true }) }
  catch { throw ctx.fail(503, 'justice_practice_storage_unavailable') }
}

function cityOf(ctx: RouteContext, value: unknown): CityId | null {
  return typeof value === 'string' && ctx.cityIds.some(city => city === value) ? value as CityId : null
}

function access(ctx: RouteContext, db: Db, request: RouteRequest, cityId: CityId): { session: SessionRecord } {
  const session = request.requireSession(db, { renew: true })
  if (!ctx.allow(`living-world:justice-practice:${session.publicId}`, 120, 60_000)) throw ctx.fail(429, 'rate_limited')
  ctx.checks?.cityGate?.(session, cityId)
  if (characterCity(session) !== cityId) throw ctx.fail(409, 'city_moved')
  const life = ctx.settle(session, cityId)
  if (life.onboarding.required) throw ctx.fail(403, 'onboarding_required')
  if (life.activeAction !== null) throw ctx.fail(409, 'busy')
  return { session }
}

function ownership(row: JusticePracticeRecord, session: SessionRecord, cityId: CityId): string | null {
  if (row.publicId !== session.publicId || row.account !== (session.account ?? null)) return 'account_changed'
  if (row.cityId !== cityId || row.caseId !== CASE_ID) return 'city_mismatch'
  return null
}

function response(row: JusticePracticeRecord | null, code: string, ok: boolean, options: { duplicate?: boolean; feedback?: string } = {}): PublicResult {
  return {
    ok, code,
    ...(options.feedback ? { feedback: options.feedback } : {}),
    ...(options.duplicate ? { duplicate: true as const } : {}),
    practice: row ? justicePracticeView(row.practice) : null,
    revision: row?.practice.revision ?? null,
  }
}

const EVIDENCE: readonly JusticeEvidenceId[] = ['dispatch-copy', 'arrival-receipt', 'seal-log', 'npc-recount']
const INITIAL_CHOICES = ['pause-and-reconcile', 'accept-receipt', 'assign-responsibility'] as const
const REVIEW_CHOICES = ['correct-duplicate-entry', 'keep-hold', 'assign-responsibility'] as const
const FEEDBACK_IDS: readonly JusticeFeedbackId[] = [
  'advanced', 'inspected', 'alreadyInspected', 'needEvidence', 'citeCounts', 'compareCounts', 'unsupportedConclusion',
  'noticeSent', 'reviewFirst', 'reviewEvidence', 'citeReview', 'reviewCounts', 'complete', 'wrongPhase', 'revisionConflict',
  'requestConflict', 'terminal', 'capacity', 'revisionExhausted', 'invalid',
]
const OUTCOME_CODES: readonly JusticeOutcomeCode[] = ['advanced', 'feedback', 'complete', 'conflict', 'terminal', 'capacity', 'invalid']

function evidenceIds(value: unknown): value is JusticeEvidenceId[] {
  return Array.isArray(value) && value.length >= 1 && value.length <= 3
    && value.every(item => typeof item === 'string' && EVIDENCE.includes(item as JusticeEvidenceId))
    && new Set(value).size === value.length
}

/** Parse and canonicalize only the authored action vocabulary. Property order and evidence-list order cannot alter a retry fingerprint. */
function actionOf(value: unknown): JusticePracticeAction | null {
  if (!isPlainRecord(value) || typeof value.kind !== 'string') return null
  if (value.kind === 'inspect') {
    if (!exactKeys(value, ['kind', 'evidenceId']) || typeof value.evidenceId !== 'string' || !EVIDENCE.includes(value.evidenceId as JusticeEvidenceId)) return null
    return { kind: 'inspect', evidenceId: value.evidenceId as JusticeEvidenceId }
  }
  if (value.kind === 'initial-decision') {
    if (!exactKeys(value, ['kind', 'choiceId', 'reasonEvidenceIds']) || typeof value.choiceId !== 'string'
      || !INITIAL_CHOICES.includes(value.choiceId as typeof INITIAL_CHOICES[number]) || !evidenceIds(value.reasonEvidenceIds)) return null
    return { kind: 'initial-decision', choiceId: value.choiceId as typeof INITIAL_CHOICES[number], reasonEvidenceIds: canonicalEvidence(value.reasonEvidenceIds) }
  }
  if (value.kind === 'review-decision') {
    if (!exactKeys(value, ['kind', 'choiceId', 'reasonEvidenceIds']) || typeof value.choiceId !== 'string'
      || !REVIEW_CHOICES.includes(value.choiceId as typeof REVIEW_CHOICES[number]) || !evidenceIds(value.reasonEvidenceIds)) return null
    return { kind: 'review-decision', choiceId: value.choiceId as typeof REVIEW_CHOICES[number], reasonEvidenceIds: canonicalEvidence(value.reasonEvidenceIds) }
  }
  if (value.kind === 'send-service-notice' || value.kind === 'inspect-review') {
    return exactKeys(value, ['kind']) ? { kind: value.kind } : null
  }
  return null
}

function canonicalEvidence(values: readonly JusticeEvidenceId[]): JusticeEvidenceId[] {
  return EVIDENCE.filter(value => values.includes(value))
}

interface StartBody { cityId: string; requestId: string }
interface StepBody { cityId: string; requestId: string; expectedRevision: number; action: JusticePracticeAction }
function requestIdentifier(value: unknown): value is string { return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,64}$/.test(value) }
function startBody(value: unknown): value is StartBody {
  return isPlainRecord(value) && exactKeys(value, ['cityId', 'requestId']) && typeof value.cityId === 'string' && requestIdentifier(value.requestId)
}
function stepBody(value: unknown): StepBody | null {
  if (!isPlainRecord(value) || !exactKeys(value, ['cityId', 'requestId', 'expectedRevision', 'action'])
    || typeof value.cityId !== 'string' || !requestIdentifier(value.requestId)
    || typeof value.expectedRevision !== 'number' || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) return null
  const action = actionOf(value.action)
  return action ? { cityId: value.cityId, requestId: value.requestId, expectedRevision: value.expectedRevision, action } : null
}

function validOutcome(value: unknown): value is JusticePracticeOutcome {
  return isPlainRecord(value) && exactKeys(value, ['code', 'feedbackId', 'revision'])
    && Number.isSafeInteger(value.revision) && typeof value.code === 'string' && OUTCOME_CODES.includes(value.code as JusticeOutcomeCode)
    && typeof value.feedbackId === 'string' && FEEDBACK_IDS.includes(value.feedbackId as JusticeFeedbackId)
}

export function createJusticePracticeService(ctx: RouteContext) {
  function current(request: RouteRequest, cityUnknown: unknown): Promise<PublicResult> {
    const cityId = cityOf(ctx, cityUnknown)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    if (cityId !== CITY) throw ctx.fail(409, 'justice_practice_scenario_unavailable')
    return ctx.store.transact(db => {
      const { session } = access(ctx, db, request, cityId)
      const rowMap = rowsForRead(db)
      if (rowMap === false) return response(null, 'justice_practice_storage_unavailable', false)
      const row = readRow(rowMap, session.publicId)
      if (row === false) return response(null, 'invalid_saved_justice_practice', false)
      if (!row) return response(null, 'practice_ready', true)
      const mismatch = ownership(row, session, cityId)
      if (mismatch) return response(null, mismatch, false)
      const now = ctx.now()
      if (!safeTime(now) || now < row.updatedAt) return response(null, 'invalid_server_clock', false)
      return response(row, row.practice.phase === 'complete' ? 'practice_complete' : 'practice_loaded', true)
    })
  }

  function start(request: RouteRequest, value: unknown): Promise<PublicResult> {
    if (!startBody(value)) throw ctx.fail(400, 'invalid_justice_practice_request')
    const cityId = cityOf(ctx, value.cityId)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    if (cityId !== CITY) throw ctx.fail(409, 'justice_practice_scenario_unavailable')
    const receiptAt = ctx.onceId(value.requestId)
    return ctx.store.transact(db => {
      const { session } = access(ctx, db, request, cityId), rows = rowsForWrite(ctx, db)
      const result = ctx.once(db, session, {
        id: value.requestId, kind: 'living-world.justice-practice.start',
        fingerprint: { cityId, account: session.account ?? null, caseId: CASE_ID },
      }, () => {
        const now = ctx.now()
        if (!safeTime(now) || !safeTime(receiptAt)) return { ok: false, code: 'invalid_server_clock' }
        const existing = readRow(rows, session.publicId)
        if (existing === false) return { ok: false, code: 'invalid_saved_justice_practice' }
        if (existing) {
          const mismatch = ownership(existing, session, cityId)
          return { ok: false, code: mismatch ?? 'practice_retained' }
        }
        if (countRows(rows) >= MAX_ROWS) return { ok: false, code: 'justice_practice_capacity' }
        const practice = createJusticePractice()
        const row: JusticePracticeRecord = { v: 1, publicId: session.publicId, account: session.account ?? null,
          cityId, caseId: CASE_ID, createdAt: now, updatedAt: now, practice }
        putRow(rows, row, ctx)
        return { ok: true, code: 'practice_started', revision: practice.revision }
      })
      const row = readRow(rows, session.publicId)
      if (row === false) return response(null, 'invalid_saved_justice_practice', false)
      if (!row) return response(null, String(result.code ?? 'practice_refused'), result.ok === true, { duplicate: 'duplicate' in result && result.duplicate === true })
      const mismatch = ownership(row, session, cityId)
      if (mismatch) return response(null, mismatch, false)
      const now = ctx.now()
      if (!safeTime(now) || now < row.updatedAt) return response(null, 'invalid_server_clock', false)
      if (result.ok !== true) return response(row, String(result.code ?? 'practice_retained'), false, { duplicate: 'duplicate' in result && result.duplicate === true })
      return response(row, String(result.code ?? 'practice_started'), true, { duplicate: 'duplicate' in result && result.duplicate === true })
    })
  }

  function step(request: RouteRequest, value: unknown): Promise<PublicResult> {
    const body = stepBody(value)
    if (!body) throw ctx.fail(400, 'invalid_justice_practice_request')
    const cityId = cityOf(ctx, body.cityId)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    if (cityId !== CITY) throw ctx.fail(409, 'justice_practice_scenario_unavailable')
    ctx.onceId(body.requestId)
    const normalizedAction = body.action
    return ctx.store.transact(db => {
      const { session } = access(ctx, db, request, cityId), rows = rowsForWrite(ctx, db)
      const result = ctx.once(db, session, {
        id: body.requestId, kind: 'living-world.justice-practice.step',
        fingerprint: { cityId, account: session.account ?? null, caseId: CASE_ID, expectedRevision: body.expectedRevision, action: normalizedAction },
      }, () => {
        const row = readRow(rows, session.publicId), now = ctx.now()
        if (row === false) return { ok: false, code: 'invalid_saved_justice_practice' }
        if (!row) return { ok: false, code: 'practice_not_started' }
        const mismatch = ownership(row, session, cityId)
        if (mismatch) return { ok: false, code: mismatch }
        if (!safeTime(now) || now < row.updatedAt) return { ok: false, code: 'invalid_server_clock' }
        const applied = applyJusticePractice(row.practice, { requestId: body.requestId, expectedRevision: body.expectedRevision, action: normalizedAction })
        if (!validOutcome(applied.outcome)) return { ok: false, code: 'invalid_practice_outcome' }
        if (applied.state.phase === row.practice.phase && applied.state.revision === row.practice.revision
          && applied.state.receipts.length === row.practice.receipts.length) {
          return { ok: false, code: applied.outcome.code, feedbackId: applied.outcome.feedbackId,
            revision: applied.outcome.revision }
        }
        const next: JusticePracticeRecord = { ...row, updatedAt: now, practice: applied.state }
        putRow(rows, next, ctx)
        const accepted = applied.outcome.code === 'advanced' || applied.outcome.code === 'feedback' || applied.outcome.code === 'complete'
        return { ok: accepted, code: applied.outcome.code, feedbackId: applied.outcome.feedbackId, revision: applied.outcome.revision }
      })
      const row = readRow(rows, session.publicId)
      if (row === false) return response(null, 'invalid_saved_justice_practice', false)
      if (!row) return response(null, String(result.code ?? 'practice_not_started'), result.ok === true,
        { duplicate: 'duplicate' in result && result.duplicate === true,
          ...(typeof result.feedbackId === 'string' && FEEDBACK_IDS.includes(result.feedbackId as JusticeFeedbackId)
            ? { feedback: justicePracticeFeedback(result.feedbackId as JusticeFeedbackId) } : {}) })
      const mismatch = ownership(row, session, cityId)
      if (mismatch) return response(null, mismatch, false)
      const now = ctx.now()
      if (!safeTime(now) || now < row.updatedAt) return response(null, 'invalid_server_clock', false)
      const feedback = typeof result.feedbackId === 'string' && FEEDBACK_IDS.includes(result.feedbackId as JusticeFeedbackId)
        ? justicePracticeFeedback(result.feedbackId as JusticeFeedbackId) : undefined
      const resultRevision = Number.isSafeInteger(result.revision) ? result.revision as number : null
      const accepted = result.ok === true && resultRevision !== null && row.practice.revision >= resultRevision
      return response(row, String(result.code ?? 'practice_refused'), accepted, {
        duplicate: 'duplicate' in result && result.duplicate === true,
        ...(feedback ? { feedback } : {}),
      })
    })
  }

  return { current, start, step }
}
