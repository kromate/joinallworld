import type { BarberResponse } from '../../../types/living-world-barber.ts'
import type { ApiEnvelope, CityId } from '../../../types/protocol.ts'
import { barberLesson, BARBER_STARTER_TOOL_COST, type BarberLessonId } from '../../../game/living-world/barber-catalogue.ts'
import { readValidatedBarberPractice } from '../../../game/living-world/barber.ts'

export type BarberApiReply = BarberResponse & ApiEnvelope
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[\w:-]{1,100}$/.test(value)
const safeTime = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const safeCounter = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 1
const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const own = Reflect.ownKeys(value)
  return own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key))
}

function matchesPlan(value: unknown, expected: NonNullable<ReturnType<typeof barberLesson>>['plan']): boolean {
  if (!record(value) || !exactKeys(value, ['body', 'catalogueVersion', 'id', 'objectives', 'styleId', 'version'])
    || value.id !== expected.id || value.version !== expected.version || value.catalogueVersion !== expected.catalogueVersion
    || value.styleId !== expected.styleId || value.body !== expected.body || !Array.isArray(value.objectives)
    || value.objectives.length !== expected.objectives.length) return false
  return value.objectives.every((item, index) => {
    const objective = expected.objectives[index]
    if (!objective || !record(item) || !exactKeys(item, ['coverageRequired', 'id', 'region', 'target', 'tool'])
      || item.id !== objective.id || item.region !== objective.region || item.tool !== objective.tool || item.coverageRequired !== objective.coverageRequired
      || !record(item.target) || !exactKeys(item.target, ['maxX', 'maxY', 'minX', 'minY'])) return false
    const bounds = objective.target
    return item.target.minX === bounds.minX && item.target.minY === bounds.minY && item.target.maxX === bounds.maxX && item.target.maxY === bounds.maxY
  })
}

/** Strictly reads domain state while accepting the client API envelope and future root-level extras. */
export function readBarberReply(value: unknown): BarberApiReply | null {
  if (!record(value) || !safeTime(value.serverTime) || value.storage !== undefined && value.storage !== 'failing'
    || value.storage === 'failing' || typeof value.ok !== 'boolean'
    || typeof value.code !== 'string' || !/^[\w:-]{1,80}$/.test(value.code)
    || value.reason !== undefined && (typeof value.reason !== 'string' || value.reason.length > 500)
    || value.duplicate !== undefined && value.duplicate !== true
    || !Array.isArray(value.results) || value.results.length > 2 || typeof value.starterTool !== 'boolean'
    || value.starterToolCost !== BARBER_STARTER_TOOL_COST) return null

  let session: BarberResponse['session'] = null
  let plan: BarberResponse['plan'] = null
  if (value.session !== null) {
    const raw = value.session
    if (!record(raw) || !exactKeys(raw, ['cityId', 'lessonId', 'location', 'nextSequence', 'practice', 'revision', 'sessionId', 'status'])
      || (raw.lessonId !== 'basic' && raw.lessonId !== 'advanced') || !identifier(raw.sessionId) || !identifier(raw.cityId) || !identifier(raw.location)
      || !safeCounter(raw.revision) || !safeCounter(raw.nextSequence) || typeof raw.status !== 'string'
      || !['running', 'paused', 'complete'].some(status => status === raw.status)) return null
    const lesson = barberLesson(raw.lessonId as BarberLessonId)
    const practice = readValidatedBarberPractice(raw.practice, lesson?.plan)
    if (!lesson || !practice || raw.status !== practice.status || !matchesPlan(value.plan, lesson.plan)) return null
    session = { sessionId: raw.sessionId, lessonId: raw.lessonId, cityId: raw.cityId as CityId,
      location: raw.location, revision: raw.revision as number, nextSequence: raw.nextSequence as number,
      status: raw.status as typeof practice.status, practice }
    plan = lesson.plan
  } else if (value.session === null && value.plan !== null) return null

  const results: BarberResponse['results'] = []
  const seen = new Set<string>()
  for (const item of value.results) {
    if (!record(item) || !exactKeys(item, ['earnedAt', 'lessonId', 'styleId'])
      || (item.lessonId !== 'basic' && item.lessonId !== 'advanced') || seen.has(item.lessonId)
      || item.styleId !== barberLesson(item.lessonId)?.resultStyleId || !safeTime(item.earnedAt)) return null
    seen.add(item.lessonId)
    results.push({ lessonId: item.lessonId, styleId: item.styleId, earnedAt: item.earnedAt })
  }
  if (value.starterTool && !seen.has('basic')) return null
  if (seen.has('advanced') && (!seen.has('basic') || !value.starterTool)) return null

  return { ok: value.ok, code: value.code, ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
    ...(value.duplicate === true ? { duplicate: true as const } : {}), session, plan, results,
    starterTool: value.starterTool, starterToolCost: BARBER_STARTER_TOOL_COST, serverTime: value.serverTime }
}
