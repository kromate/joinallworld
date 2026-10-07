import { loadCityContent, playableCityIds } from '../cities/registry.ts'
await Promise.all(playableCityIds().map(loadCityContent))
// Tests for the routines pack: where a regular is, and what the People panel says about it. See src/game/routines/resolve.ts.
import test from 'node:test'
import assert from 'node:assert/strict'
import { regularsFor, venueFor } from '../cities/runtime.ts'
import { createLife, dispatch, viewLife } from '../../life.ts'
import { makeContext } from '../util.ts'
import type { NpcDefinition } from '../../types/content.ts'
import { archetypeFor, nextChange, where, whereLine } from './resolve.ts'
import { ROUTINES } from './data.ts'
import { ARCHETYPES, type Presence, type Sky } from './types.ts'
import './pack.ts'

const DRY: Sky = { raining: false }
const WET: Sky = { raining: true }
const HOUR = 3600000
/** Lagos clock time: a calendar day (its UTC date) and an hour of it. 2026-10-04 is a Sunday. */
const at = (day: string, hour: number): number => Date.parse(`${day}T00:00:00Z`) - HOUR + hour * HOUR
const SUN = '2026-10-04', MON = '2026-10-05', FRI = '2026-10-09', SAT = '2026-10-10'
const WEEK = ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10']

const cast = (city: string, archetype: string): NpcDefinition[] => regularsFor(city).filter((npc) => archetypeFor(npc, city) === archetype)
const everyone = (): [string, NpcDefinition][] => playableCityIds().flatMap((city) => regularsFor(city).map((npc): [string, NpcDefinition] => [city, npc]))
function need<T>(value: T | null | undefined, what: string): T { assert.ok(value, what); return value }
const lagosNpc = (id: string): NpcDefinition => need(regularsFor('lagos').find((npc) => npc.id === id), id)
/** How many quarter hours of the given days this regular is at the venue. */
const hoursHere = (npc: NpcDefinition, city: string, days: readonly string[], sky: Sky): number => {
  let n = 0
  for (const day of days) for (let q = 0; q < 96; q++) if (where(npc, at(day, q / 4), city, sky).here) n++
  return n
}
const walkers = (): [string, NpcDefinition][] => playableCityIds().flatMap((city) => cast(city, 'walker').map((npc): [string, NpcDefinition] => [city, npc]))

test('the same regular, moment, city and sky always give the same answer', () => {
  for (const [city, npc] of everyone().slice(0, 300)) {
    for (const sky of [DRY, WET]) assert.deepEqual(where(npc, at(MON, 10.3), city, sky), where(npc, at(MON, 10.3), city, sky))
  }
  const kunle = lagosNpc('kunle')
  assert.deepEqual(where(kunle, at(MON, 7), 'lagos'), where(kunle, at(MON, 7) + 600000, 'lagos'), 'the answer holds for the quarter hour')
})

test('every regular of every playable city has a valid answer at any hour, in any weather', () => {
  const places = new Set(['venue', 'home', 'church', 'mosque'])
  let checked = 0
  for (const [city, npc] of everyone()) {
    for (const day of WEEK) for (const hour of [2, 6, 10, 14, 18, 22]) for (const sky of [DRY, WET]) {
      const presence: Presence = where(npc, at(day, hour), city, sky)
      assert.equal(typeof presence.here, 'boolean')
      assert.ok(places.has(presence.place), `${city}/${npc.id}: ${presence.place}`)
      if (presence.here) assert.equal(presence.place, 'venue', `${city}/${npc.id}`)
      checked++
    }
  }
  assert.ok(checked > 10000, `swept ${checked} answers`)
})

test('every archetype has a routine row, and the common ones are found in the cities', () => {
  const used = new Set(everyone().map(([city, npc]) => archetypeFor(npc, city)))
  for (const name of ARCHETYPES) assert.ok(ROUTINES[name], `${name} has a row`)
  for (const name of ['trader', 'cook', 'student', 'medic', 'clerk', 'nightlife', 'worshipper']) assert.ok(used.has(name as never), `${name} is found in the cities`)
})

test('the Lagos cast is classified by what they do', () => {
  const kind = (id: string) => archetypeFor(lagosNpc(id), 'lagos')
  assert.equal(kind('amaka'), 'cook')
  assert.equal(kind('iya-bose'), 'trader')
  assert.equal(kind('tunde-code'), 'student')
  assert.equal(kind('nurse-kemi'), 'medic')
  assert.equal(kind('deji'), 'nightlife')
  assert.equal(kind('dj-kay'), 'nightlife')
  assert.equal(kind('mrs-okafor'), 'clerk')
  assert.equal(kind('oga-tunde'), 'fan', 'running the screen is not a jog')
  assert.equal(kind('sister-grace'), 'worshipper')
  assert.equal(kind('mallam-isa'), 'keeper')
})

test('a student is in class on a Monday morning and at home on a Sunday', () => {
  const tunde = lagosNpc('tunde-code')
  assert.equal(where(tunde, at(MON, 11), 'lagos').here, true)
  const sunday = where(tunde, at(SUN, 11), 'lagos')
  assert.equal(sunday.here, false)
  assert.equal(sunday.place, 'home')
})

test('the office keeps weekdays: the clerk is there on Monday and away on Sunday', () => {
  const mrs = lagosNpc('mrs-okafor')
  assert.equal(where(mrs, at(MON, 11), 'lagos').here, true)
  assert.equal(where(mrs, at(SUN, 11), 'lagos').here, false)
  assert.equal(where(mrs, at(FRI, 16.5), 'lagos').here, false, 'the Friday close is earlier')
})

test('on a Sunday morning a Christian city\'s stalls close for church', () => {
  const stallholders = [...cast('port-harcourt', 'trader'), ...cast('port-harcourt', 'cook')]
  assert.ok(stallholders.length > 0)
  for (const npc of stallholders) {
    const sunday = where(npc, at(SUN, 9.5), 'port-harcourt')
    assert.equal(sunday.here, false, npc.id)
    assert.equal(sunday.place, 'church')
    assert.equal(sunday.why, 'service')
    assert.equal(where(npc, at(MON, 11), 'port-harcourt').here, true, `${npc.id} is back to work on Monday`)
  }
  const bose = lagosNpc('iya-bose')
  assert.equal(where(bose, at(SUN, 9.5), 'lagos').why, 'service', 'a mixed city keeps the Sunday too')
  assert.equal(where(bose, at(SUN, 15), 'lagos').here, true, 'the stall is open again after the service')
})

test('in a Muslim city the stalls stop for Friday prayers', () => {
  const stallholders = [...cast('kano', 'trader'), ...cast('kano', 'cook')]
  assert.ok(stallholders.length > 0)
  for (const npc of stallholders) {
    const friday = where(npc, at(FRI, 13.5), 'kano')
    assert.equal(friday.here, false, npc.id)
    assert.equal(friday.place, 'mosque')
    assert.equal(where(npc, at(FRI, 10), 'kano').here, true, `${npc.id} trades before the prayers`)
  }
})

test('nobody is at the bar at dawn, on any night of the week, in any city', () => {
  let seen = 0
  for (const city of playableCityIds()) for (const npc of cast(city, 'nightlife')) {
    seen++
    for (const day of WEEK) for (const hour of [5, 5.5, 6, 7]) assert.equal(where(npc, at(day, hour), city).here, false, `${city}/${npc.id} at ${hour} on ${day}`)
  }
  assert.ok(seen > 0)
  const dj = lagosNpc('dj-kay')
  assert.equal(where(dj, at(SAT, 23.5), 'lagos').here, true, 'the club is full on Saturday night')
  assert.equal(where(dj, at(SUN, 1.5), 'lagos').here, true, 'and Saturday night runs past midnight')
})

test('rain sends the person in the open home, and shortens the covered stall\'s day', () => {
  assert.ok(walkers().length > 0)
  for (const [city, npc] of walkers()) {
    assert.ok(hoursHere(npc, city, WEEK, DRY) > 0, `${npc.id} walks on a dry day`)
    assert.equal(hoursHere(npc, city, WEEK, WET), 0, `${npc.id} stays in when it rains`)
  }
  const bose = lagosNpc('iya-bose')
  const dry = hoursHere(bose, 'lagos', [MON], DRY), wet = hoursHere(bose, 'lagos', [MON], WET)
  assert.ok(wet > 0 && wet < dry, `the stall trades ${wet} quarters in the rain and ${dry} in the dry`)
})

test('a cold harmattan morning trims the day of people in the open', () => {
  const OCT = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']
  const JAN = ['2027-01-04', '2027-01-05', '2027-01-06', '2027-01-07', '2027-01-08']
  const open = walkers()
  assert.ok(open.length > 0, 'a walker somewhere')
  let october = 0, january = 0
  for (const [city, npc] of open) { october += hoursHere(npc, city, OCT, DRY); january += hoursHere(npc, city, JAN, DRY) }
  assert.ok(january < october, `${january} quarters in January, ${october} in October`)
})

test('the line says where the person is and when that changes', () => {
  const bose = lagosNpc('iya-bose')
  const name = need(venueFor('lagos', bose.venue), 'the market').label
  const now = at(MON, 11)
  const here = where(bose, now, 'lagos'), end = nextChange(bose, now, 'lagos')
  assert.equal(here.here, true)
  assert.ok(end !== null && end > now && end - now < 12 * HOUR)
  assert.match(whereLine(here, name, end, now), new RegExp(`^At ${name} till \\d{1,2}(:\\d\\d)?\\s?(AM|PM)$`))
  const night = at(MON, 23), gone = where(bose, night, 'lagos'), back = nextChange(bose, night, 'lagos')
  assert.equal(gone.here, false)
  assert.match(whereLine(gone, name, back, night), /^(Asleep|Away from .+), back tomorrow at \d/)
  const sunday = at(SUN, 9.5)
  assert.match(whereLine(where(bose, sunday, 'lagos'), name, nextChange(bose, sunday, 'lagos'), sunday), /^At church till /)
  assert.equal(whereLine({ here: false, place: 'home', why: 'rain', band: 'morning' }, name, null, now), 'Sheltering from the rain')
  assert.equal(whereLine({ here: true, place: 'venue', why: 'shift', band: 'morning' }, name, null, now), `At ${name}`)
})

test('the venue view lists who is in and who is away, and an absent regular cannot be spoken to', () => {
  const ctx = (now: number) => makeContext({ now, cityId: 'lagos', seed: 'routines' })
  const sunday = at(SUN, 9.5), monday = at(MON, 11)
  const stall = createLife({ location: 'park', spot: 'people' }, ctx(sunday))
  stall.t = sunday
  const morning = viewLife(stall, ctx(sunday)).social
  const ronke = morning.away.find((npc) => npc.id === 'mama-ronke')
  assert.ok(ronke, 'the zobo seller is at church')
  assert.match(ronke.where, /^At church till/)
  assert.equal(morning.here.some((npc) => npc.id === 'mama-ronke'), false)
  const refused = dispatch(stall, { type: 'activity', payload: { id: 'npc-mama-ronke-hello' } }, ctx(sunday))
  assert.equal(refused.ok, false)
  assert.equal(refused.code, 'not_now')
  const weekday = createLife({ location: 'park', spot: 'people' }, ctx(monday))
  weekday.t = monday
  const view = viewLife(weekday, ctx(monday)).social
  const found = view.here.find((npc) => npc.id === 'mama-ronke')
  assert.ok(found, 'the zobo seller is selling on Monday')
  assert.match(found.where, /^At /)
  assert.equal(dispatch(weekday, { type: 'activity', payload: { id: 'npc-mama-ronke-hello' } }, ctx(monday)).ok, true)
})
