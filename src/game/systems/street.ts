import { PLAYS, LEFT_OUT } from '../profile.ts'
import { arrive, defaultSpot } from '../api.ts'
import { venueFor } from '../cities/runtime.ts'
import { cityReference } from '../cities/references.ts'
import { emit } from '../registry.ts'
import { busy, fail, ok } from '../util.ts'
import type { LifeContext, LifeState } from '../../types/life.ts'
import type { SystemDefinition } from '../../types/registry.ts'

function place(state: LifeState, payload: Record<string, unknown>, ctx: LifeContext) {
  const blocked = busy(state)
  if (blocked) return blocked
  const to = payload.to
  if (payload.from !== state.location || typeof to !== 'string' || !venueFor(ctx.cityId, to) || to === 'home') return fail(state, 'street_location_changed', 'Your location changed. Reopen the street to continue.')
  if (state.location !== 'city-street' && to !== 'city-street') return fail(state, 'invalid_street_transition', 'Use the street door first.')
  const identity = cityReference(ctx.cityId, to), realVenue = to !== 'city-street' && to !== 'neighbourhood'
  state.message = `You entered ${venueFor(ctx.cityId, to)?.label ?? 'the street'}.`
  if (realVenue && !state.travel.visited.includes(identity)) {
    arrive(state, to, ctx, { mode: 'trek' })
    state.travel.visited = [...state.travel.visited, identity].slice(-512)
    emit(state, 'venue.visited', { venue: to, first: true }, ctx)
  } else { state.location = to; state.spot = defaultSpot(to, ctx.cityId) }
  if (state.stories) state.stories.running = null
  return ok(state, 'street_placed')
}

export default {
  id: 'street', stateKeys: [], sanitize() {},
  ...(PLAYS ? { actions: { 'street.place': { serverOnly: true, run: place, refusal: 'The street server confirms this door.' } } } : LEFT_OUT),
} satisfies SystemDefinition<'street'>
