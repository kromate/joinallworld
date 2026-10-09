/** Server authority for the fictional NPC clerk practice. No real case or justice record is read. */
import { characterCity } from '../character.ts'
import { clerkPracticeView, readClerkPractice, startClerkPractice, stepClerkPractice,
  type ClerkPracticeState, type ClerkPracticeStep, type ClerkPracticeView } from '../../src/game/living-world/clerk.ts'
import type { CityId } from '../../src/types/protocol.ts'
import type { Db, RouteContext, RouteRequest, SessionRecord } from '../types.ts'
import type { LifeState } from '../../src/types/life.ts'
import type { ClerkResponse } from '../../src/types/living-world-clerk.ts'

const MAX_RECORDS = 1024
const MAX_RECORD_BYTES = 4096
const MAX_TIME = Number.MAX_SAFE_INTEGER
const REWARD = 75
const STEPS = ['inspect_receipt', 'inspect_dispatch', 'compare_discrepancy', 'choose_outcome'] as const
const EVIDENCE = ['receipt', 'dispatch', 'compare-a', 'compare-b', 'compare-c', 'outcome-a', 'outcome-b', 'outcome-c'] as const

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const safeTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/.test(value)
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  try {
    const own = Reflect.ownKeys(value)
    return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key))
  } catch { return false }
}
const sizeOf = (value: unknown): number | null => {
  try {
    const text = JSON.stringify(value)
    return text === undefined || /[^\x00-\x7f]/.test(text) ? null : text.length
  } catch { return null }
}

export interface ClerkRecord {
  v: 1
  publicId: string
  account: string | null
  cityId: CityId
  location: string
  createdAt: number
  updatedAt: number
  practice: ClerkPracticeState
  claimed: boolean
  claimedAt: number | null
}
type ClerkCollection = Record<string, unknown> & { clerk?: Record<string, unknown> }

/** Strict reader for account privacy summaries. Callers retain malformed rows unchanged for recovery. */
export function readValidatedClerkRecord(value: unknown, publicId: string): ClerkRecord | null {
  try {
    if (!identifier(publicId) || !record(value) || !exactKeys(value, ['v', 'publicId', 'account', 'cityId', 'location', 'createdAt', 'updatedAt', 'practice', 'claimed', 'claimedAt'])
      || value.v !== 1 || value.publicId !== publicId || !(value.account === null || identifier(value.account))
      || value.cityId !== 'lagos' || !identifier(value.location) || !safeTime(value.createdAt) || !safeTime(value.updatedAt)
      || value.createdAt > value.updatedAt || typeof value.claimed !== 'boolean'
      || !(value.claimedAt === null || safeTime(value.claimedAt))) return null
    const practice = readClerkPractice(value.practice)
    if (!practice || practice.actorId !== publicId || (value.claimed
      ? practice.step !== 'complete' || !safeTime(value.claimedAt) || value.claimedAt !== value.updatedAt
      : value.claimedAt !== null)) return null
    const parsed: ClerkRecord = { v: 1, publicId, account: value.account as string | null, cityId: 'lagos', location: value.location,
      createdAt: value.createdAt, updatedAt: value.updatedAt, practice, claimed: value.claimed, claimedAt: value.claimedAt as number | null }
    return sizeOf(parsed) !== null && sizeOf(parsed)! <= MAX_RECORD_BYTES ? parsed : null
  } catch { return null }
}

function rowsCount(rows: Record<string, unknown>): number {
  let count = 0
  for (const key of Reflect.ownKeys(rows)) if (typeof key === 'string' && Object.hasOwn(rows, key) && ++count > MAX_RECORDS) return count
  return count
}
function collection(ctx: RouteContext, db: Db): Record<string, unknown> {
  try {
    const root = ctx.collection(db, 'livingWorld', { clerk: {} }) as ClerkCollection
    if (!record(root)) throw ctx.fail(503, 'clerk_storage_unavailable')
    if (!Object.hasOwn(root, 'clerk')) Object.defineProperty(root, 'clerk', { value: {}, enumerable: true, configurable: true, writable: true })
    if (!record(root.clerk)) throw ctx.fail(503, 'clerk_storage_unavailable')
    return root.clerk
  } catch (error) {
    if (record(error) && error.status === 503) throw error
    throw ctx.fail(503, 'clerk_storage_unavailable')
  }
}
function readRow(rows: Record<string, unknown>, publicId: string): ClerkRecord | null | false {
  if (!Object.hasOwn(rows, publicId)) return null
  return readValidatedClerkRecord(rows[publicId], publicId) ?? false
}
function write(rows: Record<string, unknown>, row: ClerkRecord, ctx: RouteContext): void {
  const size = sizeOf(row)
  if (size === null || size > MAX_RECORD_BYTES) throw ctx.fail(507, 'clerk_record_too_large')
  try { Object.defineProperty(rows, row.publicId, { value: row, enumerable: true, configurable: true, writable: true }) }
  catch { throw ctx.fail(503, 'clerk_storage_unavailable') }
}
function cityOf(ctx: RouteContext, value: unknown): CityId | null {
  return typeof value === 'string' && ctx.cityIds.some(city => city === value) ? value as CityId : null
}
function access(ctx: RouteContext, db: Db, request: RouteRequest, cityId: CityId): { session: SessionRecord; location: string; life: LifeState } {
  const session = request.requireSession(db, { renew: true })
  if (!ctx.allow(`living-world:clerk:${session.publicId}`, 120, 60_000)) throw ctx.fail(429, 'rate_limited')
  ctx.checks?.cityGate?.(session, cityId)
  if (characterCity(session) !== cityId) throw ctx.fail(409, 'city_moved')
  const life = ctx.settle(session, cityId)
  if (life.onboarding.required) throw ctx.fail(403, 'onboarding_required')
  if (life.activeAction !== null) throw ctx.fail(409, 'busy')
  if (!identifier(life.location)) throw ctx.fail(409, 'clerk_location_unavailable')
  return { session, location: life.location, life }
}
function matches(row: ClerkRecord, session: SessionRecord, cityId: CityId): string | null {
  if (row.account !== (session.account ?? null)) return 'account_changed'
  if (row.cityId !== cityId) return 'city_mismatch'
  return null
}
function response(row: ClerkRecord | null, code: string, ok: boolean, duplicate = false, reason?: string): ClerkResponse {
  const practice = row ? clerkPracticeView(row.practice) : null
  return { ok, code, ...(reason ? { reason } : {}), ...(duplicate ? { duplicate: true } : {}), practice,
    revision: row?.practice.revision ?? null, claimed: row?.claimed ?? false, reward: REWARD }
}
function parseStart(value: unknown): value is { cityId: string; requestId: string } {
  return record(value) && exactKeys(value, ['cityId', 'requestId']) && typeof value.cityId === 'string' && identifier(value.requestId)
}
function parseStep(value: unknown): value is { cityId: string; requestId: string; revision: number; stepId: Exclude<ClerkPracticeStep, 'complete'>; evidenceId: string } {
  return record(value) && exactKeys(value, ['cityId', 'requestId', 'revision', 'stepId', 'evidenceId'])
    && typeof value.cityId === 'string' && identifier(value.requestId) && Number.isSafeInteger(value.revision) && (value.revision as number) >= 0
    && typeof value.stepId === 'string' && (STEPS as readonly string[]).includes(value.stepId)
    && typeof value.evidenceId === 'string' && (EVIDENCE as readonly string[]).includes(value.evidenceId)
}
function parseClaim(value: unknown): value is { cityId: string; requestId: string; revision: number } {
  return record(value) && exactKeys(value, ['cityId', 'requestId', 'revision']) && typeof value.cityId === 'string'
    && identifier(value.requestId) && Number.isSafeInteger(value.revision) && (value.revision as number) >= 0
}

export function createClerkService(ctx: RouteContext) {
  function current(request: RouteRequest, cityUnknown: unknown): Promise<ClerkResponse> {
    const cityId = cityOf(ctx, cityUnknown)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    if (cityId !== 'lagos') throw ctx.fail(409, 'clerk_scenario_unavailable')
    return ctx.store.transact(db => {
      const { session } = access(ctx, db, request, cityId), rows = collection(ctx, db), row = readRow(rows, session.publicId)
      if (row === false) return response(null, 'invalid_saved_clerk', false, false, 'Saved clerk practice is quarantined and kept for recovery.')
      if (!row) return response(null, 'practice_ready', true)
      const mismatch = matches(row, session, cityId)
      if (mismatch) return response(null, mismatch, false)
      const now = ctx.now()
      if (!safeTime(now) || now < row.updatedAt) return response(row, 'invalid_server_clock', false)
      return response(row, row.claimed ? 'practice_claimed' : row.practice.step === 'complete' ? 'practice_completed' : 'practice_loaded', true)
    })
  }

  function start(request: RouteRequest, body: unknown): Promise<ClerkResponse> {
    if (!parseStart(body)) throw ctx.fail(400, 'invalid_clerk_request')
    const cityId = cityOf(ctx, body.cityId)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    if (cityId !== 'lagos') throw ctx.fail(409, 'clerk_scenario_unavailable')
    const receiptAt = ctx.onceId(body.requestId)
    return ctx.store.transact(db => {
      const { session, location } = access(ctx, db, request, cityId), rows = collection(ctx, db)
      const result = ctx.once(db, session, { id: body.requestId, kind: 'living-world.clerk.start', fingerprint: { cityId } }, () => {
        const now = ctx.now()
        if (!safeTime(now) || !safeTime(receiptAt)) return { ok: false, code: 'invalid_server_clock' }
        const row = readRow(rows, session.publicId)
        if (row === false) return { ok: false, code: 'invalid_saved_clerk' }
        if (row) {
          const mismatch = matches(row, session, cityId)
          return { ok: false, code: mismatch ?? (row.claimed ? 'practice_claimed' : 'practice_retained') }
        }
        if (rowsCount(rows) >= MAX_RECORDS) return { ok: false, code: 'clerk_capacity' }
        const practice = startClerkPractice(session.publicId)
        if (!practice) return { ok: false, code: 'invalid_server_actor' }
        const created: ClerkRecord = { v: 1, publicId: session.publicId, account: session.account ?? null, cityId, location,
          createdAt: now, updatedAt: now, practice, claimed: false, claimedAt: null }
        write(rows, created, ctx)
        return { ok: true, code: 'practice_started', revision: practice.revision }
      })
      const row = readRow(rows, session.publicId)
      if (row === false) return response(null, 'invalid_saved_clerk', false)
      if (!row) return response(null, String(result.code ?? 'practice_refused'), result.ok === true, 'duplicate' in result && result.duplicate === true)
      const mismatch = matches(row, session, cityId)
      if (mismatch) return response(null, mismatch, false)
      const now = ctx.now()
      if (!safeTime(now) || now < row.updatedAt) return response(row, 'invalid_server_clock', false)
      if (row.claimed) return response(row, 'practice_claimed', false, 'duplicate' in result && result.duplicate === true)
      if (result.ok !== true) return response(row, String(result.code ?? 'practice_refused'), false, 'duplicate' in result && result.duplicate === true)
      return response(row, String(result.code ?? 'practice_started'), true, 'duplicate' in result && result.duplicate === true)
    })
  }

  function step(request: RouteRequest, body: unknown): Promise<ClerkResponse> {
    if (!parseStep(body)) throw ctx.fail(400, 'invalid_clerk_request')
    const cityId = cityOf(ctx, body.cityId)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    if (cityId !== 'lagos') throw ctx.fail(409, 'clerk_scenario_unavailable')
    ctx.onceId(body.requestId)
    return ctx.store.transact(db => {
      const { session } = access(ctx, db, request, cityId), rows = collection(ctx, db)
      const result = ctx.once(db, session, { id: body.requestId, kind: 'living-world.clerk.step',
        fingerprint: { cityId, revision: body.revision, stepId: body.stepId, evidenceId: body.evidenceId } }, () => {
        const row = readRow(rows, session.publicId), now = ctx.now()
        if (row === false) return { ok: false, code: 'invalid_saved_clerk' }
        if (!row) return { ok: false, code: 'practice_not_started' }
        const mismatch = matches(row, session, cityId)
        if (mismatch) return { ok: false, code: mismatch }
        if (!safeTime(now) || now < row.updatedAt) return { ok: false, code: 'invalid_server_clock' }
        if (row.claimed) return { ok: false, code: 'practice_claimed' }
        if (body.revision !== row.practice.revision) return { ok: false, code: 'revision_conflict' }
        const outcome = stepClerkPractice(row.practice, { actorId: session.publicId, expectedRevision: body.revision,
          stepId: body.stepId, evidenceId: body.evidenceId })
        if (!outcome.ok || !outcome.state) return { ok: false, code: outcome.code, ...(outcome.feedback ? { reason: outcome.feedback } : {}) }
        row.practice = outcome.state
        row.updatedAt = now
        write(rows, row, ctx)
        return { ok: true, code: outcome.code, revision: outcome.state.revision }
      })
      const row = readRow(rows, session.publicId)
      if (row === false) return response(null, 'invalid_saved_clerk', false)
      if (!row) return response(null, String(result.code ?? 'practice_not_started'), result.ok === true, 'duplicate' in result && result.duplicate === true,
        'reason' in result && typeof result.reason === 'string' ? result.reason : undefined)
      const mismatch = matches(row, session, cityId)
      if (mismatch) return response(null, mismatch, false)
      const resultRevision = 'revision' in result && Number.isSafeInteger(result.revision) ? result.revision as number : null
      const now = ctx.now()
      if (!safeTime(now) || now < row.updatedAt) return response(row, 'invalid_server_clock', false)
      const accepted = result.ok === true && !row.claimed && resultRevision !== null && row.practice.revision >= resultRevision
      return response(row, row.claimed ? 'practice_claimed' : String(result.code ?? 'practice_refused'), accepted, 'duplicate' in result && result.duplicate === true,
        'reason' in result && typeof result.reason === 'string' ? result.reason : undefined)
    })
  }

  function claim(request: RouteRequest, body: unknown): Promise<ClerkResponse> {
    if (!parseClaim(body)) throw ctx.fail(400, 'invalid_clerk_request')
    const cityId = cityOf(ctx, body.cityId)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    if (cityId !== 'lagos') throw ctx.fail(409, 'clerk_scenario_unavailable')
    ctx.onceId(body.requestId)
    return ctx.store.transact(db => {
      const { session, life } = access(ctx, db, request, cityId)
      const rows = collection(ctx, db)
      const result = ctx.once(db, session, { id: body.requestId, kind: 'living-world.clerk.claim',
        fingerprint: { cityId, revision: body.revision } }, () => {
        const row = readRow(rows, session.publicId), now = ctx.now()
        if (row === false) return { ok: false, code: 'invalid_saved_clerk' }
        if (!row) return { ok: false, code: 'practice_not_started' }
        const mismatch = matches(row, session, cityId)
        if (mismatch) return { ok: false, code: mismatch }
        if (!safeTime(now) || now < row.updatedAt) return { ok: false, code: 'invalid_server_clock' }
        if (row.claimed) return { ok: false, code: 'practice_claimed' }
        if (row.practice.revision !== body.revision || row.practice.step !== 'complete') return { ok: false, code: 'practice_incomplete' }
        const acted = ctx.act(life, { type: 'living-world.server', cityId, payload: { op: 'clerk-reward' },
          stateGuard: 'The fictional clerk practice is rewarded once after its completed authored case.' })
        if (!acted.ok) return { ok: false, code: acted.code }
        row.claimed = true
        row.claimedAt = now
        row.updatedAt = now
        write(rows, row, ctx)
        return { ok: true, code: 'practice_claimed', claimedAt: now }
      })
      const row = readRow(rows, session.publicId)
      if (row === false) return response(null, 'invalid_saved_clerk', false)
      if (!row) return response(null, String(result.code ?? 'practice_not_started'), false, 'duplicate' in result && result.duplicate === true)
      const mismatch = matches(row, session, cityId)
      if (mismatch) return response(null, mismatch, false)
      const now = ctx.now()
      if (!safeTime(now) || now < row.updatedAt) return response(row, 'invalid_server_clock', false)
      const receiptMatches = result.ok === true && row.claimed && 'claimedAt' in result && result.claimedAt === row.claimedAt
      return response(row, String(result.code ?? 'practice_claimed'), receiptMatches,
        'duplicate' in result && result.duplicate === true)
    })
  }
  return { current, start, step, claim }
}
