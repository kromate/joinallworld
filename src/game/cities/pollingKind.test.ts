import test from 'node:test'
import assert from 'node:assert/strict'
import { createLife } from '../../life.ts'
import { lagosTime } from '../clock.ts'
import { ELECTION } from '../content/civic.ts'
import civicSystem, { castVote, civicEligibility, claimHuntPrize, fileCandidacy, pollingVenueFor } from '../systems/civic.ts'
import { makeContext } from '../util.ts'
import { loadCityContent, registerCityForTest } from './registry.ts'
import { FICTIONAL_CITY_ID, fictionalCity, fictionalContent } from './testing/fictionalCity.test-fixture.ts'

const DAY = 86_400_000

test('polling mechanics follow the city venue kind instead of the Lagos venue id', async (t) => {
  const oldPolling = fictionalContent.venues.find((venue) => venue.kind === 'polling')
  if (!oldPolling) throw new Error('fictional city requires a polling venue')
  const pollingId = 'test-civic-hall'
  const polling = {
    ...oldPolling,
    id: pollingId,
    name: 'Test Civic Hall',
    definition: { ...oldPolling.definition, id: pollingId, label: 'Test Civic Hall' },
  }
  const content = {
    ...fictionalContent,
    venues: fictionalContent.venues.map((venue) => venue === oldPolling ? polling : venue),
    regulars: fictionalContent.regulars.map((regular) => regular.venueId === oldPolling.id
      ? { ...regular, venueId: pollingId, definition: { ...regular.definition, venue: pollingId } }
      : regular),
  }
  const registration = registerCityForTest({ ...fictionalCity, loadContent: async () => content })
  t.after(registration.dispose)
  await loadCityContent(FICTIONAL_CITY_ID)

  assert.equal(pollingVenueFor('lagos')?.id, ELECTION.pollingVenue, 'Lagos keeps its existing polling venue')
  assert.equal(pollingVenueFor(FICTIONAL_CITY_ID)?.id, pollingId)

  const now = 4 * DAY
  const ctx = makeContext({ now, cityId: FICTIONAL_CITY_ID, seed: 'polling-kind' })
  const eligible = () => {
    const state = createLife({ cash: ELECTION.filingFee + 100 }, ctx)
    state.civic.since = 0
    state.civic.work = { days: ELECTION.minWorkDays, last: 1 }
    state.activeAction = null
    return state
  }

  const wrong = eligible()
  wrong.location = ELECTION.pollingVenue
  assert.deepEqual([civicEligibility(wrong, ctx).pollingVenue, castVote(wrong, {}, ctx).code], [pollingId, 'wrong_place'])

  const voter = eligible()
  voter.location = pollingId
  assert.equal(castVote(voter, {}, ctx).code, 'voted')

  const candidate = eligible()
  const before = candidate.cash
  assert.equal(fileCandidacy(candidate, {}, ctx).code, 'declared')
  assert.equal(candidate.cash, before - ELECTION.filingFee)
  assert.equal(candidate.ledger.at(-1)?.reason, 'Governorship filing fee')

  const day = lagosTime(now).day
  const saved = eligible()
  saved.civic.hunt = { city: FICTIONAL_CITY_ID, day, claimed: false, gems: [{ venue: pollingId, spot: null, kind: 'visit', found: true }] }
  const reloaded = createLife(saved, ctx)
  assert.deepEqual(reloaded.civic.hunt, saved.civic.hunt, 'a city-local venue id survives the saved-hunt boundary')

  const movedSave = structuredClone(reloaded)
  if (!movedSave.civic.hunt) throw new Error('saved hunt was not restored')
  movedSave.civic.hunt.claimed = true
  for (const gem of movedSave.civic.hunt.gems) gem.found = true
  movedSave.estate.city = 'lagos'
  const lagosContext = makeContext({ now, cityId: 'lagos', seed: 'polling-kind-arrival' })
  const moved = createLife(movedSave, lagosContext)
  const refresh = civicSystem.actions['civic.refresh']
  if (!refresh) throw new Error('civic.refresh is not registered')
  assert.equal(refresh(moved, {}, lagosContext).code, 'refreshed')
  assert.equal(moved.civic.hunt?.city, 'lagos')
  assert.ok(moved.civic.hunt?.gems.every((gem) => gem.venue !== pollingId && gem.found), 'arrival rerolls current-city places while keeping the claimed cap')
  const cash = moved.cash
  assert.equal(claimHuntPrize(moved, {}, lagosContext).code, 'already_claimed')
  assert.equal(moved.cash, cash, 'same-day travel cannot claim the hunt prize twice')
})
