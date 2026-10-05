import assert from 'node:assert/strict'
import { loadCityContent, cachedCityContent } from '../../src/game/cities/registry.ts'
import { viewLife } from '../../src/life.ts'
import type { LifeState } from '../../src/types/life.ts'
import { driver, object, qualifyState } from './cityJourney.ts'
import type { JourneyDevice, JourneyHost } from './cityJourney.ts'

const list = (value: unknown): unknown[] => { assert.ok(Array.isArray(value)); return value }
const asState = (value: Record<string, unknown>): LifeState => value as unknown as LifeState

/**
 * The real second city, played on a host: a newcomer chooses Ibadan and a local government, visits every venue and does what each
 * offers, works a shift at an Ibadan workplace, finds the gem hunt's Ibadan places and claims its prize; a Lagos player travels there
 * by road (the fare is charged once), arrives as a visitor and settles; two players meet in an Ibadan room; and nothing of Ibadan's
 * elections, billboards or radio is Lagos's. The same script runs on the Node server and on the Worker (see their host tests).
 */
export async function ibadanJourney(host: JourneyHost): Promise<void> {
  const { id, read, life, action, finish, conserved, start } = driver(host)
  await Promise.all([loadCityContent('lagos'), loadCityContent('ibadan')])
  const content = cachedCityContent('ibadan')
  const lagosContent = cachedCityContent('lagos')
  assert.ok(content && lagosContent)
  const here = (state: Record<string, unknown>) => ({ now: host.now(), cityId: 'ibadan' })

  // ---- a newcomer chooses Ibadan -------------------------------------------------------------------------------------
  const tunde = await start('Tunde', 'ibadan', 'lagelu')
  const resident = await read('/api/world/me?city=ibadan', tunde.cookie)
  assert.equal(resident.placed, true)
  assert.equal(resident.lga, 'lagelu', 'the starter house is on an estate in the chosen Ibadan local government')
  const born = await life(tunde, 'ibadan')
  assert.equal(object(born.estate).city, 'ibadan')
  assert.deepEqual(object(born.estate).plot && Object.keys(object(object(born.estate).plot)).sort(), ['estate', 'lga', 'plot'])
  assert.equal(object(object(born.estate).plot).lga, 'lagelu')
  assert.equal((await host.request('/api/life?city=lagos', undefined, tunde.cookie)).status, 409, 'the character is not in Lagos')

  // ---- every venue offers something -----------------------------------------------------------------------------------
  const lagosIds = new Set(lagosContent.venues.map(venue => venue.id))
  const seen: string[] = []
  for (const venue of content.venues.filter(item => item.id !== 'home')) {
    assert.ok(!lagosIds.has(venue.id), `${venue.id} is not a Lagos venue id`)
    const arrived = await finish(tunde, 'ibadan', object((await action(tunde, 'ibadan', 'travel', { id: venue.id, mode: 'trek' })).state))
    assert.equal(arrived.location, venue.id)
    let done = 0
    for (const spot of Object.values(venue.definition.spots)) {
      for (const activity of spot.activities ?? []) {
        await action(tunde, 'ibadan', 'spot', { id: spot.id })
        const response = await host.request('/api/action', { cityId: 'ibadan', type: 'activity', payload: { id: activity.id }, actionId: id() }, tunde.cookie)
        const answer = object(await response.json())
        if (answer.ok === true) { await finish(tunde, 'ibadan', object(answer.state)); done += 1 }
        else assert.ok(['not_sick', 'closed'].includes(String(answer.code)), `${activity.id}: ${JSON.stringify(answer)}`)
      }
    }
    assert.ok(done >= 1, `${venue.id}: at least one activity can be done`)
    seen.push(venue.id)
  }
  assert.equal(seen.length, 24)

  /** Walking the whole city takes it out of anyone: eat, wash and sleep at home. */
  async function recover(device: JourneyDevice): Promise<void> {
    await finish(device, 'ibadan', object((await action(device, 'ibadan', 'travel', { id: 'home', mode: 'trek' })).state))
    for (const [spot, activity] of [['kitchen', 'garri'], ['bathroom', 'bath'], ['bedroom', 'nap'], ['bedroom', 'nap']] as const) {
      await action(device, 'ibadan', 'spot', { id: spot })
      await finish(device, 'ibadan', object((await action(device, 'ibadan', 'activity', { id: activity })).state))
    }
  }

  // ---- a job whose workplace is in Ibadan -----------------------------------------------------------------------------
  await recover(tunde)
  await action(tunde, 'ibadan', 'apply-job', { id: 'community-helper' })
  const employed = await life(tunde, 'ibadan')
  assert.equal(object(employed.career).city, 'ibadan')
  const view = viewLife(asState(employed), here(employed))
  const workplace = content.workplaces.find(item => item.careerId === 'community-helper')
  assert.ok(workplace && content.venues.some(venue => venue.id === workplace.venueId), 'the workplace is an Ibadan venue')
  await finish(tunde, 'ibadan', object((await action(tunde, 'ibadan', 'travel', { id: workplace.venueId, mode: 'trek' })).state))
  await action(tunde, 'ibadan', 'spot', { id: 'work' })
  const shift = viewLife(asState(await life(tunde, 'ibadan')), here(employed)).career.shift
  assert.ok(shift && view.career.employed)
  const before = await life(tunde, 'ibadan')
  const worked = object((await action(tunde, 'ibadan', 'activity', { id: shift.id })).state)
  const paid = await finish(tunde, 'ibadan', worked)
  assert.ok(Number(paid.cash) > Number(before.cash), 'the Ibadan workplace pays')
  conserved(paid)

  // ---- the gem hunt names Ibadan places, and pays once -----------------------------------------------------------------
  const hunt = object(object(paid.civic).hunt)
  const gems = list(hunt.gems).map(object)
  assert.ok(gems.length >= 3)
  for (const gem of gems) assert.ok(content.venues.some(venue => venue.id === gem.venue), `gem at ${String(gem.venue)} is an Ibadan place`)
  for (const gem of gems) {
    await recover(tunde)
    const venue = content.venues.find(item => item.id === gem.venue)
    assert.ok(venue)
    await finish(tunde, 'ibadan', object((await action(tunde, 'ibadan', 'travel', { id: venue.id, mode: 'trek' })).state))
    const spot = typeof gem.spot === 'string' ? gem.spot : Object.keys(venue.definition.spots)[0]!
    await action(tunde, 'ibadan', 'spot', { id: spot })
    if (gem.kind === 'activity') {
      const activity = Object.values(venue.definition.spots).flatMap(item => item.activities ?? []).find(item => !item.cost)
      assert.ok(activity)
      const response = await host.request('/api/action', { cityId: 'ibadan', type: 'activity', payload: { id: activity.id }, actionId: id() }, tunde.cookie)
      const answer = object(await response.json())
      if (answer.ok === true) await finish(tunde, 'ibadan', object(answer.state))
    }
    // Activity gems come loose when the activity ends; visit gems on a search. Either way the answer is the engine's, never a failure of the host.
    const found = await host.request('/api/action', { cityId: 'ibadan', type: 'civic.hunt-search', payload: {}, actionId: id() }, tunde.cookie)
    assert.equal(found.status, 200)
  }
  const beforeClaim = await life(tunde, 'ibadan')
  const claim = await host.request('/api/action', { cityId: 'ibadan', type: 'civic.hunt-claim', payload: {}, actionId: id() }, tunde.cookie)
  const claimed = object(await claim.json())
  assert.equal(claimed.ok, true, JSON.stringify(claimed))
  assert.equal(Number(object(claimed.state).cash) - Number(beforeClaim.cash), 3000)
  const again = object(await (await host.request('/api/action', { cityId: 'ibadan', type: 'civic.hunt-claim', payload: {}, actionId: id() }, tunde.cookie)).json())
  assert.equal(again.ok, false, 'the prize is paid once a day')
  conserved(await life(tunde, 'ibadan'))
  const huntBoard = await read('/api/civic/hunt?city=ibadan', tunde.cookie)
  assert.equal(huntBoard.city, 'ibadan')

  // ---- a Lagos player travels to Ibadan, as a visitor ---------------------------------------------------------------------
  const ada = await start('Ada', 'lagos', 'ikeja')
  const lagosLife = await life(ada, 'lagos')
  const departed = object((await action(ada, 'lagos', 'estate.relocate', { to: 'ibadan', mode: 'road' })).state)
  assert.equal(Number(departed.cash), Number(lagosLife.cash) - 3500, 'the bus fare is charged once, when the trip starts')
  await host.elapse(ada, 'lagos', 121000)
  const arrival = await host.request('/api/life?city=lagos', undefined, ada.cookie)
  const arrived = object(object(await arrival.json()).state)
  assert.equal(object(arrived.estate).city, 'ibadan')
  assert.equal(object(arrived.estate).lga, null, 'a visitor has not chosen an Ibadan home yet')
  assert.equal(Number(arrived.cash), Number(departed.cash), 'arriving costs nothing more')
  assert.ok(content.venues.some(venue => venue.id === arrived.location && venue.id !== 'home'), 'a visitor arrives at a public Ibadan place')
  assert.equal(object(object(object(arrived.estate).away).lagos).lga, 'ikeja', 'the Lagos house stays hers')
  const visitor = await read('/api/world/me?city=ibadan', ada.cookie)
  assert.equal(visitor.placed, false)
  const settled = object((await action(ada, 'ibadan', 'estate.set-lga', { lga: 'ibadan-north', via: 'manual' })).state)
  assert.equal(Number(settled.cash), Number(arrived.cash), 'the first Ibadan home is free')
  conserved(settled)

  // ---- two players meet in an Ibadan venue room ---------------------------------------------------------------------------
  const peerTunde = await host.socket(tunde), peerAda = await host.socket(ada)
  const venue = String(settled.location)
  async function presence(peer: Awaited<ReturnType<JourneyHost['socket']>>, count: number): Promise<void> {
    for (let attempts = 0; attempts < 12; attempts += 1) {
      const frame = object(await peer.next())
      assert.notEqual(frame.type, 'error', JSON.stringify(frame))
      if (frame.type === 'presence' && list(frame.members).length === count) return
    }
    assert.fail(`expected ${count} in the Ibadan room`)
  }
  if ((await life(tunde, 'ibadan')).location !== venue) await finish(tunde, 'ibadan', object((await action(tunde, 'ibadan', 'travel', { id: venue, mode: 'trek' })).state))
  peerTunde.send({ type: 'join', cityId: 'ibadan', venueId: venue })
  await presence(peerTunde, 1)
  peerAda.send({ type: 'join', cityId: 'ibadan', venueId: venue })
  await presence(peerAda, 2)
  await presence(peerTunde, 2)

  // ---- elections, billboards, radio and the rich list are Ibadan's own -----------------------------------------------------
  await host.qualify(ada, 'ibadan')
  const nomination = { cityId: 'ibadan', slogan: 'Ibadan first', requestId: id() }
  const nominated = object(await (await host.request('/api/civic/gov/run', nomination, ada.cookie)).json())
  assert.equal(nominated.ok, true, JSON.stringify(nominated))
  const ibadanRace = object((await read('/api/civic/gov?city=ibadan')).election)
  const lagosRace = object((await read('/api/civic/gov?city=lagos')).election)
  assert.deepEqual(list(ibadanRace.candidates).map(item => object(item).id), [ada.id])
  assert.deepEqual(list(lagosRace.candidates), [], 'a candidate in Ibadan is not on the Lagos ballot')
  const ads = object(await read('/api/civic/ads?city=ibadan'))
  assert.equal(ads.city, 'ibadan')
  const slots = JSON.stringify(ads)
  assert.ok(content.billboardRoads.some(road => slots.includes(road.road)), 'the billboards stand on Ibadan roads')
  assert.ok(!slots.includes('Third Mainland'), 'no Lagos road is offered')
  assert.deepEqual(list(object(ads.sea).plots ?? []), [], 'an inland city has no sea plots')
  const radioVenue = content.radioVenueIds[0]
  assert.ok(radioVenue)
  const radio = object(await read(`/api/civic/radio?city=ibadan&venue=${radioVenue}`))
  assert.equal(radio.city, 'ibadan')
  assert.equal(object(radio).club, true, 'an Ibadan radio venue plays')
  assert.equal(object(await read('/api/civic/radio?city=ibadan&venue=quilox')).club, false, 'a Lagos club is not a radio venue in Ibadan')
  const rich = object(await read('/api/civic/richlist?city=ibadan'))
  assert.equal(rich.city, 'ibadan')
  conserved(await life(ada, 'ibadan'))
}
export type { JourneyDevice }
