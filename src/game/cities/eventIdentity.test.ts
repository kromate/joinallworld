import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceLife, createLife, dispatch, viewLife } from '../../life.ts'
import { eventIcs, eventOccurrenceKey, eventsAt, occurrenceOn } from '../calendar.ts'
import { awayCard } from '../digest.ts'
import { lagosTime } from '../clock.ts'
import { visitIdentity } from '../systems/missions.ts'
import { cachedCityContent, loadCityContent, registerCityForTest } from './registry.ts'
import {
  FICTIONAL_CITY_ID,
  FICTIONAL_NEIGHBOUR_CITY_ID,
  fictionalCity,
  fictionalContent,
  fictionalNeighbourCity,
  fictionalNeighbourContent,
} from './testing/fictionalCity.test-fixture.ts'
import type { CalendarEvent, CityContent, CityModule } from '../../types/content.ts'
import type { LifeContextInit, LifeState } from '../../types/life.ts'

const event: CalendarEvent = {
  id: 'local-night', title: 'Local night', blurb: 'The same local event id in each city.', venue: 'test-square', icon: 'star',
  when: { weekday: 1, from: 0, to: 24 },
}

const withEvent = (module: CityModule, content: CityContent): CityModule => ({ ...module, loadContent: async () => ({ ...content, events: [event] }) })
const cityA = withEvent(fictionalCity, fictionalContent)
const cityB = withEvent(fictionalNeighbourCity, fictionalNeighbourContent)

test('visit and event identities remain distinct across cities and survive a cold-origin reload', async () => {
  let now = Date.UTC(2026, 0, 5, 10)
  const context = (cityId: string): LifeContextInit => ({ now, cityId, seed: `event-identity-${now}` })
  const finish = (state: LifeState): void => {
    const seconds = state.activeAction?.remaining
    if (typeof seconds !== 'number') assert.fail('a timed action is running')
    now += (seconds + 1) * 1000
    assert.equal(advanceLife(state, seconds + 1, context(state.estate.city)).ok, true)
  }

  let registrations = [registerCityForTest(cityA), registerCityForTest(cityB)]
  await Promise.all([loadCityContent(FICTIONAL_CITY_ID), loadCityContent(FICTIONAL_NEIGHBOUR_CITY_ID)])
  let state = createLife({ location: 'test-square' }, context(FICTIONAL_CITY_ID))
  const time = lagosTime(now)
  state.missions.day = time.day
  state.missions.week = time.week
  state.missions.daily = [{ id: 'd-two-places', n: 0, marks: [], claimed: false }]
  state.missions.weekly = []
  state.missions.visited = { week: time.week, list: [] }

  assert.equal(dispatch(state, { type: 'activity', payload: { id: 'test-play' } }, context(FICTIONAL_CITY_ID)).code, 'started')
  finish(state)
  const firstEventKey = eventOccurrenceKey(FICTIONAL_CITY_ID, event.id, time.day)
  assert.deepEqual(state.events.attended, [firstEventKey])

  assert.equal(dispatch(state, { type: 'travel', payload: { id: 'home', mode: 'trek' } }, context(FICTIONAL_CITY_ID)).code, 'started')
  finish(state)
  assert.equal(dispatch(state, { type: 'travel', payload: { id: 'test-square', mode: 'trek' } }, context(FICTIONAL_CITY_ID)).code, 'started')
  finish(state)
  assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: FICTIONAL_NEIGHBOUR_CITY_ID, mode: 'road' } }, context(FICTIONAL_CITY_ID)).code, 'departed')
  finish(state)
  assert.equal(dispatch(state, { type: 'activity', payload: { id: 'test-play' } }, context(FICTIONAL_NEIGHBOUR_CITY_ID)).code, 'started')
  finish(state)

  const secondEventKey = eventOccurrenceKey(FICTIONAL_NEIGHBOUR_CITY_ID, event.id, time.day)
  assert.notEqual(firstEventKey, secondEventKey)
  assert.deepEqual(state.events.attended, [firstEventKey, secondEventKey])
  assert.equal(state.events.count, 2)
  assert.deepEqual(state.missions.visited.list, [visitIdentity(FICTIONAL_CITY_ID, 'test-square'), visitIdentity(FICTIONAL_NEIGHBOUR_CITY_ID, 'test-square')])
  assert.deepEqual(state.missions.daily[0] && { n: state.missions.daily[0].n, marks: state.missions.daily[0].marks }, {
    n: 2,
    marks: [visitIdentity(FICTIONAL_CITY_ID, 'test-square'), visitIdentity(FICTIONAL_NEIGHBOUR_CITY_ID, 'test-square')],
  })
  const savedInB = structuredClone(state)

  for (const registration of registrations.reverse()) registration.dispose()
  registrations = [registerCityForTest(cityA), registerCityForTest(cityB)]
  try {
    await loadCityContent(FICTIONAL_NEIGHBOUR_CITY_ID)
    assert.equal(cachedCityContent(FICTIONAL_CITY_ID), null)
    state = createLife(savedInB, { ...context(FICTIONAL_NEIGHBOUR_CITY_ID), trustedSave: true })
    assert.deepEqual(state.events.attended, [firstEventKey, secondEventKey])
    assert.deepEqual(state.missions.visited.list, [visitIdentity(FICTIONAL_CITY_ID, 'test-square'), visitIdentity(FICTIONAL_NEIGHBOUR_CITY_ID, 'test-square')])
    assert.deepEqual(state.missions.daily[0]?.marks, [visitIdentity(FICTIONAL_CITY_ID, 'test-square'), visitIdentity(FICTIONAL_NEIGHBOUR_CITY_ID, 'test-square')])
    const live = eventsAt(now, FICTIONAL_NEIGHBOUR_CITY_ID).find((item) => item.id === event.id)
    assert.ok(live)
    assert.equal(viewLife(state, context(FICTIONAL_NEIGHBOUR_CITY_ID)).events.live.find((item) => item.key === secondEventKey)?.attended, true)
    assert.match(eventIcs(live), new RegExp(`UID:${secondEventKey}@allworld`))
    assert.equal(awayCard({ hoursAway: 24, events: [live] })?.lines[0]?.id, `event:${secondEventKey}`)
    assert.equal(cachedCityContent(FICTIONAL_CITY_ID), null, 'event and mission views do not load the origin city')

    const migrated = createLife({ missions: {
      day: time.day, daily: [{ id: 'd-two-places', n: 1, marks: ['test-square'], claimed: false }],
      visited: { week: time.week, list: ['test-square', 'not-a-venue'] },
    } }, context(FICTIONAL_NEIGHBOUR_CITY_ID))
    assert.deepEqual(migrated.missions.visited.list, [visitIdentity(FICTIONAL_NEIGHBOUR_CITY_ID, 'test-square')])
    assert.deepEqual(migrated.missions.daily[0]?.marks, [visitIdentity(FICTIONAL_NEIGHBOUR_CITY_ID, 'test-square')])
  } finally {
    for (const registration of registrations.reverse()) registration.dispose()
  }
})

test('Lagos keeps deployed occurrence and visit keys', () => {
  const day = 20458
  assert.equal(visitIdentity('lagos', 'park'), 'park')
  assert.equal(eventOccurrenceKey('lagos', event.id, day), `${event.id}:${day}`)
  assert.equal(occurrenceOn(event, day)?.key, `${event.id}:${day}`)
})
