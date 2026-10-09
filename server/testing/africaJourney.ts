import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DEFAULT_LOOK } from '../../src/game/content/traits.ts'
import { allCityLinks, cityRules, loadCityContent } from '../../src/game/cities/registry.ts'
import type { JourneyDevice } from './cityJourney.ts'

export const AFRICA_CAPITALS = ['yaounde', 'lome', 'accra', 'nairobi', 'algiers'] as const

export interface AfricaJourneyHost {
  now(): number
  request(path: string, body?: object, cookie?: string): Promise<Response>
  elapse(device: JourneyDevice, city: string, ms: number): Promise<void>
  restart(): Promise<void>
  /** Test-only credit made through the authenticated admin wallet route. */
  credit(device: JourneyDevice, amount: number, reason: string): Promise<void>
}

const object = (value: unknown): Record<string, unknown> => {
  assert.ok(typeof value === 'object' && value !== null && !Array.isArray(value))
  return value as Record<string, unknown>
}
const list = (value: unknown): unknown[] => { assert.ok(Array.isArray(value)); return value }
const id = (now: number): string => `${now}:${randomUUID()}`

async function json(response: Response): Promise<Record<string, unknown>> {
  const value = object(await response.json())
  assert.equal(response.status, 200, JSON.stringify(value))
  return value
}

export async function africaJourney(host: AfricaJourneyHost): Promise<void> {
  await Promise.all([...AFRICA_CAPITALS, 'lagos'].map(city => loadCityContent(city)))
  const deviceResponse = await host.request('/api/session', { name: 'Africa Journey', onboarding: true })
  const deviceAnswer = await json(deviceResponse)
  const cookie = deviceResponse.headers.get('set-cookie')?.split(';')[0]
  assert.ok(cookie, 'the real session route issues the journey cookie')
  const sessionId = object(deviceAnswer.session).id
  assert.equal(typeof sessionId, 'string')
  const device: JourneyDevice = { id: String(sessionId), cookie }
  const life = async (city: string): Promise<Record<string, unknown>> => object((await json(await host.request(`/api/life?city=${city}`, undefined, cookie))).state)
  const action = async (city: string, type: string, payload: object, actionId = id(host.now())): Promise<Record<string, unknown>> => json(await host.request('/api/action', { cityId: city, type, payload, actionId }, cookie))
  const finish = async (city: string, started: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const active = started.activeAction
    if (active) await host.elapse(device, city, (Number(object(active).remaining) + 1) * 1000)
    return life(city)
  }

  assert.equal(object((await life('lagos')).estate).city, 'lagos')
  await action('lagos', 'onboarding.quick-start', { look: DEFAULT_LOOK })
  await action('lagos', 'onboarding.traits', { traits: ['musical', 'tech-bro-or-sis'] })
  await action('lagos', 'onboarding.dream', { dream: 'yaba-unicorn' })
  await action('lagos', 'onboarding.lottery', {})
  await action('lagos', 'onboarding.home', { lga: 'ikeja', via: 'manual' })
  await json(await host.request('/api/world/me?city=lagos', undefined, cookie))
  const settled = await life('lagos')
  const originalEstate = object(settled.estate)
  const originalHome = structuredClone({ lga: originalEstate.lga, plot: originalEstate.plot, style: originalEstate.style, home: originalEstate.home, living: originalEstate.living, tier: originalEstate.tier })
  const originalName = settled.name
  await host.credit(device, 2_000_000, 'Africa capital trip acceptance fixture')
  const credited = await life('lagos')
  assert.equal(Number(credited.cash) - Number(settled.cash), 2_000_000)
  const creditLines = list(credited.ledger).map(object).filter(line => line.reason === 'Admin credit: Africa capital trip acceptance fixture')
  assert.equal(creditLines.length, 1, 'fixture funding records exactly one wallet ledger credit')
  const history = object(await json(await host.request('/api/support/history', undefined, cookie)))
  const creditEffects = list(history.entries).map(object).filter(entry => entry.reason === 'Admin credit: Africa capital trip acceptance fixture')
  assert.equal(creditEffects.length, 1, 'the actual wallet-effect journal records the funding once')
  assert.equal(creditEffects[0]?.amount, 2_000_000)
  assert.equal(creditEffects[0]?.balanceAfter, credited.cash)

  const links = allCityLinks()
  for (const city of AFRICA_CAPITALS) {
    const route = links.find(link => (link.a === 'lagos' && link.b === city || link.b === 'lagos' && link.a === city) && link.mode === 'air')
    assert.ok(route, `${city} has its production airport link from Lagos`)
    const before = await life('lagos')
    const beforeLedgerLength = list(before.ledger).length
    const tripId = id(host.now())
    const departure = await action('lagos', 'estate.relocate', { to: city, mode: 'air' }, tripId)
    const inFlight = object(departure.state)
    assert.equal(Number(inFlight.cash), Number(before.cash) - route.fare, `${city}: departure charges exactly the production fare`)
    const ledgerAfterDeparture = list(inFlight.ledger).map(object)
    const fareLines = ledgerAfterDeparture.slice(beforeLedgerLength).filter(line => Number(line.amount) === -route.fare)
    assert.equal(fareLines.length, 1, `${city}: exactly one fare ledger entry`)
    const replay = await action('lagos', 'estate.relocate', { to: city, mode: 'air' }, tripId)
    assert.equal(replay.duplicate, true, `${city}: same intent replays its successful receipt`)
    assert.equal(Number(object(replay.state).cash), Number(inFlight.cash), `${city}: replaying the same action id never charges twice`)
    const refused = object(await (await host.request('/api/action', { cityId: 'lagos', type: 'estate.relocate', payload: { to: city, mode: 'air' }, actionId: id(host.now()) }, cookie)).json())
    assert.equal(refused.ok, false, `${city}: a new departure cannot start while in flight`)
    assert.equal(refused.code, 'busy', `${city}: the actual unfinished-flight guard refuses departure`)
    assert.equal(Number((await life('lagos')).cash), Number(inFlight.cash), `${city}: refused second departure adds no fare`)

    await host.restart()
    const persisted = await life('lagos')
    assert.equal(object(persisted.activeAction).kind, 'intercity', `${city}: the unfinished flight persists through host restart`)
    assert.equal(object(persisted.activeAction).id, city)
    assert.equal(Number(persisted.cash), Number(inFlight.cash))
    const persistedReplay = await action('lagos', 'estate.relocate', { to: city, mode: 'air' }, tripId)
    assert.equal(persistedReplay.duplicate, true, `${city}: the actual departure receipt survives host restart`)
    assert.equal(Number((await life('lagos')).cash), Number(inFlight.cash), `${city}: receipt replay after restart adds no fare`)
    let arrived = await finish('lagos', inFlight)
    assert.equal(object(arrived.estate).city, city, `${city}: the HTTP action lifecycle arrives in the target city`)
    const airport = cityRules(city)?.hubs.find(hub => hub.mode === 'air')?.venueId
    assert.ok(airport, `${city}: the production city module declares its airport arrival hub`)
    assert.equal(arrived.location, airport, `${city}: an air visitor arrives at the airport venue from the route`)
    assert.equal(object(arrived.estate).lga, null, `${city}: travel does not create a second owned home`)
    assert.ok(object(object(arrived.estate).away).lagos, `${city}: the Nigerian home remains stored while away`)
    arrived = await life(city)
    assert.equal(object(arrived.estate).city, city, `${city}: a fresh session read reloads the visitor life`)
    await host.restart()
    assert.equal(object((await life(city)).estate).city, city, `${city}: visitor life survives a persisted host restart`)

    const mealVenue = `${city}-meal-stop`, mealId = `${city}-visitor-meal`
    const mealTrip = await finish(city, object((await action(city, 'travel', { id: mealVenue, mode: 'trek' })).state))
    assert.equal(mealTrip.location, mealVenue)
    await action(city, 'spot', { id: 'counter' })
    const mealStarted = object((await action(city, 'activity', { id: mealId })).state)
    const walletDuringMeal = mealStarted.cash
    const blocked = object(await (await host.request('/api/action', { cityId: city, type: 'estate.relocate', payload: { to: 'lagos', mode: 'air' }, actionId: id(host.now()) }, cookie)).json())
    assert.equal(blocked.ok, false, `${city}: an unfinished meal action blocks departure`)
    assert.equal(blocked.code, 'busy', `${city}: the unfinished-action guard refuses departure`)
    assert.equal(Number((await life(city)).cash), Number(walletDuringMeal), `${city}: blocked departure charges no fare`)
    await finish(city, mealStarted)

    const returnBefore = await life(city)
    const returnLedgerLength = list(returnBefore.ledger).length
    const returnStarted = object((await action(city, 'estate.relocate', { to: 'lagos', mode: 'air' })).state)
    assert.equal(Number(returnStarted.cash), Number(returnBefore.cash) - route.fare, `${city}: return fare is charged once`)
    const returned = await finish(city, returnStarted)
    assert.equal(object(returned.estate).city, 'lagos')
    const estate = object(returned.estate)
    assert.deepEqual({ lga: estate.lga, plot: estate.plot, style: estate.style, home: estate.home, living: estate.living, tier: estate.tier }, originalHome, `${city}: original Nigerian home and living details survive the return`)
    assert.equal(returned.name, originalName, `${city}: character identity survives the trip`)
    const initialLedger = list(credited.ledger)
    const finalLedger = list(returned.ledger)
    assert.deepEqual(finalLedger.slice(0, initialLedger.length), initialLedger, `${city}: existing balance ledger entries are retained`)
    assert.equal(Number(returned.cash), Number(credited.cash) + finalLedger.slice(initialLedger.length).reduce<number>((sum, entry) => sum + Number(object(entry).amount), 0), `${city}: returned balance matches the retained ledger and trip expenses`)
    assert.deepEqual(finalLedger.slice(returnLedgerLength).map(object).filter(line => Number(line.amount) === -route.fare).length, 1, `${city}: exactly one return fare is recorded in the wallet ledger`)

    const replayAfterRestart = await action('lagos', 'estate.relocate', { to: city, mode: 'air' }, tripId)
    assert.equal(replayAfterRestart.ok, true, `${city}: an accepted action id replays its receipt after persistence`)
    assert.equal(replayAfterRestart.duplicate, true, `${city}: the trip receipt is recognized after persistence`)
    assert.equal(Number((await life('lagos')).cash), Number(returned.cash), `${city}: replay after restart cannot charge again`)
    const savedHistory = object(await json(await host.request('/api/support/history', undefined, cookie)))
    assert.deepEqual(list(savedHistory.entries).map(object).filter(entry => entry.reason === 'Admin credit: Africa capital trip acceptance fixture'), creditEffects, `${city}: funding journal survives restart without a duplicate effect`)
  }
}
