/** Server authority for a simulated mannequin barber apprenticeship. */
import { characterCity } from '../character.ts'
import { barberLesson, BARBER_STARTER_TOOL_COST, type BarberLessonId } from '../../src/game/living-world/barber-catalogue.ts'
import { readBarberPractice, readValidatedBarberPractice, resumeBarberPractice, startBarberPractice, pauseBarberPractice, stepBarberPractice, type BarberPracticeInput, type BarberPracticeState } from '../../src/game/living-world/barber.ts'
import type { BarberControlPacket, BarberResponse, BarberResultView } from '../../src/types/living-world-barber.ts'
import type { CityId } from '../../src/types/protocol.ts'
import type { Look } from '../../src/types/life.ts'
import type { Db, RouteContext, RouteRequest, SessionRecord } from '../types.ts'
import type { LifeState } from '../../src/types/life.ts'

const FRAME_MS = 100, MAX_FRAMES = 5, MAX_CREDIT_MS = 500, TIMEOUT_MS = 1500
const MAX_RECORDS = 1024, MAX_RECORD_BYTES = 8192, MAX_TIME = Number.MAX_SAFE_INTEGER
const TOOL_IDS = ['comb', 'clippers', 'scissors', 'brush'] as const
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const safeTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_TIME
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[\w:-]{1,100}$/.test(value)
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Reflect.ownKeys(value)
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key))
}
const utf8Size = (value: string): number => new TextEncoder().encode(value).byteLength

interface Receipt { cityId: CityId; sessionId: string; revision: number; sequence: number; frames: BarberPracticeInput[]; code: 'controls_accepted' | 'lesson_completed' }
interface NpcResult { lessonId: BarberLessonId; styleId: 'man-low-cut-v1' | 'man-fade-v1'; look: Look; earnedAt: number }
interface LessonProgress {
  lessonId: BarberLessonId; sessionId: string; cityId: CityId; location: string; createdAt: number; updatedAt: number; lastInputAt: number
  creditMs: number; revision: number; nextSequence: number; practice: BarberPracticeState; lastPacket: Receipt | null; claimed: boolean
}
interface BarberRecord {
  v: 1; publicId: string; account: string | null; starterTool: boolean; currentLesson: BarberLessonId | null
  results: Partial<Record<BarberLessonId, NpcResult>>; lessons: Partial<Record<BarberLessonId, LessonProgress>>
}
type BarberCollection = Record<string, unknown> & { barber?: Record<string, unknown> }

function collection(ctx: RouteContext, db: Db): Record<string, unknown> {
  const root = ctx.collection(db, 'livingWorld', { barber: {} }) as BarberCollection
  if (!record(root)) throw ctx.fail(503, 'barber_storage_unavailable')
  if (!Object.hasOwn(root, 'barber')) root.barber = {}
  if (!record(root.barber)) throw ctx.fail(503, 'barber_storage_unavailable')
  return root.barber
}
function rowsCount(rows: Record<string, unknown>): number { let n = 0; for (const key in rows) if (Object.hasOwn(rows, key) && ++n > MAX_RECORDS) return n; return n }
function sizeOf(value: unknown): number | null { try { return utf8Size(JSON.stringify(value)) } catch { return null } }
const canonicalPacket = (value: BarberControlPacket): string => JSON.stringify({
  cityId: value.cityId, sessionId: value.sessionId, revision: value.revision, sequence: value.sequence,
  frames: value.frames.map(({ tool, x, y, pressed }) => ({ tool, x, y, pressed })),
})
function resultFor(value: unknown, lessonId: BarberLessonId): NpcResult | null {
  const lesson = barberLesson(lessonId)
  if (!lesson || !record(value) || !exactKeys(value, ['lessonId', 'styleId', 'look', 'earnedAt']) || value.lessonId !== lessonId
    || value.styleId !== lesson.resultStyleId || !safeTime(value.earnedAt) || !record(value.look)) return null
  if (!exactKeys(value.look, ['body', 'hair', 'outfit', 'fabric', 'skin', 'hairColor', 'outfitColor', 'bottomsColor'])
    || value.look.body !== lesson.look.body || value.look.hair !== lesson.look.hair || value.look.outfit !== lesson.look.outfit
    || value.look.fabric !== lesson.look.fabric || value.look.skin !== lesson.look.skin || value.look.hairColor !== lesson.look.hairColor
    || value.look.outfitColor !== lesson.look.outfitColor || value.look.bottomsColor !== lesson.look.bottomsColor) return null
  return { lessonId, styleId: lesson.resultStyleId, look: lesson.look, earnedAt: value.earnedAt }
}
function parseLesson(value: unknown): LessonProgress | null {
  if (!record(value) || !exactKeys(value, ['lessonId', 'sessionId', 'cityId', 'location', 'createdAt', 'updatedAt', 'lastInputAt', 'creditMs', 'revision', 'nextSequence', 'practice', 'lastPacket', 'claimed'])
    || (value.lessonId !== 'basic' && value.lessonId !== 'advanced') || !identifier(value.sessionId)
    || typeof value.cityId !== 'string' || !identifier(value.location) || !safeTime(value.createdAt) || !safeTime(value.updatedAt) || !safeTime(value.lastInputAt)
    || !Number.isInteger(value.creditMs) || (value.creditMs as number) < 0 || (value.creditMs as number) >= MAX_CREDIT_MS
    || !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 || !Number.isSafeInteger(value.nextSequence) || (value.nextSequence as number) < 1
    || typeof value.claimed !== 'boolean') return null
  const lessonId = value.lessonId as BarberLessonId, lesson = barberLesson(lessonId)
  const practice = readValidatedBarberPractice(value.practice, lesson?.plan)
  if (!lesson || !practice || practice.plan.id !== lesson.plan.id || value.createdAt > value.updatedAt || value.lastInputAt > value.updatedAt) return null
  if (value.lastPacket !== null) {
    if (!record(value.lastPacket) || !exactKeys(value.lastPacket, ['cityId', 'sessionId', 'revision', 'sequence', 'frames', 'code'])
      || value.lastPacket.cityId !== value.cityId || value.lastPacket.sessionId !== value.sessionId
      || !Number.isSafeInteger(value.lastPacket.revision) || (value.lastPacket.revision as number) < 1 || (value.lastPacket.revision as number) >= (value.revision as number)
      || !Number.isSafeInteger(value.lastPacket.sequence) || (value.lastPacket.sequence as number) < 1
      || (value.lastPacket.code !== 'controls_accepted' && value.lastPacket.code !== 'lesson_completed')) return null
    const savedPacket: unknown = { cityId: value.lastPacket.cityId, sessionId: value.lastPacket.sessionId, revision: value.lastPacket.revision,
      sequence: value.lastPacket.sequence, frames: value.lastPacket.frames }
    if (!packet(savedPacket)) return null
  }
  const receipt = value.lastPacket as Receipt | null
  if (value.nextSequence !== (receipt === null ? 1 : receipt.sequence + 1)) return null
  if (practice.status === 'complete' ? receipt === null || receipt.code !== 'lesson_completed'
    : receipt !== null && receipt.code === 'lesson_completed') return null
  return { lessonId, sessionId: value.sessionId, cityId: value.cityId as CityId, location: value.location,
    createdAt: value.createdAt, updatedAt: value.updatedAt, lastInputAt: value.lastInputAt, creditMs: value.creditMs,
    revision: value.revision as number, nextSequence: value.nextSequence as number, practice, lastPacket: value.lastPacket as Receipt | null, claimed: value.claimed }
}
function parseRecord(value: unknown, publicId: string, pauseRunning = false): BarberRecord | null {
  if (!record(value) || !exactKeys(value, ['v', 'publicId', 'account', 'starterTool', 'currentLesson', 'results', 'lessons'])
    || value.v !== 1 || value.publicId !== publicId || !(value.account === null || identifier(value.account))
    || typeof value.starterTool !== 'boolean' || !(value.currentLesson === null || value.currentLesson === 'basic' || value.currentLesson === 'advanced')
    || !record(value.results) || !record(value.lessons)) return null
  const lessons: BarberRecord['lessons'] = {}, results: BarberRecord['results'] = {}
  for (const id of ['basic', 'advanced'] as const) {
    if (Object.hasOwn(value.lessons, id)) {
      const rawProgress = value.lessons[id], progress = parseLesson(rawProgress)
      if (!progress || progress.lessonId !== id) return null
      lessons[id] = pauseRunning && progress.practice.status === 'running'
        ? { ...progress, practice: readBarberPractice(record(rawProgress) ? rawProgress.practice : null, barberLesson(id)!.plan)! }
        : progress
    }
    if (Object.hasOwn(value.results, id)) {
      const result = resultFor(value.results[id], id)
      if (!result) return null
      results[id] = result
    }
  }
  if (Reflect.ownKeys(value.lessons).some(key => key !== 'basic' && key !== 'advanced') || Reflect.ownKeys(value.results).some(key => key !== 'basic' && key !== 'advanced')) return null
  for (const id of ['basic', 'advanced'] as const) {
    const result = results[id], progress = lessons[id]
    if (result && (!progress || !progress.claimed || progress.practice.status !== 'complete' || result.earnedAt !== progress.updatedAt)) return null
    if (progress?.claimed && !result) return null
  }
  if (value.starterTool && !results.basic || lessons.advanced && (!results.basic || !value.starterTool)) return null
  const unclaimed = (['basic', 'advanced'] as const).filter(id => lessons[id] !== undefined && !lessons[id]!.claimed)
  if (value.currentLesson === null ? unclaimed.length !== 0
    : unclaimed.length !== 1 || unclaimed[0] !== value.currentLesson) return null
  if (value.currentLesson !== null) {
    const active = lessons[value.currentLesson]
    if (!active || active.claimed || active.practice.status === 'complete' && active.claimed) return null
  }
  if (sizeOf(value) === null || sizeOf(value)! > MAX_RECORD_BYTES) return null
  return { v: 1, publicId, account: value.account as string | null, starterTool: value.starterTool,
    currentLesson: value.currentLesson as BarberLessonId | null, results, lessons }
}
function existing(rows: Record<string, unknown>, publicId: string, pauseRunning = false): BarberRecord | null | false {
  return Object.hasOwn(rows, publicId) ? parseRecord(rows[publicId], publicId, pauseRunning) ?? false : null
}
function write(rows: Record<string, unknown>, value: BarberRecord, ctx: RouteContext): void {
  const size = sizeOf(value)
  if (size === null || size > MAX_RECORD_BYTES) throw ctx.fail(507, 'barber_record_too_large')
  Object.defineProperty(rows, value.publicId, { value, enumerable: true, configurable: true, writable: true })
}
function cityOf(ctx: RouteContext, value: unknown): CityId | null { return typeof value === 'string' && ctx.cityIds.some(city => city === value) ? value as CityId : null }
function control(value: unknown): value is BarberPracticeInput {
  return record(value) && exactKeys(value, ['pressed', 'tool', 'x', 'y']) && TOOL_IDS.includes(value.tool as BarberPracticeInput['tool'])
    && typeof value.x === 'number' && Number.isFinite(value.x) && value.x >= 0 && value.x <= 1
    && typeof value.y === 'number' && Number.isFinite(value.y) && value.y >= 0 && value.y <= 1 && typeof value.pressed === 'boolean'
}
function packet(value: unknown): value is BarberControlPacket {
  return record(value) && exactKeys(value, ['cityId', 'sessionId', 'revision', 'sequence', 'frames']) && typeof value.cityId === 'string'
    && identifier(value.sessionId) && Number.isSafeInteger(value.revision) && (value.revision as number) > 0
    && Number.isSafeInteger(value.sequence) && (value.sequence as number) > 0 && Array.isArray(value.frames)
    && value.frames.length > 0 && value.frames.length <= MAX_FRAMES && value.frames.every(control)
}
function response(row: BarberRecord | null, progress: LessonProgress | null, code: string, ok: boolean, duplicate = false, reason?: string): BarberResponse {
  const lesson = progress ? barberLesson(progress.lessonId) : null
  const results: BarberResultView[] = row ? (['basic', 'advanced'] as const).flatMap(id => row.results[id] ? [{ lessonId: id, styleId: row.results[id]!.styleId, earnedAt: row.results[id]!.earnedAt }] : []) : []
  return { ok, code, ...(reason ? { reason } : {}), ...(duplicate ? { duplicate: true } : {}),
    session: progress ? { sessionId: progress.sessionId, lessonId: progress.lessonId, cityId: progress.cityId, location: progress.location,
      revision: progress.revision, nextSequence: progress.nextSequence, status: progress.practice.status, practice: progress.practice } : null,
    plan: lesson?.plan ?? null, results, starterTool: row?.starterTool ?? false, starterToolCost: BARBER_STARTER_TOOL_COST }
}
function watermark(progress: LessonProgress): number { return Math.max(progress.createdAt, progress.updatedAt, progress.lastInputAt) }

export function createBarberService(ctx: RouteContext) {
  function access(db: Db, request: RouteRequest, cityId: CityId): { session: SessionRecord; location: string; life: LifeState } {
    const session = request.requireSession(db, { renew: true })
    if (!ctx.allow(`living-world:barber:${session.publicId}`, 660, 60_000)) throw ctx.fail(429, 'rate_limited')
    ctx.checks?.cityGate?.(session, cityId)
    if (characterCity(session) !== cityId) throw ctx.fail(409, 'city_moved')
    const life = ctx.settle(session, cityId)
    if (life.onboarding.required) throw ctx.fail(403, 'onboarding_required')
    if (life.activeAction !== null) throw ctx.fail(409, 'busy')
    if (!identifier(life.location)) throw ctx.fail(409, 'barber_location_unavailable')
    return { session, location: life.location, life }
  }
  function readRow(rows: Record<string, unknown>, publicId: string): BarberRecord | null | false { return existing(rows, publicId) }
  function accessMatches(row: BarberRecord, session: SessionRecord): boolean { return row.account === (session.account ?? null) }
  function active(row: BarberRecord | null | false): LessonProgress | null {
    return row !== null && row !== false && row.currentLesson ? row.lessons[row.currentLesson] ?? null : null
  }
  function current(request: RouteRequest, cityUnknown: unknown): Promise<BarberResponse> {
    const cityId = cityOf(ctx, cityUnknown)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    return ctx.store.transact(db => {
      const { session, location } = access(db, request, cityId), rows = collection(ctx, db)
      const rawSaved = rows[session.publicId], row = existing(rows, session.publicId, true)
      if (row === false) return response(null, null, 'invalid_saved_barber', false, false, 'Saved barber practice is quarantined and has been kept for recovery.')
      if (row === null) return response(null, null, 'no_practice', true)
      if (!accessMatches(row, session)) return response(null, null, 'account_changed', false)
      let progress = active(row)
      const now = ctx.now()
      if (!safeTime(now)) return response(row, progress, 'invalid_server_clock', false)
      const rawActive = progress && record(rawSaved) && record(rawSaved.lessons) ? rawSaved.lessons[progress.lessonId] : null
      const wasRunning = record(rawActive) && record(rawActive.practice) && rawActive.practice.status === 'running'
      if (progress && wasRunning) {
        progress.revision++; progress.updatedAt = Math.max(progress.updatedAt, now); progress.lastInputAt = progress.updatedAt; progress.creditMs = 0
        write(rows, row, ctx)
      }
      if (progress && (progress.cityId !== cityId || progress.location !== location)) {
        if (progress.practice.status === 'running') {
          progress.practice = pauseBarberPractice(progress.practice, 'Practice paused because you left its bound location.')
          progress.revision++; progress.updatedAt = Math.max(progress.updatedAt, now); progress.lastInputAt = progress.updatedAt; progress.creditMs = 0
          write(rows, row, ctx)
        }
        return response(row, progress, progress.cityId !== cityId ? 'city_mismatch' : 'location_changed', false)
      }
      return response(row, progress, row.currentLesson ? 'practice_loaded' : 'apprenticeship_ready', true)
    })
  }
  function start(request: RouteRequest, body: unknown): Promise<BarberResponse> {
    if (!record(body) || !exactKeys(body, ['cityId', 'lessonId', 'requestId']) || typeof body.cityId !== 'string' || !identifier(body.requestId)
      || (body.lessonId !== 'basic' && body.lessonId !== 'advanced')) throw ctx.fail(400, 'invalid_barber_request')
    const cityId = cityOf(ctx, body.cityId)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    const onceAt = ctx.onceId(body.requestId), lessonId = body.lessonId as BarberLessonId
    return ctx.store.transact(db => {
      const { session, location } = access(db, request, cityId), rows = collection(ctx, db)
      const result = ctx.once(db, session, { id: body.requestId, kind: 'living-world.barber.start', fingerprint: { cityId, lessonId, location } }, () => {
        const now = ctx.now()
        if (!safeTime(now) || !safeTime(onceAt)) return { ok: false, code: 'invalid_server_clock' }
        let row = readRow(rows, session.publicId)
        if (row === false) return { ok: false, code: 'invalid_saved_barber' }
        if (row !== null && !accessMatches(row, session)) return { ok: false, code: 'account_changed' }
        if (row !== null && row.currentLesson) return { ok: false, code: 'lesson_active' }
        if (row) {
          const latest = Math.max(...(['basic', 'advanced'] as const).map(id => row.lessons[id] ? watermark(row.lessons[id]!) : 0))
          if (now < latest) return { ok: false, code: 'clock_reversed' }
        }
        if (row?.lessons[lessonId]) return { ok: false, code: row.results[lessonId] ? 'lesson_retained' : 'lesson_already_started' }
        if (lessonId === 'advanced' && (row === null || !row.results.basic || !row.starterTool)) return { ok: false, code: 'barber_tool_required' }
        if (row === null && rowsCount(rows) >= MAX_RECORDS) return { ok: false, code: 'barber_capacity' }
        const lesson = barberLesson(lessonId)!, practice = startBarberPractice(lesson.plan)
        if (!practice) return { ok: false, code: 'lesson_unavailable' }
        if (row === null) row = { v: 1, publicId: session.publicId, account: session.account ?? null, starterTool: false, currentLesson: null, results: {}, lessons: {} }
        const sessionId = ctx.randomId()
        if (!identifier(sessionId)) return { ok: false, code: 'invalid_server_id' }
        const progress: LessonProgress = { lessonId, sessionId, cityId, location, createdAt: now, updatedAt: now,
          lastInputAt: now, creditMs: 0, revision: 1, nextSequence: 1, practice, lastPacket: null, claimed: false }
        row.lessons[lessonId] = progress; row.currentLesson = lessonId; write(rows, row, ctx)
        return { ok: true, code: 'lesson_started', sessionId: progress.sessionId }
      })
      const row = readRow(rows, session.publicId)
      if (row === false) return response(null, null, 'invalid_saved_barber', false)
      if (row === null) {
        if (result.ok !== true) return response(null, null, String(result.code ?? 'lesson_refused'), false, 'duplicate' in result && result.duplicate === true)
        return response(null, null, 'no_practice', false, 'duplicate' in result && result.duplicate === true)
      }
      const progress = active(row)
      if (result.ok !== true) return response(row, progress, String(result.code ?? 'lesson_refused'), false, 'duplicate' in result && result.duplicate === true)
      if (!progress || progress.sessionId !== result.sessionId) return response(row, progress, 'superseded_lesson', false, true)
      return response(row, progress, String(result.code ?? 'lesson_started'), true, 'duplicate' in result && result.duplicate === true)
    })
  }
  function input(request: RouteRequest, body: unknown): Promise<BarberResponse> {
    if (!packet(body)) throw ctx.fail(400, 'invalid_barber_packet')
    const cityId = cityOf(ctx, body.cityId)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    const fingerprint = canonicalPacket(body)
    return ctx.store.transact(db => {
      const { session, location } = access(db, request, cityId), rows = collection(ctx, db), row = readRow(rows, session.publicId)
      if (row === null || row === false) return response(null, null, row === false ? 'invalid_saved_barber' : 'no_practice', false)
      if (!accessMatches(row, session)) return response(null, null, 'account_changed', false)
      const progress = active(row)
      if (!progress) return response(row, null, 'no_active_lesson', false)
      if (progress.sessionId !== body.sessionId) return response(row, progress, 'session_mismatch', false)
      const now = ctx.now()
      if (!safeTime(now)) return response(row, progress, 'invalid_server_clock', false)
      if (progress.cityId !== cityId || progress.location !== location) {
        if (progress.practice.status === 'running') { progress.practice = pauseBarberPractice(progress.practice, 'Practice paused because you left its bound location.'); progress.revision++; progress.updatedAt = Math.max(now, watermark(progress)); progress.lastInputAt = progress.updatedAt; progress.creditMs = 0; write(rows, row, ctx) }
        return response(row, progress, progress.cityId !== cityId ? 'city_mismatch' : 'location_changed', false)
      }
      if (progress.practice.status === 'running' && now < watermark(progress)) {
        progress.practice = pauseBarberPractice(progress.practice, 'Server clock moved backwards; practice is safely paused.')
        progress.creditMs = 0; progress.lastInputAt = watermark(progress); progress.updatedAt = watermark(progress); progress.revision++; write(rows, row, ctx)
      } else if (progress.practice.status === 'running' && now - progress.lastInputAt > TIMEOUT_MS) {
        progress.practice = pauseBarberPractice(progress.practice, 'Practice timed out; resume explicitly to continue.')
        progress.creditMs = 0; progress.lastInputAt = now; progress.updatedAt = now; progress.revision++; write(rows, row, ctx)
      }
      const receipt = progress.lastPacket
      const receiptMatches = receipt !== null && receipt.sequence === body.sequence && canonicalPacket({ cityId: receipt.cityId, sessionId: receipt.sessionId,
        revision: receipt.revision, sequence: receipt.sequence, frames: receipt.frames }) === fingerprint
      if (receipt?.sequence === body.sequence) return response(row, progress, receiptMatches ? receipt.code : 'packet_conflict', receiptMatches, receiptMatches)
      if (body.sequence !== progress.nextSequence) return response(row, progress, 'sequence_conflict', false)
      if (body.revision !== progress.revision) return response(row, progress, 'revision_conflict', false)
      if (progress.practice.status !== 'running') return response(row, progress, progress.practice.status === 'complete' ? 'lesson_complete' : 'lesson_paused', false)
      if (now < watermark(progress)) return response(row, progress, 'clock_reversed', false)
      const elapsed = now - progress.lastInputAt
      const credit = Math.min(MAX_CREDIT_MS, progress.creditMs + elapsed), cost = body.frames.length * FRAME_MS
      if (credit < cost) return response(row, progress, 'insufficient_time_credit', false)
      const lesson = barberLesson(progress.lessonId)!
      let practice = progress.practice
      for (const frame of body.frames) { if (practice.status !== 'running') break; practice = stepBarberPractice(practice, frame, lesson.plan).state ?? practice }
      progress.practice = practice; progress.creditMs = Math.max(0, credit - cost); progress.lastInputAt = now; progress.updatedAt = now
      progress.nextSequence++; progress.revision++
      const code = practice.status === 'complete' ? 'lesson_completed' : 'controls_accepted'
      progress.lastPacket = { cityId, sessionId: body.sessionId, revision: body.revision, sequence: body.sequence,
        frames: body.frames.map(({ tool, x, y, pressed }) => ({ tool, x, y, pressed })), code }
      write(rows, row, ctx)
      return response(row, progress, code, true)
    })
  }
  function lifecycle(request: RouteRequest, body: unknown, target: 'paused' | 'running'): Promise<BarberResponse> {
    if (!record(body) || !exactKeys(body, ['cityId', 'requestId', 'sessionId', 'revision']) || typeof body.cityId !== 'string'
      || !identifier(body.requestId) || !identifier(body.sessionId) || !Number.isSafeInteger(body.revision) || (body.revision as number) < 1) throw ctx.fail(400, 'invalid_barber_request')
    const cityId = cityOf(ctx, body.cityId)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    ctx.onceId(body.requestId)
    return ctx.store.transact(db => {
      const { session, location } = access(db, request, cityId), rows = collection(ctx, db)
      const result = ctx.once(db, session, { id: body.requestId, kind: `living-world.barber.${target}`, fingerprint: body }, () => {
        const row = readRow(rows, session.publicId), progress = active(row)
        if (row === null || row === false) return { ok: false, code: row === false ? 'invalid_saved_barber' : 'no_practice' }
        if (!accessMatches(row, session)) return { ok: false, code: 'account_changed' }
        if (!progress || progress.sessionId !== body.sessionId) return { ok: false, code: 'session_mismatch' }
        if (progress.revision !== body.revision) return { ok: false, code: 'revision_conflict' }
        const now = ctx.now()
        if (!safeTime(now)) return { ok: false, code: 'invalid_server_clock' }
        if (progress.cityId !== cityId || progress.location !== location) {
          if (progress.practice.status === 'running') { progress.practice = pauseBarberPractice(progress.practice); progress.creditMs = 0; progress.revision++; progress.updatedAt = Math.max(now, watermark(progress)); progress.lastInputAt = progress.updatedAt; write(rows, row, ctx) }
          return { ok: false, code: 'location_changed' }
        }
        if (now < watermark(progress)) return { ok: false, code: 'clock_reversed' }
        if (target === 'paused') {
          if (progress.practice.status !== 'running') return { ok: false, code: 'lesson_not_running' }
          progress.practice = pauseBarberPractice(progress.practice); progress.creditMs = 0
        } else {
          if (progress.practice.status !== 'paused') return { ok: false, code: 'lesson_not_paused' }
          if (now < watermark(progress)) return { ok: false, code: 'clock_reversed' }
          progress.practice = resumeBarberPractice(progress.practice, barberLesson(progress.lessonId)!.plan)!
          if (progress.practice.status !== 'running') return { ok: false, code: 'lesson_unavailable' }
          progress.creditMs = 0
        }
        progress.updatedAt = now; progress.lastInputAt = now; progress.revision++; write(rows, row, ctx)
        return { ok: true, code: target === 'paused' ? 'lesson_paused' : 'lesson_resumed' }
      })
      const row = readRow(rows, session.publicId)
      if (row === null || row === false) return response(null, null, row === false ? 'invalid_saved_barber' : 'no_practice', false)
      return response(row, active(row), String(result.code ?? 'lesson_refused'), result.ok === true, 'duplicate' in result && result.duplicate === true)
    })
  }
  function claim(request: RouteRequest, body: unknown): Promise<BarberResponse> {
    if (!record(body) || !exactKeys(body, ['cityId', 'lessonId', 'sessionId', 'requestId']) || typeof body.cityId !== 'string'
      || (body.lessonId !== 'basic' && body.lessonId !== 'advanced') || !identifier(body.sessionId) || !identifier(body.requestId)) throw ctx.fail(400, 'invalid_barber_request')
    const cityId = cityOf(ctx, body.cityId)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    ctx.onceId(body.requestId)
    const lessonId = body.lessonId as BarberLessonId
    return ctx.store.transact(db => {
      const { session, location, life } = access(db, request, cityId), rows = collection(ctx, db)
      const result = ctx.once(db, session, { id: body.requestId, kind: 'living-world.barber.claim', fingerprint: { cityId, lessonId, sessionId: body.sessionId } }, () => {
        const row = readRow(rows, session.publicId), progress = row !== null && row !== false ? row.lessons[lessonId] : null, now = ctx.now()
        if (row === null || row === false) return { ok: false, code: row === false ? 'invalid_saved_barber' : 'no_practice' }
        if (!accessMatches(row, session)) return { ok: false, code: 'account_changed' }
        if (!progress || progress.sessionId !== body.sessionId) return { ok: false, code: 'session_mismatch' }
        if (progress.cityId !== cityId || progress.location !== location) return { ok: false, code: 'location_changed' }
        if (!safeTime(now) || now < watermark(progress)) return { ok: false, code: 'invalid_server_clock' }
        if (row.results[lessonId] || progress.claimed) return { ok: false, code: 'lesson_retained' }
        if (progress.practice.status !== 'complete') return { ok: false, code: 'lesson_incomplete' }
        if (lessonId === 'advanced' && !row.starterTool) return { ok: false, code: 'barber_tool_required' }
        const act = ctx.act(life, { type: 'living-world.server', cityId, payload: { op: 'barber-reward', lessonId }, stateGuard: 'A mannequin lesson is paid only once with its stored result.' })
        if (!act.ok) return { ok: false, code: act.code }
        const lesson = barberLesson(lessonId)!
        const npcResult: NpcResult = { lessonId, styleId: lesson.resultStyleId, look: lesson.look, earnedAt: now }
        row.results[lessonId] = npcResult; progress.claimed = true
        if (row.currentLesson === lessonId) row.currentLesson = null
        progress.updatedAt = now; progress.revision++
        write(rows, row, ctx)
        return { ok: true, code: 'lesson_claimed', result: npcResult }
      })
      const row = readRow(rows, session.publicId)
      if (row === null || row === false) return response(null, null, row === false ? 'invalid_saved_barber' : 'no_practice', false)
      const progress = row.lessons[lessonId] ?? null
      const returnedResult = 'result' in result ? resultFor(result.result, lessonId) : null
      const valid = result.ok === true && Boolean(row.results[lessonId] && progress?.claimed && returnedResult
        && returnedResult.earnedAt === row.results[lessonId]!.earnedAt)
      return response(row, active(row) ?? progress, valid ? String(result.code ?? 'lesson_claimed') : String(result.code ?? 'lesson_retained'), valid, 'duplicate' in result && result.duplicate === true)
    })
  }
  function upgrade(request: RouteRequest, body: unknown): Promise<BarberResponse> {
    if (!record(body) || !exactKeys(body, ['cityId', 'requestId']) || typeof body.cityId !== 'string' || !identifier(body.requestId)) throw ctx.fail(400, 'invalid_barber_request')
    const cityId = cityOf(ctx, body.cityId)
    if (!cityId) throw ctx.fail(400, 'invalid_city')
    ctx.onceId(body.requestId)
    return ctx.store.transact(db => {
      const { session, location, life } = access(db, request, cityId), rows = collection(ctx, db)
      const result = ctx.once(db, session, { id: body.requestId, kind: 'living-world.barber.upgrade', fingerprint: { cityId } }, () => {
        const now = ctx.now()
        if (!safeTime(now)) return { ok: false, code: 'invalid_server_clock' }
        const row = readRow(rows, session.publicId)
        if (row === null || row === false) return { ok: false, code: row === false ? 'invalid_saved_barber' : 'basic_lesson_required' }
        if (!accessMatches(row, session)) return { ok: false, code: 'account_changed' }
        if (!row.results.basic) return { ok: false, code: 'basic_lesson_required' }
        const basic = row.lessons.basic
        if (!basic || basic.cityId !== cityId || basic.location !== location) return { ok: false, code: 'location_changed' }
        if (now < watermark(basic)) return { ok: false, code: 'clock_reversed' }
        if (row.starterTool) return { ok: false, code: 'barber_tool_retained' }
        const act = ctx.act(life, { type: 'living-world.server', cityId, payload: { op: 'barber-tool' }, stateGuard: 'The barber clipper upgrade is purchased once after the basic lesson.' })
        if (!act.ok) return { ok: false, code: act.code }
        row.starterTool = true; write(rows, row, ctx)
        return { ok: true, code: 'barber_tool_upgraded' }
      })
      const row = readRow(rows, session.publicId)
      if (row === false) return response(null, null, 'invalid_saved_barber', false)
      return response(row, active(row), String(result.code ?? 'upgrade_refused'), result.ok === true && Boolean(row?.starterTool), 'duplicate' in result && result.duplicate === true)
    })
  }
  return { current, start, input, pause: (request: RouteRequest, body: unknown) => lifecycle(request, body, 'paused'), resume: (request: RouteRequest, body: unknown) => lifecycle(request, body, 'running'), claim, upgrade }
}
