/**
 * Pure rental-permission foundation. Caller evidence is trusted server input, never browser proof.
 * It records a stable starter entitlement separately from one finite vehicle-use lease; it grants
 * neither vehicle ownership nor any wallet/collateral effect. No route or storage wiring lives here.
 */
export const STARTER_TRIP_LEASE_MS = 30 * 60_000
export const MAX_RENTAL_RECORD_BYTES = 4096
const MAX_TIME = Number.MAX_SAFE_INTEGER
const SCOPE = 'district-driving'

export type RentalRecoveryReason = 'lease_expired' | 'qualification_revoked' | 'qualification_changed' | 'resource_unavailable' | 'route_changed' | 'entitlement_revoked'
export interface StarterEntitlement {
  actor: string; resourceId: string; scope: typeof SCOPE
  qualificationId: string; qualificationVersion: number; issuedAt: number; status: 'active' | 'revoked'
}
export interface RentalTrip {
  id: string; generation: number; startRequestId: string; startRevision: number; startFingerprint: string
  actor: string; resourceId: string; custodyPointId: string; scope: typeof SCOPE
  cityId: string; routeId: string; routeVersion: string
  qualificationId: string; qualificationVersion: number
  startedAt: number; expiresAt: number; status: 'active' | 'recovery' | 'returned'; custody: 'renter' | 'depot'
  recoveryReason?: RentalRecoveryReason; returnedAt?: number
}
export interface RentalState { version: 1; revision: number; generation: number; entitlement: StarterEntitlement | null; trip: RentalTrip | null }
export type RentalResult = { ok: true; code: string; state: RentalState } | { ok: false; code: string; state: RentalState }

export interface TrustedRentalQualification { id: string; version: number; status: 'active' | 'revoked' }
/** Construct these records only from the current server qualification and authoritative resource/course readers. */
export interface TrustedStarterEvidence {
  actor: string; resourceId: string; custodyPointId: string; qualification: TrustedRentalQualification
  resourceAvailable: boolean; at: number
}
export interface TrustedTripEvidence extends TrustedStarterEvidence {
  cityId: string; routeId: string; routeVersion: string
}

const obj = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  try { const prototype = Object.getPrototypeOf(v); return prototype === Object.prototype || prototype === null } catch { return false }
}
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/.test(v)
const time = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= MAX_TIME
const whole = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && (v as number) >= min && (v as number) <= MAX_TIME
const own = <T>(value: Record<string, T>, key: string): T | undefined => Object.hasOwn(value, key) ? value[key] : undefined
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Reflect.ownKeys(value)
  return actual.length === keys.length && actual.every(key => typeof key === 'string' && keys.includes(key))
}
const fail = (state: RentalState, code: string): RentalResult => ({ ok: false, code, state })
const copy = (state: RentalState): RentalState => ({ ...state, entitlement: state.entitlement ? { ...state.entitlement } : null, trip: state.trip ? { ...state.trip } : null })
export const emptyRentalState = (): RentalState => ({ version: 1, revision: 0, generation: 0, entitlement: null, trip: null })

/** Strict non-stepping reader. Invalid or future source returns null so storage callers can quarantine it unchanged. */
export function readValidatedRentalState(value: unknown): RentalState | null {
  try {
  if (!obj(value) || !exact(value, ['version', 'revision', 'generation', 'entitlement', 'trip']) || value.version !== 1 || !whole(value.revision) || !whole(value.generation) || value.generation > value.revision) return null
  let entitlement: StarterEntitlement | null = null, trip: RentalTrip | null = null
  const e = value.entitlement
  if (e !== null) {
    if (!obj(e) || !exact(e, ['actor', 'resourceId', 'scope', 'qualificationId', 'qualificationVersion', 'issuedAt', 'status'])
      || !id(e.actor) || !id(e.resourceId) || e.scope !== SCOPE || !id(e.qualificationId) || !whole(e.qualificationVersion, 1)
      || !time(e.issuedAt) || (e.status !== 'active' && e.status !== 'revoked')) return null
    entitlement = { actor: e.actor, resourceId: e.resourceId, scope: SCOPE, qualificationId: e.qualificationId, qualificationVersion: e.qualificationVersion, issuedAt: e.issuedAt, status: e.status }
  }
  const t = value.trip
  if (t !== null) {
    const keys = ['id', 'generation', 'startRequestId', 'startRevision', 'startFingerprint', 'actor', 'resourceId', 'custodyPointId', 'scope', 'cityId', 'routeId', 'routeVersion', 'qualificationId', 'qualificationVersion', 'startedAt', 'expiresAt', 'status', 'custody']
    if (!obj(t) || (t.status === 'active' && !exact(t, keys))
      || (t.status === 'recovery' && !exact(t, [...keys, 'recoveryReason']))
      || (t.status === 'returned' && !exact(t, [...keys, 'returnedAt']))
      || typeof t.status !== 'string' || !['active', 'recovery', 'returned'].includes(t.status)
      || !id(t.id) || !whole(t.generation, 1) || t.generation !== value.generation || !id(t.startRequestId) || !whole(t.startRevision, 1) || t.startRevision >= value.revision
      || typeof t.startFingerprint !== 'string' || t.startFingerprint.length < 8 || t.startFingerprint.length > 1200
      || !id(t.actor) || !id(t.resourceId) || !id(t.custodyPointId) || t.scope !== SCOPE || !id(t.cityId) || !id(t.routeId) || !id(t.routeVersion)
      || !id(t.qualificationId) || !whole(t.qualificationVersion, 1) || !time(t.startedAt) || !time(t.expiresAt) || t.expiresAt <= t.startedAt
      || t.expiresAt - t.startedAt !== STARTER_TRIP_LEASE_MS
      || typeof t.custody !== 'string' || !['renter', 'depot'].includes(t.custody)) return null
    const status = t.status as RentalTrip['status'], custody = t.custody as RentalTrip['custody']
    if ((status === 'active' && (custody !== 'renter' || t.recoveryReason !== undefined || t.returnedAt !== undefined))
      || (status === 'recovery' && (custody !== 'renter' || typeof t.recoveryReason !== 'string' || !['lease_expired', 'qualification_revoked', 'qualification_changed', 'resource_unavailable', 'route_changed', 'entitlement_revoked'].includes(t.recoveryReason) || t.returnedAt !== undefined))
      || (status === 'returned' && (custody !== 'depot' || !time(t.returnedAt) || t.returnedAt < t.startedAt || t.recoveryReason !== undefined))) return null
    const expectedFingerprint = JSON.stringify([t.id, t.startRevision, t.generation - 1, t.actor, t.resourceId, t.cityId, t.routeId, t.routeVersion])
    if (t.startFingerprint !== expectedFingerprint || t.startedAt < (entitlement?.issuedAt ?? MAX_TIME)) return null
    trip = { id: t.id, generation: t.generation, startRequestId: t.startRequestId, startRevision: t.startRevision, startFingerprint: t.startFingerprint, actor: t.actor, resourceId: t.resourceId, custodyPointId: t.custodyPointId, scope: SCOPE, cityId: t.cityId, routeId: t.routeId, routeVersion: t.routeVersion, qualificationId: t.qualificationId, qualificationVersion: t.qualificationVersion, startedAt: t.startedAt, expiresAt: t.expiresAt, status, custody, ...(status === 'recovery' ? { recoveryReason: t.recoveryReason as RentalRecoveryReason } : {}), ...(status === 'returned' ? { returnedAt: t.returnedAt as number } : {}) }
  }
  if ((trip && (!entitlement || trip.actor !== entitlement.actor || trip.resourceId !== entitlement.resourceId || trip.scope !== entitlement.scope || trip.qualificationId !== entitlement.qualificationId || (trip.status === 'active' && entitlement.status !== 'active')))
    || (value.generation === 0) !== (trip === null)) return null
  const validated: RentalState = { version: 1, revision: value.revision, generation: value.generation, entitlement, trip }
  // All retained strings are validated ASCII IDs, fixed literals, or the exact
  // fingerprint rebuilt from those IDs. JSON code-unit length equals UTF-8 bytes.
  if (JSON.stringify(validated).length > MAX_RENTAL_RECORD_BYTES) return null
  return validated
  } catch { return null }
}

/** A qualification earns one stable, non-expiring starter entitlement; no vehicle ownership or money is written. */
export function earnStarterEntitlement(state: RentalState, evidence: TrustedStarterEvidence): RentalResult {
  if (!validEvidence(evidence) || evidence.qualification.status !== 'active') return fail(state, 'qualification_required')
  if (!evidence.resourceAvailable) return fail(state, 'resource_unavailable')
  if (state.entitlement) return fail(state, state.entitlement.actor === evidence.actor && state.entitlement.resourceId === evidence.resourceId ? 'already_earned' : 'entitlement_exists')
  if (state.revision >= MAX_TIME) return fail(state, 'revision_exhausted')
  const next = copy(state); next.revision++
  next.entitlement = { actor: evidence.actor, resourceId: evidence.resourceId, scope: SCOPE, qualificationId: evidence.qualification.id, qualificationVersion: evidence.qualification.version, issuedAt: evidence.at, status: 'active' }
  return { ok: true, code: 'entitlement_earned', state: next }
}

/** Start one finite lease from exact current server evidence; `expected*` are CAS inputs. */
export function startRental(state: RentalState, input: { requestId: string; tripId: string; expectedRevision: number; expectedGeneration: number; actor: string; resourceId: string; cityId: string; routeId: string; routeVersion: string; at: number }, evidence: TrustedTripEvidence): RentalResult {
  if (!obj(input) || !exact(input, ['requestId', 'tripId', 'expectedRevision', 'expectedGeneration', 'actor', 'resourceId', 'cityId', 'routeId', 'routeVersion', 'at'])
    || !id(input.requestId) || !id(input.tripId) || !whole(input.expectedRevision) || !whole(input.expectedGeneration)
    || !id(input.actor) || !id(input.resourceId) || !id(input.cityId) || !id(input.routeId) || !id(input.routeVersion)) return fail(state, 'invalid_request')
  const fingerprint = JSON.stringify([input.tripId, input.expectedRevision, input.expectedGeneration, input.actor, input.resourceId, input.cityId, input.routeId, input.routeVersion])
  const prior = state.trip
  if (prior && prior.startRequestId === input.requestId) return prior.startFingerprint === fingerprint ? { ok: true, code: 'duplicate', state } : fail(state, 'request_conflict')
  if (input.expectedGeneration !== state.generation) return fail(state, 'generation_conflict')
  if (input.expectedRevision !== state.revision) return fail(state, 'version_conflict')
  if (!time(input.at) || input.at + STARTER_TRIP_LEASE_MS > MAX_TIME) return fail(state, 'invalid_time')
  if (!validEvidence(evidence) || !validTripEvidence(evidence) || evidence.qualification.status !== 'active' || !evidence.resourceAvailable || evidence.at !== input.at
    || evidence.actor !== input.actor || evidence.resourceId !== input.resourceId || evidence.cityId !== input.cityId || evidence.routeId !== input.routeId || evidence.routeVersion !== input.routeVersion) return fail(state, 'evidence_required')
  const entitlement = state.entitlement
  if (!entitlement || entitlement.status !== 'active' || entitlement.actor !== input.actor || entitlement.resourceId !== input.resourceId || entitlement.qualificationId !== evidence.qualification.id || input.at < entitlement.issuedAt) return fail(state, 'permission_required')
  if (prior && (prior.status !== 'returned' || prior.custody !== 'depot')) return fail(state, prior.status === 'recovery' ? 'recovery_required' : 'trip_active')
  if (state.revision >= MAX_TIME || state.generation >= MAX_TIME) return fail(state, 'state_exhausted')
  const next = copy(state); next.revision++; next.generation++
  next.trip = { id: input.tripId, generation: next.generation, startRequestId: input.requestId, startRevision: input.expectedRevision, startFingerprint: fingerprint,
    actor: input.actor, resourceId: input.resourceId, custodyPointId: evidence.custodyPointId, scope: SCOPE, cityId: input.cityId,
    routeId: input.routeId, routeVersion: input.routeVersion, qualificationId: evidence.qualification.id, qualificationVersion: evidence.qualification.version,
    startedAt: input.at, expiresAt: input.at + STARTER_TRIP_LEASE_MS, status: 'active', custody: 'renter' }
  return { ok: true, code: 'lease_started', state: next }
}

/** Revalidate before every consequential trip action; invalidation stops use but keeps vehicle custody for recovery. */
export function revalidateRental(state: RentalState, expectedRevision: number, at: number, evidence: TrustedTripEvidence): RentalResult {
  const trip = state.trip
  if (!whole(expectedRevision) || expectedRevision !== state.revision) return fail(state, 'version_conflict')
  if (!trip || trip.status !== 'active') return fail(state, trip?.status === 'recovery' ? 'recovery_required' : 'trip_terminal')
  if (!time(at) || at < trip.startedAt) return fail(state, 'invalid_time')
  const reason: RentalRecoveryReason | null = at >= trip.expiresAt ? 'lease_expired'
    : !validTripEvidence(evidence) || evidence.at !== at ? 'qualification_changed'
      : evidence.qualification.status !== 'active' ? 'qualification_revoked'
        : evidence.actor !== trip.actor || evidence.qualification.id !== trip.qualificationId || evidence.qualification.version !== trip.qualificationVersion ? 'qualification_changed'
          : !evidence.resourceAvailable || evidence.resourceId !== trip.resourceId ? 'resource_unavailable'
            : evidence.cityId !== trip.cityId || evidence.routeId !== trip.routeId || evidence.routeVersion !== trip.routeVersion ? 'route_changed' : null
  if (!reason) return { ok: true, code: 'lease_current', state }
  if (state.revision >= MAX_TIME) return fail(state, 'revision_exhausted')
  const next = copy(state); next.revision++
  next.trip = { ...trip, status: 'recovery', custody: 'renter', recoveryReason: reason }
  return { ok: true, code: 'recovery_required', state: next }
}

/** Explicit server-verified return closes custody; only this terminal transition permits a later rental. */
export function returnRental(state: RentalState, input: { requestId: string; tripId: string; expectedRevision: number; actor: string; at: number }, evidence: { verified: true; tripId: string; actor: string; resourceId: string; custodyPointId: string }): RentalResult {
  if (!obj(input) || !exact(input, ['requestId', 'tripId', 'expectedRevision', 'actor', 'at']) || !id(input.requestId) || !id(input.tripId) || !id(input.actor)) return fail(state, 'invalid_request')
  const trip = state.trip
  if (!trip || trip.id !== input.tripId || trip.actor !== input.actor) return fail(state, 'trip_missing')
  if (!id(input.requestId) || !whole(input.expectedRevision) || input.expectedRevision !== state.revision) return fail(state, 'version_conflict')
  if (trip.status !== 'active' && trip.status !== 'recovery') return fail(state, 'trip_terminal')
  if (!time(input.at) || input.at < trip.startedAt || !evidence || evidence.verified !== true || evidence.tripId !== trip.id || evidence.actor !== trip.actor || evidence.resourceId !== trip.resourceId || evidence.custodyPointId !== trip.custodyPointId) return fail(state, 'return_evidence_required')
  if (state.revision >= MAX_TIME) return fail(state, 'revision_exhausted')
  const next = copy(state); next.revision++
  next.trip = { ...trip, status: 'returned', custody: 'depot', returnedAt: input.at }
  delete next.trip.recoveryReason
  return { ok: true, code: 'returned', state: next }
}

/** Revocation stops an active lease immediately; the vehicle remains with its current custodian until verified recovery. */
export function revokeStarterEntitlement(state: RentalState, expectedRevision: number): RentalResult {
  const entitlement = state.entitlement
  if (!whole(expectedRevision) || expectedRevision !== state.revision) return fail(state, 'version_conflict')
  if (!entitlement) return fail(state, 'entitlement_missing')
  if (entitlement.status === 'revoked') return { ok: true, code: 'duplicate', state }
  if (state.revision >= MAX_TIME) return fail(state, 'revision_exhausted')
  const next = copy(state); next.revision++
  next.entitlement = { ...entitlement, status: 'revoked' }
  if (next.trip?.status === 'active') next.trip = { ...next.trip, status: 'recovery', custody: 'renter', recoveryReason: 'entitlement_revoked' }
  return { ok: true, code: next.trip?.status === 'recovery' ? 'recovery_required' : 'entitlement_revoked', state: next }
}

function validEvidence(value: unknown): value is TrustedStarterEvidence {
  return obj(value) && id(value.actor) && id(value.resourceId) && id(value.custodyPointId) && obj(value.qualification)
    && id(value.qualification.id) && whole(value.qualification.version, 1) && (value.qualification.status === 'active' || value.qualification.status === 'revoked')
    && typeof value.resourceAvailable === 'boolean' && time(value.at)
}
function validTripEvidence(value: unknown): value is TrustedTripEvidence {
  return obj(value) && id(value.cityId) && id(value.routeId) && id(value.routeVersion) && validEvidence(value)
}
