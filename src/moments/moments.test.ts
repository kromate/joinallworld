import assert from 'node:assert/strict'
import test from 'node:test'
import { CITY_CATALOGUE } from '../game/cities/catalogue.ts'
import { SCENE_KINDS } from '../game/content/venues.ts'
import { bandSpan } from '../game/world-time.ts'
import { ANYWHERE, CONDITIONED } from './common.ts'
import { MOMENT_BANK, pickMoment } from './index.ts'
import { MOMENT_SHOW_MS, MOMENT_WINDOW_MS, eligibleMoments, momentShown, pickFrom } from './pick.ts'
import { BETA_LANGS } from './types.ts'
import type { Moment } from './types.ts'

/** A server time for a Lagos wall-clock moment in 2026 (months are 1-based). */
const lagos = (month: number, day: number, hour: number, minute = 0): number => Date.UTC(2026, month - 1, day, hour - 1, minute)
const MORNING = lagos(10, 6, 9)
const CLIMATE = { rainChanceByMonth: [0, 0, 0.1, 0.3, 0.5, 0.7, 0.8, 0.8, 0.7, 0.5, 0.2, 0], clearLabel: 'Clear', harmattan: { months: [11, 12, 1, 2], label: 'Harmattan haze' } } as never
const CITIES = ['lagos', 'ibadan', 'abuja', 'port-harcourt', 'kano', 'calabar', 'benin-city', 'enugu']

const playing = (place: { kind: string; variant?: string }, city: string, from: number, count: number, seed: number | string, options = {}): string[] =>
  Array.from({ length: count }, (_, index) => pickFrom(MOMENT_BANK, place, city, from + index * MOMENT_WINDOW_MS, seed, options)?.id ?? 'none')

test('the same place, city, window and seed give the same moment', () => {
  const place = { kind: 'buka' }
  assert.equal(pickMoment(place, 'lagos', MORNING, 'a')?.id, pickMoment(place, 'lagos', MORNING + 1000, 'a')?.id)
  assert.deepEqual(playing(place, 'lagos', MORNING, 12, 'a'), playing(place, 'lagos', MORNING, 12, 'a'))
})

test('a different seed gives a different order', () => {
  const place = { kind: 'market' }
  assert.notDeepEqual(playing(place, 'lagos', MORNING, 12, 'a'), playing(place, 'lagos', MORNING, 12, 'b'))
})

test('no line repeats inside a cycle, nor across a cycle boundary', () => {
  for (const [kind, city] of [['buka', 'lagos'], ['market', 'kano'], ['club', 'calabar'], ['home', 'ibadan']] as const) {
    const place = { kind }
    const span = bandSpan(MORNING)
    const count = eligibleMoments(MOMENT_BANK, place, city, MORNING).length
    assert.ok(count >= 15, `${kind} in ${city} has ${count} eligible lines`)
    const windows = Math.min(count * 2 + 3, Math.floor((span.to - span.from) / MOMENT_WINDOW_MS))
    const ids = playing(place, city, span.from, windows, 'seed')
    for (let index = 0; index < Math.min(count, windows); index += 1) assert.equal(ids.indexOf(ids[index] as string), index, `${kind}: repeat inside the first cycle at ${index}`)
    for (let index = 1; index < ids.length; index += 1) assert.notEqual(ids[index], ids[index - 1], `${kind}: two windows in a row at ${index}`)
    if (windows > count) assert.notEqual(ids[count], ids[count - 1], `${kind}: repeat across the cycle boundary`)
  }
})

test('bands, seasons and conditions filter', () => {
  const dawn = eligibleMoments(MOMENT_BANK, { kind: 'buka' }, 'lagos', lagos(10, 6, 5, 30))
  const night = eligibleMoments(MOMENT_BANK, { kind: 'buka' }, 'lagos', lagos(10, 6, 23))
  assert.ok(dawn.every((moment) => !moment.bands || moment.bands.includes('dawn')))
  assert.ok(night.every((moment) => !moment.bands || moment.bands.includes('night')))
  assert.notDeepEqual(dawn.map((moment) => moment.id), night.map((moment) => moment.id))
  const dry = eligibleMoments(MOMENT_BANK, { kind: 'buka' }, 'kano', lagos(1, 15, 9), { climate: CLIMATE })
  const wet = eligibleMoments(MOMENT_BANK, { kind: 'buka' }, 'kano', lagos(7, 15, 9), { climate: CLIMATE })
  assert.ok(dry.some((moment) => moment.season?.harmattan), 'a harmattan line in January')
  assert.ok(!wet.some((moment) => moment.season?.harmattan), 'no harmattan line in July')
  assert.ok(wet.some((moment) => moment.season?.wet), 'a wet-season line in July')
  assert.ok(!dry.some((moment) => moment.season?.wet), 'no wet-season line in January')
  assert.ok(!eligibleMoments(MOMENT_BANK, { kind: 'buka' }, 'kano', lagos(1, 15, 9)).some((moment) => moment.season), 'season lines need a climate')
})

test('conditioned lines never play without their condition', () => {
  assert.ok(CONDITIONED.length > 0)
  for (const time of [lagos(10, 6, 6), MORNING, lagos(10, 6, 14), lagos(10, 6, 19), lagos(10, 6, 23)]) {
    const ids = eligibleMoments(MOMENT_BANK, { kind: 'home' }, 'lagos', time).map((moment) => moment.id)
    for (const moment of CONDITIONED) assert.ok(!ids.includes(moment.id), moment.id)
  }
  for (const cond of ['power-cut', 'power-restored', 'rain', 'go-slow', 'match-night'] as const) {
    assert.ok(CONDITIONED.filter((moment) => moment.cond === cond).length >= 2, cond)
    const live = eligibleMoments(MOMENT_BANK, { kind: 'home' }, 'lagos', lagos(10, 6, 20), { conditions: [cond] })
    assert.ok(live.some((moment) => moment.cond === cond), cond)
    assert.ok(live.every((moment) => !moment.cond || moment.cond === cond), cond)
  }
})

test('every id is unique, and every place kind and city exists', () => {
  assert.equal(new Set(MOMENT_BANK.map((moment) => moment.id)).size, MOMENT_BANK.length)
  const open = new Set(CITY_CATALOGUE.filter((city) => city.open).map((city) => city.id))
  for (const moment of MOMENT_BANK) {
    for (const kind of moment.placeKinds ?? []) assert.ok((SCENE_KINDS as readonly string[]).includes(kind), `${moment.id}: ${kind}`)
    for (const city of moment.cityIds ?? []) assert.ok(open.has(city), `${moment.id}: ${city} is not an open city`)
    assert.ok(moment.weight > 0, moment.id)
  }
})

test('every Hausa, Yoruba, Igbo or Efik line is beta', () => {
  for (const moment of MOMENT_BANK) if (moment.lang && BETA_LANGS.includes(moment.lang)) assert.equal(moment.beta, true, moment.id)
  for (const lang of BETA_LANGS) assert.ok(MOMENT_BANK.some((moment) => moment.lang === lang), lang)
})

test('lines are short, plain and not duplicated', () => {
  const seen = new Set<string>()
  for (const moment of MOMENT_BANK) {
    assert.ok(moment.text.length >= 12 && moment.text.length <= 140, `${moment.id}: ${moment.text.length} characters`)
    assert.equal(moment.text, moment.text.trim(), moment.id)
    assert.ok(!/[\u0000-\u001f]/.test(moment.text), moment.id)
    assert.ok(!seen.has(moment.text), `duplicate text: ${moment.text}`)
    seen.add(moment.text)
  }
})

test('counts: 15 to 25 lines for every main kind, and every city carries its own', () => {
  const kinds = ['buka', 'market', 'hub', 'club', 'office', 'gym', 'mall', 'beach', 'hospital', 'salon', 'park', 'worship', 'police', 'viewing', 'home']
  for (const kind of kinds) {
    const own = MOMENT_BANK.filter((moment) => moment.placeKinds?.length === 1 && moment.placeKinds[0] === kind && !moment.cityIds)
    assert.ok(own.length >= 15 && own.length <= 25, `${kind} has ${own.length}`)
  }
  for (const city of CITIES) assert.ok(MOMENT_BANK.filter((moment) => moment.cityIds?.includes(city)).length >= 8, city)
  assert.ok(ANYWHERE.length >= 20)
})

test('something plays at every scene kind and home, in every city, at every time of day', () => {
  for (const city of CITIES) for (const kind of [...SCENE_KINDS, 'home']) for (const hour of [6, 9, 14, 19, 23]) {
    assert.ok(pickMoment({ kind }, city, lagos(10, 6, hour), 7) !== null, `${city} ${kind} ${hour}h`)
  }
})

test('a moment is on show for a share of windows, only at the start of each', () => {
  let shown = 0
  const windows = 600
  for (let index = 0; index < windows; index += 1) {
    const start = lagos(10, 6, 0) + index * MOMENT_WINDOW_MS
    const first = momentShown(start, 'x')
    assert.equal(momentShown(start + MOMENT_SHOW_MS, 'x'), false)
    assert.equal(momentShown(start + MOMENT_SHOW_MS - 1, 'x'), first)
    if (first) shown += 1
  }
  assert.ok(shown / windows > 0.45 && shown / windows < 0.75, `${shown}/${windows}`)
  assert.equal(momentShown(Number.NaN, 'x'), momentShown(0, 'x'))
})

test('pickFrom copes with an empty bank and a bad time', () => {
  assert.equal(pickFrom([], { kind: 'buka' }, 'lagos', MORNING, 1), null)
  const bank: Moment[] = [{ id: 'only-1', text: 'The only line there is.', weight: 1 }]
  assert.equal(pickFrom(bank, { kind: 'buka' }, 'lagos', Number.NaN, 1)?.id, 'only-1')
})
