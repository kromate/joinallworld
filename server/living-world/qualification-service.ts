/** Server authority for claiming a simulated qualification from retained driving evidence. */
import { characterCity } from '../character.ts'
import { awardQualification, type Qualification } from '../../src/game/living-world/journey.ts'
import { PRACTICE_COURSE } from '../../src/game/living-world/course.ts'
import type { QualificationClaimRequest, QualificationResponse } from '../../src/types/living-world.ts'
import type { CityId } from '../../src/types/protocol.ts'
import type { Db, RouteContext, RouteRequest, SessionRecord } from '../types.ts'

export type { QualificationClaimRequest, QualificationResponse } from '../../src/types/living-world.ts'

const QUALIFICATION_ID = 'district-driving'
const QUALIFICATION_VERSION = 1
const MAX_ROWS = 1024
const MAX_RECORD_BYTES = 4096
const MAX_TIME = Number.MAX_SAFE_INTEGER
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const safeTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 100 && /^[\w:-]+$/.test(value)
const utf8Size = (value: string): number => new TextEncoder().encode(value).byteLength

export interface DrivingEvidence {
  journeyId: string
  cityId: CityId
  location: string
  routeId: string
  routeVersion: string
  earnedAt: number
}
export type ReadDrivingEvidence = (db: Db, publicId: string) => DrivingEvidence | null | false
export interface QualificationRecord {
  v: 1
  publicId: string
  qualification: Qualification
  courseId: string
  courseVersion: string
  cityId: CityId
}
type QualificationCollection = Record<string, unknown> & { qualifications?: Record<string, unknown> }

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Reflect.ownKeys(value)
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key))
}
function cityOf(ctx: RouteContext, value: unknown): CityId | null {
  return typeof value === 'string' && ctx.cityIds.some(city => city === value) ? value as CityId : null
}
function recordBytes(value: unknown): number | null {
  try { return utf8Size(JSON.stringify(value)) } catch { return null }
}
function savedRecord(value: unknown, publicId: string): QualificationRecord | null {
  if (!isRecord(value) || !exactKeys(value, ['v', 'publicId', 'qualification', 'courseId', 'courseVersion', 'cityId'])
    || value.v !== 1 || value.publicId !== publicId || !identifier(value.courseId)
    || typeof value.courseVersion !== 'string' || value.courseVersion.length < 1 || value.courseVersion.length > 80
    || typeof value.cityId !== 'string' || !isRecord(value.qualification)
    || !exactKeys(value.qualification, ['id', 'version', 'evidenceJourneyId', 'earnedAt', 'status'])
    || value.qualification.id !== QUALIFICATION_ID || value.qualification.version !== QUALIFICATION_VERSION
    || !identifier(value.qualification.evidenceJourneyId) || !safeTime(value.qualification.earnedAt)
    || (value.qualification.status !== 'active' && value.qualification.status !== 'revoked')) return null
  if (recordBytes(value) === null || recordBytes(value)! > MAX_RECORD_BYTES) return null
  return {
    v: 1,
    publicId,
    qualification: {
      id: QUALIFICATION_ID,
      version: QUALIFICATION_VERSION,
      evidenceJourneyId: value.qualification.evidenceJourneyId,
      earnedAt: value.qualification.earnedAt,
      status: value.qualification.status as Qualification['status'],
    },
    courseId: value.courseId,
    courseVersion: value.courseVersion,
    cityId: value.cityId as CityId,
  }
}
export { savedRecord as readValidatedQualificationRecord }
function collection(ctx: RouteContext, db: Db): Record<string, unknown> {
  const raw = ctx.collection(db, 'livingWorld', { qualifications: {} })
  if (!isRecord(raw)) throw ctx.fail(503, 'qualification_storage_unavailable')
  const root = raw as QualificationCollection
  if (!Object.hasOwn(root, 'qualifications')) root.qualifications = {}
  if (!isRecord(root.qualifications)) throw ctx.fail(503, 'qualification_storage_unavailable')
  return root.qualifications
}
function countRows(rows: Record<string, unknown>): number {
  let count = 0
  for (const key in rows) if (Object.hasOwn(rows, key) && ++count > MAX_ROWS) return count
  return count
}
function response(code: string, ok: boolean, qualification: Qualification | null, valid: boolean, duplicate = false, reason?: string): QualificationResponse {
  return { ok, code, ...(reason ? { reason } : {}), ...(duplicate ? { duplicate: true } : {}), qualification, valid }
}

export function createQualificationService(ctx: RouteContext, readEvidence: ReadDrivingEvidence) {
  function access(db: Db, request: RouteRequest, cityId: CityId): { session: SessionRecord; location: string } {
    const session = request.requireSession(db, { renew: true })
    if (!ctx.allow(`living-world:qualification:${session.publicId}`, 60, 60_000)) throw ctx.fail(429, 'rate_limited')
    ctx.checks?.cityGate?.(session, cityId)
    if (characterCity(session) !== cityId) throw ctx.fail(409, 'city_moved')
    const life = ctx.settle(session, cityId)
    if (life.onboarding.required) throw ctx.fail(403, 'onboarding_required')
    if (life.activeAction !== null) throw ctx.fail(409, 'busy')
    if (!identifier(life.location)) throw ctx.fail(409, 'driving_location_unavailable')
    return { session, location: life.location }
  }

  function stored(rows: Record<string, unknown>, publicId: string): QualificationRecord | null | false {
    if (!Object.hasOwn(rows, publicId)) return null
    return savedRecord(rows[publicId], publicId) ?? false
  }

  function evidenceMatches(row: QualificationRecord, evidence: DrivingEvidence | null | false): boolean {
    return evidence !== null && evidence !== false
      && evidence.journeyId === row.qualification.evidenceJourneyId
      && evidence.cityId === row.cityId
      && evidence.routeId === row.courseId && evidence.routeVersion === row.courseVersion
      && evidence.earnedAt === row.qualification.earnedAt
  }

  function current(request: RouteRequest, cityUnknown: unknown): Promise<QualificationResponse> {
    const cityId = cityOf(ctx, cityUnknown)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    return ctx.store.transact(db => {
      const { session, location } = access(db, request, cityId)
      const rows = collection(ctx, db), found = stored(rows, session.publicId)
      if (found === false) return response('invalid_saved_qualification', false, null, false, false, 'Saved qualification data is invalid and has been kept for recovery.')
      const evidence = readEvidence(db, session.publicId)
      if (evidence === false) return response('assessment_unavailable', false, found?.qualification ?? null, false, false, 'Driving evidence is invalid or quarantined; no qualification state was changed.')
      if (!found) {
        if (evidence && identifier(evidence.journeyId) && evidence.location === location && safeTime(evidence.earnedAt)
          && evidence.earnedAt <= ctx.now() && evidence.routeId === PRACTICE_COURSE.id
          && evidence.routeVersion === PRACTICE_COURSE.version && evidence.cityId === cityId) return response('claim_available', true, null, false)
        return response('not_qualified', true, null, false)
      }
      const valid = found.qualification.status === 'active' && found.courseId === PRACTICE_COURSE.id
        && found.courseVersion === PRACTICE_COURSE.version && evidenceMatches(found, evidence)
      return response(valid ? 'qualified' : 'reassessment_required', true, found.qualification, valid)
    })
  }

  function claim(request: RouteRequest, body: unknown): Promise<QualificationResponse> {
    if (!isRecord(body) || !exactKeys(body, ['cityId', 'requestId', 'journeyId'])
      || typeof body.cityId !== 'string' || !identifier(body.requestId) || !identifier(body.journeyId)) throw ctx.fail(400, 'invalid_qualification_request')
    const cityId = cityOf(ctx, body.cityId)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    const receiptAt = ctx.onceId(body.requestId)
    return ctx.store.transact(db => {
      const { session, location } = access(db, request, cityId)
      const rows = collection(ctx, db)
      const result = ctx.once(db, session, {
        id: body.requestId as string,
        kind: 'living-world.qualification.claim',
        fingerprint: { cityId, journeyId: body.journeyId },
      }, () => {
        const now = ctx.now()
        if (!safeTime(now) || !safeTime(receiptAt)) return { ok: false, code: 'invalid_server_clock' }
        const found = stored(rows, session.publicId)
        if (found === false) return { ok: false, code: 'invalid_saved_qualification' }
        if (found) return { ok: false, code: found.qualification.status === 'active' ? 'qualification_retained' : 'qualification_revoked' }
        if (countRows(rows) >= MAX_ROWS) return { ok: false, code: 'qualification_capacity' }
        const evidence = readEvidence(db, session.publicId)
        if (evidence === false) return { ok: false, code: 'assessment_unavailable' }
        if (!evidence) return { ok: false, code: 'assessment_required' }
        if (evidence.journeyId !== body.journeyId) return { ok: false, code: 'assessment_mismatch' }
        if (evidence.cityId !== cityId || evidence.location !== location) return { ok: false, code: 'assessment_location_changed' }
        if (evidence.routeId !== PRACTICE_COURSE.id || evidence.routeVersion !== PRACTICE_COURSE.version) return { ok: false, code: 'reassessment_required' }
        if (!safeTime(evidence.earnedAt) || evidence.earnedAt > now) return { ok: false, code: 'invalid_assessment_time' }
        const awarded = awardQualification({ qualifications: {}, permissions: {}, deliveries: {} }, {
          id: QUALIFICATION_ID, version: QUALIFICATION_VERSION, evidenceJourneyId: evidence.journeyId, earnedAt: evidence.earnedAt,
        })
        if (!awarded.ok || awarded.code !== 'qualified') return { ok: false, code: awarded.code }
        const record: QualificationRecord = {
          v: 1, publicId: session.publicId, qualification: awarded.state.qualifications[QUALIFICATION_ID]!,
          courseId: PRACTICE_COURSE.id, courseVersion: PRACTICE_COURSE.version, cityId,
        }
        if (recordBytes(record) === null || recordBytes(record)! > MAX_RECORD_BYTES) return { ok: false, code: 'qualification_record_too_large' }
        Object.defineProperty(rows, session.publicId, { value: record, enumerable: true, configurable: true, writable: true })
        return { ok: true, code: 'qualified', qualification: record.qualification, valid: true }
      })
      const found = stored(rows, session.publicId)
      if (found === false) return response('invalid_saved_qualification', false, null, false, 'duplicate' in result && result.duplicate === true)
      if (result.ok !== true) return response(String(result.code ?? 'qualification_refused'), false, found?.qualification ?? null, false, 'duplicate' in result && result.duplicate === true)
      const latestEvidence = readEvidence(db, session.publicId)
      const valid = Boolean(found && found.qualification.evidenceJourneyId === body.journeyId
        && found.courseId === PRACTICE_COURSE.id && found.courseVersion === PRACTICE_COURSE.version
        && found.qualification.status === 'active' && evidenceMatches(found, latestEvidence))
      if (!valid) return response('qualification_receipt_superseded', false, found?.qualification ?? null, false, true)
      return response(String(result.code ?? 'qualified'), true, found!.qualification, true, 'duplicate' in result && result.duplicate === true)
    })
  }

  return { current, claim }
}
