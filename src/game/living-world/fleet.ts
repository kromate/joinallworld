/** Pure contract for a tiny authored NPC vehicle fleet. It is not a physical map or live fleet. */
import { STARTER_TRIP_LEASE_MS, type StarterEntitlement } from './rental.ts'

export const MAX_FLEET_UNITS = 8
export const MAX_FLEET_RECORD_BYTES = 8192
const MAX = Number.MAX_SAFE_INTEGER
const RESOURCE = 'marina-starter-sedan'
const DEPOT = 'marina-fictional-depot'
const QUALIFICATION = 'district-driving'
const SCOPE = 'district-driving'

/** Distinct fictional units share one catalogue permission resource; none asserts mapped availability. */
export const AUTHORED_FLEET_UNITS = Object.freeze([
  Object.freeze({ id: 'marina-sedan-01', resourceId: RESOURCE, depotId: DEPOT }),
  Object.freeze({ id: 'marina-sedan-02', resourceId: RESOURCE, depotId: DEPOT }),
  Object.freeze({ id: 'marina-sedan-03', resourceId: RESOURCE, depotId: DEPOT }),
  Object.freeze({ id: 'marina-sedan-04', resourceId: RESOURCE, depotId: DEPOT }),
] as const)

export type FleetRecoveryReason = 'lease_expired' | 'qualification_revoked' | 'permission_revoked' | 'qualification_changed' | 'permission_changed' | 'route_changed' | 'depot_unavailable'
export interface FleetLease {
  tripId: string; generation: number; startRequestId: string; startRevision: number; startFingerprint: string
  actor: string; cityId: string; resourceId: string; depotId: string; routeId: string; routeVersion: string
  qualificationId: string; qualificationVersion: number; permissionIssuedAt: number; startedAt: number; expiresAt: number
  status: 'active' | 'recovery' | 'returned'; recoveryReason?: FleetRecoveryReason
  returnedAt?: number; returnRequestId?: string; returnRevision?: number; returnFingerprint?: string
}
export interface FleetUnit { id: string; resourceId: string; depotId: string; generation: number; lease: FleetLease | null }
export interface FleetState { version: 1; revision: number; generation: number; lastAt: number; units: FleetUnit[] }
export type FleetResult = { ok: true; code: string; state: FleetState; unitId?: string } | { ok: false; code: string; state: FleetState }

export interface TrustedFleetEvidence {
  actor: string; cityId: string; at: number; resourceId: string
  qualification: { id: string; version: number; status: 'active' | 'revoked' }
  permission: Pick<StarterEntitlement, 'actor' | 'resourceId' | 'scope' | 'qualificationId' | 'qualificationVersion' | 'issuedAt' | 'status'>
  route: { id: string; version: string; cityId: string; depotId: string; verified: boolean; available: boolean }
  depot: { id: string; cityId: string; available: boolean }
}
export interface TrustedFleetReturnPose {
  actor: string; tripId: string; unitId: string; cityId: string; depotId: string
  verified: boolean; stopped: boolean; at: number
}

const obj = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  try { const proto = Object.getPrototypeOf(value); return proto === Object.prototype || proto === null } catch { return false }
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/.test(value)
const time = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX
const whole = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= MAX
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Reflect.ownKeys(value)
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key))
}
const fail = (state: FleetState, code: string): FleetResult => ({ ok: false, code, state })
const cloneLease = (lease: FleetLease | null): FleetLease | null => lease ? { ...lease } : null
const clone = (state: FleetState): FleetState => ({ ...state, units: state.units.map(unit => ({ ...unit, lease: cloneLease(unit.lease) })) })
const withinRecordCap = (state: FleetState): boolean => {
  try { return JSON.stringify(state).length <= MAX_FLEET_RECORD_BYTES } catch { return false }
}

export function emptyFleetState(): FleetState {
  return { version: 1, revision: 0, generation: 0, lastAt: 0,
    units: AUTHORED_FLEET_UNITS.map(unit => ({ ...unit, generation: 0, lease: null })) }
}

/** Strict non-stepping reader. Invalid/future state returns null for caller quarantine unchanged. */
export function readValidatedFleetState(value: unknown): FleetState | null {
  try {
    if (!obj(value) || !exact(value, ['version', 'revision', 'generation', 'lastAt', 'units']) || value.version !== 1
      || !whole(value.revision) || !whole(value.generation) || value.generation > value.revision || !time(value.lastAt)
      || !Array.isArray(value.units) || value.units.length !== AUTHORED_FLEET_UNITS.length || value.units.length > MAX_FLEET_UNITS) return null
    const units: FleetUnit[] = []
    const occupiedActors = new Set<string>(), ids = new Set<string>(), generations = new Set<number>(),
      tripIds = new Set<string>(), startRequestIds = new Set<string>()
    let maxGeneration = 0
    for (let i = 0; i < value.units.length; i++) {
      const raw = value.units[i], spec = AUTHORED_FLEET_UNITS[i]!
      if (!obj(raw) || !exact(raw, ['id', 'resourceId', 'depotId', 'generation', 'lease'])
        || raw.id !== spec.id || raw.resourceId !== spec.resourceId || raw.depotId !== spec.depotId
        || !whole(raw.generation) || (raw.lease !== null && !obj(raw.lease)) || ids.has(spec.id)) return null
      ids.add(spec.id)
      const generation = raw.generation as number
      maxGeneration = Math.max(maxGeneration, generation)
      if ((generation === 0) !== (raw.lease === null) || (generation > 0 && generations.has(generation))) return null
      let lease: FleetLease | null = null
      if (raw.lease !== null) {
        const l = raw.lease as Record<string, unknown>
        const base = ['tripId', 'generation', 'startRequestId', 'startRevision', 'startFingerprint', 'actor', 'cityId', 'resourceId', 'depotId', 'routeId', 'routeVersion', 'qualificationId', 'qualificationVersion', 'permissionIssuedAt', 'startedAt', 'expiresAt', 'status']
        if ((l.status === 'active' && !exact(l, base)) || (l.status === 'recovery' && !exact(l, [...base, 'recoveryReason']))
          || (l.status === 'returned' && !exact(l, [...base, 'returnedAt', 'returnRequestId', 'returnRevision', 'returnFingerprint']))
          || (l.status !== 'active' && l.status !== 'recovery' && l.status !== 'returned')
          || !id(l.tripId) || !whole(l.generation) || l.generation !== generation || !id(l.startRequestId)
          || !whole(l.startRevision) || l.startRevision >= value.revision || typeof l.startFingerprint !== 'string' || l.startFingerprint.length < 8 || l.startFingerprint.length > 1200
          || !id(l.actor) || !id(l.cityId) || l.cityId !== 'lagos' || l.resourceId !== RESOURCE || l.depotId !== DEPOT
          || !id(l.routeId) || !id(l.routeVersion) || l.qualificationId !== QUALIFICATION || l.qualificationVersion !== 1
          || l.tripId !== `fleet-lease-${generation}` || tripIds.has(l.tripId as string) || startRequestIds.has(l.startRequestId as string)
          || !time(l.permissionIssuedAt) || l.permissionIssuedAt > l.startedAt
          || !time(l.startedAt) || !time(l.expiresAt) || l.expiresAt - l.startedAt !== STARTER_TRIP_LEASE_MS) return null
        const status = l.status as FleetLease['status']
        if ((status === 'active' && (l.recoveryReason !== undefined || l.returnedAt !== undefined))
          || (status === 'recovery' && (typeof l.recoveryReason !== 'string' || !['lease_expired', 'qualification_revoked', 'permission_revoked', 'qualification_changed', 'permission_changed', 'route_changed', 'depot_unavailable'].includes(l.recoveryReason) || l.returnedAt !== undefined))
          || (status === 'returned' && (!time(l.returnedAt) || l.returnedAt < l.startedAt || l.returnedAt > value.lastAt
            || !id(l.returnRequestId) || !whole(l.returnRevision) || l.returnRevision <= l.startRevision || l.returnRevision >= value.revision
            || typeof l.returnFingerprint !== 'string' || l.returnFingerprint.length < 8 || l.returnFingerprint.length > 300 || l.recoveryReason !== undefined))) return null
        const fingerprint = startFingerprint(l.tripId as string, l.startRevision as number, (l.generation as number) - 1, l.actor as string,
          l.cityId as string, l.resourceId as string, l.depotId as string, l.routeId as string, l.routeVersion as string,
          l.qualificationId as string, l.qualificationVersion as number, l.permissionIssuedAt as number)
        if (l.startFingerprint !== fingerprint || l.startedAt > l.expiresAt - STARTER_TRIP_LEASE_MS || value.lastAt < l.startedAt
          || (status === 'recovery' && l.recoveryReason === 'lease_expired' && value.lastAt < l.expiresAt)
          || (status === 'returned' && l.returnFingerprint !== returnFingerprint({ cityId: l.cityId as string,
            tripId: l.tripId as string, expectedRevision: l.returnRevision as number }))) return null
        if (status !== 'returned') {
          if (occupiedActors.has(l.actor as string)) return null
          occupiedActors.add(l.actor as string)
        }
        tripIds.add(l.tripId as string); startRequestIds.add(l.startRequestId as string)
        lease = { tripId: l.tripId as string, generation, startRequestId: l.startRequestId as string, startRevision: l.startRevision as number,
          startFingerprint: l.startFingerprint, actor: l.actor as string, cityId: 'lagos', resourceId: RESOURCE, depotId: DEPOT,
          routeId: l.routeId as string, routeVersion: l.routeVersion as string, qualificationId: QUALIFICATION, qualificationVersion: 1,
          permissionIssuedAt: l.permissionIssuedAt as number, startedAt: l.startedAt as number, expiresAt: l.expiresAt as number, status,
          ...(status === 'recovery' ? { recoveryReason: l.recoveryReason as FleetRecoveryReason } : {}),
          ...(status === 'returned' ? { returnedAt: l.returnedAt as number, returnRequestId: l.returnRequestId as string,
            returnRevision: l.returnRevision as number, returnFingerprint: l.returnFingerprint as string } : {}) }
      }
      if (generation > 0) generations.add(generation)
      units.push({ id: spec.id, resourceId: spec.resourceId, depotId: spec.depotId, generation, lease })
    }
    if ((value.generation === 0) !== (maxGeneration === 0) || maxGeneration !== value.generation
      || (value.generation === 0 && (value.revision !== 0 || value.lastAt !== 0))) return null
    const state: FleetState = { version: 1, revision: value.revision, generation: value.generation, lastAt: value.lastAt, units }
    // Canonical strings are ASCII IDs/literals and numbers; JSON length is UTF-8 byte length here.
    if (JSON.stringify(state).length > MAX_FLEET_RECORD_BYTES) return null
    return state
  } catch { return null }
}

function startFingerprint(tripId: string, revision: number, generation: number, actor: string, cityId: string, resource: string,
  depotId: string, routeId: string, routeVersion: string, qualificationId: string, qualificationVersion: number, permissionIssuedAt: number): string {
  return JSON.stringify([tripId, revision, generation, actor, cityId, resource, depotId, routeId, routeVersion, qualificationId, qualificationVersion, permissionIssuedAt])
}
function evidenceShape(value: unknown): value is TrustedFleetEvidence {
  if (!obj(value) || !exact(value, ['actor', 'cityId', 'at', 'resourceId', 'qualification', 'permission', 'route', 'depot'])
    || !id(value.actor) || !id(value.cityId) || !time(value.at) || !id(value.resourceId)) return false
  const q = value.qualification, p = value.permission, r = value.route, d = value.depot
  return obj(q) && exact(q, ['id', 'version', 'status']) && id(q.id) && whole(q.version) && q.version >= 1 && (q.status === 'active' || q.status === 'revoked')
    && obj(p) && exact(p, ['actor', 'resourceId', 'scope', 'qualificationId', 'qualificationVersion', 'issuedAt', 'status'])
    && id(p.actor) && id(p.resourceId) && p.scope === SCOPE && id(p.qualificationId) && whole(p.qualificationVersion) && p.qualificationVersion >= 1
    && time(p.issuedAt) && (p.status === 'active' || p.status === 'revoked')
    && obj(r) && exact(r, ['id', 'version', 'cityId', 'depotId', 'verified', 'available']) && id(r.id) && id(r.version) && id(r.cityId) && id(r.depotId)
    && typeof r.verified === 'boolean' && typeof r.available === 'boolean'
    && obj(d) && exact(d, ['id', 'cityId', 'available']) && id(d.id) && id(d.cityId) && typeof d.available === 'boolean'
}
function allocationEligible(e: TrustedFleetEvidence, cityId: string): string | null {
  if (cityId !== 'lagos' || e.cityId !== cityId || e.actor !== e.permission.actor || e.resourceId !== RESOURCE
    || e.permission.resourceId !== RESOURCE || e.permission.scope !== SCOPE || e.permission.status !== 'active') return 'permission_required'
  if (e.qualification.id !== QUALIFICATION || e.qualification.version !== 1 || e.qualification.status !== 'active'
    || e.permission.qualificationId !== e.qualification.id || e.permission.qualificationVersion !== e.qualification.version) return 'qualification_required'
  if (e.at < e.permission.issuedAt) return 'permission_not_issued'
  if (!e.route.verified) return 'route_unverified'
  if (!e.route.available || !e.depot.available) return 'fleet_unavailable'
  if (e.route.cityId !== cityId || e.route.depotId !== DEPOT || e.depot.id !== DEPOT || e.depot.cityId !== cityId) return 'route_changed'
  return null
}

/**
 * Pure transition over a caller-validated canonical state. A future adapter must call
 * readValidatedFleetState first and commit the returned state with CAS in its durable transaction.
 * Trusted evidence must be built by that adapter from same-transaction server authorities.
 * Allocate one unit from trusted current server evidence; it grants custody, never ownership.
 */
export function allocateFleetUnit(state: FleetState, input: unknown, evidence: TrustedFleetEvidence): FleetResult {
  if (!obj(input) || !exact(input, ['cityId', 'requestId', 'expectedRevision']) || !id(input.cityId) || !id(input.requestId) || !whole(input.expectedRevision)) return fail(state, 'invalid_request')
  if (!evidenceShape(evidence)) return fail(state, 'evidence_required')
  const actor = evidence.actor
  const priorLease = state.units.find(unit => unit.lease?.startRequestId === input.requestId)
  if (priorLease?.lease) {
    const fp = startFingerprint(priorLease.lease.tripId, priorLease.lease.startRevision, priorLease.lease.generation - 1, actor,
      input.cityId, evidence.resourceId, evidence.route.depotId, evidence.route.id, evidence.route.version,
      evidence.qualification.id, evidence.qualification.version, evidence.permission.issuedAt)
    return priorLease.lease.startFingerprint === fp && priorLease.lease.actor === actor
      && input.expectedRevision === priorLease.lease.startRevision && allocationEligible(evidence, input.cityId) === null
      && priorLease.lease.status === 'active' && evidence.at >= state.lastAt && evidence.at >= priorLease.lease.startedAt
      && evidence.at < priorLease.lease.expiresAt
      ? { ok: true, code: 'duplicate', state, unitId: priorLease.id } : fail(state, 'request_conflict')
  }
  if (input.expectedRevision !== state.revision) return fail(state, 'revision_conflict')
  if (state.lastAt > evidence.at) return fail(state, 'clock_reversed')
  const ineligible = allocationEligible(evidence, input.cityId)
  if (ineligible) return fail(state, ineligible)
  if (evidence.at + STARTER_TRIP_LEASE_MS > MAX) return fail(state, 'invalid_time')
  if (state.units.some(unit => unit.lease && unit.lease.actor === actor && unit.lease.status !== 'returned')) return fail(state, 'custody_retained')
  if (state.revision >= MAX || state.generation >= MAX) return fail(state, 'counter_exhausted')
  const unit = state.units.find(candidate => candidate.lease === null || candidate.lease.status === 'returned')
  if (!unit) return fail(state, 'fleet_unavailable')
  const generation = state.generation + 1
  const tripId = `fleet-lease-${generation}`
  const fingerprint = startFingerprint(tripId, state.revision, state.generation, actor, input.cityId, evidence.resourceId,
    evidence.route.depotId, evidence.route.id, evidence.route.version, evidence.qualification.id, evidence.qualification.version, evidence.permission.issuedAt)
  const next = clone(state); next.revision++; next.generation = generation; next.lastAt = evidence.at
  const assigned = next.units.find(candidate => candidate.id === unit.id)!
  assigned.generation = generation
  assigned.lease = { tripId, generation, startRequestId: input.requestId, startRevision: state.revision, startFingerprint: fingerprint,
    actor, cityId: input.cityId, resourceId: RESOURCE, depotId: DEPOT, routeId: evidence.route.id, routeVersion: evidence.route.version,
    qualificationId: QUALIFICATION, qualificationVersion: 1, permissionIssuedAt: evidence.permission.issuedAt,
    startedAt: evidence.at, expiresAt: evidence.at + STARTER_TRIP_LEASE_MS, status: 'active' }
  if (!withinRecordCap(next)) return fail(state, 'record_too_large')
  return { ok: true, code: 'unit_allocated', state: next, unitId: assigned.id }
}

function statusReason(evidence: TrustedFleetEvidence, lease: FleetLease, at: number): FleetRecoveryReason | null {
  if (at >= lease.expiresAt) return 'lease_expired'
  if (evidence.qualification.status !== 'active') return 'qualification_revoked'
  if (evidence.permission.status !== 'active') return 'permission_revoked'
  if (evidence.actor !== lease.actor || evidence.resourceId !== lease.resourceId
    || evidence.qualification.id !== lease.qualificationId || evidence.qualification.version !== lease.qualificationVersion
    || evidence.permission.actor !== lease.actor || evidence.permission.resourceId !== lease.resourceId
    || evidence.permission.qualificationId !== lease.qualificationId || evidence.permission.qualificationVersion !== lease.qualificationVersion
    || evidence.permission.issuedAt !== lease.permissionIssuedAt) return 'permission_changed'
  if (!evidence.route.verified || !evidence.route.available || evidence.cityId !== lease.cityId || evidence.route.id !== lease.routeId
    || evidence.route.version !== lease.routeVersion || evidence.route.cityId !== lease.cityId || evidence.route.depotId !== lease.depotId) return 'route_changed'
  if (!evidence.depot.available || evidence.depot.id !== lease.depotId || evidence.depot.cityId !== lease.cityId) return 'depot_unavailable'
  return null
}

/** Pure transition over a caller-validated state; invalidation stops authority but never releases custody. */
export function revalidateFleetLease(state: FleetState, input: unknown, evidence: TrustedFleetEvidence): FleetResult {
  if (!obj(input) || !exact(input, ['tripId', 'expectedRevision']) || !id(input.tripId) || !whole(input.expectedRevision)) return fail(state, 'invalid_request')
  if (!evidenceShape(evidence)) return fail(state, 'evidence_required')
  if (input.expectedRevision !== state.revision) return fail(state, 'revision_conflict')
  const unit = state.units.find(row => row.lease?.tripId === input.tripId)
  if (!unit?.lease) return fail(state, 'lease_missing')
  const lease = unit.lease
  if (evidence.actor !== lease.actor) return fail(state, 'wrong_actor')
  if (evidence.at < state.lastAt || evidence.at < lease.startedAt) return fail(state, 'clock_reversed')
  if (lease.status === 'returned') return fail(state, 'lease_terminal')
  if (lease.status === 'recovery') return { ok: false, code: 'recovery_required', state }
  const reason = statusReason(evidence, lease, evidence.at)
  if (!reason) return { ok: true, code: 'lease_current', state, unitId: unit.id }
  if (state.revision >= MAX) return fail(state, 'counter_exhausted')
  const next = clone(state); next.revision++; next.lastAt = evidence.at
  const changed = next.units.find(row => row.id === unit.id)!.lease!
  changed.status = 'recovery'; changed.recoveryReason = reason
  if (!withinRecordCap(next)) return fail(state, 'record_too_large')
  return { ok: true, code: 'recovery_required', state: next, unitId: unit.id }
}

function returnFingerprint(input: { cityId: string; tripId: string; expectedRevision: number }): string {
  return JSON.stringify([input.cityId, input.tripId, input.expectedRevision])
}

/** Pure transition over a caller-validated state; release requires fresh server-verified stopped depot pose. */
export function returnFleetUnit(state: FleetState, input: unknown, pose: TrustedFleetReturnPose): FleetResult {
  if (!obj(input) || !exact(input, ['cityId', 'requestId', 'tripId', 'expectedRevision']) || !id(input.cityId)
    || !id(input.requestId) || !id(input.tripId) || !whole(input.expectedRevision)) return fail(state, 'invalid_request')
  if (!obj(pose) || !exact(pose, ['actor', 'tripId', 'unitId', 'cityId', 'depotId', 'verified', 'stopped', 'at'])
    || !id(pose.actor) || !id(pose.tripId) || !id(pose.unitId) || !id(pose.cityId) || !id(pose.depotId)
    || typeof pose.verified !== 'boolean' || typeof pose.stopped !== 'boolean' || !time(pose.at)) return fail(state, 'return_evidence_required')
  const unit = state.units.find(row => row.lease?.tripId === input.tripId)
  if (!unit?.lease) return fail(state, 'lease_missing')
  const lease = unit.lease
  if (pose.actor !== lease.actor) return fail(state, 'wrong_actor')
  if (lease.status === 'returned' && lease.returnRequestId === input.requestId) {
    // A receipt replay acknowledges only the already-terminal return; it cannot authorize a new release.
    return lease.returnFingerprint === returnFingerprint(input) && input.cityId === lease.cityId
      && pose.tripId === lease.tripId && pose.unitId === unit.id && pose.cityId === lease.cityId
      && pose.depotId === lease.depotId && pose.verified && pose.stopped
      && pose.at >= lease.returnedAt! && pose.at >= state.lastAt
      ? { ok: true, code: 'duplicate', state, unitId: unit.id } : fail(state, 'request_conflict')
  }
  if (input.expectedRevision !== state.revision) return fail(state, 'revision_conflict')
  if (state.lastAt > pose.at || pose.at < lease.startedAt) return fail(state, 'clock_reversed')
  if (lease.status === 'returned') return fail(state, 'lease_terminal')
  if (input.cityId !== lease.cityId || pose.cityId !== lease.cityId || pose.tripId !== lease.tripId || pose.unitId !== unit.id
    || pose.depotId !== lease.depotId || lease.depotId !== DEPOT || !pose.verified || !pose.stopped) return fail(state, 'return_evidence_required')
  if (state.revision >= MAX) return fail(state, 'counter_exhausted')
  const next = clone(state); next.revision++; next.lastAt = pose.at
  const returned = next.units.find(row => row.id === unit.id)!.lease!
  returned.status = 'returned'; delete returned.recoveryReason
  returned.returnedAt = pose.at; returned.returnRequestId = input.requestId; returned.returnRevision = input.expectedRevision
  returned.returnFingerprint = returnFingerprint(input)
  if (!withinRecordCap(next)) return fail(state, 'record_too_large')
  return { ok: true, code: 'unit_returned', state: next, unitId: unit.id }
}
