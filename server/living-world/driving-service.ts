/** Server authority for the deterministic district practice course. */
import { characterCity } from '../character.ts'
import type { CityId } from '../../src/types/protocol.ts'
import { createDriving, pauseDriving, readValidatedDrivingState, stepDriving } from '../../src/game/living-world/driving.ts'
import type { DrivingInput, DrivingState } from '../../src/game/living-world/driving.ts'
import { PRACTICE_COURSE } from '../../src/game/living-world/course.ts'
import type { DrivingControlPacket, DrivingLifecycleRequest, DrivingResponse, DrivingSessionView } from '../../src/types/living-world.ts'
import type { Db, RouteContext, RouteRequest, SessionRecord } from '../types.ts'

const FRAME_MS = 100
const MAX_FRAMES = 5
const MAX_CREDIT_MS = 500
const INPUT_TIMEOUT_MS = 1500
const MAX_RECORD_BYTES = 4096
const MAX_RECORDS = 1024
const MAX_TIME = Number.MAX_SAFE_INTEGER
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const safeTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 100 && /^[\w:-]+$/.test(value)
const utf8Size = (value: string): number => new TextEncoder().encode(value).byteLength

type PacketReceipt = { sequence: number; fingerprint: string; code: string }
type DrivingRecord = {
  v: 1; publicId: string; journeyId: string; cityId: CityId; location: string
  createdAt: number; updatedAt: number; lastInputAt: number; creditMs: number
  revision: number; nextSequence: number; state: DrivingState; lastPacket: PacketReceipt | null
}
type LivingWorldCollection = Record<string, unknown> & { driving?: Record<string, unknown> }

/** Internal evidence reader: reads committed authority without pausing, repairing or creating a row.
 * false means the original source must remain quarantined; null means no passed assessment.
 * This is not a browser-supplied completion claim.
 */
export function readDrivingQualificationEvidence(db: Db, publicId: string): {
  journeyId: string; cityId: CityId; location: string; routeId: string; routeVersion: string; earnedAt: number
} | null | false {
  const root = db.livingWorld
  if (root === undefined) return null
  if (!isRecord(root)) return false
  if (!Object.hasOwn(root, 'driving')) return null
  if (!isRecord(root.driving)) return false
  if (!Object.hasOwn(root.driving, publicId)) return null
  const row = savedRecord(root.driving[publicId], publicId)
  if (!row) return false
  if (row.state.status !== 'complete' || row.state.assessment !== 'passed') return null
  return { journeyId: row.journeyId, cityId: row.cityId, location: row.location,
    routeId: row.state.routeId, routeVersion: row.state.routeVersion, earnedAt: row.updatedAt }
}

/** Storage reader is intentionally strict. Invalid rows are refused, never silently reset. */
function savedRecord(value: unknown, publicId: string): DrivingRecord | null {
  const recordKeys = ['v', 'publicId', 'journeyId', 'cityId', 'location', 'createdAt', 'updatedAt', 'lastInputAt', 'creditMs', 'revision', 'nextSequence', 'state', 'lastPacket']
  if (!isRecord(value) || !exactKeys(value, recordKeys) || value.v !== 1 || value.publicId !== publicId || !identifier(value.journeyId)
    || typeof value.cityId !== 'string' || !identifier(value.location) || !safeTime(value.createdAt)
    || !safeTime(value.updatedAt) || !safeTime(value.lastInputAt) || !Number.isInteger(value.creditMs)
    || (value.creditMs as number) < 0 || (value.creditMs as number) >= MAX_CREDIT_MS
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1
    || !Number.isSafeInteger(value.nextSequence) || (value.nextSequence as number) < 1
    || !(value.lastPacket === null || (isRecord(value.lastPacket) && exactKeys(value.lastPacket, ['sequence', 'fingerprint', 'code'])
      && Number.isSafeInteger(value.lastPacket.sequence) && (value.lastPacket.sequence as number) > 0
      && typeof value.lastPacket.fingerprint === 'string' && value.lastPacket.fingerprint.length <= 800
      && typeof value.lastPacket.code === 'string' && ['controls_accepted', 'lesson_completed'].includes(value.lastPacket.code)))) return null
  if ((value.createdAt as number) > (value.updatedAt as number) || (value.lastInputAt as number) > (value.updatedAt as number)
    || (value.nextSequence as number) > (value.revision as number)
    || (value.lastPacket === null ? value.nextSequence !== 1 : (value.lastPacket as PacketReceipt).sequence !== (value.nextSequence as number) - 1)) return null
  const stateKeys = ['routeId', 'routeVersion', 'position', 'heading', 'speed', 'checkpointIndex', 'checkpointEntry', 'stopDwellMs', 'score', 'status', 'assessment', 'feedback']
  if (!isRecord(value.state) || !exactKeys(value.state, stateKeys)) return null
  const state = readValidatedDrivingState(value.state, PRACTICE_COURSE)
  if (!state) return null
  // A completed assessment is recorded only by the accepted packet that completed it.
  // This prevents a corrupt/fabricated terminal save from being treated as a retryable run.
  if (state.status === 'complete' ? value.lastPacket === null || (value.lastPacket as PacketReceipt).code !== 'lesson_completed'
    : value.lastPacket !== null && (value.lastPacket as PacketReceipt).code === 'lesson_completed') return null
  let text: string
  try { text = JSON.stringify(value) } catch { return null }
  if (utf8Size(text) > MAX_RECORD_BYTES) return null
  return { ...value, state } as unknown as DrivingRecord
}

function collection(ctx: RouteContext, db: Db): { root: LivingWorldCollection; records: Record<string, unknown> } {
  const raw = ctx.collection(db, 'livingWorld', { driving: {} })
  if (!isRecord(raw)) throw ctx.fail(503, 'driving_storage_unavailable')
  const root = raw as LivingWorldCollection
  if (!Object.hasOwn(root, 'driving')) root.driving = {}
  if (!isRecord(root.driving)) throw ctx.fail(503, 'driving_storage_unavailable')
  return { root, records: root.driving }
}

function boundedCount(records: Record<string, unknown>): number {
  let count = 0
  for (const key in records) if (Object.hasOwn(records, key) && ++count > MAX_RECORDS) return count
  return count
}

function response(session: DrivingSessionView | null, code: string, ok: boolean, reason?: string, duplicate = false): DrivingResponse {
  return { ok, code, ...(reason ? { reason } : {}), ...(duplicate ? { duplicate: true } : {}), session,
    course: PRACTICE_COURSE, frameMs: FRAME_MS, maxFrames: MAX_FRAMES }
}
function view(row: DrivingRecord): DrivingSessionView {
  return { journeyId: row.journeyId, cityId: row.cityId, location: row.location, revision: row.revision,
    nextSequence: row.nextSequence, state: row.state }
}
function watermark(row: DrivingRecord): number { return Math.max(row.createdAt, row.updatedAt, row.lastInputAt) }
function pauseRecord(row: DrivingRecord, now: number, feedback: string): void {
  const at = Math.max(now, watermark(row))
  row.state = pauseDriving(row.state, feedback)
  row.creditMs = 0; row.lastInputAt = at; row.updatedAt = at; row.revision++
}
function writeRecord(records: Record<string, unknown>, row: DrivingRecord, ctx: RouteContext): void {
  const encoded = JSON.stringify(row)
  if (utf8Size(encoded) > MAX_RECORD_BYTES) throw ctx.fail(507, 'driving_record_too_large')
  records[row.publicId] = row
}
function cityOf(ctx: RouteContext, value: unknown): CityId | null {
  return typeof value === 'string' && ctx.cityIds.some((city) => city === value) ? value as CityId : null
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Reflect.ownKeys(value)
  return own.length === keys.length && own.every((key) => typeof key === 'string' && keys.includes(key))
}
function inputFrame(value: unknown): value is DrivingInput {
  return isRecord(value) && exactKeys(value, ['throttle', 'brake', 'steer'])
    && typeof value.throttle === 'number' && Number.isFinite(value.throttle) && value.throttle >= 0 && value.throttle <= 1
    && typeof value.brake === 'number' && Number.isFinite(value.brake) && value.brake >= 0 && value.brake <= 1
    && typeof value.steer === 'number' && Number.isFinite(value.steer) && value.steer >= -1 && value.steer <= 1
}
function lifecycle(value: unknown, includeJourney: boolean): value is DrivingLifecycleRequest {
  if (!isRecord(value) || !exactKeys(value, includeJourney ? ['cityId', 'requestId', 'journeyId', 'revision'] : ['cityId', 'requestId'])) return false
  return typeof value.cityId === 'string' && identifier(value.requestId)
    && (!includeJourney || (identifier(value.journeyId) && Number.isSafeInteger(value.revision) && (value.revision as number) >= 1))
}
function packet(value: unknown): value is DrivingControlPacket {
  if (!isRecord(value) || !exactKeys(value, ['cityId', 'journeyId', 'sequence', 'frames'])) return false
  return typeof value.cityId === 'string' && identifier(value.journeyId) && Number.isSafeInteger(value.sequence)
    && (value.sequence as number) >= 1 && Array.isArray(value.frames) && value.frames.length >= 1
    && value.frames.length <= MAX_FRAMES && value.frames.every(inputFrame)
}

export function createDrivingService(ctx: RouteContext) {
  function access(db: Db, request: RouteRequest, requestedCity: CityId): { session: SessionRecord; location: string } {
    const session = request.requireSession(db, { renew: true })
    if (!ctx.allow(`living-world:driving:${session.publicId}`, 660, 60_000)) throw ctx.fail(429, 'rate_limited')
    ctx.checks?.cityGate?.(session, requestedCity)
    if (characterCity(session) !== requestedCity) throw ctx.fail(409, 'city_moved')
    const life = ctx.settle(session, requestedCity)
    // Existing action authorization treats the quick-start hold as the gate. Confirmed guests
    // and legacy lives with done:false/required:false keep their established access.
    if (life.onboarding.required) throw ctx.fail(403, 'onboarding_required')
    if (life.activeAction !== null) throw ctx.fail(409, 'busy')
    if (!identifier(life.location)) throw ctx.fail(409, 'driving_location_unavailable')
    return { session, location: life.location }
  }

  function existing(records: Record<string, unknown>, publicId: string): DrivingRecord | null | false {
    if (!Object.hasOwn(records, publicId)) return null
    const row = savedRecord(records[publicId], publicId)
    return row ?? false
  }

  function current(request: RouteRequest, cityUnknown: unknown): Promise<DrivingResponse> {
    const cityId = cityOf(ctx, cityUnknown)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    return ctx.store.transact((db) => {
      const { session, location } = access(db, request, cityId)
      const { records } = collection(ctx, db)
      const found = existing(records, session.publicId)
      if (found === false) return response(null, 'invalid_saved_journey', false, 'Saved driving data is invalid and has been kept for recovery.')
      if (!found) return response(null, 'no_journey', true)
      if (found.state.status === 'running') {
        const now = ctx.now()
        if (!safeTime(now)) return response(view(found), 'invalid_server_clock', false)
        const why = found.cityId !== cityId ? 'Lesson paused because your character changed cities.'
          : found.location !== location ? 'Lesson paused because your character left the lesson location.'
            : 'Lesson paused after reload; resume through the server before driving.'
        pauseRecord(found, now, why)
        writeRecord(records, found, ctx)
      }
      if (found.cityId !== cityId) return response(null, 'no_journey', true)
      if (found.location !== location) return response(view(found), 'location_changed', false, 'Return to the location where this lesson began.')
      return response(view(found), 'current', true)
    })
  }

  function start(request: RouteRequest, body: unknown): Promise<DrivingResponse> {
    if (!lifecycle(body, false)) throw ctx.fail(400, 'invalid_driving_request')
    const cityId = cityOf(ctx, body.cityId)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    const onceAt = ctx.onceId(body.requestId)
    return ctx.store.transact((db) => {
      const { session, location } = access(db, request, cityId)
      const { records } = collection(ctx, db)
      const fp = { cityId, location }
      const result = ctx.once(db, session, { id: body.requestId, kind: 'living-world.driving.start', fingerprint: fp }, (_at) => {
        const now = ctx.now()
        if (!safeTime(now) || !safeTime(onceAt)) return { ok: false, code: 'invalid_server_clock' }
        const found = existing(records, session.publicId)
        if (found === false) return { ok: false, code: 'invalid_saved_journey' }
        if (found && found.state.assessment === 'passed') return { ok: false, code: 'assessment_retained', journeyId: found.journeyId, revision: found.revision }
        if (found && now < watermark(found)) return { ok: false, code: 'clock_reversed', journeyId: found.journeyId, revision: found.revision }
        if (found && found.state.status !== 'complete') {
          if (found.state.status === 'running' && (found.cityId !== cityId || found.location !== location)) {
            pauseRecord(found, now, 'Lesson paused because your character left its bound city or location.')
            writeRecord(records, found, ctx)
          }
          return { ok: false, code: found.state.status === 'running' ? 'journey_active' : 'journey_exists', journeyId: found.journeyId, revision: found.revision }
        }
        if (!found && boundedCount(records) >= MAX_RECORDS) return { ok: false, code: 'driving_capacity' }
        const row: DrivingRecord = { v: 1, publicId: session.publicId, journeyId: ctx.randomId(), cityId, location,
          createdAt: now, updatedAt: now, lastInputAt: now, creditMs: 0, revision: 1, nextSequence: 1,
          state: createDriving(PRACTICE_COURSE), lastPacket: null }
        if (row.state.status !== 'running') return { ok: false, code: 'course_unavailable' }
        writeRecord(records, row, ctx)
        return { ok: true, code: 'started', journeyId: row.journeyId, revision: row.revision, nextSequence: row.nextSequence, state: row.state }
      })
      const found = existing(records, session.publicId)
      if (found === null || found === false) return response(null, String(result.code ?? (found === false ? 'invalid_saved_journey' : 'driving_storage_unavailable')), false)
      if (result.ok !== true) return response(view(found), String(result.code ?? 'start_refused'), false)
      if (result.journeyId !== found.journeyId) return response(view(found), 'superseded_journey', false, undefined, true)
      return response(view(found), String(result.code ?? 'started'), true, undefined, 'duplicate' in result && result.duplicate === true)
    })
  }

  function input(request: RouteRequest, body: unknown): Promise<DrivingResponse> {
    if (!packet(body)) throw ctx.fail(400, 'invalid_driving_packet')
    const cityId = cityOf(ctx, body.cityId)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    const fingerprint = JSON.stringify({ cityId, journeyId: body.journeyId, sequence: body.sequence, frames: body.frames })
    return ctx.store.transact((db) => {
      const { session, location } = access(db, request, cityId)
      const { records } = collection(ctx, db)
      const found = existing(records, session.publicId)
      if (found === null || found === false) return response(null, found === false ? 'invalid_saved_journey' : 'no_journey', false)
      if (found.cityId !== cityId || found.location !== location) {
        if (found.state.status === 'running') {
          const now = ctx.now()
          if (!safeTime(now)) return response(view(found), 'invalid_server_clock', false)
          pauseRecord(found, now, 'Lesson paused because your character left its bound city or location.')
          writeRecord(records, found, ctx)
        }
        return response(view(found), found.cityId !== cityId ? 'city_mismatch' : 'location_changed', false)
      }
      if (found.journeyId !== body.journeyId) return response(view(found), 'journey_mismatch', false)
      const now = ctx.now()
      if (!safeTime(now)) return response(view(found), 'invalid_server_clock', false)
      const receipt = found.lastPacket
      const elapsed = now - found.lastInputAt
      let pauseCode: string | null = null
      if (found.state.status === 'running' && now < watermark(found)) {
        pauseRecord(found, now, 'Server clock moved backwards; the lesson is safely paused.')
        writeRecord(records, found, ctx)
        pauseCode = 'clock_reversed'
      } else if (found.state.status === 'running' && elapsed > INPUT_TIMEOUT_MS) {
        pauseRecord(found, now, 'Lesson timed out; resume explicitly to continue.')
        writeRecord(records, found, ctx)
        pauseCode = 'input_timeout'
      }
      if (receipt?.sequence === body.sequence) {
        if (receipt.fingerprint !== fingerprint) return response(view(found), 'packet_conflict', false)
        return response(view(found), receipt.code, true, undefined, true)
      }
      if (body.sequence !== found.nextSequence) return response(view(found), 'sequence_conflict', false)
      if (pauseCode) return response(view(found), pauseCode, false)
      if (found.state.status !== 'running') return response(view(found), found.state.status === 'complete' ? 'journey_complete' : 'journey_paused', false)
      const credit = Math.min(MAX_CREDIT_MS, found.creditMs + elapsed)
      const cost = body.frames.length * FRAME_MS
      if (credit < cost) return response(view(found), 'insufficient_time_credit', false)
      let state = found.state
      for (const frame of body.frames) {
        if (state.status !== 'running') break
        state = stepDriving(state, frame, PRACTICE_COURSE).state
      }
      found.state = state; found.creditMs = Math.max(0, credit - cost); found.lastInputAt = now; found.updatedAt = now
      found.nextSequence++; found.revision++
      const code = state.status === 'complete' ? 'lesson_completed' : 'controls_accepted'
      found.lastPacket = { sequence: body.sequence, fingerprint, code }
      writeRecord(records, found, ctx)
      return response(view(found), code, true)
    })
  }

  function transition(request: RouteRequest, body: unknown, target: 'paused' | 'running'): Promise<DrivingResponse> {
    if (!lifecycle(body, true)) throw ctx.fail(400, 'invalid_driving_request')
    const cityId = cityOf(ctx, body.cityId)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    ctx.onceId(body.requestId)
    return ctx.store.transact((db) => {
      const { session, location } = access(db, request, cityId)
      const { records } = collection(ctx, db)
      const result = ctx.once(db, session, { id: body.requestId, kind: `living-world.driving.${target}`, fingerprint: body }, (_at) => {
        const found = existing(records, session.publicId)
        if (found === null || found === false) return { ok: false, code: found === false ? 'invalid_saved_journey' : 'no_journey' }
        const now = ctx.now()
        if (!safeTime(now)) return { ok: false, code: 'invalid_server_clock' }
        if (found.journeyId !== body.journeyId) return { ok: false, code: 'journey_mismatch' }
        if (found.revision !== body.revision) return { ok: false, code: 'revision_conflict', journeyId: found.journeyId, revision: found.revision }
        if (found.cityId !== cityId || found.location !== location) {
          if (found.state.status === 'running') {
            pauseRecord(found, now, 'Lesson paused because your character left its bound city or location.')
            writeRecord(records, found, ctx)
          }
          return { ok: false, code: found.cityId !== cityId ? 'city_mismatch' : 'location_changed', journeyId: found.journeyId, revision: found.revision }
        }
        if (target === 'paused') {
          if (found.state.status !== 'running') return { ok: false, code: 'journey_not_running' }
          pauseRecord(found, now, 'Lesson paused; the vehicle is safely stopped.')
        } else {
          if (found.state.status !== 'paused') return { ok: false, code: 'journey_not_paused' }
          if (now < watermark(found)) return { ok: false, code: 'clock_reversed', journeyId: found.journeyId, revision: found.revision }
          const safe = pauseDriving(found.state)
          found.state = { ...safe, status: 'running', feedback: 'Lesson resumed; controls are accepted in timed packets.' }
          found.creditMs = 0
        }
        if (target === 'running') { found.updatedAt = now; found.lastInputAt = now; found.revision++ }
        writeRecord(records, found, ctx)
        return { ok: true, code: target === 'paused' ? 'paused' : 'resumed', journeyId: found.journeyId, revision: found.revision }
      })
      const found = existing(records, session.publicId)
      if (found === null || found === false) return response(null, String(result.code ?? 'journey_unavailable'), false)
      const matching = result.journeyId === found.journeyId
      return response(view(found), String(result.code ?? 'transition_refused'), result.ok === true && matching,
        result.ok === true && matching ? undefined : undefined, 'duplicate' in result && result.duplicate === true)
    })
  }

  return {
    current,
    start,
    input,
    resume: (request: RouteRequest, body: unknown) => transition(request, body, 'running'),
    pause: (request: RouteRequest, body: unknown) => transition(request, body, 'paused'),
  }
}
