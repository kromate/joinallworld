import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceLife, createLife, dispatch, viewLife } from '../../life.ts'
import { loadCityContent, registerCityForTest } from './registry.ts'
import { fictionalCity, fictionalContent } from './testing/fictionalCity.test-fixture.ts'
import { quote } from '../systems/travel.ts'
import { localTripRoute } from '../../map3d/roads.ts'
import { tripOf, tripPose } from '../../map3d/trip.ts'
import { tripInfo } from '../../app/features/travel/travelModel.ts'
import { VEHICLES } from '../../map3d/vehicles.ts'

// The route asks for more than a trip inside a city may take: the quote is held to the local cap.
const route = { a: 'test-square', b: 'polling-unit', mode: 'boat', fare: 700, seconds: 40, beta: true } as const
const TRIP = 15

test('local boat travel requires its jetty pair, charges once, resumes and returns without road events', async () => {
  const registered = registerCityForTest({ ...fictionalCity, loadContent: async () => ({ ...fictionalContent, localRoutes: [route] }) })
  try {
    await loadCityContent(fictionalCity.id)
    let now = Date.UTC(2026, 0, 5, 9)
    const context = () => ({ cityId: fictionalCity.id, now, seed: 'boat' })
    let state = createLife({ location: route.a, cash: 10000 }, context())
    const options = () => viewLife(state, context()).travel.destinations
    assert.ok(options().find(place => place.id === route.b)?.modes.some(mode => mode.id === 'boat'))
    assert.ok(!options().find(place => place.id === 'home')?.modes.some(mode => mode.id === 'boat'))
    const before = state.cash
    assert.equal(dispatch(state, { type: 'travel', payload: { id: 'home', mode: 'boat' } }, context()).code, 'travel_mode_unavailable')
    assert.equal(state.cash, before)
    assert.equal(dispatch(state, { type: 'travel', payload: { id: route.b, mode: 'boat' } }, context()).code, 'started')
    assert.equal(state.cash, before - route.fare)
    assert.equal(state.activeAction?.duration, TRIP)
    assert.equal(tripOf(state)?.mode, 'boat')
    assert.equal(tripInfo(state, viewLife(state, context()))?.mode.label, 'Boat')
    now += 10000
    advanceLife(state, 10, context())
    const saved = structuredClone(state)
    state = createLife(saved, { ...context(), trustedSave: true })
    assert.deepEqual(state.activeAction, saved.activeAction)
    assert.equal(state.cash, saved.cash)
    now += 6000
    advanceLife(state, 6, context())
    assert.equal(state.location, route.b)
    assert.equal(state.travel.event, null)
    assert.equal(state.travel.lastTrip?.mode, 'boat')
    assert.equal(dispatch(state, { type: 'travel', payload: { id: route.a, mode: 'boat' } }, context()).code, 'started')
    now += (TRIP + 1) * 1000
    advanceLife(state, TRIP + 1, context())
    assert.equal(state.location, route.a)
    assert.equal(state.cash, before - 2 * route.fare)
    assert.equal(state.travel.event, null)
    assert.equal(dispatch(state, { type: 'travel', payload: { id: route.b, mode: 'boat' } }, context()).code, 'started')
    const charged = state.cash
    assert.equal(dispatch(state, { type: 'cancel' }, context()).ok, true)
    assert.equal(state.location, route.a)
    assert.equal(state.cash, charged, 'cancellation retains the existing nonrefundable fare rule')
    state.location = 'home'
    const ctx = { ...context(), rng: () => 0, cityId: fictionalCity.id }
    assert.throws(() => quote(state, route.b, 'boat', ctx), /declared jetty/)
    const forged = createLife({ ...state, activeAction: { kind: 'travel', id: route.b, mode: 'boat', duration: 40, remaining: 30, fare: 700 } }, { ...context(), trustedSave: true })
    assert.equal(forged.activeAction, null)
  } finally { registered.dispose() }
})

test('water routes use source vertices in both directions and a boat vehicle', () => {
  const points = [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 10 }, { x: 10, y: 0, z: 10 }]
  const pack = { localRoutes: [{ a: 'a', b: 'b', mode: 'boat' as const, points }] }
  const forward = localTripRoute(pack, 'a', 'b', 'boat')
  const reverse = localTripRoute(pack, 'b', 'a', 'boat')
  assert.ok(forward && reverse)
  assert.deepEqual(forward.points.map(({ x, y, z }) => ({ x, y, z })), points)
  assert.deepEqual(reverse.points, [...forward.points].reverse())
  assert.equal(forward.length, 20)
  assert.equal(localTripRoute(pack, 'a', 'b', 'cab'), null)
  assert.equal(localTripRoute(pack, 'home', 'b', 'boat'), null)
  const pose = tripPose(forward, 0.5, 'boat')
  assert.equal(pose.phase, 'ride')
  assert.equal(pose.walking, false)
  assert.ok(pose.vehicle)
  assert.equal(typeof VEHICLES.boat, 'function')
})
