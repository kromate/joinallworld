/** Server authority for the non-allocating Lagos starter vehicle permission. */
import { characterCity } from '../character.ts'
import { emptyRentalState, earnStarterEntitlement, readValidatedRentalState, type RentalState } from '../../src/game/living-world/rental.ts'
import { PRACTICE_COURSE } from '../../src/game/living-world/course.ts'
import { readValidatedQualificationRecord } from './qualification-service.ts'
import { readDrivingQualificationEvidence } from './driving-service.ts'
import type { StarterRentalResponse } from '../../src/types/living-world.ts'
import type { CityId } from '../../src/types/protocol.ts'
import type { Db, RouteContext, RouteRequest, SessionRecord } from '../types.ts'

const RESOURCE_ID = 'marina-starter-sedan'
const QUALIFICATION_ID = 'district-driving'
const MAX_ROWS = 1024
const MAX_RECORD_BYTES = 4096
const MAX_TIME = Number.MAX_SAFE_INTEGER
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[\w:-]{1,100}$/.test(value)
const safeTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object'
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Reflect.ownKeys(value)
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key))
}

type RentalCollection = Record<string, unknown> & { rentals?: Record<string, unknown> }

/** Strict reader: corrupt/future rows are quarantined unchanged rather than repaired or restarted. */
export function readValidatedStarterRentalRecord(value: unknown, publicId: string): RentalState | null {
  if (!identifier(publicId)) return null
  const state = readValidatedRentalState(value)
  if (!state || state.revision < 1 || state.generation !== 0 || state.trip !== null || !state.entitlement
    || state.entitlement.actor !== publicId || state.entitlement.resourceId !== RESOURCE_ID
    || state.entitlement.scope !== 'district-driving' || state.entitlement.qualificationId !== QUALIFICATION_ID
    || state.entitlement.qualificationVersion !== 1) return null
  try { if (JSON.stringify(state).length > MAX_RECORD_BYTES) return null } catch { return null }
  return state
}

function cityOf(ctx: RouteContext, value: unknown): CityId | null {
  return typeof value === 'string' && ctx.cityIds.some(city => city === value) ? value as CityId : null
}
function collection(ctx: RouteContext, db: Db): Record<string, unknown> {
  const raw = ctx.collection(db, 'livingWorld', { rentals: {} })
  if (!isRecord(raw)) throw ctx.fail(503, 'rental_storage_unavailable')
  const root = raw as RentalCollection
  if (!Object.hasOwn(root, 'rentals')) root.rentals = {}
  if (!isRecord(root.rentals)) throw ctx.fail(503, 'rental_storage_unavailable')
  return root.rentals
}
function countRows(rows: Record<string, unknown>): number {
  let count = 0
  for (const key in rows) if (Object.hasOwn(rows, key) && ++count > MAX_ROWS) return count
  return count
}
function readRow(rows: Record<string, unknown>, publicId: string): RentalState | null | false {
  if (!Object.hasOwn(rows, publicId)) return null
  return readValidatedStarterRentalRecord(rows[publicId], publicId) ?? false
}
function qualification(db: Db, publicId: string, cityId: CityId, now: number) {
  const root = db.livingWorld
  if (root === undefined) return null
  if (!isRecord(root) || !Object.hasOwn(root, 'qualifications') || !isRecord(root.qualifications)
    || !Object.hasOwn(root.qualifications, publicId)) return null
  const saved = readValidatedQualificationRecord(root.qualifications[publicId], publicId)
  if (!saved || saved.qualification.status !== 'active' || saved.qualification.id !== QUALIFICATION_ID || saved.qualification.version !== 1
    || saved.courseId !== PRACTICE_COURSE.id || saved.courseVersion !== PRACTICE_COURSE.version || saved.cityId !== cityId) return null
  const evidence = readDrivingQualificationEvidence(db, publicId)
  if (!evidence || evidence.journeyId !== saved.qualification.evidenceJourneyId
    || evidence.cityId !== cityId || evidence.routeId !== PRACTICE_COURSE.id
    || evidence.routeVersion !== PRACTICE_COURSE.version || evidence.earnedAt !== saved.qualification.earnedAt
    || !safeTime(evidence.earnedAt) || evidence.earnedAt > now) return null
  return saved
}
function response(code: string, permission: StarterRentalResponse['permission'], revision: number | null, eligible: boolean, valid: boolean, duplicate = false): StarterRentalResponse {
  const ok = code === 'permission_issued' || code === 'duplicate' || code === 'eligible' || (code === 'permission_retained' && valid)
  return { ok, code,
    reason: 'The mapped driving route is not available yet; no car has been allocated.', ...(duplicate ? { duplicate: true } : {}), permission, revision,
    eligible, valid, tripAvailable: false, allocation: 'none' }
}

export function createStarterRentalService(ctx: RouteContext) {
  function access(db: Db, request: RouteRequest, cityId: CityId): { session: SessionRecord; location: string } {
    const session = request.requireSession(db, { renew: true })
    if (!ctx.allow(`living-world:rental:${session.publicId}`, 60, 60_000)) throw ctx.fail(429, 'rate_limited')
    ctx.checks?.cityGate?.(session, cityId)
    if (characterCity(session) !== cityId) throw ctx.fail(409, 'city_moved')
    const life = ctx.settle(session, cityId)
    if (life.onboarding.required) throw ctx.fail(403, 'onboarding_required')
    if (life.activeAction !== null) throw ctx.fail(409, 'busy')
    if (!identifier(life.location)) throw ctx.fail(409, 'driving_location_unavailable')
    return { session, location: life.location }
  }

  function current(request: RouteRequest, cityUnknown: unknown): Promise<StarterRentalResponse> {
    const cityId = cityOf(ctx, cityUnknown)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    if (cityId !== 'lagos') throw ctx.fail(409, 'starter_city_unavailable')
    return ctx.store.transact(db => {
      const { session } = access(db, request, cityId)
      const rows = collection(ctx, db), stored = readRow(rows, session.publicId)
      if (stored === false) return response('invalid_saved_rental', null, null, false, false)
      const now = ctx.now()
      if (!safeTime(now)) return response('invalid_server_clock', stored?.entitlement ?? null, stored?.revision ?? null, false, false)
      const qualified = qualification(db, session.publicId, cityId, now)
      const entitlement = stored?.entitlement ?? null
      const valid = Boolean(entitlement && entitlement.status === 'active' && qualified && entitlement.issuedAt <= now
        && entitlement.qualificationId === qualified.qualification.id && entitlement.qualificationVersion === qualified.qualification.version)
      const code = valid ? 'permission_retained' : entitlement?.status === 'revoked' ? 'permission_revoked' : qualified && !entitlement ? 'eligible' : 'qualification_required'
      return response(code, entitlement, stored?.revision ?? null, Boolean(qualified && !entitlement), valid)
    })
  }

  function claim(request: RouteRequest, body: unknown): Promise<StarterRentalResponse> {
    if (!isRecord(body) || !exactKeys(body, ['cityId', 'requestId', 'qualificationJourneyId', 'qualificationVersion'])
      || typeof body.cityId !== 'string' || !identifier(body.requestId) || !identifier(body.qualificationJourneyId)
      || !Number.isSafeInteger(body.qualificationVersion) || (body.qualificationVersion as number) < 1) throw ctx.fail(400, 'invalid_rental_request')
    const cityId = cityOf(ctx, body.cityId)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    if (cityId !== 'lagos') throw ctx.fail(409, 'starter_city_unavailable')
    const receiptAt = ctx.onceId(body.requestId)
    return ctx.store.transact(db => {
      const { session, location } = access(db, request, cityId)
      const rows = collection(ctx, db)
      const receipt = ctx.once(db, session, { id: body.requestId as string, kind: 'living-world.rental.claim',
        fingerprint: { cityId, qualificationJourneyId: body.qualificationJourneyId, qualificationVersion: body.qualificationVersion, location } }, () => {
        const now = ctx.now()
        if (!safeTime(now) || !safeTime(receiptAt)) return { ok: false, code: 'invalid_server_clock' }
        const stored = readRow(rows, session.publicId)
        if (stored === false) return { ok: false, code: 'invalid_saved_rental' }
        if (stored?.entitlement) return { ok: false, code: stored.entitlement.status === 'active' ? 'permission_retained' : 'permission_revoked' }
        if (countRows(rows) >= MAX_ROWS) return { ok: false, code: 'rental_capacity' }
        const qualified = qualification(db, session.publicId, cityId, now)
        if (!qualified) return { ok: false, code: 'qualification_required' }
        if (qualified.qualification.evidenceJourneyId !== body.qualificationJourneyId
          || qualified.qualification.version !== body.qualificationVersion) return { ok: false, code: 'qualification_mismatch' }
        const state = stored ?? emptyRentalState()
        // `resourceAvailable` means this authored catalogue permission may be issued; no physical fleet allocation is implied.
        const earned = earnStarterEntitlement(state, {
          actor: session.publicId, resourceId: RESOURCE_ID, custodyPointId: 'marina-fictional-depot',
          qualification: { id: qualified.qualification.id, version: qualified.qualification.version, status: qualified.qualification.status },
          resourceAvailable: true, at: now,
        })
        if (!earned.ok || earned.code !== 'entitlement_earned') return { ok: false, code: earned.code }
        if (JSON.stringify(earned.state).length > MAX_RECORD_BYTES) return { ok: false, code: 'rental_record_too_large' }
        Object.defineProperty(rows, session.publicId, { value: earned.state, enumerable: true, configurable: true, writable: true })
        return { ok: true, code: 'permission_issued' }
      })
      const stored = readRow(rows, session.publicId)
      if (stored === false) return response('invalid_saved_rental', null, null, false, false, 'duplicate' in receipt && receipt.duplicate === true)
      if (receipt.ok !== true) {
        const entitlement = stored?.entitlement ?? null
        if (receipt.code === 'permission_retained' && entitlement?.status === 'active') {
          const now = ctx.now()
          if (!safeTime(now)) return response('invalid_server_clock', entitlement, stored!.revision, false, false)
          const qualified = qualification(db, session.publicId, cityId, now)
          if (!qualified) return response('qualification_required', entitlement, stored!.revision, false, false)
          if (qualified.qualification.evidenceJourneyId !== body.qualificationJourneyId || qualified.qualification.version !== body.qualificationVersion)
            return response('qualification_mismatch', entitlement, stored!.revision, false, false)
          const valid = Boolean(qualified && entitlement.issuedAt <= now
            && entitlement.qualificationId === qualified.qualification.id && entitlement.qualificationVersion === qualified.qualification.version
            && qualified.qualification.evidenceJourneyId === body.qualificationJourneyId && qualified.qualification.version === body.qualificationVersion)
          if (valid) return response('permission_retained', entitlement, stored!.revision, false, true, 'duplicate' in receipt && receipt.duplicate === true)
          return response('receipt_superseded', entitlement, stored!.revision, false, false)
        }
        return response(String(receipt.code ?? 'permission_refused'), entitlement, stored?.revision ?? null,
          false, false, 'duplicate' in receipt && receipt.duplicate === true)
      }
      const now = ctx.now(), qualified = safeTime(now) ? qualification(db, session.publicId, cityId, now) : null
      const entitlement = stored?.entitlement ?? null
      const valid = Boolean(entitlement && entitlement.status === 'active' && qualified && entitlement.issuedAt <= now
        && entitlement.qualificationId === qualified.qualification.id && entitlement.qualificationVersion === qualified.qualification.version
        && qualified.qualification.evidenceJourneyId === body.qualificationJourneyId && qualified.qualification.version === body.qualificationVersion)
      if (!valid) return response('receipt_superseded', entitlement, stored?.revision ?? null, false, false, true)
      return response(String(receipt.code ?? 'permission_issued'), entitlement, stored!.revision, false, true,
        'duplicate' in receipt && receipt.duplicate === true)
    })
  }

  return { current, claim }
}

export type { StarterRentalClaimRequest, StarterRentalResponse } from '../../src/types/living-world.ts'
