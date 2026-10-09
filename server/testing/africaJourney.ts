import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { DEFAULT_LOOK } from '../../src/game/content/traits.ts'
import { allCityLinks, cityRules, isOpenCityId, linksFrom, loadCityContent } from '../../src/game/cities/registry.ts'
import { createLife, viewLife } from '../../src/life.ts'
import { planHomewardRoute } from '../../src/game/cities/homewardRoute.ts'
import { routeUnavailable } from '../../src/game/cities/routeAvailability.ts'
import { driver } from './cityJourney.ts'
import type { JourneyDevice } from './cityJourney.ts'

export const AFRICA_CAPITALS = ['yaounde', 'lome', 'accra', 'nairobi', 'algiers'] as const

export interface AfricaJourneyHost {
  now(): number
  request(path: string, body?: object, cookie?: string): Promise<Response>
  elapse(device: JourneyDevice, city: string, ms: number): Promise<void>
  restart(): Promise<void>
  /** Test-only credit made through the authenticated admin wallet route. */
  credit(device: JourneyDevice, amount: number, reason: string): Promise<void>
  /** Test-only spending through the same authenticated admin wallet boundary. */
  debit(device: JourneyDevice, amount: number, reason: string): Promise<void>
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

/** Real host consent, paired loan settlement, saved connections and original-home restoration. */
export async function homewardJourney(host: AfricaJourneyHost): Promise<void> {
  const home = 'maiduguri'
  for (const foreign of AFRICA_CAPITALS) {
    await Promise.all([home, foreign, 'lagos'].map(city => loadCityContent(city)))
    const unit = cityRules(home)?.units[0]?.id
    assert.ok(unit)
    const d = driver(host)
    const device = await d.start('Homeward Traveller', home, unit)
    await d.read(`/api/world/me?city=${home}`, device.cookie)
    let city = home
    const read = () => d.life(device, city)
    const journal = async () => list((await d.read('/api/support/history', device.cookie)).entries).map(object)
    const quoteOf = (state: Record<string, unknown>) => {
      const context = { cityId: String(object(state.estate).city), now: host.now(), trustedSave: true }
      return viewLife(createLife(state, context), context).estate.ride.journey
    }
    const fund = async (target: number, reason: string): Promise<void> => {
      const before = await read(), difference = target - Number(before.cash)
      if (difference) {
        if (difference > 0) await host.credit(device, difference, reason)
        else await host.debit(device, -difference, reason)
        const after = await read(), line = object(list(after.ledger).at(-1))
        assert.equal(after.cash, target)
        assert.deepEqual([line.amount, line.balance], [difference, target])
        const expectedReason = `Admin ${difference > 0 ? 'credit' : 'debit'}: ${reason}`
        assert.equal(line.reason, expectedReason)
        const effects = (await journal()).filter(entry => entry.reason === expectedReason)
        assert.equal(effects.length, 1, 'the funding/spending intent writes one real wallet effect')
        assert.deepEqual([effects[0]?.amount, effects[0]?.balanceAfter], [difference, target])
      }
      assert.equal((await read()).cash, target)
    }

    let atHome = await read()
    if (atHome.location !== 'home') atHome = await d.finish(device, home, object((await d.action(device, home, 'travel', { id: 'home', mode: 'trek' })).state))
    const furnishing = object(list(object(atHome.home).items)[0])
    assert.equal(typeof furnishing.id, 'string')
    await d.action(device, home, 'home.furniture-store', { id: furnishing.id })
    atHome = await read()
    assert.ok(Object.keys(object(object(atHome.home).storage)).length > 0, 'preservation covers actual stored furniture')
    assert.ok(Object.keys(object(atHome.inventory)).length > 0, 'normal onboarding supplies actual kitchen inventory')
    const possessions = (state: Record<string, unknown>) => ({ home: state.home, property: state.property, inventory: state.inventory,
      residence: Object.fromEntries(['lga', 'plot', 'style', 'home', 'living', 'tier'].map(key => [key, object(state.estate)[key]])) })
    const original = structuredClone(possessions(atHome))

    const toHub = planHomewardRoute(home, 'lagos', linksFrom, isOpenCityId)
    const flight = linksFrom('lagos').find(link => link.to === foreign && link.mode === 'air' && !routeUnavailable(link))
    assert.ok(toHub && flight, 'normal outward setup uses the actual Lagos connection and capital flight')
    const outward = [...toHub.legs, { from: 'lagos', to: flight.to, mode: flight.mode, fare: flight.fare, seconds: flight.seconds }]
    await Promise.all(outward.map(leg => loadCityContent(leg.to)))
    let staleQuote: string | undefined
    for (const [index, leg] of outward.entries()) {
      assert.equal(leg.from, city)
      await fund(leg.fare, `Homeward outward leg ${index}`)
      const before = await read()
      const departure = await d.action(device, city, 'estate.relocate', { to: leg.to, mode: leg.mode })
      const paid = object(departure.state)
      assert.equal(paid.cash, Number(before.cash) - leg.fare)
      assert.equal(object(list(paid.ledger).at(-1)).amount, -leg.fare)
      const arrived = await d.finish(device, city, paid)
      assert.equal(object(arrived.estate).city, leg.to)
      city = leg.to
      if (city !== foreign) {
        await fund(0, `Homeward intermediate spending ${index}`)
        const earlier = quoteOf(await read())
        assert.ok(earlier)
        staleQuote = earlier.key
      }
    }
    assert.equal(city, foreign)
    await fund(0, 'Homeward cashless visitor setup')
    const before = await read(), quote = quoteOf(before)
    assert.ok(quote && staleQuote && staleQuote !== quote.key)
    assert.deepEqual([quote.from, quote.to], [foreign, home])
    assert.ok(quote.legs.length > 0 && quote.legs.length <= 4)
    if (foreign === 'nairobi') assert.ok(quote.legs.length > 1, 'the non-airport Nairobi recovery must exercise connecting legs')
    const beforeJournal = await journal()
    for (const payload of [{}, { quote: staleQuote }]) {
      const response = await host.request('/api/action', { cityId: city, type: 'homeward.accept', payload, actionId: id(host.now()) }, device.cookie)
      const refused = await json(response)
      assert.deepEqual([refused.ok, refused.code], [false, 'quote_changed'])
      const state = await read()
      assert.deepEqual([state.cash, object(state.travel).rideDebt ?? 0, state.activeAction], [0, 0, null])
      assert.deepEqual(state.ledger, before.ledger)
      assert.deepEqual(await journal(), beforeJournal)
      assert.equal(quoteOf(state)?.key, quote.key, 'refusal leaves the current offer available for fresh consent')
    }

    const intent = id(host.now()), payload = { quote: quote.key }
    const accepted = await d.action(device, city, 'homeward.accept', payload, intent)
    assert.equal(accepted.code, 'departed')
    const booked = object(accepted.state)
    assert.deepEqual([booked.cash, object(booked.travel).rideDebt, object(booked.activeAction).kind], [0, quote.totalFare, 'homeward'])
    assert.deepEqual(object(booked.activeAction).ticket, quote)
    const loanLines = list(booked.ledger).slice(list(before.ledger).length).map(object)
    assert.deepEqual(loanLines.map(line => [line.amount, line.balance]), [[quote.totalFare, quote.totalFare], [-quote.totalFare, 0]])
    const loanEffects = (await journal()).filter(entry => String(entry.reason).startsWith('Ride home on credit:'))
    assert.deepEqual(loanEffects.map(entry => [entry.amount, entry.balanceAfter]).sort((a, b) => Number(b[0]) - Number(a[0])), [[quote.totalFare, quote.totalFare], [-quote.totalFare, 0]])
    const replay = async (): Promise<void> => {
      const repeated = await d.action(device, foreign, 'homeward.accept', payload, intent)
      assert.equal(repeated.duplicate, true)
      const state = await read()
      assert.equal(state.cash, 0)
      assert.equal(object(state.travel).rideDebt, quote.totalFare)
      assert.deepEqual(state.ledger, booked.ledger)
      assert.deepEqual((await journal()).filter(entry => String(entry.reason).startsWith('Ride home on credit:')), loanEffects)
    }
    await replay()
    for (const type of ['cancel', 'travel.skip']) {
      const refused = await json(await host.request('/api/action', { cityId: city, type, payload: {}, actionId: id(host.now()) }, device.cookie))
      assert.equal(refused.ok, false, `${type}: an accepted ticket cannot be cancelled or skipped`)
      if (type === 'cancel') assert.equal(refused.code, 'no_cancel')
      assert.equal(object(object(refused.state).activeAction).kind, 'homeward')
    }
    const conflict = await host.request('/api/action', { cityId: foreign, type: 'homeward.accept', payload: { quote: staleQuote }, actionId: intent }, device.cookie)
    assert.equal(conflict.status, 409)
    assert.equal(object(await conflict.json()).error, 'action_id_conflict')
    await replay()

    let boundary = 0
    for (const [index, leg] of quote.legs.entries()) {
      const active = object((await read()).activeAction)
      const elapsed = quote.totalSeconds - Number(active.remaining)
      const middle = boundary + leg.seconds / 2
      assert.ok(elapsed < middle, `the fixture reaches connection ${index} before its midpoint`)
      await host.elapse(device, foreign, (middle - elapsed) * 1000)
      const inConnection = await read()
      assert.equal(object(inConnection.activeAction).legIndex, index)
      assert.equal(object(inConnection.estate).city, foreign, 'connections never become playable stops')
      const began = host.now()
      await host.restart()
      // Restart latency is not simulated journey time; the existing fixture clock removes that latency only.
      const downtime = host.now() - began
      if (downtime > 0) await host.elapse(device, foreign, -downtime)
      const persisted = await read()
      assert.deepEqual(object(persisted.activeAction).ticket, quote)
      assert.equal(object(persisted.activeAction).legIndex, index)
      assert.equal(object(persisted.estate).home, home)
      await replay()
      boundary += leg.seconds
    }
    const underway = await read()
    await host.elapse(device, foreign, (Number(object(underway.activeAction).remaining) + 1) * 1000)
    const arrived = await read()
    assert.deepEqual([object(arrived.estate).city, arrived.location, arrived.activeAction], [home, 'home', null])
    city = home
    assert.deepEqual(possessions(arrived), original, 'the original home, storage and inventory survive every connection')
    await replay()
    await host.restart()
    assert.deepEqual(possessions(await read()), original)
    await host.elapse(device, home, 1000)
    await replay()
  }
}
