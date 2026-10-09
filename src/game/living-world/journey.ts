/** Pure qualification, permission, and delivery transitions for the living-world proposal.
 * Callers own persistence, identity, time, proximity verification, wallet effects, and events.
 */
export type Qualification = { id: string; version: number; evidenceJourneyId: string; earnedAt: number; status: 'active' | 'revoked' }
export type Permission = { id: string; actor: string; resourceId: string; scope: string; issuedAt: number; expiresAt: number | null; status: 'active' | 'revoked'; qualificationId?: string; qualificationVersion?: number }
export type DeliveryStatus = 'offered' | 'accepted' | 'collected' | 'delivered' | 'cancelled' | 'expired'
export interface Delivery {
  id: string; version: number; city: string; origin: string; destination: string; product: string; quantity: number; reward: number
  offeredBy: string; carrier: string | null; expiresAt: number; status: DeliveryStatus; collectedAt?: number
}
export interface JourneyState { qualifications: Record<string, Qualification>; permissions: Record<string, Permission>; deliveries: Record<string, Delivery> }
export type JourneyResult = { ok: true; code: string; state: JourneyState; effect?: DeliveryEffect } | { ok: false; code: string; state: JourneyState }
export interface DeliveryEffect { deliveryId: string; eventId: string; stockDelta: { product: string; units: number }; reward: number }
export interface ProximityEvidence { deliveryId: string; actor: string; place: 'origin' | 'destination'; at: number; verified: true }
export type DeliveryOperation = 'accept' | 'collect' | 'deliver' | 'cancel' | 'expire'

const EMPTY: JourneyState = { qualifications: {}, permissions: {}, deliveries: {} }
const QUALIFICATION_LIMIT = 64, PERMISSION_LIMIT = 128, DELIVERY_LIMIT = 128, MAX_TIME = Number.MAX_SAFE_INTEGER
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,63}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value)
const time = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX_TIME
const whole = (value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max
const own = <T>(record: Record<string, T>, key: string): T | undefined => Object.hasOwn(record, key) ? record[key] : undefined
function entries<T>(value: unknown, limit: number): [string, T][] {
  if (!isObject(value)) return []
  const result: [string, T][] = []
  for (const key in value) if (Object.hasOwn(value, key)) {
    if (result.length >= limit) throw new RangeError(`Journey record map exceeds ${limit}; quarantine the unchanged source record.`)
    result.push([key, value[key] as T])
  }
  return result
}
function count<T>(value: Record<string, T>, limit: number): number {
  let found = 0
  for (const key in value) if (Object.hasOwn(value, key) && ++found > limit) return found
  return found
}
function clone<T>(value: Record<string, T>, limit: number): Record<string, T> {
  const result: Record<string, T> = {}
  for (const [key, row] of entries<T>(value, limit)) Object.defineProperty(result, key, { value: row, enumerable: true, configurable: true, writable: true })
  return result
}
const withinCapacity = (state: JourneyState): boolean => count(state.qualifications, QUALIFICATION_LIMIT) <= QUALIFICATION_LIMIT && count(state.permissions, PERMISSION_LIMIT) <= PERMISSION_LIMIT && count(state.deliveries, DELIVERY_LIMIT) <= DELIVERY_LIMIT
const copy = (state: JourneyState): JourneyState => ({ qualifications: clone(state.qualifications, QUALIFICATION_LIMIT), permissions: clone(state.permissions, PERMISSION_LIMIT), deliveries: clone(state.deliveries, DELIVERY_LIMIT) })
const fail = (state: JourneyState, code: string): JourneyResult => ({ ok: false, code, state })

/** Rebuild bounded records from untrusted saved input; malformed rows are discarded.
 * Oversized maps throw before returning a partial state; the caller should quarantine the unchanged source record.
 */
export function sanitizeJourneyState(input: unknown): JourneyState {
  if (!isObject(input)) return { ...EMPTY, qualifications: {}, permissions: {}, deliveries: {} }
  const out: JourneyState = { qualifications: {}, permissions: {}, deliveries: {} }
  const qualifications = entries<unknown>(input.qualifications, QUALIFICATION_LIMIT)
  for (const [key, raw] of qualifications) if (id(key) && isObject(raw) && raw.id === key && whole(raw.version, 1, 1000) && id(raw.evidenceJourneyId) && time(raw.earnedAt) && (raw.status === 'active' || raw.status === 'revoked')) out.qualifications[key] = { id: key, version: raw.version, evidenceJourneyId: raw.evidenceJourneyId, earnedAt: raw.earnedAt, status: raw.status }
  const permissions = entries<unknown>(input.permissions, PERMISSION_LIMIT)
  for (const [key, raw] of permissions) if (id(key) && isObject(raw) && raw.id === key && id(raw.actor) && id(raw.resourceId) && id(raw.scope) && time(raw.issuedAt) && (raw.expiresAt === null || (time(raw.expiresAt) && raw.expiresAt > raw.issuedAt)) && (raw.status === 'active' || raw.status === 'revoked') && ((raw.qualificationId === undefined && raw.qualificationVersion === undefined) || (id(raw.qualificationId) && whole(raw.qualificationVersion, 1, 1000)))) {
    const qualificationId = id(raw.qualificationId) ? raw.qualificationId : undefined, qualificationVersion = whole(raw.qualificationVersion, 1, 1000) ? raw.qualificationVersion : undefined
    if (qualificationId === undefined && qualificationVersion === undefined) out.permissions[key] = { id: key, actor: raw.actor, resourceId: raw.resourceId, scope: raw.scope, issuedAt: raw.issuedAt, expiresAt: raw.expiresAt, status: raw.status }
    else if (qualificationId !== undefined && qualificationVersion !== undefined) out.permissions[key] = { id: key, actor: raw.actor, resourceId: raw.resourceId, scope: raw.scope, issuedAt: raw.issuedAt, expiresAt: raw.expiresAt, status: raw.status, qualificationId, qualificationVersion }
  }
  const deliveries = entries<unknown>(input.deliveries, DELIVERY_LIMIT)
  const statuses: DeliveryStatus[] = ['offered', 'accepted', 'collected', 'delivered', 'cancelled', 'expired']
  for (const [key, raw] of deliveries) if (id(key) && isObject(raw) && raw.id === key && whole(raw.version, 1, 1000000) && id(raw.city) && id(raw.origin) && id(raw.destination) && id(raw.product) && whole(raw.quantity, 1, 1000) && whole(raw.reward, 0, 1000000) && id(raw.offeredBy) && (raw.carrier === null || id(raw.carrier)) && time(raw.expiresAt) && statuses.includes(raw.status as DeliveryStatus) && (raw.collectedAt === undefined || time(raw.collectedAt))) {
    const row: Delivery = { id: key, version: raw.version, city: raw.city, origin: raw.origin, destination: raw.destination, product: raw.product, quantity: raw.quantity, reward: raw.reward, offeredBy: raw.offeredBy, carrier: raw.carrier, expiresAt: raw.expiresAt, status: raw.status as DeliveryStatus }
    if (row.status === 'offered' && (row.carrier !== null || raw.collectedAt !== undefined)) continue
    if (row.status === 'accepted' && (!id(raw.carrier) || raw.collectedAt !== undefined)) continue
    if (row.status === 'collected' || row.status === 'delivered') { if (!id(raw.carrier) || !time(raw.collectedAt) || raw.collectedAt > row.expiresAt) continue; row.collectedAt = raw.collectedAt }
    if ((row.status === 'cancelled' || row.status === 'expired') && raw.collectedAt !== undefined) { if (!id(raw.carrier) || !time(raw.collectedAt) || raw.collectedAt > row.expiresAt) continue; row.collectedAt = raw.collectedAt }
    out.deliveries[key] = row
  }
  return out
}

/** Award a versioned qualification once per evidence journey. */
export function awardQualification(state: JourneyState, value: Omit<Qualification, 'status'>): JourneyResult {
  if (!withinCapacity(state)) return fail(state, 'state_capacity')
  if (!isObject(value) || !id(value.id) || !id(value.evidenceJourneyId) || !whole(value.version, 1, 1000) || !time(value.earnedAt)) return fail(state, 'invalid_qualification')
  const existing = own(state.qualifications, value.id)
  if (existing) return existing.evidenceJourneyId === value.evidenceJourneyId && existing.version === value.version ? { ok: true, code: 'duplicate', state } : fail(state, 'qualification_exists')
  if (count(state.qualifications, QUALIFICATION_LIMIT) >= QUALIFICATION_LIMIT) return fail(state, 'qualification_capacity')
  if (entries<Qualification>(state.qualifications, QUALIFICATION_LIMIT).some(([, item]) => item.evidenceJourneyId === value.evidenceJourneyId)) return fail(state, 'evidence_already_used')
  const next = copy(state); next.qualifications[value.id] = { id: value.id, version: value.version, evidenceJourneyId: value.evidenceJourneyId, earnedAt: value.earnedAt, status: 'active' }; return { ok: true, code: 'qualified', state: next }
}

export function revokeQualification(state: JourneyState, qualificationId: string): JourneyResult {
  if (!withinCapacity(state)) return fail(state, 'state_capacity')
  const current = own(state.qualifications, qualificationId); if (!current) return fail(state, 'qualification_missing')
  if (current.status === 'revoked') return { ok: true, code: 'duplicate', state }
  const next = copy(state); next.qualifications[qualificationId] = { ...current, status: 'revoked' }; return { ok: true, code: 'revoked', state: next }
}

/** Issue a scoped capability. No price, collateral, or ownership is part of this contract. */
export function issuePermission(state: JourneyState, value: Omit<Permission, 'status'>): JourneyResult {
  if (!withinCapacity(state)) return fail(state, 'state_capacity')
  if (!isObject(value) || !id(value.id) || !id(value.actor) || !id(value.resourceId) || !id(value.scope) || !time(value.issuedAt) || (value.expiresAt !== null && (!time(value.expiresAt) || value.expiresAt <= value.issuedAt))) return fail(state, 'invalid_permission')
  if (own(state.permissions, value.id)) return fail(state, 'permission_exists')
  if (count(state.permissions, PERMISSION_LIMIT) >= PERMISSION_LIMIT) return fail(state, 'permission_capacity')
  if ((value.qualificationId === undefined) !== (value.qualificationVersion === undefined)) return fail(state, 'invalid_qualification')
  if (value.qualificationId !== undefined) { if (!id(value.qualificationId) || !whole(value.qualificationVersion, 1, 1000)) return fail(state, 'invalid_qualification'); const q = own(state.qualifications, value.qualificationId); if (!q || q.status !== 'active' || q.version !== value.qualificationVersion) return fail(state, 'qualification_required') }
  const next = copy(state); next.permissions[value.id] = { id: value.id, actor: value.actor, resourceId: value.resourceId, scope: value.scope, issuedAt: value.issuedAt, expiresAt: value.expiresAt, status: 'active', ...(value.qualificationId !== undefined ? { qualificationId: value.qualificationId, qualificationVersion: value.qualificationVersion! } : {}) }; return { ok: true, code: 'issued', state: next }
}

export function revokePermission(state: JourneyState, permissionId: string): JourneyResult {
  if (!withinCapacity(state)) return fail(state, 'state_capacity')
  const current = own(state.permissions, permissionId); if (!current) return fail(state, 'permission_missing')
  if (current.status === 'revoked') return { ok: true, code: 'duplicate', state }
  const next = copy(state); next.permissions[permissionId] = { ...current, status: 'revoked' }; return { ok: true, code: 'revoked', state: next }
}

/** Recheck exact actor/resource/scope and current qualification on every consequential action. */
export function checkPermission(state: JourneyState, request: { permissionId: string; actor: string; resourceId: string; scope: string; at: number }): { ok: true; code: 'allowed' } | { ok: false; code: string } {
  if (!isObject(request) || !id(request.permissionId) || !id(request.actor) || !id(request.resourceId) || !id(request.scope) || !time(request.at)) return { ok: false, code: 'permission_scope' }
  const p = own(state.permissions, request.permissionId)
  if (!p || p.status !== 'active') return { ok: false, code: 'permission_revoked' }
  if (request.actor !== p.actor || request.resourceId !== p.resourceId || request.scope !== p.scope) return { ok: false, code: 'permission_scope' }
  if (request.at < p.issuedAt) return { ok: false, code: 'permission_not_yet_issued' }
  if (p.expiresAt !== null && request.at >= p.expiresAt) return { ok: false, code: 'permission_expired' }
  if (p.qualificationId) { const q = own(state.qualifications, p.qualificationId); if (!q || q.status !== 'active' || q.version !== p.qualificationVersion) return { ok: false, code: 'qualification_required' } }
  return { ok: true, code: 'allowed' }
}

export function offerDelivery(state: JourneyState, value: Omit<Delivery, 'version' | 'carrier' | 'status' | 'collectedAt'>, at: number): JourneyResult {
  if (!withinCapacity(state)) return fail(state, 'state_capacity')
  if (!isObject(value) || !id(value.id) || !id(value.city) || !id(value.origin) || !id(value.destination) || !id(value.product) || !id(value.offeredBy) || !whole(value.quantity, 1, 1000) || !whole(value.reward, 0, 1000000) || !time(at) || !time(value.expiresAt) || value.expiresAt <= at || value.expiresAt - at > 30 * 86400000) return fail(state, 'invalid_delivery')
  if (own(state.deliveries, value.id)) return fail(state, 'delivery_exists')
  if (count(state.deliveries, DELIVERY_LIMIT) >= DELIVERY_LIMIT) return fail(state, 'delivery_capacity')
  const next = copy(state); next.deliveries[value.id] = { id: value.id, city: value.city, origin: value.origin, destination: value.destination, product: value.product, quantity: value.quantity, reward: value.reward, offeredBy: value.offeredBy, expiresAt: value.expiresAt, version: 1, carrier: null, status: 'offered' }; return { ok: true, code: 'offered', state: next }
}

/** Advance one delivery state. Server code supplies authenticated actor and verified proximity evidence. */
export function transitionDelivery(state: JourneyState, input: { deliveryId: string; operation: DeliveryOperation; actor: string; expectedVersion: number; at: number; proximity?: ProximityEvidence }): JourneyResult {
  if (!withinCapacity(state)) return fail(state, 'state_capacity')
  if (!isObject(input) || !id(input.deliveryId) || !id(input.actor) || !['accept', 'collect', 'deliver', 'cancel', 'expire'].includes(input.operation) || !time(input.at) || !whole(input.expectedVersion, 1, 1000000)) return fail(state, 'invalid_transition')
  const row = own(state.deliveries, input.deliveryId)
  if (!row) return fail(state, 'delivery_missing')
  if (row.version !== input.expectedVersion) return fail(state, 'version_conflict')
  if (['delivered', 'cancelled', 'expired'].includes(row.status)) return fail(state, 'delivery_terminal')
  if (input.at >= row.expiresAt && row.status !== 'expired') return changed(row, state, 'expired')
  if (input.operation === 'expire') return fail(state, 'not_expired')
  if (input.operation === 'cancel') {
    if (input.actor !== row.offeredBy && input.actor !== row.carrier) return fail(state, 'actor_forbidden')
    return changed(row, state, 'cancelled')
  }
  if (input.operation === 'accept') {
    if (row.status !== 'offered') return fail(state, 'delivery_state')
    if (input.actor === row.offeredBy) return fail(state, 'actor_forbidden')
    return changed({ ...row, carrier: input.actor }, state, 'accepted')
  }
  if (input.actor !== row.carrier) return fail(state, 'wrong_carrier')
  if (input.operation === 'collect') {
    if (row.status !== 'accepted' || !evidenceMatches(input.proximity, row, input.actor, 'origin', input.at)) return fail(state, 'origin_required')
    return changed({ ...row, collectedAt: input.at }, state, 'collected')
  }
  if (input.operation === 'deliver') {
    if (row.status !== 'collected' || !evidenceMatches(input.proximity, row, input.actor, 'destination', input.at)) return fail(state, 'destination_required')
    const result = changed(row, state, 'delivered')
    return result.ok ? { ...result, effect: { deliveryId: row.id, eventId: `delivery:${row.id}:${row.version + 1}`, stockDelta: { product: row.product, units: row.quantity }, reward: row.reward } } : result
  }
  return fail(state, 'invalid_transition')
}

function evidenceMatches(value: ProximityEvidence | undefined, row: Delivery, actor: string, place: 'origin' | 'destination', at: number): boolean {
  return Boolean(value && value.verified === true && value.deliveryId === row.id && value.actor === actor && value.place === place && time(value.at) && value.at <= at && at - value.at <= 10000)
}
function changed(row: Delivery, state: JourneyState, status: DeliveryStatus): JourneyResult {
  const next = copy(state), updated: Delivery = { ...row, status, version: row.version + 1 }
  if (status === 'accepted' && row.carrier) updated.carrier = row.carrier
  if (status === 'collected') updated.collectedAt = row.collectedAt
  next.deliveries[row.id] = updated; return { ok: true, code: status, state: next }
}
