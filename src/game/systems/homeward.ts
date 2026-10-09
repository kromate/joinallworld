/**
 * OWNER world. A homeward ticket is one accepted, continuous loan journey to the original main home.
 * It records the quoted links; resuming it never reprices or rechecks today's booking availability.
 */
import { LEFT_OUT, PLAYS } from '../profile.ts'
import { canCredit, credit, debit } from '../api.ts'
import { fail, ok } from '../util.ts'
import { readHomewardTicket } from '../homeward-gate.ts'
import type { HomewardQuote } from '../cities/homewardRoute.ts'
import { rideDebtOf, rideDebtText, setRideDebt } from '../relief.ts'
import type { ActiveKindHandler, SavedActiveAction, SystemDefinition } from '../../types/registry.ts'
import type { HomewardJourneyAction, HomewardTicket, IntercityAction, LifeContext, LifeState } from '../../types/life.ts'

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
      const ticket = readHomewardTicket(value, state, ctx)
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
