import assert from 'node:assert/strict'
import { loadCityContent, cachedCityContent } from '../../src/game/cities/registry.ts'
import { viewLife } from '../../src/life.ts'
import type { LifeState } from '../../src/types/life.ts'
import { driver, object } from './cityJourney.ts'
import type { JourneyDevice, JourneyHost, JourneySocket } from './cityJourney.ts'

const list = (value: unknown): unknown[] => { assert.ok(Array.isArray(value)); return value }
const asState = (value: Record<string, unknown>): LifeState => value as unknown as LifeState

/** The four open Ogun cities and the local government a newcomer picks in each. */
const OGUN = [
  { id: 'abeokuta', name: 'Tunde', lga: 'abeokuta-south' },
  { id: 'ota', name: 'Kemi', lga: 'ado-odo-ota' },
  { id: 'ijebu-ode', name: 'Femi', lga: 'ijebu-ode' },
  { id: 'sagamu', name: 'Sola', lga: 'sagamu' },
] as const

/**
 * Ogun State, played on a host (the same script runs on the Node server and on the Worker):
 *   - a newcomer starts in each of the four cities, visits every venue of it and does something at each; the venues are the city's own
 *   - a job works in each city (apply, one shift, the pay arrives once); the gem hunt and the missions point at that city's places
 *   - a Lagos player crosses to Ota and back (cheap, short); the fare is charged once, a trip survives the host restarting, and a
 *     reload shows the new city; Abeokuta and Ibadan are reachable both ways, by train and by road
 *   - two players meet in an Ota venue and chat
 *   - elections, billboards, radio and the rich list of Abeokuta are not Ota's, Sagamu's, Ibadan's or Lagos's
 */
export async function ogunJourney(host: JourneyHost): Promise<void> {
  const { id, read, life, action, finish, conserved, start } = driver(host)
  const ids = ['lagos', 'ibadan', ...OGUN.map(city => city.id)]
  await Promise.all(ids.map(city => loadCityContent(city)))
  const contentOf = (city: string) => { const content = cachedCityContent(city); assert.ok(content, city); return content }
  const here = (city: string) => ({ now: host.now(), cityId: city })
  const lagosIds = new Set(contentOf('lagos').venues.map(venue => venue.id))
  const players = new Map<string, JourneyDevice>()

  /** Walk to a place, unless already standing there. */
  async function go(device: JourneyDevice, city: string, venue: string): Promise<void> {
    if ((await life(device, city)).location === venue) return
    await finish(device, city, object((await action(device, city, 'travel', { id: venue, mode: 'trek' })).state))
  }

  /** Walking a whole city takes it out of anyone: eat, wash and sleep at home. */
  async function recover(device: JourneyDevice, city: string): Promise<void> {
    await go(device, city, 'home')
    for (const [spot, activity] of [['kitchen', 'garri'], ['bathroom', 'bath'], ['bedroom', 'nap'], ['bedroom', 'nap']] as const) {
      await action(device, city, 'spot', { id: spot })
      await finish(device, city, object((await action(device, city, 'activity', { id: activity })).state))
    }
  }
  /** Did the activity run? A refusal is returned with its code. */
  async function tryActivity(device: JourneyDevice, city: string, activityId: string): Promise<string | null> {
    const response = await host.request('/api/action', { cityId: city, type: 'activity', payload: { id: activityId }, actionId: id() }, device.cookie)
    const answer = object(await response.json())
    if (answer.ok === true) { await finish(device, city, object(answer.state)); return null }
    return String(answer.code)
  }

  for (const { id: city, name, lga } of OGUN) {
    const content = contentOf(city)
    // ---- a newcomer starts in this city ------------------------------------------------------------------------------
    const player = await start(name, city, lga)
    players.set(city, player)
    const resident = await read(`/api/world/me?city=${city}`, player.cookie)
    assert.equal(resident.placed, true)
    assert.equal(resident.lga, lga, `${city}: the starter house is in the chosen local government`)
    const born = await life(player, city)
    assert.equal(object(born.estate).city, city)
    assert.equal(object(object(born.estate).plot).lga, lga)
    assert.equal((await host.request('/api/life?city=lagos', undefined, player.cookie)).status, 409, `${city}: the character is not in Lagos`)

    // ---- every venue offers something --------------------------------------------------------------------------------
    let visited = 0
    for (const venue of content.venues.filter(item => item.id !== 'home')) {
      assert.ok(!lagosIds.has(venue.id), `${city}: ${venue.id} is not a Lagos venue id`)
      const arrived = await finish(player, city, object((await action(player, city, 'travel', { id: venue.id, mode: 'trek' })).state))
      assert.equal(arrived.location, venue.id)
      let done = 0
      const refused: string[] = []
      for (const spot of Object.values(venue.definition.spots)) {
        for (const activity of spot.activities ?? []) {
          await action(player, city, 'spot', { id: spot.id })
          const code = await tryActivity(player, city, activity.id)
          if (code === null) done += 1
          else refused.push(`${activity.id}:${code}:${activity.hours ? 'hours' : 'open'}`)
        }
      }
      // An evening set is open from 18:00 and the host's clock stands at midday: its refusal is the opening hour, and the engine test of
      // src/game/cities/ogun/venues.test.ts plays it at 20:00. Anything else must be doable now.
      const evening = done === 0 && refused.length > 0 && refused.every(item => item.endsWith(':closed:hours'))
      assert.ok(done >= 1 || evening, `${city}/${venue.id}: at least one activity can be done (${refused.join(' ')})`)
      visited += 1
      if (visited % 6 === 0) await recover(player, city)
    }
    assert.ok(visited >= 15, `${city} has at least 15 venues to visit`)
    // The qualified visit keys are stored for this city only; the stored life stays readable.
    const afterWalk = await life(player, city)
    const travel = object(afterWalk.travel)
    assert.ok(list(travel.visited).every(key => typeof key === 'string' && key.startsWith(`${city}:`)), `${city}: visited places are city-qualified`)
    assert.ok(list(travel.visited).length >= visited)

    // ---- a job whose workplace is in this city -------------------------------------------------------------------------
    await recover(player, city)
    await action(player, city, 'apply-job', { id: 'community-helper' })
    const employed = await life(player, city)
    assert.equal(object(employed.career).city, city)
    const workplace = content.workplaces.find(item => item.careerId === 'community-helper')
    assert.ok(workplace && content.venues.some(venue => venue.id === workplace.venueId), `${city}: the workplace is one of its venues`)
    await go(player, city, workplace.venueId)
    await action(player, city, 'spot', { id: 'work' })
    const shift = viewLife(asState(await life(player, city)), here(city)).career.shift
    assert.ok(shift, `${city}: a shift is offered`)
    const before = await life(player, city), ledgerBefore = list(before.ledger).length
    const worked = object((await action(player, city, 'activity', { id: shift.id })).state)
    const paid = await finish(player, city, worked)
    const payments = list(paid.ledger).slice(ledgerBefore).map(object).filter(entry => Number(entry.amount) > 0)
    assert.equal(payments.length, 1, `${city}: the pay arrives once`)
    assert.equal(Number(paid.cash) - Number(before.cash), Number(payments[0]?.amount))
    assert.ok(Number(paid.cash) > Number(before.cash))
    conserved(paid)
    const again = await host.request('/api/action', { cityId: city, type: 'activity', payload: { id: shift.id }, actionId: id() }, player.cookie)
    assert.equal(object(await again.json()).ok, false, `${city}: the same shift does not pay again at once`)
    assert.equal(Number((await life(player, city)).cash), Number(paid.cash))
    // the shift cooldown is stored city-qualified, and the saved life is still read
    const cooldowns = object(object((await life(player, city)).travel).cooldowns)
    assert.ok(Object.keys(cooldowns).some(key => key.startsWith(`${city}:`)), `${city}: the shift cooldown is city-qualified`)

    // ---- the gem hunt and the missions name this city's places ------------------------------------------------------------
    const hunt = object(object(paid.civic).hunt)
    const gems = list(hunt.gems).map(object)
    assert.ok(gems.length >= 3)
    for (const gem of gems) assert.ok(content.venues.some(venue => venue.id === gem.venue), `${city}: gem at ${String(gem.venue)} is its own place`)
    const view = viewLife(asState(paid), here(city))
    const missionTargets = [...view.missions.daily, ...view.missions.weekly].flatMap(row => Array.isArray(row.go) ? [String(row.go[0])] : [])
    for (const target of missionTargets) assert.ok(content.venues.some(venue => venue.id === target), `${city}: mission goes to ${target}, one of its own places`)
    if (city !== 'abeokuta') continue

    for (const gem of gems) {
      await recover(player, city)
      const venue = content.venues.find(item => item.id === gem.venue)
      assert.ok(venue)
      await go(player, city, venue.id)
      await action(player, city, 'spot', { id: typeof gem.spot === 'string' ? gem.spot : Object.keys(venue.definition.spots)[0]! })
      if (gem.kind === 'activity') {
        const activity = Object.values(venue.definition.spots).flatMap(item => item.activities ?? []).find(item => !item.cost)
        assert.ok(activity)
        await tryActivity(player, city, activity.id)
      }
      const found = await host.request('/api/action', { cityId: city, type: 'civic.hunt-search', payload: {}, actionId: id() }, player.cookie)
      assert.equal(found.status, 200)
    }
    const beforeClaim = await life(player, city)
    const claimed = object(await (await host.request('/api/action', { cityId: city, type: 'civic.hunt-claim', payload: {}, actionId: id() }, player.cookie)).json())
    assert.equal(claimed.ok, true, JSON.stringify(claimed))
    assert.equal(Number(object(claimed.state).cash) - Number(beforeClaim.cash), 3000)
    const repeat = object(await (await host.request('/api/action', { cityId: city, type: 'civic.hunt-claim', payload: {}, actionId: id() }, player.cookie)).json())
    assert.equal(repeat.ok, false, 'the prize is paid once a day')
    conserved(await life(player, city))
    assert.equal((await read('/api/civic/hunt?city=abeokuta', player.cookie)).city, 'abeokuta')
    assert.equal(object(await read('/api/civic/hunt?city=ota')).claims, 0, 'a claim in Abeokuta is not an Ota claim')
  }

  // ---- this week's events are the city's own ------------------------------------------------------------------------------------
  for (const { id: city } of OGUN) {
    const player = players.get(city)
    assert.ok(player)
    const hello = object(await (await host.request('/api/growth/hello', { cityId: city }, player.cookie)).json())
    assert.equal(hello.ok, true, JSON.stringify(hello))
    const events = list(hello.events).map(object)
    for (const event of events) assert.ok(contentOf(city).venues.some(venue => venue.id === event.venue), `${city}: event at ${String(event.venue)} is its own place`)
  }

  // ---- elections, billboards, radio and the rich list of Abeokuta are Abeokuta's own ------------------------------------------------
  const tunde = players.get('abeokuta')
  assert.ok(tunde)
  await host.qualify(tunde, 'abeokuta')
  const nominated = object(await (await host.request('/api/civic/gov/run', { cityId: 'abeokuta', slogan: 'Abeokuta first', requestId: id() }, tunde.cookie)).json())
  assert.equal(nominated.ok, true, JSON.stringify(nominated))
  const abeokuta = contentOf('abeokuta')
  const slot = abeokuta.billboardRoads[0]
  assert.ok(slot)
  const rented = object(await (await host.request('/api/civic/ads/rent', { cityId: 'abeokuta', kind: 'billboard', slot: slot.id, text: 'Olumo views', colour: 'gold', icon: 'star', requestId: id() }, tunde.cookie)).json())
  assert.equal(rented.ok, true, JSON.stringify(rented))
  const radioVenue = abeokuta.radioVenueIds[0]
  assert.ok(radioVenue)
  await go(tunde, 'abeokuta', radioVenue)
  const shoutout = object(await (await host.request('/api/civic/radio/shoutout', { cityId: 'abeokuta', title: 'Egba Night', artist: 'Tunde', requestId: id() }, tunde.cookie)).json())
  assert.equal(shoutout.ok, true, JSON.stringify(shoutout))
  conserved(await life(tunde, 'abeokuta'))

  assert.deepEqual(list(object(object((await read('/api/civic/gov?city=abeokuta')).election)).candidates).map(item => object(item).id), [tunde.id])
  assert.ok(JSON.stringify(await read('/api/civic/ads?city=abeokuta')).includes('Olumo views'))
  assert.ok(JSON.stringify(await read(`/api/civic/radio?city=abeokuta&venue=${radioVenue}`)).includes('Egba Night'))
  assert.equal(object(await read('/api/civic/richlist?city=abeokuta')).city, 'abeokuta')
  assert.ok(Number(object(await read('/api/civic/neighbours?city=abeokuta', tunde.cookie)).total) >= 1)
  for (const other of ['lagos', 'ibadan', 'ota', 'ijebu-ode', 'sagamu']) {
    assert.ok(!list(object((await read(`/api/civic/gov?city=${other}`)).election).candidates).some(item => object(item).id === tunde.id), `${other}: no Abeokuta candidate`)
    assert.ok(!JSON.stringify(await read(`/api/civic/ads?city=${other}`)).includes('Olumo views'), `${other}: no Abeokuta billboard`)
    assert.equal(object(await read(`/api/civic/ads?city=${other}`)).city, other)
    for (const venue of other === 'lagos' || other === 'ibadan' ? [] : contentOf(other).radioVenueIds.slice(0, 1)) {
      assert.ok(!JSON.stringify(await read(`/api/civic/radio?city=${other}&venue=${venue}`)).includes('Egba Night'), `${other}: no Abeokuta shout-out`)
    }
    if (other !== 'lagos' && other !== 'ibadan') {
      const peer = players.get(other)
      assert.ok(peer)
      assert.equal(Number(object(await read(`/api/civic/neighbours?city=${other}`, peer.cookie)).total), 0, `${other}: an Abeokuta resident is not its neighbour`)
    }
  }

  // ---- Abeokuta and Ibadan are reachable both ways ----------------------------------------------------------------------------------
  async function leg(device: JourneyDevice, from: string, to: string, mode: string, fare: number, seconds: number): Promise<Record<string, unknown>> {
    const start = await life(device, from)
    const departed = object((await action(device, from, 'estate.relocate', { to, mode })).state)
    assert.equal(Number(departed.cash), Number(start.cash) - fare, `${from} to ${to} by ${mode}: the fare is charged once, at departure`)
    const second = await host.request('/api/action', { cityId: from, type: 'estate.relocate', payload: { to, mode }, actionId: id() }, device.cookie)
    assert.equal(object(await second.json()).ok, false, 'a second departure is refused while travelling')
    assert.equal(Number((await life(device, from)).cash), Number(departed.cash), 'no second fare')
    await host.elapse(device, from, (seconds + 1) * 1000)
    const arrived = await life(device, from)
    assert.equal(object(arrived.estate).city, to)
    assert.equal(Number(arrived.cash), Number(departed.cash), 'arriving costs nothing more')
    assert.equal(arrived.activeAction, null)
    const reloaded = await life(device, to)
    assert.equal(object(reloaded.estate).city, to, 'a reload shows the new city')
    assert.equal(reloaded.location, arrived.location)
    conserved(reloaded)
    return reloaded
  }
  const toIbadan = await leg(tunde, 'abeokuta', 'ibadan', 'rail', 4000, 45)
  assert.ok(contentOf('ibadan').venues.some(venue => venue.id === toIbadan.location && venue.id !== 'home'), 'a visitor arrives at a public Ibadan place')
  assert.equal(object(object(object(toIbadan.estate).away).abeokuta).lga, 'abeokuta-south', 'the Abeokuta house stays his')
  await leg(tunde, 'ibadan', 'abeokuta', 'road', 3000, 90)
  const home = await life(tunde, 'abeokuta')
  assert.equal(object(home.estate).lga, 'abeokuta-south')
  assert.equal(home.location, 'home', 'back at the Abeokuta house')
  assert.equal(object(home.career).city, 'abeokuta', 'the job is still held')
  assert.ok(list(object(home.travel).visited).every(key => typeof key === 'string' && key.startsWith('abeokuta:')), 'travel left the Abeokuta history alone')

  // ---- a Lagos player crosses to Ota and back; the trip survives the host restarting --------------------------------------------------
  const ada = await start('Ada', 'lagos', 'ikeja')
  const lagosLife = await life(ada, 'lagos')
  const departed = object((await action(ada, 'lagos', 'estate.relocate', { to: 'ota', mode: 'road' })).state)
  assert.equal(Number(departed.cash), Number(lagosLife.cash) - 2000, 'the Ota fare is charged once, when the trip starts')
  assert.equal(object(departed.activeAction).remaining, 60, 'the Ota trip is short')
  await host.restart()
  const resumed = await life(ada, 'lagos')
  assert.equal(object(resumed.activeAction).kind, 'intercity', 'the trip is still under way after the host restarted')
  assert.equal(Number(resumed.cash), Number(departed.cash), 'a restart charges nothing')
  await host.elapse(ada, 'lagos', 61000)
  const inOta = await life(ada, 'lagos')
  assert.equal(object(inOta.estate).city, 'ota')
  assert.equal(Number(inOta.cash), Number(departed.cash))
  assert.equal(object(inOta.estate).lga, null, 'a visitor has not chosen an Ota home yet')
  assert.ok(contentOf('ota').venues.some(venue => venue.id === inOta.location && venue.id !== 'home'), 'a visitor arrives at a public Ota place')
  assert.equal(object(object(object(inOta.estate).away).lagos).lga, 'ikeja', 'the Lagos house stays hers')
  assert.equal(object(await read('/api/world/me?city=ota', ada.cookie)).placed, false)
  assert.equal((await host.request('/api/life?city=lagos', undefined, ada.cookie)).status, 409, 'the character is in Ota now, not in Lagos')
  assert.equal(object(object((await read('/api/life?city=ota', ada.cookie)).state).estate).city, 'ota')

  // ---- two players meet in an Ota venue room and talk -------------------------------------------------------------------------------
  const kemi = players.get('ota')
  assert.ok(kemi)
  const venue = String(inOta.location)
  if ((await life(kemi, 'ota')).location !== venue) await finish(kemi, 'ota', object((await action(kemi, 'ota', 'travel', { id: venue, mode: 'trek' })).state))
  const peerKemi = await host.socket(kemi), peerAda = await host.socket(ada)
  async function until(peer: JourneySocket, accept: (frame: Record<string, unknown>) => boolean, what: string): Promise<Record<string, unknown>> {
    for (let attempts = 0; attempts < 14; attempts += 1) {
      const frame = object(await peer.next())
      assert.notEqual(frame.type, 'error', JSON.stringify(frame))
      if (accept(frame)) return frame
    }
    assert.fail(what)
  }
  peerKemi.send({ type: 'join', cityId: 'ota', venueId: venue })
  await until(peerKemi, frame => frame.type === 'presence' && list(frame.members).length === 1, 'Kemi alone in the Ota room')
  peerAda.send({ type: 'join', cityId: 'ota', venueId: venue })
  await until(peerAda, frame => frame.type === 'presence' && list(frame.members).length === 2, 'Ada sees Kemi')
  await until(peerKemi, frame => frame.type === 'presence' && list(frame.members).length === 2, 'Kemi sees Ada')
  peerAda.send({ type: 'chat', body: 'Good morning, Ota', clientId: id() })
  const heard = await until(peerKemi, frame => frame.type === 'chat', 'Kemi hears Ada')
  assert.ok(JSON.stringify(heard).includes('Good morning, Ota'))
  // a room in Ota is not a room in Abeokuta
  peerKemi.send({ type: 'join', cityId: 'abeokuta', venueId: venue })
  assert.equal(object(await peerKemi.next()).type, 'error', 'an Ota venue is not an Abeokuta room')

  // ---- a damaged or hostile stored record is cleaned on the next read, and never drops the life ---------------------------------------------------
  if (host.edit) {
    const femi = players.get('ijebu-ode')
    assert.ok(femi)
    const ijebu = contentOf('ijebu-ode').venues.filter(item => item.id !== 'home').map(item => item.id)
    const own = Object.keys(object(object((await life(femi, 'ijebu-ode')).travel).cooldowns))
    await host.edit(femi, 'ijebu-ode', state => {
      const travel = object(state.travel)
      travel.visited = [...Array.from({ length: 2000 }, (_, index) => index % 2 ? { index } : `ota:made-up-${index}`), ...ijebu, ...ijebu, 'zz:nowhere', '__proto__']
      const cooldowns: Record<string, unknown> = {}
      for (let index = 0; index < 3000; index += 1) cooldowns[`sagamu:junk-${index}`] = index % 2 ? 'soon' : host.now() + 1000
      for (const key of own) cooldowns[key] = host.now() + 99 * 86_400_000
      travel.cooldowns = cooldowns
    })
    const cleaned = object((await life(femi, 'ijebu-ode')).travel)
    const visited = list(cleaned.visited)
    assert.ok(visited.length <= 512 && new Set(visited).size === visited.length, 'a stored visit list is bounded and has no repeats')
    assert.ok(ijebu.every(venue => visited.includes(`ijebu-ode:${venue}`)), 'the real places in a damaged list are kept, qualified')
    assert.ok(Object.keys(object(cleaned.cooldowns)).length <= 80, 'stored cooldowns are bounded')
    for (const readyAt of Object.values(object(cleaned.cooldowns))) assert.ok(Number(readyAt) <= host.now() + 86_400_000, 'no stored cooldown is longer than the longest authored one')
    assert.equal(object(object((await life(femi, 'ijebu-ode')).estate)).city, 'ijebu-ode', 'the life itself is intact')
    conserved(await life(femi, 'ijebu-ode'))
  }

  // ---- back to Lagos: one more fare, the Lagos house, and nothing lost ---------------------------------------------------------------------
  const settledOta = object((await action(ada, 'ota', 'estate.set-lga', { lga: 'ado-odo-ota', via: 'manual' })).state)
  assert.equal(Number(settledOta.cash), Number(inOta.cash), 'the first Ota home is free')
  const back = await leg(ada, 'ota', 'lagos', 'road', 2000, 60)
  assert.deepEqual([object(back.estate).lga, object(back.estate).living], ['ikeja', 'own'])
  assert.equal(back.location, 'home')
  const away = object(object(object(back.estate).away).ota)
  assert.equal(away.lga, 'ado-odo-ota', 'the Ota house stays hers')
  assert.ok(list(object(back.travel).visited).every(key => typeof key === 'string'))
  conserved(back)
}
export type { JourneyDevice }
