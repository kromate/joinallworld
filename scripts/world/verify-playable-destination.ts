#!/usr/bin/env node
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertCityContentContract, assertCityMapContract } from '../../src/game/cities/cityContractTest.test.ts'
import { createDestinationModule } from '../../src/game/cities/africa/module.ts'
import { loadCityContent, registerCityForTest } from '../../src/game/cities/registry.ts'
import { advanceLife, createLife, dispatch } from '../../src/life.ts'
import type { CityModule } from '../../src/types/content.ts'
import type { LifeState } from '../../src/types/life.ts'
import type { DestinationFacts } from '../../src/game/cities/africa/types.ts'

const CITY_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const SCRIPT_DIRECTORY = fileURLToPath(new URL('.', import.meta.url))

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isDestinationFacts(value: unknown): value is DestinationFacts {
  if (!isRecord(value) || !isRecord(value.country) || !isRecord(value.state)
    || !isRecord(value.centre) || !isRecord(value.airport) || !Array.isArray(value.bounds)) return false
  const airport = value.airport
  const centre = value.centre
  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.country.idISOlower === 'string'
    && typeof value.country.name === 'string'
    && typeof value.state.idunique === 'string'
    && typeof value.state.name === 'string'
    && typeof value.timezone === 'string'
    && isNumber(centre.lon)
    && isNumber(centre.lat)
    && typeof airport.id === 'string'
    && typeof airport.name === 'string'
    && isNumber(airport.lon)
    && isNumber(airport.lat)
    && typeof airport.sourceUrl === 'string'
    && typeof value.sourceLabel === 'string'
    && typeof value.sourceUrl === 'string'
    && typeof value.licence === 'string'
    && value.bounds.length === 4
    && value.bounds.every(isNumber)
    && typeof value.coverageNote === 'string'
}

function isCityModule(value: unknown): value is CityModule {
  if (!isRecord(value) || !isRecord(value.rules)) return false
  return typeof value.id === 'string'
    && value.rules.id === value.id
    && typeof value.loadContent === 'function'
    && typeof value.loadMap === 'function'
}

function usage(): never {
  throw new TypeError('Usage: node --experimental-strip-types scripts/world/verify-playable-destination.ts <city-id>')
}

async function loadDestination(cityId: string): Promise<{ city: CityModule; facts: DestinationFacts }> {
  const cityDirectory = resolve(SCRIPT_DIRECTORY, '../../src/game/cities', cityId)
  const [cityNamespace, factsNamespace]: [unknown, unknown] = await Promise.all([
    import(pathToFileURL(resolve(cityDirectory, 'index.ts')).href),
    import(pathToFileURL(resolve(cityDirectory, 'facts.ts')).href),
  ])
  if (!isRecord(cityNamespace) || !isCityModule(cityNamespace.city)) throw new TypeError(`${cityId}: index.ts must export a CityModule named city`)
  if (!isRecord(factsNamespace) || !isDestinationFacts(factsNamespace.FACTS)) throw new TypeError(`${cityId}: facts.ts must export valid DestinationFacts as FACTS`)
  assert.equal(cityNamespace.city.id, cityId, 'directory id matches CityModule id')
  assert.equal(factsNamespace.FACTS.id, cityId, 'directory id matches facts id')
  assert.equal(cityNamespace.city.rules.country.id, factsNamespace.FACTS.country.idISOlower, 'module country ISO matches sourced facts')
  assert.equal(cityNamespace.city.rules.country.name, factsNamespace.FACTS.country.name, 'module country name matches sourced facts')
  assert.equal(cityNamespace.city.rules.timezone, factsNamespace.FACTS.timezone, 'module timezone matches sourced facts')
  assert.deepEqual([cityNamespace.city.rules.atlas.lon, cityNamespace.city.rules.atlas.lat], [factsNamespace.FACTS.centre.lon, factsNamespace.FACTS.centre.lat], 'module atlas point matches the sourced city centre')
  return { city: cityNamespace.city, facts: factsNamespace.FACTS }
}

function finishAction(state: LifeState, advance: () => void): void {
  for (let iteration = 0; state.activeAction && iteration < 300; iteration += 1) advance()
  assert.equal(state.activeAction, null, 'bounded action loop completes the current journey or activity')
}

async function verifyFlightLifecycle(cityId: string, facts: DestinationFacts): Promise<void> {
  await loadCityContent('lagos')
  const testFacts = { ...facts, id: `test-${cityId}` }
  const destination = createDestinationModule(testFacts, async () => {
    throw new Error('The server lifecycle must not load destination map geometry')
  })
  const airLinks = destination.rules.links.filter(link => link.mode === 'air')
  assert.equal(airLinks.length, 1, 'the destination has exactly one beta air link')
  const link = airLinks[0]
  assert.ok(link)
  const module = { ...destination, rules: { ...destination.rules, links: airLinks } } satisfies CityModule
  const registration = registerCityForTest(module)

  try {
    const content = await loadCityContent(module.id)
    let now = Date.UTC(2026, 9, 9, 9)
    let state: LifeState = createLife(null, { cityId: 'lagos', now, isNew: true })
    const context = () => ({ cityId: state.estate.city, now, trustedSave: true, seed: `verify-${cityId}` })
    const advance = () => {
      now += 1000
      advanceLife(state, 1, context())
    }
    state.onboarding.done = true
    state.cash = 2_000_000
    assert.equal(dispatch(state, { type: 'estate.set-lga', payload: { lga: 'ikeja' } }, context()).ok, true)
    assert.equal(dispatch(state, { type: 'estate.move-in', payload: {} }, context()).ok, true)
    const homeBefore = structuredClone({ lga: state.estate.lga, plot: state.estate.plot, style: state.estate.style, home: state.estate.home, living: state.estate.living })
    assert.equal(state.estate.home, 'lagos', 'verification begins with a Lagos home')
    assert.ok(content.housing.some(home => home.definition.id === `${module.id}-centre-home`), 'destination rental has its stable city-prefixed id')

    const cashBeforeDeparture = state.cash
    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: module.id, mode: 'air' } }, context()).code, 'departed')
    assert.equal(state.cash, cashBeforeDeparture - link.fare, 'the authored fare is charged exactly at departure')
    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: module.id, mode: 'air' } }, context()).ok, false, 'a second departure is refused while busy')
    assert.equal(state.cash, cashBeforeDeparture - link.fare, 'a refused duplicate departure cannot charge again')

    state = createLife(JSON.parse(JSON.stringify(state)), context())
    assert.equal(state.activeAction?.kind, 'intercity', 'an in-flight JSON save retains the active journey')
    finishAction(state, advance)
    assert.equal(state.estate.city, module.id)
    const airHub = module.rules.hubs.find(hub => hub.mode === 'air')
    assert.ok(airHub, 'destination declares an air hub')
    assert.equal(state.location, airHub.venueId, 'arrival lands at the declared air-hub venue')
    assert.equal(state.estate.lga, null, 'visiting does not create a second owned home')
    assert.equal(state.estate.home, 'lagos', 'the original home remains active')
    assert.ok(state.estate.away.lagos, 'the original Lagos home is retained while visiting')

    state = createLife(JSON.parse(JSON.stringify(state)), context())
    assert.equal(state.estate.city, module.id, 'a visitor JSON reload stays in the destination')
    assert.equal(state.location, airHub.venueId, 'a visitor JSON reload retains the arrival venue')
    const meal = content.venues.find(venue => venue.id === `${module.id}-meal-stop`)
    assert.ok(meal, 'destination includes its fictional visitor meal venue')
    assert.equal(dispatch(state, { type: 'travel', payload: { id: meal.id, mode: 'trek' } }, context()).code, 'started')
    finishAction(state, advance)
    assert.equal(dispatch(state, { type: 'spot', payload: { id: 'counter' } }, context()).ok, true)
    state.needs.hunger = 10
    assert.equal(dispatch(state, { type: 'activity', payload: { id: `${module.id}-visitor-meal` } }, context()).ok, true)
    const cashBeforeBusyDeparture = state.cash
    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: 'lagos', mode: 'air' } }, context()).ok, false, 'an unfinished meal prevents departure')
    assert.equal(state.cash, cashBeforeBusyDeparture, 'a rejected departure during a meal cannot charge a fare')
    finishAction(state, advance)
    assert.ok(state.needs.hunger > 10, 'the visitor meal restores hunger')

    state = createLife(JSON.parse(JSON.stringify(state)), context())
    assert.equal(state.estate.city, module.id, 'a post-activity visitor JSON reload remains in the destination')
    assert.equal(state.location, meal.id, 'the post-activity reload retains the visitor location')
    const cashBeforeReturn = state.cash
    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: 'lagos', mode: 'air' } }, context()).code, 'departed')
    assert.equal(state.cash, cashBeforeReturn - link.fare, 'the return charges the exact reverse-link fare')
    assert.equal(dispatch(state, { type: 'estate.relocate', payload: { to: 'lagos', mode: 'air' } }, context()).ok, false, 'a duplicate return departure is refused')
    assert.equal(state.cash, cashBeforeReturn - link.fare, 'the duplicate return cannot charge again')
    finishAction(state, advance)
    state = createLife(JSON.parse(JSON.stringify(state)), context())
    assert.equal(state.estate.city, 'lagos', 'a return JSON reload preserves the home city')
    assert.deepEqual({ lga: state.estate.lga, plot: state.estate.plot, style: state.estate.style, home: state.estate.home, living: state.estate.living }, homeBefore, 'the original rental, plot and home style survive the visit')
    assert.equal(state.estate.away[module.id], undefined, 'returning clears the away-home marker')
  } finally {
    registration.dispose()
  }
}

async function verifyDestination(cityId: string): Promise<void> {
  const { city, facts } = await loadDestination(cityId)
  assertCityContentContract(city, await city.loadContent())
  const map = await city.loadMap()
  await assertCityMapContract(city, map)
  const [content, scene] = await Promise.all([city.loadContent(), map.loadScene()])
  const airHub = city.rules.hubs.find(hub => hub.mode === 'air')
  assert.ok(airHub?.venueId, 'opened destination declares an air hub with an arrival venue')
  const arrival = scene.sites[airHub.venueId]
  assert.ok(arrival, 'actual airport venue is present in the rendered scene')
  assert.equal(airHub.name, facts.airport.name, 'air hub name matches the sourced airport')
  const airportVenue = content.venues.find(venue => venue.id === airHub.venueId)
  assert.ok(airportVenue, 'airport hub has matching playable venue content')
  assert.equal(airportVenue.position.kind, 'lon-lat', 'airport venue retains its sourced geographic point')
  if (airportVenue.position.kind === 'lon-lat') {
    assert.deepEqual([airportVenue.position.lon, airportVenue.position.lat], [facts.airport.lon, facts.airport.lat], 'airport venue matches the sourced airport coordinates')
  }
  assert.ok(scene.core, 'opened scene declares its initial camera core')
  assert.ok(arrival.x >= scene.core.minX && arrival.x <= scene.core.maxX && arrival.z >= scene.core.minZ && arrival.z <= scene.core.maxZ,
    'the initial camera core contains the actual airport arrival point')
  assert.ok(scene.roads.length > 0 && scene.roads.length <= 160, 'sourced roads are nonempty and stay within the rendering cap')
  assert.ok(scene.roads.every(road => road.id.startsWith('osm:way:') && road.points.length >= 2
    && road.points.every(point => point.every(Number.isFinite))), 'sourced road geometry is finite and identified')

  let buildingBoxes = 0
  scene.decorate({
    box(x, y, z, width, height, depth) {
      assert.ok([x, y, z, width, height, depth].every(Number.isFinite), 'sourced building decoration is finite')
      assert.ok(width > 0 && height > 0 && depth > 0, 'sourced building decoration has positive dimensions')
      buildingBoxes += 1
    },
    cyl() {},
    cone() {},
    at(_x, _y, _z, _rotation, draw) { draw() },
  }, { rng: () => 0.5 })
  assert.ok(buildingBoxes > 0 && buildingBoxes <= 700, 'sourced buildings render with a bounded number of boxes')

  await verifyFlightLifecycle(cityId, facts)
  process.stdout.write(`${JSON.stringify({ city: cityId, status: 'verified', roads: scene.roads.length, buildingBoxes })}\n`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length !== 1) usage()
  const cityId = args[0]
  if (!cityId || !CITY_ID_PATTERN.test(cityId)) usage()
  await verifyDestination(cityId)
}

main().catch(error => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error)
  process.stderr.write(`${message}\n`)
  process.exitCode = 1
})
