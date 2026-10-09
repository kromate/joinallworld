/**
 * OWNER world. A homeward ticket is one accepted, continuous loan journey to the original main home.
 * It records the quoted links; resuming it never reprices or rechecks today's booking availability.
 */
import { LEFT_OUT, PLAYS } from '../profile.ts'
import { canCredit, credit, debit } from '../api.ts'
import { fail, isRecord, ok } from '../util.ts'
import { isKnownCityId } from '../cities/registry.ts'
import type { HomewardQuote } from '../cities/homewardRoute.ts'
import { rideDebtOf, rideDebtText, setRideDebt } from '../relief.ts'
import type { ActiveKindHandler, SavedActiveAction, SystemDefinition } from '../../types/registry.ts'
import type { HomewardJourneyAction, HomewardLeg, HomewardTicket, IntercityAction, LifeContext, LifeState } from '../../types/life.ts'

// Issued version-one tickets keep the bounds they were sold under if the new-booking timetable changes.
const V1_LEG_MAX_SECONDS = { road: 75, rail: 50, air: 20 } as const
const V1_MAX_LEGS = 4
const V1_MAX_SECONDS = 300
const V1_MAX_FARE = 1_000_000

const isSafePositive = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const isMode = (value: unknown): value is HomewardLeg['mode'] => value === 'road' || value === 'rail' || value === 'air'
const keyFor = (from: string, to: string, legs: readonly HomewardLeg[]): string =>
  JSON.stringify([1, from, to, legs.map(leg => JSON.stringify([leg.from, leg.to, leg.mode, leg.fare, leg.seconds]))])

function invalidTicket(ctx: LifeContext, message: string): null {
  if (ctx.trustedSave === true) throw new TypeError(`The trusted homeward ticket cannot resume: ${message}`)
  return null
}

/** Structural validation only: issued legs and terms are preserved even if today's route changes. */
function readTicket(value: SavedActiveAction, state: LifeState, ctx: LifeContext): HomewardTicket | null {
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

/** The foundation supplies estate operations; feature systems do not import one another. */
export default function createHomewardSystem(
  homewardOffer: (state: LifeState, ctx: LifeContext) => HomewardQuote | null,
  arriveInCity: (state: LifeState, trip: Pick<IntercityAction, 'id' | 'mode'>, ctx: LifeContext) => void,
) {
  function accept(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext) {
    const quote = homewardOffer(state, ctx)
    if (!quote) {
      if (state.activeAction) return fail(state, 'busy', 'Finish your current action before asking for a ride home.')
      if (rideDebtOf(state) > 0) return fail(state, 'ride_debt', rideDebtText(rideDebtOf(state)))
      return fail(state, 'credit_not_offered', 'A ride on credit is not available for this life right now.')
    }
    const home = quote.to
    if (typeof payload.quote !== 'string' || payload.quote.length > 1024 || payload.quote !== quote.key) {
      return fail(state, 'quote_changed', 'The route or total changed. Review the new homeward quote and choose again.')
    }
    if (state.cash >= quote.totalFare) return fail(state, 'credit_not_offered', 'You have enough cash to book the full route home.')
    if (!canCredit(state, quote.totalFare)) return fail(state, 'insufficient_funds', 'The ride advance would exceed the wallet limit.')

    if (!credit(state, quote.totalFare, 'Ride home on credit: full route advance', ctx)
      || !debit(state, quote.totalFare, 'Ride home on credit: ticket purchase', ctx)) {
      throw new Error('The validated homeward advance and ticket debit must settle together.')
    }
    setRideDebt(state, quote.totalFare)
    const ticket: HomewardTicket = quote
    state.activeAction = { kind: 'homeward', id: home, duration: quote.totalSeconds, remaining: quote.totalSeconds, ticket, legIndex: 0 }
    state.message = `Your ride home is booked. ${rideDebtText(quote.totalFare)}; repayment comes from what you earn.`
    return ok(state, 'departed')
  }

  function legAtElapsed(ticket: HomewardTicket, elapsed: number): number {
    let boundary = 0
    for (let index = 0; index < ticket.legs.length; index += 1) {
      boundary += ticket.legs[index]!.seconds
      if (elapsed < boundary) return index
    }
    return ticket.legs.length - 1
  }

  const active = {
    moves: true,
    sanitize(value: SavedActiveAction, state: LifeState, ctx: LifeContext) {
      const ticket = readTicket(value, state, ctx)
      if (!ticket) return null
      return { ticket, legIndex: legAtElapsed(ticket, value.duration - value.remaining) }
    },
    invalidated(_state: LifeState, _value: SavedActiveAction, ctx: LifeContext) {
      if (ctx.trustedSave === true) throw new TypeError('A trusted homeward ticket has invalid timing; preserve the stored life for recovery.')
    },
    ...(PLAYS ? {
      tick(_state: LifeState, action: HomewardJourneyAction, elapsedSeconds: number) {
        action.legIndex = legAtElapsed(action.ticket, action.duration - action.remaining + elapsedSeconds)
      },
      complete(state: LifeState, action: HomewardJourneyAction, ctx: LifeContext) {
        const last = action.ticket.legs.at(-1)
        if (!last) throw new TypeError('A homeward ticket must have at least one leg.')
        arriveInCity(state, { id: action.ticket.to, mode: last.mode }, ctx)
      },
      cancel(state: LifeState) {
        return fail(state, 'no_cancel', 'The homeward ticket is already booked and cannot be cancelled or skipped.')
      },
    } satisfies Pick<ActiveKindHandler<HomewardJourneyAction>, 'tick' | 'complete' | 'cancel'> : LEFT_OUT),
  } satisfies ActiveKindHandler<HomewardJourneyAction>

  const play = PLAYS ? { actions: { 'homeward.accept': accept } } satisfies Pick<SystemDefinition<'homeward'>, 'actions'> : LEFT_OUT

  return {
    id: 'homeward',
    stateKeys: [],
    sanitize() {},
    active: { homeward: active },
    ...play,
  } satisfies SystemDefinition<'homeward'>
}
