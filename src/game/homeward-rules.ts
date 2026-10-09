/** Frozen issued-ticket validation and current route planning, loaded together before life reconstruction. */
import { isKnownCityId } from './cities/registry.ts'
import { rideDebtOf } from './relief.ts'
import { isRecord } from './util.ts'
import { HOMEWARD_V1_MAX_FARE } from './homeward-gate.ts'
import type { SavedActiveAction } from '../types/registry.ts'
import type { HomewardLeg, HomewardTicket, LifeContext, LifeState } from '../types/life.ts'
export { planHomewardRoute } from './cities/homewardRoute.ts'

// Issued version-one tickets keep the bounds they were sold under if the new-booking timetable changes.
const V1_LEG_MAX_SECONDS = { road: 75, rail: 50, air: 20 } as const
const V1_MAX_LEGS = 4
const V1_MAX_SECONDS = 300
const V1_MAX_FARE = HOMEWARD_V1_MAX_FARE

const isSafePositive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const isMode = (value: unknown): value is HomewardLeg['mode'] => value === 'road' || value === 'rail' || value === 'air'
const keyFor = (from: string, to: string, legs: readonly HomewardLeg[]): string =>
  JSON.stringify([1, from, to, legs.map(leg => JSON.stringify([leg.from, leg.to, leg.mode, leg.fare, leg.seconds]))])

function invalidTicket(ctx: LifeContext, message: string): null {
  if (ctx.trustedSave === true) throw new TypeError(`The trusted homeward ticket cannot resume: ${message}`)
  return null
}

/** Structural validation only: issued legs and terms are preserved even if today's route changes. */
export function readHomewardTicket(value: SavedActiveAction, state: LifeState, ctx: LifeContext): HomewardTicket | null {
  if (!isRecord(value.ticket)) return invalidTicket(ctx, 'ticket is missing')
  const raw = value.ticket
  if (raw.version !== 1 || typeof raw.from !== 'string' || typeof raw.to !== 'string'
    || !isKnownCityId(raw.from) || !isKnownCityId(raw.to) || raw.from === raw.to
    || !Array.isArray(raw.legs) || raw.legs.length < 1 || raw.legs.length > V1_MAX_LEGS
    || !isSafePositive(raw.totalFare) || raw.totalFare > V1_MAX_FARE
    || !isSafePositive(raw.totalSeconds) || raw.totalSeconds > V1_MAX_SECONDS
    || typeof raw.key !== 'string') return invalidTicket(ctx, 'ticket header is malformed')

  const legs: HomewardLeg[] = []
  const seen = new Set<string>([raw.from])
  let at = raw.from
  let totalFare = 0
  let totalSeconds = 0
  for (const entry of raw.legs) {
    if (!isRecord(entry) || typeof entry.from !== 'string' || typeof entry.to !== 'string'
      || !isKnownCityId(entry.from) || !isKnownCityId(entry.to) || entry.from !== at || seen.has(entry.to)
      || !isMode(entry.mode) || !isSafePositive(entry.fare) || !isSafePositive(entry.seconds)) return invalidTicket(ctx, 'ticket leg is malformed')
    const maximum = V1_LEG_MAX_SECONDS[entry.mode]
    if (entry.seconds > maximum) return invalidTicket(ctx, 'ticket leg exceeds its saved timetable bounds')
    totalFare += entry.fare
    totalSeconds += entry.seconds
    if (!Number.isSafeInteger(totalFare) || totalFare > V1_MAX_FARE || !Number.isSafeInteger(totalSeconds) || totalSeconds > V1_MAX_SECONDS) {
      return invalidTicket(ctx, 'ticket totals exceed their bounds')
    }
    const leg: HomewardLeg = { from: entry.from, to: entry.to, mode: entry.mode, fare: entry.fare, seconds: entry.seconds }
    legs.push(leg)
    seen.add(entry.to)
    at = entry.to
  }
  if (at !== raw.to || totalFare !== raw.totalFare || totalSeconds !== raw.totalSeconds
    || raw.key !== keyFor(raw.from, raw.to, legs)) return invalidTicket(ctx, 'ticket identity or totals do not match its legs')
  if (value.id !== raw.to || value.duration !== totalSeconds || state.estate.city !== raw.from
    || state.estate.home !== raw.to || rideDebtOf(state) > totalFare) return invalidTicket(ctx, 'ticket does not match the saved home, origin, duration or loan')

  return { version: 1, from: raw.from, to: raw.to, legs, totalFare, totalSeconds, key: raw.key }
}
