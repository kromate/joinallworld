/**
 * Durable mapped-trip adapter. It deliberately has no production physical resolver or motion
 * verifier: until server-owned components can prove the route, depot, vehicle, actor, terrain, yield and per-step swept-body contract,
 * every mutating entry point fails closed. An optional resolver is a private host-code seam, never
 * a request field; tests inject one only to exercise persistence and control semantics.
 */
import { characterCity } from '../character.ts'
import { readValidatedQualificationRecord } from './qualification-service.ts'
import { readDrivingQualificationEvidence } from './driving-service.ts'
import { readValidatedStarterRentalRecord } from './rental-service.ts'
import {
  allocateFleetUnit, emptyFleetState, readValidatedFleetState, revalidateFleetLease, returnFleetUnit,
  type FleetLease, type FleetState, type TrustedFleetEvidence,
} from '../../src/game/living-world/fleet.ts'
import { createDriving, pauseDriving, readValidatedDrivingState, stepDriving } from '../../src/game/living-world/driving.ts'
import type { DrivingInput, DrivingRoute, DrivingState } from '../../src/game/living-world/driving.ts'
import type { CityId } from '../../src/types/protocol.ts'
import type { MappedTripControlRequest, MappedTripLifecycleRequest, MappedTripResponse, MappedTripStartRequest, MappedTripView } from '../../src/types/mapped-trip.ts'
import type { Db, RouteContext, RouteRequest, SessionRecord } from '../types.ts'

const CITY = 'lagos' as const
const RESOURCE = 'marina-starter-sedan'
const DEPOT = 'marina-fictional-depot'
const QUALIFICATION = 'district-driving'
const FRAME_MS = 100, MAX_FRAMES = 5, MAX_CREDIT_MS = 500, INPUT_TIMEOUT_MS = 1500
const EVIDENCE_MAX_AGE_MS = 30_000, MAX_RECORDS = 1024, MAX_ROW_BYTES = 8192
const MAX = Number.MAX_SAFE_INTEGER
const SHA256 = /^[a-f0-9]{64}$/

const record = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  try { const proto = Object.getPrototypeOf(value); return proto === Object.prototype || proto === null } catch { return false }
}
const exact = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  try { const own = Reflect.ownKeys(value); return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key)) } catch { return false }
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/.test(value)
const time = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const count = (value: unknown, min = 0): value is number => time(value) && value >= min
const byteLength = (value: unknown): number | null => {
  try { return new TextEncoder().encode(JSON.stringify(value)).byteLength } catch { return null }
}
const owns = (value: Record<string, unknown>, key: string): boolean => Object.hasOwn(value, key)
const response = (trip: MappedTripView | null, code: string, ok = false, reason?: string, duplicate = false): MappedTripResponse => ({
  ok, code, ...(reason ? { reason } : {}), ...(duplicate ? { duplicate: true } : {}), trip, frameMs: FRAME_MS, maxFrames: MAX_FRAMES,
})

/** These proofs are data returned only by the server-owned resolver passed to this service. */
export interface AcceptedMappedPhysicalEvidence {
  kind: 'accepted-complete-mapped-route'
  actor: string
  cityId: 'lagos'
  location: string
  checkedAt: number
  route: DrivingRoute
  resourceId: typeof RESOURCE
  depotId: typeof DEPOT
  supplierCheckpointId: string
  shopCheckpointId: string
  depotCheckpointId: string
  availability: { route: boolean; depot: boolean; actorAtDepot: boolean }
  pins: {
    manifestCanonicalSha256: string
    tileSha256: string
    packSha256: string
    routeClearanceSha256: string
    depotSiteSha256: string
    vehicleDescriptorSha256: string
    boardingAndExitSha256: string
    actorEnvelopeSha256: string
    terrainSupportSha256: string
    yieldPolicySha256: string
  }
}

export interface MappedPhysicalResolverInput {
  readonly db: Db
  readonly session: SessionRecord
  readonly cityId: 'lagos'
  readonly location: string
  readonly at: number
  readonly qualification: { readonly id: string; readonly version: number; readonly status: 'active' | 'revoked' } | null
  readonly permission: { readonly actor: string; readonly resourceId: string; readonly scope: string; readonly qualificationId: string; readonly qualificationVersion: number; readonly issuedAt: number; readonly status: 'active' | 'revoked' } | null
  readonly tripId: string | null
}

/** Only a private, trusted server adapter may supply this resolver; never expose it to an API body. */
export type MappedPhysicalResolver = (input: MappedPhysicalResolverInput) => AcceptedMappedPhysicalEvidence | null | Promise<AcceptedMappedPhysicalEvidence | null>

/** A second server-only gate. Static route pins do not prove each moving sedan footprint. */
export interface MappedMotionVerifierInput {
  readonly actor: string
  readonly cityId: 'lagos'
  readonly location: string
  readonly tripId: string
  readonly fleetUnitId: string
  readonly leaseGeneration: number
  readonly leaseStartRevision: number
  readonly fleetRevision: number
  readonly at: number
  readonly route: DrivingRoute
  readonly pins: ProofPins
  readonly fingerprint: string
  readonly from: DrivingState
  readonly to: DrivingState
}
export interface VerifiedMappedMotion {
  kind: 'verified-server-motion'
  actor: string
  cityId: 'lagos'
  location: string
  tripId: string
  fleetUnitId: string
  leaseGeneration: number
  leaseStartRevision: number
  fleetRevision: number
  routeId: string
  routeVersion: string
  checkedAt: number
  fingerprint: string
  pins: ProofPins
}
/** This private server dependency checks one canonical server-derived 100 ms candidate at a time. */
export type MappedMotionVerifier = (input: MappedMotionVerifierInput) => VerifiedMappedMotion | null | Promise<VerifiedMappedMotion | null>

type ProofPins = AcceptedMappedPhysicalEvidence['pins']
type PacketReceipt = { sequence: number; fingerprint: string; code: 'controls_accepted' | 'trip_completed' }
type MappedTripRecord = {
  v: 1; publicId: string; tripId: string; cityId: CityId; location: string; routeId: string; routeVersion: string
  fleetUnitId: string; qualificationId: string; qualificationVersion: number; permissionIssuedAt: number
  pins: ProofPins; supplierCheckpoint: number; shopCheckpoint: number; depotCheckpoint: number
  createdAt: number; updatedAt: number; lastInputAt: number; creditMs: number; revision: number; nextSequence: number
  state: DrivingState; status: 'active' | 'recovery' | 'returned'; lastPacket: PacketReceipt | null
}
type Auth = {
  qualification: ReturnType<typeof readValidatedQualificationRecord> | null | false
  evidence: ReturnType<typeof readDrivingQualificationEvidence>
  rental: ReturnType<typeof readValidatedStarterRentalRecord> | null | false
}
type World = Record<string, unknown>

function world(db: Db): World | null { return db.livingWorld === undefined ? null : record(db.livingWorld) ? db.livingWorld : null }
function rowsFor(root: World | null, key: string): Record<string, unknown> | null {
  if (!root || !owns(root, key)) return null
  return record(root[key]) ? root[key] : null
}
function boundedRows(rows: Record<string, unknown>): number {
  let n = 0
  for (const key in rows) if (owns(rows, key) && ++n > MAX_RECORDS) return n
  return n
}
function readAuth(db: Db, actor: string): Auth {
  const root = world(db)
  if (db.livingWorld !== undefined && !root) return { qualification: false, evidence: false, rental: false }
  const qrows = root && owns(root, 'qualifications') ? rowsFor(root, 'qualifications') : null
  const rrows = root && owns(root, 'rentals') ? rowsFor(root, 'rentals') : null
  if (root && owns(root, 'qualifications') && !qrows || root && owns(root, 'rentals') && !rrows)
    return { qualification: false, evidence: false, rental: false }
  const qualification = qrows && owns(qrows, actor) ? readValidatedQualificationRecord(qrows[actor], actor) ?? false : null
  const rental = rrows && owns(rrows, actor) ? readValidatedStarterRentalRecord(rrows[actor], actor) ?? false : null
  const evidence = qualification ? readDrivingQualificationEvidence(db, actor) : null
  return { qualification, evidence, rental }
}
function authMatches(auth: Auth, actor: string, city: string, now: number): boolean {
  const q = auth.qualification, e = auth.evidence, r = auth.rental
  return Boolean(q !== null && q !== false && e !== null && e !== false && r !== null && r !== false
    && q.publicId === actor && q.cityId === city && q.qualification.id === QUALIFICATION && q.qualification.version === 1
    && q.courseId === 'district-practice' && q.courseVersion === '1' && q.qualification.status === 'active'
    && e.journeyId === q.qualification.evidenceJourneyId && e.cityId === city && e.location !== ''
    && e.routeId === q.courseId && e.routeVersion === q.courseVersion && e.earnedAt === q.qualification.earnedAt && e.earnedAt <= now
    && r.entitlement?.actor === actor && r.entitlement.status === 'active' && r.entitlement.resourceId === RESOURCE
    && r.entitlement.scope === 'district-driving' && r.entitlement.qualificationId === q.qualification.id
    && r.entitlement.qualificationVersion === q.qualification.version && r.entitlement.issuedAt <= now)
}
function proofFresh(proof: AcceptedMappedPhysicalEvidence, now: number): boolean {
  return time(now) && proof.checkedAt <= now && now - proof.checkedAt <= EVIDENCE_MAX_AGE_MS
}
function proofPins(value: unknown): ProofPins | null {
  if (!record(value) || !exact(value, ['manifestCanonicalSha256', 'tileSha256', 'packSha256', 'routeClearanceSha256', 'depotSiteSha256', 'vehicleDescriptorSha256', 'boardingAndExitSha256', 'actorEnvelopeSha256', 'terrainSupportSha256', 'yieldPolicySha256'])) return null
  const result = value as Record<keyof ProofPins, unknown>
  for (const key of ['manifestCanonicalSha256', 'tileSha256', 'packSha256', 'routeClearanceSha256', 'depotSiteSha256', 'vehicleDescriptorSha256', 'boardingAndExitSha256', 'actorEnvelopeSha256', 'terrainSupportSha256', 'yieldPolicySha256'] as const)
    if (typeof result[key] !== 'string' || !SHA256.test(result[key] as string)) return null
  return {
    manifestCanonicalSha256: result.manifestCanonicalSha256 as string, tileSha256: result.tileSha256 as string,
    packSha256: result.packSha256 as string, routeClearanceSha256: result.routeClearanceSha256 as string,
    depotSiteSha256: result.depotSiteSha256 as string,
    vehicleDescriptorSha256: result.vehicleDescriptorSha256 as string, boardingAndExitSha256: result.boardingAndExitSha256 as string,
    actorEnvelopeSha256: result.actorEnvelopeSha256 as string, terrainSupportSha256: result.terrainSupportSha256 as string,
    yieldPolicySha256: result.yieldPolicySha256 as string,
  }
}
function inspectEvidence(value: unknown, actor: string, location: string, now: number): AcceptedMappedPhysicalEvidence | null {
  try {
  if (!record(value) || !exact(value, ['kind', 'actor', 'cityId', 'location', 'checkedAt', 'route', 'resourceId', 'depotId', 'supplierCheckpointId', 'shopCheckpointId', 'depotCheckpointId', 'availability', 'pins'])
    || value.kind !== 'accepted-complete-mapped-route' || value.actor !== actor || value.cityId !== CITY || value.location !== location
    || !time(value.checkedAt) || value.checkedAt > now || now - value.checkedAt > EVIDENCE_MAX_AGE_MS
    || value.resourceId !== RESOURCE || value.depotId !== DEPOT || !id(value.supplierCheckpointId) || !id(value.shopCheckpointId) || !id(value.depotCheckpointId)) return null
  const pins = proofPins(value.pins), route = value.route
  if (!pins || !record(route) || typeof route.id !== 'string' || !id(route.id) || typeof route.version !== 'string' || !id(route.version)
    || !Array.isArray(route.checkpoints) || !record(value.availability)
    || !exact(value.availability, ['route', 'depot', 'actorAtDepot'])
    || typeof value.availability.route !== 'boolean' || typeof value.availability.depot !== 'boolean' || typeof value.availability.actorAtDepot !== 'boolean') return null
  const cleanRoute = route as unknown as DrivingRoute
  if (createDriving(cleanRoute).status !== 'running') return null
  const supplier = cleanRoute.checkpoints.findIndex(check => check.id === value.supplierCheckpointId && check.stopRequired)
  const shop = cleanRoute.checkpoints.findIndex(check => check.id === value.shopCheckpointId && check.stopRequired)
  const depot = cleanRoute.checkpoints.findIndex(check => check.id === value.depotCheckpointId && check.stopRequired)
  if (supplier < 0 || shop <= supplier || depot <= shop || depot !== cleanRoute.checkpoints.length - 1) return null
  return {
    kind: 'accepted-complete-mapped-route', actor, cityId: CITY, location, checkedAt: value.checkedAt,
    route: cleanRoute, resourceId: RESOURCE, depotId: DEPOT,
    supplierCheckpointId: value.supplierCheckpointId, shopCheckpointId: value.shopCheckpointId, depotCheckpointId: value.depotCheckpointId,
    availability: { route: value.availability.route, depot: value.availability.depot, actorAtDepot: value.availability.actorAtDepot }, pins,
  }
  } catch { return null }
}
function samePins(left: unknown, canonical: string): boolean {
  const checked = proofPins(left)
  return checked !== null && JSON.stringify(checked) === canonical
}
type MotionExpectation = Pick<MappedMotionVerifierInput, 'actor' | 'cityId' | 'location' | 'tripId' | 'fleetUnitId' | 'leaseGeneration' | 'leaseStartRevision' | 'fleetRevision' | 'at' | 'fingerprint'>
  & { routeId: string; routeVersion: string; pinsJson: string }
function motionFingerprint(input: Omit<MappedMotionVerifierInput, 'fingerprint'>): string {
  return JSON.stringify([input.actor, input.tripId, input.fleetUnitId, input.leaseGeneration, input.leaseStartRevision, input.fleetRevision,
    input.cityId, input.location, input.route.id, input.route.version, input.pins, input.at, input.from, input.to])
}
function verifiedMotion(value: unknown, expected: MotionExpectation): value is VerifiedMappedMotion {
  return record(value) && exact(value, ['kind', 'actor', 'cityId', 'location', 'tripId', 'fleetUnitId', 'leaseGeneration', 'leaseStartRevision', 'fleetRevision', 'routeId', 'routeVersion', 'checkedAt', 'fingerprint', 'pins'])
    && value.kind === 'verified-server-motion' && value.actor === expected.actor && value.cityId === expected.cityId
    && value.location === expected.location && value.tripId === expected.tripId && value.fleetUnitId === expected.fleetUnitId
    && value.leaseGeneration === expected.leaseGeneration && value.leaseStartRevision === expected.leaseStartRevision
    && value.fleetRevision === expected.fleetRevision
    && value.routeId === expected.routeId && value.routeVersion === expected.routeVersion
    && value.checkedAt === expected.at && value.fingerprint === expected.fingerprint
    && samePins(value.pins, expected.pinsJson)
}
function fleetEvidence(actor: string, at: number, auth: Auth, proof: AcceptedMappedPhysicalEvidence): TrustedFleetEvidence | null {
  const witnessed = authMatches(auth, actor, CITY, at)
  const qualification = auth.qualification !== null && auth.qualification !== false ? auth.qualification.qualification : null
  const permission = auth.rental !== null && auth.rental !== false ? auth.rental.entitlement : null
  // Missing/revoked account permissions may only invalidate custody; they can never start or move a trip.
  const q = qualification ?? { id: QUALIFICATION, version: 1, status: 'revoked' as const }
  const p = permission ?? { actor, resourceId: RESOURCE, scope: 'district-driving', qualificationId: QUALIFICATION, qualificationVersion: 1, issuedAt: 0, status: 'revoked' as const }
  return {
    actor, cityId: CITY, at, resourceId: RESOURCE,
    qualification: { id: q.id, version: q.version, status: witnessed ? q.status : 'revoked' },
    permission: { actor: p.actor, resourceId: p.resourceId, scope: p.scope, qualificationId: p.qualificationId,
      qualificationVersion: p.qualificationVersion, issuedAt: p.issuedAt, status: witnessed ? p.status : 'revoked' },
    route: { id: proof.route.id, version: proof.route.version, cityId: CITY, depotId: DEPOT, verified: true, available: proof.availability.route },
    depot: { id: DEPOT, cityId: CITY, available: proof.availability.depot },
  }
}
function readFleet(root: World | null): FleetState | null | false {
  if (!root || !owns(root, 'fleet')) return null
  return readValidatedFleetState(root.fleet) ?? false
}
function readTrip(value: unknown, actor: string, proof: AcceptedMappedPhysicalEvidence): MappedTripRecord | null {
  try {
  const keys = ['v', 'publicId', 'tripId', 'cityId', 'location', 'routeId', 'routeVersion', 'fleetUnitId', 'qualificationId', 'qualificationVersion', 'permissionIssuedAt', 'pins', 'supplierCheckpoint', 'shopCheckpoint', 'depotCheckpoint', 'createdAt', 'updatedAt', 'lastInputAt', 'creditMs', 'revision', 'nextSequence', 'state', 'status', 'lastPacket']
  if (!record(value) || !exact(value, keys) || value.v !== 1 || value.publicId !== actor || !id(value.tripId) || value.cityId !== CITY
    || value.location !== proof.location || value.routeId !== proof.route.id || value.routeVersion !== proof.route.version
    || !id(value.fleetUnitId) || value.qualificationId !== QUALIFICATION || value.qualificationVersion !== 1
    || !time(value.permissionIssuedAt) || JSON.stringify(value.pins) !== JSON.stringify(proof.pins)
    || value.supplierCheckpoint !== proof.route.checkpoints.findIndex(check => check.id === proof.supplierCheckpointId)
    || value.shopCheckpoint !== proof.route.checkpoints.findIndex(check => check.id === proof.shopCheckpointId)
    || value.depotCheckpoint !== proof.route.checkpoints.findIndex(check => check.id === proof.depotCheckpointId)
    || !time(value.createdAt) || !time(value.updatedAt) || !time(value.lastInputAt) || value.createdAt > value.updatedAt || value.lastInputAt > value.updatedAt
    || !count(value.creditMs) || value.creditMs >= MAX_CREDIT_MS || !count(value.revision, 1) || !count(value.nextSequence, 1)
    || (value.status !== 'active' && value.status !== 'recovery' && value.status !== 'returned')) return null
  const state = readValidatedDrivingState(value.state, proof.route)
  if (!state || state.status === 'complete' !== (value.status === 'returned') || value.status === 'recovery' && state.status !== 'paused') return null
  let lastPacket: PacketReceipt | null = null
  if (value.lastPacket !== null) {
    if (!record(value.lastPacket) || !exact(value.lastPacket, ['sequence', 'fingerprint', 'code']) || !count(value.lastPacket.sequence, 1)
      || typeof value.lastPacket.fingerprint !== 'string' || value.lastPacket.fingerprint.length < 8 || value.lastPacket.fingerprint.length > 1600
      || (value.lastPacket.code !== 'controls_accepted' && value.lastPacket.code !== 'trip_completed')) return null
    lastPacket = { sequence: value.lastPacket.sequence, fingerprint: value.lastPacket.fingerprint, code: value.lastPacket.code }
  }
  if (value.nextSequence > value.revision || (lastPacket === null ? value.nextSequence !== 1 : lastPacket.sequence !== value.nextSequence - 1)
    || (state.status === 'complete' ? lastPacket?.code !== 'trip_completed' : lastPacket?.code === 'trip_completed')) return null
  const result = { ...(value as unknown as MappedTripRecord), state }
  if ((byteLength(result) ?? Infinity) > MAX_ROW_BYTES) return null
  return result
  } catch { return null }
}
function readOwnerTrip(root: World | null, actor: string): MappedTripRecord | null | false {
  if (!root || !owns(root, 'mappedTrips')) return null
  const rows = rowsFor(root, 'mappedTrips'); if (!rows) return false
  if (boundedRows(rows) > MAX_RECORDS) return false
  if (!owns(rows, actor)) return null
  // Structural validation is possible before a current physical resolver supplies the route;
  // geometry/state validation still happens in readTrip against that exact route.
  const value = rows[actor]
  const keys = ['v', 'publicId', 'tripId', 'cityId', 'location', 'routeId', 'routeVersion', 'fleetUnitId', 'qualificationId', 'qualificationVersion', 'permissionIssuedAt', 'pins', 'supplierCheckpoint', 'shopCheckpoint', 'depotCheckpoint', 'createdAt', 'updatedAt', 'lastInputAt', 'creditMs', 'revision', 'nextSequence', 'state', 'status', 'lastPacket']
  if (!record(value) || !exact(value, keys) || value.v !== 1 || value.publicId !== actor || !id(value.tripId) || value.cityId !== CITY
    || !id(value.location) || !id(value.routeId) || !id(value.routeVersion) || !id(value.fleetUnitId)
    || value.qualificationId !== QUALIFICATION || value.qualificationVersion !== 1 || !time(value.permissionIssuedAt)
    || !proofPins(value.pins) || !count(value.supplierCheckpoint) || value.supplierCheckpoint >= 64
    || !count(value.shopCheckpoint) || value.shopCheckpoint >= 64 || !count(value.depotCheckpoint) || value.depotCheckpoint >= 64
    || value.shopCheckpoint <= value.supplierCheckpoint || value.depotCheckpoint <= value.shopCheckpoint
    || !time(value.createdAt) || !time(value.updatedAt) || !time(value.lastInputAt) || value.createdAt > value.updatedAt || value.lastInputAt > value.updatedAt
    || !count(value.creditMs) || value.creditMs >= MAX_CREDIT_MS || !count(value.revision, 1) || !count(value.nextSequence, 1)
    || (value.status !== 'active' && value.status !== 'recovery' && value.status !== 'returned')) return false
  const state = value.state
  if (!record(state) || !exact(state, ['routeId', 'routeVersion', 'position', 'heading', 'speed', 'checkpointIndex', 'checkpointEntry', 'stopDwellMs', 'score', 'status', 'assessment', 'feedback'])
    || state.routeId !== value.routeId || state.routeVersion !== value.routeVersion || !record(state.position)
    || !exact(state.position, ['x', 'z']) || !finite(state.position.x) || Math.abs(state.position.x) > 100_000
    || !finite(state.position.z) || Math.abs(state.position.z) > 100_000
    || !finite(state.heading) || Math.abs(state.heading) > Math.PI * 1_000 || !finite(state.speed) || state.speed < 0 || state.speed > 20
    || !count(state.checkpointIndex) || state.checkpointIndex > 64
    || typeof state.checkpointEntry !== 'string' || !['blocked', 'armed', 'entered'].includes(state.checkpointEntry)
    || !finite(state.stopDwellMs) || state.stopDwellMs < 0 || state.stopDwellMs >= 1_000
    || !finite(state.score) || state.score < 0 || state.score > 100 || typeof state.status !== 'string' || !['running', 'paused', 'complete'].includes(state.status)
    || typeof state.assessment !== 'string' || !['pending', 'passed', 'failed'].includes(state.assessment) || typeof state.feedback !== 'string' || state.feedback.length > 160
    || (state.status === 'complete') !== (value.status === 'returned') || value.status === 'recovery' && state.status !== 'paused'
    || state.status === 'paused' && (state.speed !== 0 || state.stopDwellMs !== 0)
    || state.status === 'complete' && (state.checkpointIndex !== value.depotCheckpoint + 1 || state.speed !== 0 || state.stopDwellMs !== 0
      || state.assessment !== (state.score >= 70 ? 'passed' : 'failed'))
    || state.status !== 'complete' && (state.checkpointIndex > value.depotCheckpoint || state.assessment !== 'pending')) return false
  if (value.lastPacket !== null && (!record(value.lastPacket) || !exact(value.lastPacket, ['sequence', 'fingerprint', 'code'])
    || !count(value.lastPacket.sequence, 1) || typeof value.lastPacket.fingerprint !== 'string' || value.lastPacket.fingerprint.length < 8
    || value.lastPacket.fingerprint.length > 1600 || (value.lastPacket.code !== 'controls_accepted' && value.lastPacket.code !== 'trip_completed'))) return false
  // The pure route reader performs tighter speed, coordinate, assessment and checkpoint checks.
  if (value.nextSequence > value.revision || (value.lastPacket === null ? value.nextSequence !== 1 : value.lastPacket.sequence !== value.nextSequence - 1)
    || (state.status === 'complete' ? value.lastPacket?.code !== 'trip_completed' : value.lastPacket?.code === 'trip_completed')) return false
  return (byteLength(value) ?? Infinity) <= MAX_ROW_BYTES ? value as unknown as MappedTripRecord : false
}
function writeRows(db: Db, actor: string, trip: MappedTripRecord, fleet: FleetState, ctx: RouteContext): void {
  if ((byteLength(trip) ?? Infinity) > MAX_ROW_BYTES) throw ctx.fail(507, 'mapped_trip_record_too_large')
  const root = world(db) ?? {}
  const rows = owns(root, 'mappedTrips') ? rowsFor(root, 'mappedTrips') : {}
  if (!rows) throw ctx.fail(503, 'mapped_trip_storage_unavailable')
  const rowCount = boundedRows(rows)
  if (rowCount > MAX_RECORDS) throw ctx.fail(503, 'mapped_trip_storage_quarantined')
  if (!owns(rows, actor) && rowCount >= MAX_RECORDS) throw ctx.fail(507, 'mapped_trip_capacity')
  Object.defineProperty(rows, actor, { value: trip, enumerable: true, configurable: true, writable: true })
  root.mappedTrips = rows; root.fleet = fleet; db.livingWorld = root
}
function view(row: MappedTripRecord, route: DrivingRoute): MappedTripView {
  const { state } = row
  return {
    tripId: row.tripId, fleetUnitId: row.fleetUnitId, cityId: row.cityId, location: row.location,
    routeId: row.routeId, routeVersion: row.routeVersion, revision: row.revision, nextSequence: row.nextSequence,
    route, state: { routeId: state.routeId, routeVersion: state.routeVersion, position: { ...state.position }, heading: state.heading,
      speed: state.speed, checkpointIndex: state.checkpointIndex, checkpointEntry: state.checkpointEntry,
      stopDwellMs: state.stopDwellMs, status: state.status, feedback: state.feedback },
    supplierCheckpoint: row.supplierCheckpoint, shopCheckpoint: row.shopCheckpoint, depotCheckpoint: row.depotCheckpoint,
    recovery: row.status === 'recovery',
  }
}
function pauseRecord(row: MappedTripRecord, now: number, message: string, recovery = false): void {
  row.state = pauseDriving(row.state, message); row.creditMs = 0
  row.lastInputAt = Math.max(now, row.updatedAt); row.updatedAt = row.lastInputAt; row.revision++
  if (recovery) row.status = 'recovery'
}
function exactInput(value: unknown): value is DrivingInput {
  return record(value) && exact(value, ['throttle', 'brake', 'steer'])
    && typeof value.throttle === 'number' && Number.isFinite(value.throttle) && value.throttle >= 0 && value.throttle <= 1
    && typeof value.brake === 'number' && Number.isFinite(value.brake) && value.brake >= 0 && value.brake <= 1
    && typeof value.steer === 'number' && Number.isFinite(value.steer) && value.steer >= -1 && value.steer <= 1
}
function parse(value: unknown, kind: 'start' | 'input' | 'lifecycle'): MappedTripStartRequest | MappedTripControlRequest | MappedTripLifecycleRequest | null {
  if (!record(value)) return null
  if (kind === 'start') return exact(value, ['cityId', 'requestId']) && value.cityId === CITY && id(value.requestId)
    ? { cityId: CITY, requestId: value.requestId } : null
  if (kind === 'input') return exact(value, ['cityId', 'tripId', 'sequence', 'frames']) && value.cityId === CITY && id(value.tripId)
    && count(value.sequence, 1) && Array.isArray(value.frames) && value.frames.length > 0 && value.frames.length <= MAX_FRAMES
    && value.frames.every(exactInput) ? { cityId: CITY, tripId: value.tripId, sequence: value.sequence, frames: value.frames } : null
  return exact(value, ['cityId', 'requestId', 'tripId', 'revision']) && value.cityId === CITY && id(value.requestId) && id(value.tripId) && count(value.revision, 1)
    ? { cityId: CITY, requestId: value.requestId, tripId: value.tripId, revision: value.revision } : null
}
function cityOf(ctx: RouteContext, value: unknown): CityId | null { return typeof value === 'string' && ctx.cityIds.some(city => city === value) ? value as CityId : null }
function access(ctx: RouteContext, db: Db, request: RouteRequest, city: CityId) {
  const session = request.requireSession(db, { renew: true })
  if (!ctx.allow(`living-world:mapped-trip:${session.publicId}`, 660, 60_000)) throw ctx.fail(429, 'rate_limited')
  ctx.checks?.cityGate?.(session, city)
  if (characterCity(session) !== city) throw ctx.fail(409, 'city_moved')
  const life = ctx.settle(session, city)
  if (life.onboarding.required) throw ctx.fail(403, 'onboarding_required')
  if (life.activeAction !== null) throw ctx.fail(409, 'busy')
  if (!id(life.location)) throw ctx.fail(409, 'mapped_trip_location_unavailable')
  return { session, location: life.location }
}
function eligibleStart(auth: Auth, actor: string, now: number): boolean { return authMatches(auth, actor, CITY, now) }
function startFingerprint(actor: string, location: string, proof: AcceptedMappedPhysicalEvidence, permissionIssuedAt: number): string {
  return JSON.stringify([CITY, actor, location, proof.route.id, proof.route.version, proof.supplierCheckpointId,
    proof.shopCheckpointId, proof.depotCheckpointId, permissionIssuedAt, proof.pins])
}

/**
 * Both physical dependencies are absent in production until static route/depot and per-frame
 * swept-motion checks have accepted source-backed implementations. Their injectable forms exist
 * for service-contract fixtures and later host wiring; no HTTP request can furnish either one.
 */
export function createMappedTripService(ctx: RouteContext, resolver?: MappedPhysicalResolver, motionVerifier?: MappedMotionVerifier) {
  async function resolve(db: Db, session: SessionRecord, location: string, at: number, auth: Auth, tripId: string | null) {
    if (!resolver || !motionVerifier) return null
    const qualification = auth.qualification !== null && auth.qualification !== false ? auth.qualification.qualification : null
    const permission = auth.rental !== null && auth.rental !== false ? auth.rental.entitlement : null
    let raw: unknown
    try {
      raw = await resolver({ db, session, cityId: CITY, location, at,
        qualification: qualification ? { id: qualification.id, version: qualification.version, status: qualification.status } : null,
        permission: permission ? { ...permission } : null, tripId })
    } catch { return null }
    return inspectEvidence(raw, session.publicId, location, at)
  }

  async function verifyCandidate(actor: string, location: string, row: MappedTripRecord, fleet: FleetState, lease: FleetLease,
    at: number, proof: AcceptedMappedPhysicalEvidence, from: DrivingState, to: DrivingState): Promise<boolean> {
    if (!motionVerifier) return false
    const route: DrivingRoute = {
      id: proof.route.id, version: proof.route.version, roadWidth: proof.route.roadWidth, speedLimit: proof.route.speedLimit,
      roads: proof.route.roads.map(road => road.map(point => ({ x: point.x, z: point.z }))),
      checkpoints: proof.route.checkpoints.map(check => ({ ...check, center: { ...check.center } })),
    }
    const pins = { ...proof.pins }
    const fromState = { ...from, position: { ...from.position } }, toState = { ...to, position: { ...to.position } }
    const fleetUnitId = lease.tripId === row.tripId ? row.fleetUnitId : ''
    const leaseGeneration = lease.generation, leaseStartRevision = lease.startRevision, fleetRevision = fleet.revision
    if (!id(fleetUnitId) || lease.actor !== actor || lease.tripId !== row.tripId || lease.status !== 'active'
      || lease.generation <= 0 || !count(fleetRevision)) return false
    const unsealed: Omit<MappedMotionVerifierInput, 'fingerprint'> = {
      actor, cityId: CITY, location, tripId: row.tripId, fleetUnitId, leaseGeneration, leaseStartRevision, fleetRevision,
      at, route, pins, from: fromState, to: toState,
    }
    const fingerprint = motionFingerprint(unsealed)
    const expected: MotionExpectation = { actor, cityId: CITY, location, tripId: row.tripId, fleetUnitId,
      leaseGeneration, leaseStartRevision, fleetRevision, at, routeId: route.id, routeVersion: route.version, fingerprint, pinsJson: JSON.stringify(pins) }
    // Freeze the independent copies passed to host code; expected bindings above are separate immutable scalars.
    for (const road of route.roads) { for (const point of road) Object.freeze(point); Object.freeze(road) }
    for (const checkpoint of route.checkpoints) { Object.freeze(checkpoint.center); Object.freeze(checkpoint) }
    Object.freeze(route.roads); Object.freeze(route.checkpoints); Object.freeze(route); Object.freeze(pins)
    Object.freeze(fromState.position); Object.freeze(toState.position); Object.freeze(fromState); Object.freeze(toState)
    const input: MappedMotionVerifierInput = Object.freeze({ ...unsealed, fingerprint })
    try { return verifiedMotion(await motionVerifier(input), expected) } catch { return false }
  }

  function current(request: RouteRequest, cityUnknown: unknown): Promise<MappedTripResponse> {
    const city = cityOf(ctx, cityUnknown)
    if (city !== CITY) throw ctx.fail(400, 'invalid_city')
    return ctx.store.transact(async db => {
      const { session, location } = access(ctx, db, request, city), root = world(db)
      let now = ctx.now()
      if (!time(now)) return response(null, 'invalid_server_clock')
      const raw = readOwnerTrip(root, session.publicId)
      if (raw === false) return response(null, 'mapped_trip_quarantined', false, 'Saved trip data is malformed and has been left unchanged.')
      let auth = readAuth(db, session.publicId)
      if (auth.qualification === false || auth.rental === false || auth.evidence === false) return response(null, 'authority_quarantined')
      const proof = await resolve(db, session, location, now, auth, raw?.tripId ?? null)
      if (!proof) return response(null, 'physical_evidence_unavailable', false, 'Mapped vehicle evidence is not accepted; no trip state changed.')
      if (!raw) return response(null, 'no_trip', true)
      const saved = readTrip(raw, session.publicId, proof)
      if (!saved) return response(null, 'mapped_trip_quarantined', false, 'Saved trip data does not match the current accepted route and has been left unchanged.')
      if (saved.cityId !== city || saved.location !== location) return response(view(saved, proof.route), 'trip_location_changed')
      const fs = readFleet(root)
      if (fs === false) return response(null, 'fleet_quarantined')
      const fleet = fs ?? emptyFleetState(), evidence = fleetEvidence(session.publicId, now, auth, proof)
      if (!evidence) return response(null, 'authority_unavailable')
      if (saved.status === 'returned') {
        const returned = fleet.units.find(unit => unit.id === saved.fleetUnitId)?.lease
        if (!returned || returned.tripId !== saved.tripId || returned.actor !== session.publicId || returned.status !== 'returned')
          return response(null, 'fleet_quarantined', false, 'Returned trip and fleet custody do not match; saved records were left unchanged.')
        return response(view(saved, proof.route), 'current', true)
      }
      const revalidated = revalidateFleetLease(fleet, { tripId: saved.tripId, expectedRevision: fleet.revision }, evidence)
      if (revalidated.code === 'recovery_required') {
        if (saved.status !== 'recovery') {
          if (saved.revision >= MAX) return response(view(saved, proof.route), 'revision_exhausted')
          pauseRecord(saved, now, 'Trip authority changed. The vehicle is stopped and retained for recovery.', true)
          writeRows(db, session.publicId, saved, revalidated.state, ctx)
        }
        return response(view(saved, proof.route), 'recovery_required', false, 'The vehicle is stopped and retained; verified recovery-return support is not available yet.')
      }
      if (!revalidated.ok) return response(view(saved, proof.route), revalidated.code)
      if (saved.status === 'recovery') return response(view(saved, proof.route), 'recovery_required')
      if (saved.state.status === 'running') {
        // Bootstrap never preserves held throttle. An accepted route is required before this stop write.
        if (saved.revision >= MAX) return response(view(saved, proof.route), 'revision_exhausted')
        pauseRecord(saved, now, 'Trip paused after reload; explicitly resume before driving.')
        writeRows(db, session.publicId, saved, fleet, ctx)
      }
      return response(view(saved, proof.route), 'current', true)
    })
  }

  function start(request: RouteRequest, body: unknown): Promise<MappedTripResponse> {
    const parsed = parse(body, 'start') as MappedTripStartRequest | null
    if (!parsed) throw ctx.fail(400, 'invalid_mapped_trip_request')
    const city = cityOf(ctx, parsed.cityId)
    if (city !== CITY) throw ctx.fail(400, 'invalid_city')
    const receiptAt = ctx.onceId(parsed.requestId)
    return ctx.store.transact(async db => {
      const { session, location } = access(ctx, db, request, city)
      let now = ctx.now()
      if (!time(now) || !time(receiptAt) || receiptAt > now) return response(null, 'invalid_server_clock')
      let auth = readAuth(db, session.publicId)
      if (auth.qualification === false || auth.rental === false || auth.evidence === false) return response(null, 'authority_quarantined')
      if (!eligibleStart(auth, session.publicId, now)) return response(null, 'starter_permission_required')
      const proof = await resolve(db, session, location, now, auth, null)
      if (!proof) return response(null, 'physical_evidence_unavailable', false, 'Route, depot, vehicle, actor, terrain and yield evidence is not accepted.')
      const resolvedAt = ctx.now()
      if (!time(resolvedAt) || resolvedAt < now) return response(null, 'clock_reversed')
      now = resolvedAt
      const currentAuth = readAuth(db, session.publicId)
      if (currentAuth.qualification === false || currentAuth.rental === false || currentAuth.evidence === false)
        return response(null, 'authority_quarantined')
      if (!authMatches(currentAuth, session.publicId, city, now)) return response(null, 'starter_permission_required')
      if (!proofFresh(proof, now)) return response(null, 'physical_evidence_stale')
      auth.qualification = currentAuth.qualification; auth.evidence = currentAuth.evidence; auth.rental = currentAuth.rental
      if (!proof.availability.route || !proof.availability.depot || !proof.availability.actorAtDepot)
        return response(null, 'mapped_start_unavailable')
      const root = world(db), savedRaw = readOwnerTrip(root, session.publicId)
      if (savedRaw === false) return response(null, 'mapped_trip_quarantined')
      const existing = savedRaw ? readTrip(savedRaw, session.publicId, proof) : null
      if (savedRaw && !existing) return response(null, 'mapped_trip_quarantined')
      const fleetRead = readFleet(root)
      if (fleetRead === false) return response(null, 'fleet_quarantined')
      const fleet = fleetRead ?? emptyFleetState()
      // The currentAuth false-sentinel quarantine was returned above; here only absence remains.
      const activeQualification = auth.qualification !== null ? auth.qualification.qualification : null
      const activeRental = auth.rental !== null ? auth.rental : null
      const p = activeRental?.entitlement
      if (!activeQualification || !p) return response(null, 'starter_permission_required')
      const fp = startFingerprint(session.publicId, location, proof, p.issuedAt)
      const receipt = ctx.once(db, session, { id: parsed.requestId, kind: 'living-world.mapped-trip.start', fingerprint: fp }, () => {
        if (existing && existing.status !== 'returned') return { ok: false, code: existing.status === 'recovery' ? 'recovery_required' : 'trip_exists', tripId: existing.tripId }
        const e = fleetEvidence(session.publicId, now, auth, proof)
        if (!e) return { ok: false, code: 'authority_unavailable' }
        const allocated = allocateFleetUnit(fleet, { cityId: CITY, requestId: parsed.requestId, expectedRevision: fleet.revision }, e)
        if (!allocated.ok || !allocated.unitId) return { ok: false, code: allocated.code }
        const unit = allocated.state.units.find(item => item.id === allocated.unitId)
        const lease = unit?.lease
        if (!lease) throw ctx.fail(503, 'fleet_allocation_incomplete')
        const route = proof.route, state = createDriving(route)
        const row: MappedTripRecord = {
          v: 1, publicId: session.publicId, tripId: lease.tripId, cityId: CITY, location, routeId: route.id, routeVersion: route.version,
          fleetUnitId: unit.id, qualificationId: QUALIFICATION, qualificationVersion: 1, permissionIssuedAt: p.issuedAt,
          pins: proof.pins, supplierCheckpoint: route.checkpoints.findIndex(check => check.id === proof.supplierCheckpointId),
          shopCheckpoint: route.checkpoints.findIndex(check => check.id === proof.shopCheckpointId), depotCheckpoint: route.checkpoints.findIndex(check => check.id === proof.depotCheckpointId),
          createdAt: now, updatedAt: now, lastInputAt: now, creditMs: 0, revision: 1, nextSequence: 1, state, status: 'active', lastPacket: null,
        }
        if (state.status !== 'running') return { ok: false, code: 'route_unavailable' }
        writeRows(db, session.publicId, row, allocated.state, ctx)
        return { ok: true, code: 'trip_started', tripId: row.tripId }
      })
      const raw = readOwnerTrip(world(db), session.publicId)
      if (raw === false) return response(null, 'mapped_trip_quarantined')
      if (receipt.ok !== true) return response(raw ? (readTrip(raw, session.publicId, proof) ? view(readTrip(raw, session.publicId, proof)!, proof.route) : null) : null, String(receipt.code ?? 'trip_start_refused'))
      const row = raw && readTrip(raw, session.publicId, proof)
      if (!row || row.tripId !== receipt.tripId) return response(row ? view(row, proof.route) : null, 'superseded_trip')
      return response(view(row, proof.route), String(receipt.code ?? 'trip_started'), true, undefined, 'duplicate' in receipt && receipt.duplicate)
    })
  }

  function input(request: RouteRequest, body: unknown): Promise<MappedTripResponse> {
    const parsed = parse(body, 'input') as MappedTripControlRequest | null
    if (!parsed) throw ctx.fail(400, 'invalid_mapped_trip_packet')
    return ctx.store.transact(async db => {
      const city = cityOf(ctx, parsed.cityId)
      if (city !== CITY) throw ctx.fail(400, 'invalid_city')
      const { session, location } = access(ctx, db, request, city), root = world(db)
      let now = ctx.now()
      if (!time(now)) return response(null, 'invalid_server_clock')
      const raw = readOwnerTrip(root, session.publicId)
      if (raw === false) return response(null, 'mapped_trip_quarantined')
      if (!raw) return response(null, 'trip_missing')
      if (raw.tripId !== parsed.tripId) return response(null, 'trip_mismatch')
      let auth = readAuth(db, session.publicId)
      if (auth.qualification === false || auth.rental === false || auth.evidence === false) return response(null, 'authority_quarantined')
      const proof = await resolve(db, session, location, now, auth, raw.tripId)
      if (!proof) return response(null, 'physical_evidence_unavailable', false, 'No accepted physical route evidence; no trip state changed.')
      const beforeResolveAt = now, resolvedAt = ctx.now()
      if (!time(resolvedAt)) return response(null, 'invalid_server_clock')
      const resolverClockReversed = resolvedAt < beforeResolveAt
      now = resolvedAt
      const currentAuth = readAuth(db, session.publicId)
      if (currentAuth.qualification === false || currentAuth.rental === false || currentAuth.evidence === false)
        return response(null, 'authority_quarantined')
      auth = currentAuth
      let row = readTrip(raw, session.publicId, proof)
      if (!row) return response(null, 'mapped_trip_quarantined')
      const tripId = row.tripId, fleetUnitId = row.fleetUnitId
      if (row.status === 'returned') {
        const fingerprint = JSON.stringify([city, parsed.tripId, parsed.sequence, parsed.frames]), prior = row.lastPacket
        if (prior?.sequence === parsed.sequence) return prior.fingerprint === fingerprint
          ? response(view(row, proof.route), prior.code, true, undefined, true)
          : response(view(row, proof.route), 'packet_conflict')
        return response(view(row, proof.route), 'trip_returned')
      }
      if (row.location !== location) return response(view(row, proof.route), 'trip_location_changed')
      const fs = readFleet(root)
      if (fs === false || !fs) return response(view(row, proof.route), 'fleet_quarantined')
      const tripClockReversed = now < Math.max(row.createdAt, row.updatedAt, row.lastInputAt)
      if (resolverClockReversed || tripClockReversed || !proofFresh(proof, now)) {
        if (row.state.status === 'running' && row.revision < MAX) {
          const reason = resolverClockReversed || tripClockReversed
            ? 'Server clock moved backwards while mapped trip authority was checked.'
            : 'Mapped route evidence expired while trip authority was checked.'
          pauseRecord(row, now, reason)
          writeRows(db, session.publicId, row, fs, ctx)
          return response(view(row, proof.route), resolverClockReversed || tripClockReversed ? 'clock_reversed' : 'physical_evidence_stale')
        }
        return response(view(row, proof.route), resolverClockReversed || tripClockReversed ? 'clock_reversed' : 'physical_evidence_stale')
      }
      const e = fleetEvidence(session.publicId, now, auth, proof)
      if (!e) return response(view(row, proof.route), 'authority_unavailable')
      const revalidated = revalidateFleetLease(fs, { tripId: row.tripId, expectedRevision: fs.revision }, e)
      if (revalidated.code === 'clock_reversed') {
        if (row.state.status === 'running' && row.revision < MAX) {
          pauseRecord(row, now, 'Server clock moved backwards; mapped trip controls are stopped.')
          writeRows(db, session.publicId, row, fs, ctx)
        }
        return response(view(row, proof.route), 'clock_reversed')
      }
      if (revalidated.code === 'recovery_required') {
        if (row.status !== 'recovery') {
          if (row.revision >= MAX) return response(view(row, proof.route), 'counter_exhausted')
          pauseRecord(row, now, 'Trip authority changed. The vehicle is stopped and retained for recovery.', true)
          writeRows(db, session.publicId, row, revalidated.state, ctx)
        }
        return response(view(row, proof.route), 'recovery_required')
      }
      if (!revalidated.ok) return response(view(row, proof.route), revalidated.code)
      if (row.status !== 'active' || row.state.status !== 'running') return response(view(row, proof.route), row.status === 'recovery' ? 'recovery_required' : 'trip_paused')
      const leasedUnit = fs.units.find(unit => unit.id === fleetUnitId)
      const lease = leasedUnit?.lease
      if (!lease || lease.tripId !== tripId || lease.actor !== session.publicId || lease.status !== 'active')
        return response(view(row, proof.route), 'fleet_lease_mismatch')
      if (row.revision >= MAX || row.nextSequence >= MAX) return response(view(row, proof.route), 'counter_exhausted')
      const elapsed = now - row.lastInputAt
      if (now < Math.max(row.createdAt, row.updatedAt, row.lastInputAt)) {
        pauseRecord(row, now, 'Server clock moved backwards; mapped trip controls are stopped.')
        writeRows(db, session.publicId, row, fs, ctx)
        return response(view(row, proof.route), 'clock_reversed')
      }
      if (elapsed > INPUT_TIMEOUT_MS) {
        pauseRecord(row, now, 'Mapped trip input timed out; resume explicitly before moving.')
        writeRows(db, session.publicId, row, fs, ctx)
        return response(view(row, proof.route), 'input_timeout')
      }
      const fingerprint = JSON.stringify([city, parsed.tripId, parsed.sequence, parsed.frames])
      const prior = row.lastPacket
      if (prior?.sequence === parsed.sequence) return prior.fingerprint === fingerprint
        ? response(view(row, proof.route), prior.code, true, undefined, true)
        : response(view(row, proof.route), 'packet_conflict')
      if (parsed.sequence !== row.nextSequence) return response(view(row, proof.route), 'sequence_conflict')
      const credit = Math.min(MAX_CREDIT_MS, row.creditMs + elapsed), cost = parsed.frames.length * FRAME_MS
      if (credit < cost) return response(view(row, proof.route), 'insufficient_time_credit')
      let state = row.state
      let sweepAccepted = true
      let sweepFailureCode = 'motion_unverified'
      let recoveryFleet: FleetState | null = null
      for (const frame of parsed.frames) {
        if (state.status !== 'running') break
        const candidate = stepDriving(state, frame, proof.route).state
        const verified = await verifyCandidate(session.publicId, location, row, fs, lease, now, proof, state, candidate)
        const afterVerifierAt = ctx.now()
        if (!time(afterVerifierAt)) { sweepAccepted = false; sweepFailureCode = 'invalid_server_clock'; break }
        if (afterVerifierAt < now || afterVerifierAt < Math.max(row.createdAt, row.updatedAt, row.lastInputAt)) {
          now = afterVerifierAt; sweepAccepted = false; sweepFailureCode = 'clock_reversed'; break
        }
        now = afterVerifierAt
        if (!verified) { sweepAccepted = false; sweepFailureCode = 'motion_unverified'; break }
        const latestAuth = readAuth(db, session.publicId)
        if (latestAuth.qualification === false || latestAuth.rental === false || latestAuth.evidence === false) {
          sweepAccepted = false; sweepFailureCode = 'authority_quarantined'; break
        }
        const latestFleet = readFleet(world(db))
        if (latestFleet === false || latestFleet === null) { sweepAccepted = false; sweepFailureCode = 'fleet_quarantined'; break }
        const latestUnit = latestFleet.units.find(unit => unit.id === fleetUnitId)
        const latestLease = latestUnit?.lease
        if (latestFleet.revision !== fs.revision || !latestLease || latestLease.tripId !== tripId
          || latestLease.actor !== session.publicId || latestLease.generation !== lease.generation
          || latestLease.startRevision !== lease.startRevision || latestLease.status !== 'active') {
          sweepAccepted = false; sweepFailureCode = 'fleet_revision_conflict'; break
        }
        const latestEvidence = fleetEvidence(session.publicId, now, latestAuth, proof)
        if (!latestEvidence) { sweepAccepted = false; sweepFailureCode = 'authority_unavailable'; break }
        const latestLeaseCheck = revalidateFleetLease(latestFleet,
          { tripId: row.tripId, expectedRevision: latestFleet.revision }, latestEvidence)
        if (latestLeaseCheck.code === 'recovery_required') {
          recoveryFleet = latestLeaseCheck.state; sweepAccepted = false; sweepFailureCode = 'recovery_required'; break
        }
        if (!latestLeaseCheck.ok) { sweepAccepted = false; sweepFailureCode = latestLeaseCheck.code; break }
        if (!proofFresh(proof, now)) { sweepAccepted = false; sweepFailureCode = 'physical_evidence_stale'; break }
        if (now - row.lastInputAt > INPUT_TIMEOUT_MS) { sweepAccepted = false; sweepFailureCode = 'input_timeout'; break }
        state = candidate
      }
      if (!sweepAccepted) {
        pauseRecord(row, now, 'The server could not verify current whole-vehicle motion authority. The trip is stopped for review.')
        if (recoveryFleet) row.status = 'recovery'
        writeRows(db, session.publicId, row, recoveryFleet ?? fs, ctx)
        return response(view(row, proof.route), sweepFailureCode, false, 'No candidate movement or checkpoint progress was saved.')
      }
      const commitCredit = Math.min(MAX_CREDIT_MS, row.creditMs + (now - row.lastInputAt))
      if (commitCredit < cost) return response(view(row, proof.route), 'insufficient_time_credit')
      const previous = row
      row = { ...row, state, creditMs: Math.max(0, commitCredit - cost), lastInputAt: now, updatedAt: now,
        nextSequence: row.nextSequence + 1, revision: row.revision + 1 }
      const completed = state.status === 'complete'
      row.lastPacket = { sequence: parsed.sequence, fingerprint, code: completed ? 'trip_completed' : 'controls_accepted' }
      let fleetAfter = fs
      if (completed) {
        const terminal = proof.route.checkpoints[row.depotCheckpoint]
        const atDepot = row.depotCheckpoint === proof.route.checkpoints.length - 1 && state.checkpointIndex === proof.route.checkpoints.length
          && state.speed === 0 && terminal !== undefined && Math.hypot(state.position.x - terminal.center.x, state.position.z - terminal.center.z) <= terminal.radius
          && proof.availability.depot
        if (!atDepot) return response(view(previous, proof.route), 'depot_return_not_verified')
        const released = returnFleetUnit(fs, { cityId: CITY, requestId: `mapped-return-${row.tripId}`, tripId: row.tripId, expectedRevision: fs.revision },
          { actor: session.publicId, tripId: row.tripId, unitId: row.fleetUnitId, cityId: CITY, depotId: DEPOT, verified: true, stopped: true, at: now })
        if (!released.ok) return response(view(previous, proof.route), released.code)
        fleetAfter = released.state; row.status = 'returned'
      }
      writeRows(db, session.publicId, row, fleetAfter, ctx)
      return response(view(row, proof.route), completed ? 'trip_completed' : 'controls_accepted', true)
    })
  }

  function transition(request: RouteRequest, body: unknown, target: 'paused' | 'running' | 'recovery'): Promise<MappedTripResponse> {
    const parsed = parse(body, 'lifecycle') as MappedTripLifecycleRequest | null
    if (!parsed) throw ctx.fail(400, 'invalid_mapped_trip_request')
    const receiptAt = ctx.onceId(parsed.requestId)
    return ctx.store.transact(async db => {
      const city = cityOf(ctx, parsed.cityId)
      if (city !== CITY) throw ctx.fail(400, 'invalid_city')
      const { session, location } = access(ctx, db, request, city), root = world(db)
      let now = ctx.now()
      if (!time(now) || !time(receiptAt) || receiptAt > now) return response(null, 'invalid_server_clock')
      const raw = readOwnerTrip(root, session.publicId)
      if (raw === false) return response(null, 'mapped_trip_quarantined')
      if (!raw || raw.tripId !== parsed.tripId) return response(null, raw ? 'trip_mismatch' : 'trip_missing')
      let auth = readAuth(db, session.publicId)
      if (auth.qualification === false || auth.rental === false || auth.evidence === false) return response(null, 'authority_quarantined')
      const proof = await resolve(db, session, location, now, auth, raw.tripId)
      if (!proof) return response(null, 'physical_evidence_unavailable', false, 'No accepted physical route evidence; no lifecycle state changed.')
      const beforeResolveAt = now, resolvedAt = ctx.now()
      if (!time(resolvedAt)) return response(null, 'invalid_server_clock')
      if (target === 'running' && resolvedAt < beforeResolveAt) return response(null, 'clock_reversed')
      now = resolvedAt
      const currentAuth = readAuth(db, session.publicId)
      if (currentAuth.qualification === false || currentAuth.rental === false || currentAuth.evidence === false)
        return response(null, 'authority_quarantined')
      auth = currentAuth
      if (target === 'running' && (!proofFresh(proof, now) || !authMatches(auth, session.publicId, city, now)))
        return response(null, proofFresh(proof, now) ? 'starter_permission_required' : 'physical_evidence_stale')
      const saved = readTrip(raw, session.publicId, proof)
      if (!saved) return response(null, 'mapped_trip_quarantined')
      if (saved.status === 'returned') return response(view(saved, proof.route), 'trip_returned')
      const fs = readFleet(root)
      if (!fs) return response(view(saved, proof.route), fs === false ? 'fleet_quarantined' : 'fleet_missing')
      if (target === 'running' && now < Math.max(saved.createdAt, saved.updatedAt, saved.lastInputAt)) {
        if (saved.state.status === 'running' && saved.revision < MAX) {
          pauseRecord(saved, now, 'Server clock moved backwards; mapped trip controls are stopped.')
          writeRows(db, session.publicId, saved, fs, ctx)
        }
        return response(view(saved, proof.route), 'clock_reversed')
      }
      const evidence = fleetEvidence(session.publicId, now, auth, proof)
      if (!evidence) return response(view(saved, proof.route), 'authority_unavailable')
      const fp = { ...parsed, location }
      const result = ctx.once(db, session, { id: parsed.requestId, kind: `living-world.mapped-trip.${target}`, fingerprint: fp }, () => {
        if (saved.revision !== parsed.revision) return { ok: false, code: 'revision_conflict' }
        if (saved.location !== location || saved.cityId !== city) return { ok: false, code: 'trip_location_changed' }
        if (target === 'recovery') {
          const checked = revalidateFleetLease(fs, { tripId: saved.tripId, expectedRevision: fs.revision }, evidence)
          if (checked.code !== 'recovery_required') return { ok: false, code: checked.ok ? 'recovery_not_required' : checked.code }
          if (saved.status !== 'recovery') {
            if (saved.revision >= MAX) return { ok: false, code: 'counter_exhausted' }
            pauseRecord(saved, now, 'Trip authority changed. The vehicle remains stopped in recovery.', true)
            writeRows(db, session.publicId, saved, checked.state, ctx)
            return { ok: true, code: 'recovery_required' }
          }
          return { ok: false, code: 'recovery_required' }
        }
        const checked = revalidateFleetLease(fs, { tripId: saved.tripId, expectedRevision: fs.revision }, evidence)
        if (!checked.ok || checked.code === 'recovery_required') {
          if (checked.code === 'recovery_required' && saved.status !== 'recovery' && saved.revision < MAX) {
            pauseRecord(saved, now, 'Trip authority changed. The vehicle remains stopped in recovery.', true)
            writeRows(db, session.publicId, saved, checked.state, ctx)
            return { ok: true, code: 'recovery_required' }
          }
          return { ok: false, code: checked.code }
        }
        if (!proof.availability.route || !proof.availability.depot || authMatches(auth, session.publicId, city, now) !== true)
          return { ok: false, code: 'trip_authority_unavailable' }
        if (target === 'paused') {
          if (saved.state.status !== 'running') return { ok: false, code: 'trip_not_running' }
          if (saved.revision >= MAX) return { ok: false, code: 'counter_exhausted' }
          pauseRecord(saved, now, 'Mapped trip paused; vehicle is stopped.')
        } else {
          if (saved.status !== 'active' || saved.state.status !== 'paused') return { ok: false, code: 'trip_not_paused' }
          if (now < Math.max(saved.createdAt, saved.updatedAt, saved.lastInputAt)) return { ok: false, code: 'clock_reversed' }
          if (saved.revision >= MAX) return { ok: false, code: 'counter_exhausted' }
          saved.state = { ...pauseDriving(saved.state), status: 'running', feedback: 'Mapped trip resumed; controls are accepted in timed server packets.' }
          saved.creditMs = 0; saved.lastInputAt = now; saved.updatedAt = now; saved.revision++
        }
        writeRows(db, session.publicId, saved, fs, ctx)
        return { ok: true, code: target === 'paused' ? 'paused' : 'resumed' }
      })
      const latestRaw = readOwnerTrip(world(db), session.publicId)
      const latest = latestRaw !== null && latestRaw !== false ? readTrip(latestRaw, session.publicId, proof) : null
      return response(latest ? view(latest, proof.route) : null, String(result.code ?? 'transition_refused'), result.ok === true,
        undefined, 'duplicate' in result && result.duplicate === true)
    })
  }

  return {
    current,
    start,
    input,
    pause: (request: RouteRequest, body: unknown) => transition(request, body, 'paused'),
    resume: (request: RouteRequest, body: unknown) => transition(request, body, 'running'),
    recover: (request: RouteRequest, body: unknown) => transition(request, body, 'recovery'),
  }
}

/** Owner-scoped sanitized reader for future privacy/export integration; never enumerates fleet actors. */
export interface MappedTripOwnerSummary {
  tripId: string; cityId: CityId; location: string; routeId: string; routeVersion: string
  revision: number; status: 'active' | 'recovery' | 'returned'
}
export function readMappedTripForOwner(db: Db, publicId: string): MappedTripOwnerSummary | null | false {
  if (!id(publicId)) return false
  if (db.livingWorld !== undefined && !record(db.livingWorld)) return false
  const root = world(db), value = readOwnerTrip(root, publicId)
  if (value === false || value === null) return value
  const keys = ['v', 'publicId', 'tripId', 'cityId', 'location', 'routeId', 'routeVersion', 'fleetUnitId', 'qualificationId', 'qualificationVersion', 'permissionIssuedAt', 'pins', 'supplierCheckpoint', 'shopCheckpoint', 'depotCheckpoint', 'createdAt', 'updatedAt', 'lastInputAt', 'creditMs', 'revision', 'nextSequence', 'state', 'status', 'lastPacket']
  if (!exact(value as unknown as Record<string, unknown>, keys) || value.publicId !== publicId || !id(value.tripId) || value.cityId !== CITY
    || !id(value.location) || !id(value.routeId) || !id(value.routeVersion)
    || !count(value.revision, 1) || (value.status !== 'active' && value.status !== 'recovery' && value.status !== 'returned')
    || (byteLength(value) ?? Infinity) > MAX_ROW_BYTES) return false
  return { tripId: value.tripId, cityId: CITY, location: value.location, routeId: value.routeId,
    routeVersion: value.routeVersion, revision: value.revision, status: value.status }
}

/**
 * Erasure may remove a trip row only when no shared fleet lease still names that actor. The
 * current fleet schema retains actor IDs even after return, so this intentionally refuses after
 * allocation until a reviewed anonymous fleet-watermark migration exists.
 */
export function eraseMappedTripForOwner(db: Db, publicId: string): boolean {
  if (!id(publicId)) return false
  if (db.livingWorld !== undefined && !record(db.livingWorld)) return false
  const root = world(db), value = readOwnerTrip(root, publicId)
  if (value === false) return false
  if (value === null) return true
  const fleet = readFleet(root)
  if (fleet === false || !fleet) return false
  if (fleet.units.some(unit => unit.lease?.actor === publicId)) return false
  const rows = rowsFor(root, 'mappedTrips')
  if (!rows) return false
  delete rows[publicId]
  root!.mappedTrips = rows; db.livingWorld = root!
  return true
}
