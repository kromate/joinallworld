// The short-address table (src/paths.ts): parsing, aliases, precedence, the collision rule and the nearest-city helper.
import assert from 'node:assert/strict'
import test from 'node:test'
import { cityCatalogueEntry, knownCityIds } from './game/cities/registry.ts'
import {
  CITY_ALIASES, FIXED_WORDS, GAME_SLUGS, PANEL_WORDS, PHONE_TABLE, RESERVED_PREFIXES, isReservedPath, kmBetween, knownStateIds, nearestCities, nearestCity, openCitiesOf, openCityIds, parsePath, pathCollisions, pathOf,
} from './paths.ts'

const city = (id: string, extra: { page?: 'games'; venue?: string } = {}) => ({ kind: 'city', city: id, page: extra.page ?? null, venue: extra.venue ?? null })

test('the games: /games, each game, and the aliases', () => {
  assert.deepEqual(parsePath('/games'), { kind: 'games', game: null })
  for (const game of GAME_SLUGS) assert.deepEqual(parsePath(`/games/${game}`), { kind: 'games', game })
  assert.deepEqual(parsePath('/play'), { kind: 'games', game: null })
  assert.deepEqual(parsePath('/chess'), { kind: 'games', game: 'chess' })
  assert.deepEqual(parsePath('/word'), { kind: 'games', game: 'oro' })
  assert.deepEqual(parsePath('/games/unknown'), { kind: 'games', game: null }, 'an unknown game is the hub')
  assert.deepEqual(PHONE_TABLE, { chess: 'phone-chess', weave: 'phone-weave', whot: 'phone-whot', penalties: 'phone-penalty' })
})

test('every registry city answers at /<id>, and a state with one open city is that city', () => {
  for (const id of openCityIds()) assert.deepEqual(parsePath(`/${id}`), city(id), id)
  assert.deepEqual(parsePath('/fct'), city('abuja'))
  assert.deepEqual(parsePath('/oyo'), city('ibadan'))
  assert.deepEqual(parsePath('/rivers'), city('port-harcourt'))
  assert.deepEqual(parsePath('/lagos'), city('lagos'))
  assert.deepEqual(parsePath('/kano'), city('kano'))
  assert.ok(openCityIds().length >= 9)
})

test('aliases, case and trailing slashes', () => {
  assert.deepEqual(parsePath('/ph'), city('port-harcourt'))
  assert.deepEqual(parsePath('/portharcourt'), city('port-harcourt'))
  assert.deepEqual(parsePath('/ijebuode'), city('ijebu-ode'))
  assert.deepEqual(parsePath('/Abuja/'), city('abuja'))
  assert.deepEqual(parsePath('/KANO/Games'), city('kano', { page: 'games' }))
  assert.deepEqual(parsePath('/abuja?x=1#y'), city('abuja'), 'query and fragment are not part of the path')
})

test('a state with several open cities, and one with none', () => {
  assert.ok(openCitiesOf('ogun').length > 1)
  assert.deepEqual(parsePath('/ogun'), { kind: 'state', state: 'ogun' })
  // A city that is on the atlas but not open: its state's page says it is coming.
  assert.equal(cityCatalogueEntry('kaduna')?.open, false)
  assert.deepEqual(parsePath('/kaduna'), { kind: 'state', state: 'kaduna' })
})

test('the atlas levels and the panels', () => {
  assert.deepEqual(parsePath('/nigeria'), { kind: 'atlas', level: 'nigeria' })
  assert.deepEqual(parsePath('/world'), { kind: 'atlas', level: 'world' })
  assert.deepEqual(parsePath('/map'), { kind: 'atlas', level: 'world' })
  for (const panel of PANEL_WORDS) assert.deepEqual(parsePath(`/${panel}`), { kind: 'panel', panel })
})

test('a city page and a venue under it', () => {
  assert.deepEqual(parsePath('/abuja/games'), city('abuja', { page: 'games' }))
  assert.deepEqual(parsePath('/abuja/some-venue'), city('abuja', { venue: 'some-venue' }))
  assert.deepEqual(parsePath('/lagos/games/extra'), city('lagos', { page: 'games' }))
  assert.equal(parsePath('/games/abuja')?.kind, 'games', 'a fixed word wins over what follows it')
})

test('unknown paths and reserved prefixes are never places', () => {
  for (const path of ['/', '', '/nowhere', '/a.png', '/abuja.html', '//games', '/games//chess', '/ab uja', '/%61buja', '/constructor', '/__proto__', '/hasOwnProperty']) assert.equal(parsePath(path), null, path)
  for (const prefix of RESERVED_PREFIXES) { assert.equal(parsePath(`/${prefix}/x`), null, prefix); assert.equal(isReservedPath(`/${prefix}/x`), true, prefix) }
  assert.equal(isReservedPath('/favicon.svg'), true)
  assert.equal(isReservedPath('/assets/app.js'), true)
  assert.equal(isReservedPath('/games'), false)
  assert.equal(isReservedPath('/'), false)
  assert.equal(isReservedPath('/whatever'), false)
})

test('the canonical address of every intent parses back to itself', () => {
  const paths = ['/games', ...GAME_SLUGS.map((game) => `/games/${game}`), ...openCityIds().map((id) => `/${id}`), ...openCityIds().map((id) => `/${id}/games`), '/ogun', '/kaduna', '/nigeria', '/world', ...PANEL_WORDS.map((panel) => `/${panel}`), '/abuja/park-1']
  for (const path of paths) { const intent = parsePath(path); assert.ok(intent, path); assert.equal(pathOf(intent), path); assert.deepEqual(parsePath(pathOf(intent)), intent) }
  assert.equal(pathOf(parsePath('/ph') ?? { kind: 'atlas', level: 'world' }), '/port-harcourt')
  assert.equal(pathOf(parsePath('/fct') ?? { kind: 'atlas', level: 'world' }), '/abuja')
  assert.equal(pathOf(parsePath('/play') ?? { kind: 'atlas', level: 'world' }), '/games')
})

test('precedence: no city id, state slug or alias is a fixed word or a reserved prefix', () => {
  assert.deepEqual(pathCollisions(), [])
  const words = new Set([...FIXED_WORDS, ...RESERVED_PREFIXES])
  for (const id of knownCityIds()) assert.ok(!words.has(id), `city ${id}`)
  for (const state of knownStateIds()) assert.ok(!words.has(state), `state ${state}`)
  for (const [alias, target] of Object.entries(CITY_ALIASES)) { assert.ok(!words.has(alias), alias); assert.ok(knownCityIds().includes(target), `${alias} -> ${target}`); assert.ok(!knownCityIds().includes(alias), alias) }
})

test('a future city that takes a fixed word fails the collision check instead of breaking the address', () => {
  const base = ['lagos', 'port-harcourt', 'ijebu-ode']
  assert.deepEqual(pathCollisions(base, ['lagos']), [])
  assert.deepEqual(pathCollisions([...base, 'games'], ['lagos']), ['games'])
  assert.deepEqual(pathCollisions([...base, 'api'], ['lagos']), ['api'])
  assert.deepEqual(pathCollisions(base, ['lagos', 'messages']), ['messages'])
  assert.ok(pathCollisions(['lagos'], ['lagos']).includes('ph'), 'an alias whose city is missing is reported')
  assert.ok(pathCollisions([...base, 'ph'], ['lagos']).includes('ph'), 'a city that takes an alias is reported')
})

test('the nearest open city comes from the registry coordinates', () => {
  assert.equal(nearestCity(12.0, 8.52)?.id, 'kano')
  assert.equal(nearestCity(6.5, 3.4)?.id, 'lagos')
  assert.equal(nearestCity(9.07, 7.49)?.id, 'abuja')
  // Kaduna is on the atlas but not open: from there the nearest open city is Abuja, and Kaduna is the nearest place that is coming.
  const kaduna = cityCatalogueEntry('kaduna')
  assert.ok(kaduna)
  assert.equal(nearestCity(kaduna.lat, kaduna.lon)?.id, 'abuja')
  assert.equal(nearestCity(kaduna.lat, kaduna.lon, { open: false })?.id, 'kaduna')
  assert.ok((nearestCity(kaduna.lat, kaduna.lon, { open: false })?.km ?? 99) < 1)
  const three = nearestCities(6.5, 3.4, 3)
  assert.equal(three.length, 3)
  assert.deepEqual([...three].sort((a, b) => a.km - b.km), three, 'nearest first')
  assert.ok(Math.abs(kmBetween(6.52, 3.38, 6.52, 3.38)) < 1e-9)
  assert.ok(Math.abs(kmBetween(0, 0, 0, 1) - 111.2) < 0.5)
  // Far from everything (the other side of the world) it still answers with a city.
  assert.ok(nearestCity(-33.9, 151.2))
})
