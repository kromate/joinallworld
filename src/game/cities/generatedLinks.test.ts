import assert from 'node:assert/strict'
import test from 'node:test'
import { INTERCITY_TIME, TRIP_SKIP, intercitySeconds, tripSkipFee } from '../content/travel.ts'
import { GENERATED_LINKS, generateCityLinks, generatedAirFare, generatedRoadFare, greatCircleKm } from './generatedLinks.ts'
import type { LinkableCity } from './generatedLinks.ts'
import { CITY_LINKS, allCityLinks, cityModule, cityRules, linksFrom, playableCityIds, loadCityLinks, loadCityRules } from './registry.ts'
import type { CityLink } from '../../types/content.ts'

const open = playableCityIds()
await Promise.all([loadCityLinks(), ...open.map(loadCityRules)])
const bookable = (from: string, to: string): CityLink[] => allCityLinks().filter(link => link.status !== 'coming' && ((link.a === from && link.b === to) || (link.a === to && link.b === from)))

test('every open city reaches every other open city in both directions, by at least one bookable way', () => {
  assert.ok(open.length >= 9)
  for (const from of open) for (const to of open) {
    if (from === to) continue
    assert.ok(bookable(from, to).length > 0, `${from} to ${to}`)
    assert.ok(linksFrom(from).some(link => link.to === to && link.status !== 'coming'), `${from} lists ${to}`)
  }
})

test('every way is open, positive, the same both ways, inside the timetable and cheaper to skip than to buy', () => {
  for (const link of allCityLinks()) {
    assert.ok(link.fare > 0 && link.km > 0 && link.seconds === intercitySeconds(link.mode, link.km), `${link.a}-${link.b} ${link.mode}`)
    assert.ok(link.seconds >= 12 && link.seconds <= INTERCITY_TIME.road.max, `${link.a}-${link.b} ${link.mode} is not long`)
    if (link.status === 'coming') continue
    const fee = tripSkipFee('intercity', link.seconds, link.fare)
    assert.ok(fee > 0 && fee <= link.fare / 2 && fee <= TRIP_SKIP.intercity.base + TRIP_SKIP.intercity.perSecond * link.seconds + TRIP_SKIP.roundTo, `${link.a}-${link.b} ${link.mode} skip ${fee}`)
  }
  for (const from of open) for (const to of open) for (const mode of ['road', 'air', 'rail'] as const) {
    const forward = linksFrom(from).find(link => link.to === to && link.mode === mode), back = linksFrom(to).find(link => link.to === from && link.mode === mode)
    assert.deepEqual(forward && [forward.fare, forward.seconds, forward.km], back && [back.fare, back.seconds, back.km], `${from}-${to} ${mode} is symmetric`)
  }
})

test('within a mode a longer generated way costs more; rail is never invented; air needs two airports', () => {
  const key = (link: Pick<CityLink, 'a' | 'b' | 'mode'>) => `${[link.a, link.b].sort().join('|')}|${link.mode}`
  const written = new Set([...CITY_LINKS, ...open.flatMap(id => cityModule(id)?.rules.links ?? [])].map(key))
  const made = allCityLinks().filter(link => !written.has(key(link)))
  assert.ok(made.length > 20)
  for (const mode of ['road', 'air'] as const) {
    const sorted = made.filter(link => link.mode === mode).sort((x, y) => x.km - y.km)
    for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i]!.fare >= sorted[i - 1]!.fare, `${mode} fares rise with distance`)
  }
  assert.equal(made.some(link => link.mode === 'rail'), false)
  for (const link of made.filter(item => item.mode === 'air')) for (const id of [link.a, link.b]) assert.ok(cityRules(id)?.hubs.some(hub => hub.mode === 'air'), `${id} has an airport`)
})

test('the examples: Abeokuta–Kano, Ibadan–Port Harcourt, Sagamu–Abuja, Ijebu-Ode–Kano are all bookable', () => {
  const modes = (a: string, b: string): string[] => bookable(a, b).map(link => link.mode).sort()
  assert.deepEqual(modes('abeokuta', 'kano'), ['road'])
  assert.deepEqual(modes('ibadan', 'port-harcourt'), ['air', 'road'])
  assert.deepEqual(modes('sagamu', 'abuja'), ['road'])
  assert.deepEqual(modes('ijebu-ode', 'kano'), ['road'])
})

const at = (id: string, lon: number, lat: number, airport = false): LinkableCity => ({ id, name: id, lon, lat, airport })

test('the generator is pure, keeps authored ways, and connects a city opened later anywhere in the world', () => {
  const cities = [at('a', 3.4, 6.5, true), at('b', 8.5, 12, true), at('far-away', -74, 40.7, true), at('near', 3.5, 6.6, true)]
  const authored = [{ a: 'a', b: 'b', mode: 'road' as const }]
  const once = generateCityLinks(cities, authored), twice = generateCityLinks([...cities].reverse(), authored)
  assert.deepEqual(once, twice, 'the order of the cities does not matter')
  assert.equal(once.some(link => link.a === 'a' && link.b === 'b' && link.mode === 'road'), false, 'an authored road is kept, not replaced')
  assert.equal(once.some(link => link.a === 'a' && link.b === 'b' && link.mode === 'air'), true)
  for (const x of cities) for (const y of cities) if (x !== y) assert.ok([...once, ...authored].some(link => [link.a, link.b].sort().join() === [x.id, y.id].sort().join()), `${x.id}-${y.id} reachable`)
  const ocean = once.filter(link => link.a === 'far-away' || link.b === 'far-away')
  assert.ok(ocean.length >= 3 && ocean.every(link => link.mode === 'air' && link.seconds <= 20), 'another continent is reached by air only, and quickly')
  assert.equal(once.some(link => link.mode === 'rail'), false)
  assert.ok(generatedRoadFare(GENERATED_LINKS.maxRoadKm) > generatedRoadFare(100) && generatedAirFare(8000) > generatedAirFare(300))
  assert.ok(Math.abs(greatCircleKm({ lon: 3.38, lat: 6.52 }, { lon: 7.49, lat: 9.06 }) - 534) < 3)
})

test('long domestic journeys remain reachable by bus without inventing airports', () => {
  const southwest = { ...at('southwest', 3.4, 6.5), countryId: 'ng' }
  const northeast = { ...at('northeast', 13.15, 11.85), countryId: 'ng' }
  const links = generateCityLinks([southwest, northeast], [])
  assert.equal(links.length, 1)
  assert.equal(links[0]?.mode, 'road')
  assert.ok(links[0]!.km > GENERATED_LINKS.maxRoadKm)
  assert.deepEqual(generateCityLinks([southwest, at('overseas', -74, 40.7, true)], []), [], 'an unverified airfield is never a route')
})

test('the fitted fares stay near the hand-written ones', () => {
  for (const [km, fare] of [[130, 3500], [600, 11000], [760, 14000], [1100, 20000]] as const) assert.ok(Math.abs(generatedRoadFare(km) - fare) / fare < 0.15, `road ${km} km`)
  for (const [km, fare] of [[364, 45000], [520, 65000], [834, 85000]] as const) assert.ok(Math.abs(generatedAirFare(km) - fare) / fare < 0.12, `air ${km} km`)
})
