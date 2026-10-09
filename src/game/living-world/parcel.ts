/**
 * Pure, bounded parcel custody foundation. This is not registered gameplay or wallet/stock code.
 * Callers must build trip, stopped-pose, and recipient evidence from authoritative server data in
 * the same database transaction. Nothing in this module treats browser coordinates as proof.
 */
export const MAX_PARCEL_RECORD_BYTES = 4096
const MAX_SAFE = Number.MAX_SAFE_INTEGER
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/.test(value)
const integer = (value: unknown, min = 0): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= MAX_SAFE
const plain = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  try { const p = Object.getPrototypeOf(value); return p === Object.prototype || p === null } catch { return false }
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value)
  return actual.length === keys.length && actual.every(key => typeof key === 'string' && keys.includes(key))
}
const time = (value: unknown): value is number => integer(value)
const terminal = (status: ParcelStatus): boolean => status === 'delivered' || status === 'cancelled' || status === 'expired' || status === 'returned'

export type ParcelStatus = 'offered' | 'accepted' | 'collected' | 'recovery' | 'delivered' | 'cancelled' | 'expired' | 'returned'
export type ParcelRecoveryReason = 'lease_expired' | 'lease_revoked' | 'qualification_revoked' | 'qualification_changed' | 'route_changed' | 'parcel_expired' | 'cancelled_after_collection'
export interface ParcelRecord {
  id: string; generation: number; actor: string; tripId: string; resourceId: string
  qualificationId: string; qualificationVersion: number; cityId: string; routeId: string; routeVersion: string
  originId: string; destinationId: string; product: string; quantity: number; wage: number
  offeredAt: number; expiresAt: number; tripExpiresAt: number
  status: ParcelStatus; custody: 'supplier' | 'carrier' | 'destination'
  collectedAt?: number; terminalAt?: number; recoveryReason?: ParcelRecoveryReason
}
export interface ParcelState { version: 1; actor: string; revision: number; generation: number; lastAt: number; parcel: ParcelRecord | null }
export interface ParcelEffect {
  readonly parcelId: string; readonly generation: number
  readonly stockDelta: Readonly<{ shopId: string; product: string; quantity: number; expectedShopRevision: number }>
  readonly wage: number
}
export type ParcelResult = { ok: true; code: string; state: ParcelState; effect?: ParcelEffect } | { ok: false; code: string; state: ParcelState }

/** Build only for the authenticated server actor. */
export const emptyParcelState = (actor: string): ParcelState => ({ version: 1, actor, revision: 0, generation: 0, lastAt: 0, parcel: null })

/** Strict bounded reader: null means quarantine the original source unchanged; it never repairs or advances time. */
export function readValidatedParcelState(value: unknown): ParcelState | null {
  try {
    if (!plain(value) || !exact(value, ['version', 'actor', 'revision', 'generation', 'lastAt', 'parcel']) || value.version !== 1
      || !id(value.actor) || !integer(value.revision) || !integer(value.generation) || value.generation > value.revision || !time(value.lastAt)) return null
    let parcel: ParcelRecord | null = null
    const raw = value.parcel
    if (raw !== null) {
      const base = ['id', 'generation', 'actor', 'tripId', 'resourceId', 'qualificationId', 'qualificationVersion', 'cityId', 'routeId', 'routeVersion', 'originId', 'destinationId', 'product', 'quantity', 'wage', 'offeredAt', 'expiresAt', 'tripExpiresAt', 'status', 'custody']
      if (!plain(raw) || (raw.status === 'offered' && !exact(raw, base))
        || (raw.status === 'accepted' && !exact(raw, base))
        || (raw.status === 'collected' && !exact(raw, [...base, 'collectedAt']))
        || (raw.status === 'recovery' && !exact(raw, [...base, 'collectedAt', 'recoveryReason']))
        || (raw.status === 'delivered' && !exact(raw, [...base, 'collectedAt', 'terminalAt']))
        || (raw.status === 'returned' && !exact(raw, [...base, 'collectedAt', 'terminalAt']))
        || ((raw.status === 'cancelled' || raw.status === 'expired') && !exact(raw, [...base, 'terminalAt']))
        || typeof raw.status !== 'string' || !['offered', 'accepted', 'collected', 'recovery', 'delivered', 'cancelled', 'expired', 'returned'].includes(raw.status)
        || !id(raw.id) || !integer(raw.generation, 1) || raw.generation !== value.generation || raw.actor !== value.actor
        || !id(raw.tripId) || !id(raw.resourceId) || !id(raw.qualificationId) || !integer(raw.qualificationVersion, 1)
        || !id(raw.cityId) || !id(raw.routeId) || !id(raw.routeVersion) || !id(raw.originId) || !id(raw.destinationId) || raw.originId === raw.destinationId || !id(raw.product)
        || !integer(raw.quantity, 1) || raw.quantity > 10 || !integer(raw.wage) || raw.wage > 500
        || !time(raw.offeredAt) || !time(raw.expiresAt) || !time(raw.tripExpiresAt) || raw.expiresAt <= raw.offeredAt
        || raw.tripExpiresAt <= raw.offeredAt || raw.expiresAt > raw.tripExpiresAt
        || typeof raw.custody !== 'string' || !['supplier', 'carrier', 'destination'].includes(raw.custody)) return null
      const status = raw.status as ParcelStatus, custody = raw.custody as ParcelRecord['custody']
      const collectedAt = raw.collectedAt, terminalAt = raw.terminalAt, recoveryReason = raw.recoveryReason
      if ((status === 'offered' && (custody !== 'supplier' || collectedAt !== undefined || terminalAt !== undefined || recoveryReason !== undefined))
        || (status === 'accepted' && (custody !== 'supplier' || collectedAt !== undefined || terminalAt !== undefined || recoveryReason !== undefined))
        || (status === 'collected' && (custody !== 'carrier' || !time(collectedAt) || collectedAt < raw.offeredAt || collectedAt >= raw.expiresAt || collectedAt >= raw.tripExpiresAt || terminalAt !== undefined || recoveryReason !== undefined))
        || (status === 'recovery' && (custody !== 'carrier' || !time(collectedAt) || collectedAt < raw.offeredAt || collectedAt >= raw.expiresAt || collectedAt >= raw.tripExpiresAt || typeof recoveryReason !== 'string' || !['lease_expired', 'lease_revoked', 'qualification_revoked', 'qualification_changed', 'route_changed', 'parcel_expired', 'cancelled_after_collection'].includes(recoveryReason) || terminalAt !== undefined))
        || (status === 'delivered' && (custody !== 'destination' || !time(collectedAt) || collectedAt < raw.offeredAt || collectedAt >= raw.expiresAt || collectedAt >= raw.tripExpiresAt || !time(terminalAt) || terminalAt < collectedAt || terminalAt >= raw.expiresAt || terminalAt >= raw.tripExpiresAt || recoveryReason !== undefined))
        || (status === 'returned' && (custody !== 'supplier' || !time(collectedAt) || collectedAt < raw.offeredAt || collectedAt >= raw.expiresAt || collectedAt >= raw.tripExpiresAt || !time(terminalAt) || terminalAt < collectedAt || recoveryReason !== undefined))
        || (status === 'cancelled' && (custody !== 'supplier' || collectedAt !== undefined || !time(terminalAt) || terminalAt < raw.offeredAt || terminalAt >= raw.expiresAt || terminalAt >= raw.tripExpiresAt || recoveryReason !== undefined))
        || (status === 'expired' && (custody !== 'supplier' || collectedAt !== undefined || !time(terminalAt) || terminalAt < Math.min(raw.expiresAt, raw.tripExpiresAt) || recoveryReason !== undefined))) return null
      parcel = { id: raw.id, generation: raw.generation, actor: raw.actor as string, tripId: raw.tripId, resourceId: raw.resourceId,
        qualificationId: raw.qualificationId, qualificationVersion: raw.qualificationVersion, cityId: raw.cityId, routeId: raw.routeId, routeVersion: raw.routeVersion,
        originId: raw.originId, destinationId: raw.destinationId, product: raw.product, quantity: raw.quantity, wage: raw.wage,
        offeredAt: raw.offeredAt, expiresAt: raw.expiresAt, tripExpiresAt: raw.tripExpiresAt, status, custody,
        ...(status === 'collected' || status === 'recovery' || status === 'delivered' || status === 'returned' ? { collectedAt: collectedAt as number } : {}),
        ...(status === 'recovery' ? { recoveryReason: recoveryReason as ParcelRecoveryReason } : {}),
        ...(status === 'delivered' || status === 'cancelled' || status === 'expired' || status === 'returned' ? { terminalAt: terminalAt as number } : {}) }
    }
    if ((value.generation === 0) !== (parcel === null) || (!parcel && (value.revision !== 0 || value.lastAt !== 0))) return null
    if (parcel && (value.lastAt < (parcel.terminalAt ?? parcel.collectedAt ?? parcel.offeredAt)
      || ((parcel.status === 'offered' || parcel.status === 'accepted') && value.lastAt >= parcel.expiresAt))) return null
    const state: ParcelState = { version: 1, actor: value.actor, revision: value.revision, generation: value.generation, lastAt: value.lastAt, parcel }
    // Every canonical string above is an ASCII identifier, key, or enum literal, and numbers stringify as ASCII.
    // Therefore JSON's UTF-16 code-unit length is also its UTF-8 byte length for this validated record.
    if (JSON.stringify(state).length > MAX_PARCEL_RECORD_BYTES) return null
    return state
  } catch { return null }
}

/** Internal server evidence only; an adapter must read this from current rental/qualification/route rows in the caller transaction. */
export interface TrustedParcelTrip {
  actor: string; tripId: string; resourceId: string; qualificationId: string; qualificationVersion: number; qualificationStatus: 'active' | 'revoked'
  cityId: string; routeId: string; routeVersion: string; active: boolean; expiresAt: number; at: number
}
/** Internal server-derived stopped pose. Never accept this shape directly from a browser request. */
export interface TrustedParcelPose { actor: string; tripId: string; placeId: string; at: number; stopped: true; verified: true }
/** Snapshot of the mapped destination shop at its current revision, read in the settlement transaction. */
export interface TrustedParcelRecipient { shopId: string; product: string; revision: number; availableUnits: number; open: boolean }

const fail = (state: ParcelState, code: string): ParcelResult => ({ ok: false, code, state })
const clone = (state: ParcelState): ParcelState => ({ ...state, parcel: state.parcel ? { ...state.parcel } : null })
function expected(state: ParcelState, parcelId: string, revision: number, generation: number): ParcelResult | null {
  if (!readValidatedParcelState(state)) return fail(state, 'invalid_saved_parcel')
  if (!id(parcelId) || !integer(revision) || !integer(generation)) return fail(state, 'invalid_request')
  if (revision !== state.revision) return fail(state, 'revision_conflict')
  if (generation !== state.generation) return fail(state, 'generation_conflict')
  if (!state.parcel || state.parcel.id !== parcelId) return fail(state, 'parcel_missing')
  return null
}
function tripEvidence(parcel: ParcelRecord, trip: unknown, at: number): string | null {
  const keys = ['actor', 'tripId', 'resourceId', 'qualificationId', 'qualificationVersion', 'qualificationStatus', 'cityId', 'routeId', 'routeVersion', 'active', 'expiresAt', 'at']
  if (!plain(trip) || !exact(trip, keys) || !id(trip.actor) || !id(trip.tripId) || !id(trip.resourceId) || !id(trip.qualificationId)
    || !integer(trip.qualificationVersion, 1) || (trip.qualificationStatus !== 'active' && trip.qualificationStatus !== 'revoked')
    || !id(trip.cityId) || !id(trip.routeId) || !id(trip.routeVersion) || typeof trip.active !== 'boolean' || !time(trip.expiresAt) || trip.at !== at || !time(at)) return 'invalid_evidence'
  if (trip.actor !== parcel.actor) return 'evidence_mismatch'
  if (trip.tripId !== parcel.tripId || trip.resourceId !== parcel.resourceId || trip.expiresAt !== parcel.tripExpiresAt) return 'lease_revoked'
  if (at < parcel.offeredAt) return 'invalid_evidence'
  if (at >= trip.expiresAt) return 'lease_expired'
  if (!trip.active) return 'lease_revoked'
  if (parcel.collectedAt !== undefined && at < parcel.collectedAt) return 'invalid_evidence'
  if (trip.qualificationStatus !== 'active') return 'qualification_revoked'
  if (trip.qualificationId !== parcel.qualificationId || trip.qualificationVersion !== parcel.qualificationVersion) return 'qualification_changed'
  if (trip.cityId !== parcel.cityId || trip.routeId !== parcel.routeId || trip.routeVersion !== parcel.routeVersion) return 'route_changed'
  if (at >= parcel.expiresAt) return 'parcel_expired'
  return null
}
function poseEvidence(parcel: ParcelRecord, pose: unknown, placeId: string, at: number): boolean {
  return plain(pose) && exact(pose, ['actor', 'tripId', 'placeId', 'at', 'stopped', 'verified']) && pose.actor === parcel.actor
    && pose.tripId === parcel.tripId && pose.placeId === placeId && pose.at === at && time(at) && pose.stopped === true && pose.verified === true
}
function nextRevision(state: ParcelState): ParcelState | null {
  if (state.revision >= MAX_SAFE) return null
  const next = clone(state); next.revision++
  return next
}
function invalidated(state: ParcelState, reason: string, at: number): ParcelResult {
  const parcel = state.parcel!
  if (reason === 'invalid_evidence' || reason === 'evidence_mismatch') return fail(state, reason)
  if (terminal(parcel.status)) return fail(state, 'parcel_terminal')
  if (parcel.status === 'recovery') return fail(state, 'recovery_required')
  if (at < state.lastAt) return fail(state, 'clock_reversed')
  const next = nextRevision(state)
  if (!next) return fail(state, 'revision_exhausted')
  next.lastAt = at
  if (parcel.status === 'collected') {
    const recoveryReason: ParcelRecoveryReason = reason === 'cancelled_after_collection' ? 'cancelled_after_collection'
      : reason === 'lease_expired' ? 'lease_expired'
      : reason === 'qualification_revoked' ? 'qualification_revoked' : reason === 'qualification_changed' ? 'qualification_changed'
        : reason === 'route_changed' ? 'route_changed' : reason === 'parcel_expired' ? 'parcel_expired' : 'lease_revoked'
    next.parcel = { ...parcel, status: 'recovery', custody: 'carrier', recoveryReason }
    return { ok: true, code: 'recovery_required', state: next }
  }
  const status = reason === 'lease_expired' || reason === 'parcel_expired' ? 'expired' : 'cancelled'
  next.parcel = { ...parcel, status, custody: 'supplier', terminalAt: at }
  return { ok: true, code: status, state: next }
}
function validOperationInput(value: unknown): value is { parcelId: string; expectedRevision: number; generation: number } {
  return plain(value) && exact(value, ['parcelId', 'expectedRevision', 'generation']) && id(value.parcelId) && integer(value.expectedRevision) && integer(value.generation)
}

/** Offer terms are server-authored fictional NPC/product/wage values. The caller must confirm starter permission and fixed shop policy in the same transaction. */
export function offerParcel(state: ParcelState, input: { parcelId: string; expectedRevision: number; expectedGeneration: number; resourceId: string; qualificationId: string; qualificationVersion: number; cityId: string; routeId: string; routeVersion: string; originId: string; destinationId: string; product: string; quantity: number; wage: number; expiresAt: number }, trip: TrustedParcelTrip): ParcelResult {
  const keys = ['parcelId', 'expectedRevision', 'expectedGeneration', 'resourceId', 'qualificationId', 'qualificationVersion', 'cityId', 'routeId', 'routeVersion', 'originId', 'destinationId', 'product', 'quantity', 'wage', 'expiresAt']
  if (!readValidatedParcelState(state)) return fail(state, 'invalid_saved_parcel')
  if (!plain(input) || !exact(input, keys) || !id(input.parcelId) || !integer(input.expectedRevision) || !integer(input.expectedGeneration)
    || !id(input.resourceId) || !id(input.qualificationId) || !integer(input.qualificationVersion, 1) || !id(input.cityId) || !id(input.routeId) || !id(input.routeVersion)
    || !id(input.originId) || !id(input.destinationId) || input.originId === input.destinationId || !id(input.product)
    || !integer(input.quantity, 1) || input.quantity > 10 || !integer(input.wage) || input.wage > 500 || !time(input.expiresAt)) return fail(state, 'invalid_offer')
  if (input.expectedRevision !== state.revision) return fail(state, 'revision_conflict')
  if (input.expectedGeneration !== state.generation) return fail(state, 'generation_conflict')
  if (state.parcel && !terminal(state.parcel.status)) return fail(state, state.parcel.status === 'recovery' ? 'recovery_required' : 'parcel_active')
  const now = trip?.at
  if (!time(now) || input.expiresAt <= now || !plain(trip) || !exact(trip, ['actor', 'tripId', 'resourceId', 'qualificationId', 'qualificationVersion', 'qualificationStatus', 'cityId', 'routeId', 'routeVersion', 'active', 'expiresAt', 'at'])
    || !id(trip.actor) || !id(trip.tripId) || !id(trip.resourceId) || !id(trip.qualificationId) || !integer(trip.qualificationVersion, 1)
    || (trip.qualificationStatus !== 'active' && trip.qualificationStatus !== 'revoked') || !id(trip.cityId) || !id(trip.routeId) || !id(trip.routeVersion)
    || trip.actor !== state.actor || trip.active !== true || !time(trip.expiresAt) || input.expiresAt > trip.expiresAt || trip.qualificationStatus !== 'active'
    || trip.resourceId !== input.resourceId || trip.qualificationId !== input.qualificationId || trip.qualificationVersion !== input.qualificationVersion
    || trip.cityId !== input.cityId || trip.routeId !== input.routeId || trip.routeVersion !== input.routeVersion) return fail(state, 'trip_permission_required')
  if (now < state.lastAt) return fail(state, 'clock_reversed')
  if (state.revision >= MAX_SAFE || state.generation >= MAX_SAFE) return fail(state, 'state_exhausted')
  const next = clone(state); next.revision++; next.generation++; next.lastAt = now
  next.parcel = { id: input.parcelId, generation: next.generation, actor: state.actor, tripId: trip.tripId, resourceId: input.resourceId,
    qualificationId: input.qualificationId, qualificationVersion: input.qualificationVersion, cityId: input.cityId, routeId: input.routeId, routeVersion: input.routeVersion,
    originId: input.originId, destinationId: input.destinationId, product: input.product, quantity: input.quantity, wage: input.wage,
    offeredAt: now, expiresAt: input.expiresAt, tripExpiresAt: trip.expiresAt, status: 'offered', custody: 'supplier' }
  return { ok: true, code: 'offered', state: next }
}

function operation(state: ParcelState, input: unknown): { parcel: ParcelRecord } | ParcelResult {
  if (!validOperationInput(input)) return fail(state, 'invalid_request')
  const refusal = expected(state, input.parcelId, input.expectedRevision, input.generation)
  if (refusal) return refusal
  return { parcel: state.parcel! }
}
function currentTrip(state: ParcelState, input: unknown, trip: TrustedParcelTrip): { parcel: ParcelRecord; at: number } | ParcelResult {
  const parsed = operation(state, input)
  if ('ok' in parsed) return parsed
  const at = trip?.at
  if (!time(at)) return fail(state, 'invalid_evidence')
  if (at < state.lastAt) return fail(state, 'clock_reversed')
  const reason = tripEvidence(parsed.parcel, trip, at)
  return reason ? invalidated(state, reason, at) : { parcel: parsed.parcel, at }
}

/** Claim the one eligible offer for the actor already bound by its server-issued terms. */
export function acceptParcel(state: ParcelState, input: { parcelId: string; expectedRevision: number; generation: number }, trip: TrustedParcelTrip): ParcelResult {
  const checked = currentTrip(state, input, trip)
  if ('ok' in checked) return checked
  if (checked.parcel.status !== 'offered') return fail(state, checked.parcel.status === 'accepted' ? 'already_accepted' : 'parcel_state')
  const next = nextRevision(state); if (!next) return fail(state, 'revision_exhausted')
  next.lastAt = checked.at
  next.parcel = { ...checked.parcel, status: 'accepted' }
  return { ok: true, code: 'accepted', state: next }
}

/** Collection requires a current trip and fresh server-derived stopped pose exactly at the supplier anchor. */
export function collectParcel(state: ParcelState, input: { parcelId: string; expectedRevision: number; generation: number }, trip: TrustedParcelTrip, pose: TrustedParcelPose): ParcelResult {
  const checked = currentTrip(state, input, trip)
  if ('ok' in checked) return checked
  if (checked.parcel.status !== 'accepted') return fail(state, 'parcel_state')
  if (!poseEvidence(checked.parcel, pose, checked.parcel.originId, checked.at)) return fail(state, 'origin_pose_required')
  const next = nextRevision(state); if (!next) return fail(state, 'revision_exhausted')
  next.lastAt = checked.at
  next.parcel = { ...checked.parcel, status: 'collected', custody: 'carrier', collectedAt: checked.at }
  return { ok: true, code: 'collected', state: next }
}

/** Delivery proposes the exact stock/wage effect once; caller must commit it atomically with this state and its receipt. */
export function deliverParcel(state: ParcelState, input: { parcelId: string; expectedRevision: number; generation: number }, trip: TrustedParcelTrip, pose: TrustedParcelPose, recipient: TrustedParcelRecipient): ParcelResult {
  const checked = currentTrip(state, input, trip)
  if ('ok' in checked) return checked
  if (checked.parcel.status !== 'collected') return fail(state, checked.parcel.status === 'delivered' ? 'parcel_terminal' : checked.parcel.status === 'recovery' ? 'recovery_required' : 'parcel_state')
  if (!poseEvidence(checked.parcel, pose, checked.parcel.destinationId, checked.at)) return fail(state, 'destination_pose_required')
  if (!plain(recipient) || !exact(recipient, ['shopId', 'product', 'revision', 'availableUnits', 'open']) || !id(recipient.shopId) || !id(recipient.product)
    || !integer(recipient.revision) || !integer(recipient.availableUnits) || typeof recipient.open !== 'boolean'
    || recipient.shopId !== checked.parcel.destinationId || recipient.product !== checked.parcel.product) return fail(state, 'recipient_unavailable')
  if (!recipient.open || recipient.availableUnits < checked.parcel.quantity) return fail(state, 'recipient_capacity')
  const next = nextRevision(state); if (!next) return fail(state, 'revision_exhausted')
  next.lastAt = checked.at
  next.parcel = { ...checked.parcel, status: 'delivered', custody: 'destination', terminalAt: checked.at }
  const stockDelta = Object.freeze({ shopId: recipient.shopId, product: checked.parcel.product, quantity: checked.parcel.quantity, expectedShopRevision: recipient.revision })
  const effect: ParcelEffect = Object.freeze({ parcelId: checked.parcel.id, generation: checked.parcel.generation, stockDelta, wage: checked.parcel.wage })
  return { ok: true, code: 'delivered', state: next, effect }
}

/** Before collection cancellation ends at supplier; after collection it preserves carrier custody for recovery. */
export function cancelParcel(state: ParcelState, input: { parcelId: string; expectedRevision: number; generation: number }, trip: TrustedParcelTrip): ParcelResult {
  const checked = currentTrip(state, input, trip)
  if ('ok' in checked) return checked
  if (checked.parcel.status === 'collected') return invalidated(state, 'cancelled_after_collection', checked.at)
  if (checked.parcel.status !== 'offered' && checked.parcel.status !== 'accepted') return fail(state, checked.parcel.status === 'recovery' ? 'recovery_required' : 'parcel_terminal')
  const next = nextRevision(state); if (!next) return fail(state, 'revision_exhausted')
  next.lastAt = checked.at
  next.parcel = { ...checked.parcel, status: 'cancelled', custody: 'supplier', terminalAt: checked.at }
  return { ok: true, code: 'cancelled', state: next }
}

/** Server-time expiry is explicit so a transaction can persist the terminal/recovery result atomically. */
export function expireParcel(state: ParcelState, input: { parcelId: string; expectedRevision: number; generation: number }, at: number): ParcelResult {
  const parsed = operation(state, input)
  if ('ok' in parsed) return parsed
  if (!time(at)) return fail(state, 'invalid_time')
  if (at < state.lastAt) return fail(state, 'clock_reversed')
  const parcel = parsed.parcel
  if (terminal(parcel.status)) return fail(state, 'parcel_terminal')
  if (parcel.status === 'recovery') return fail(state, 'recovery_required')
  if (at < parcel.expiresAt && at < parcel.tripExpiresAt) return fail(state, 'not_expired')
  return invalidated(state, at >= parcel.expiresAt ? 'parcel_expired' : 'lease_expired', at)
}

/** Close recovery only with a fresh server-derived stopped pose at the original supplier; this never pays wages. */
export function returnParcel(state: ParcelState, input: { parcelId: string; expectedRevision: number; generation: number }, pose: TrustedParcelPose, at: number): ParcelResult {
  const parsed = operation(state, input)
  if ('ok' in parsed) return parsed
  const parcel = parsed.parcel
  if (parcel.status !== 'recovery') return fail(state, parcel.status === 'delivered' || terminal(parcel.status) ? 'parcel_terminal' : 'recovery_required')
  if (!time(at) || at < state.lastAt) return fail(state, 'clock_reversed')
  if (at < parcel.collectedAt! || !poseEvidence(parcel, pose, parcel.originId, at)) return fail(state, 'origin_pose_required')
  const next = nextRevision(state); if (!next) return fail(state, 'revision_exhausted')
  next.lastAt = at
  next.parcel = { ...parcel, status: 'returned', custody: 'supplier', terminalAt: pose.at }
  delete next.parcel.recoveryReason
  return { ok: true, code: 'returned', state: next }
}
