import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { object } from './cityJourney.ts'

interface BoatHost {
  now(): number
  request(path: string, body?: object): Promise<Record<string, unknown>>
  seed(location: string, cash: number): Promise<void>
  elapse(ms: number): Promise<void>
  restart(): Promise<void>
}

export async function boatJourney(host: BoatHost, route: { a: string; b: string; fare: number; seconds: number }): Promise<void> {
  const CITY = 'port-harcourt', request = host.request
  const life = async () => object((await request(`/api/life?city=${CITY}`)).state)
  const action = (destination: string, actionId: string) => request('/api/action', { cityId: CITY, type: 'travel', payload: { id: destination, mode: 'boat' }, actionId })
  await request('/api/session', { name: 'Boat Tester' })
  await life()
  await host.seed(route.a, 10000)
  const initial = await life()
  const initialLedger = (initial.ledger as unknown[]).length
  for (const destination of [route.b, route.a]) {
    const before = await life(), id = `${host.now()}:${randomUUID()}`
    const started = await action(destination, id)
    assert.equal(started.ok, true, JSON.stringify(started))
    assert.equal(object(started.state).cash, Number(before.cash) - route.fare)
    assert.equal(object(object(started.state).activeAction).duration, route.seconds)
    const duplicate = await action(destination, id)
    assert.equal(duplicate.duplicate, true)
    assert.equal(object(duplicate.state).cash, object(started.state).cash)
    await host.elapse(route.seconds * 500)
    const midway = await life()
    const remaining = object(midway.activeAction).remaining
    assert.ok(Number(remaining) > 0 && Number(remaining) < route.seconds)
    await host.restart()
    const reloaded = await life()
    assert.equal(reloaded.cash, midway.cash)
    assert.deepEqual(reloaded.activeAction, midway.activeAction)
    const retried = await action(destination, id)
    assert.equal(retried.duplicate, true)
    assert.equal(object(retried.state).cash, midway.cash)
    await host.elapse(route.seconds * 500 + 1000)
    const arrived = await life()
    assert.equal(arrived.location, destination)
    assert.equal(arrived.activeAction, null)
    assert.equal(object(arrived.travel).event, null)
    const afterArrival = await action(destination, id)
    assert.equal(afterArrival.duplicate, true)
    assert.equal(object(afterArrival.state).cash, arrived.cash)
  }
  const final = await life()
  assert.equal(final.cash, 10000 - 2 * route.fare)
  assert.deepEqual((final.ledger as unknown[]).slice(initialLedger).map(entry => object(entry).amount), [-route.fare, -route.fare])
}
