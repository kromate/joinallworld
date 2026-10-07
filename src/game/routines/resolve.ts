// Where a regular is at a moment: the one resolver every host shares.
//
// `where(npc, now, city, sky)` is pure: the same regular, instant, city and sky give the same answer on the server, in the Worker and
// in the browser, with nothing stored. It reads the world clock (src/game/world-time.ts: the day, the time band, the harmattan), the
// routine table (data.ts) and the city's own habits (cities.ts). Weather is an input, because reading it pulls in the health system.
//
// How one answer is made:
//   1. The regular is classified once (archetype.ts) and the city's tweaks are laid over the shared routine.
//   2. Whoever keeps the day of rest is away at church (Sunday morning) or at Friday prayers, whatever the plan says.
//   3. The plan of the day (and the tail of yesterday's night shift) is bent by the person: an early riser starts earlier, a late riser later,
//      and each day wobbles by a quarter hour or two, so a whole market does not arrive in the same minute. Harmattan mornings start later.
//   4. Rain: the rainy-day plan if the routine has one; otherwise people in the open go home and the rest stay where they are.
//   5. A visitor only comes while the venue is open; the staff who open it need no hours.
// Everything changes on a quarter of an hour, so the answer is read at the quarter the moment falls in.
import type { NpcDefinition } from '../../types/content.ts'
import { formatHour, isOpen, lagosTime, WEEKDAYS, type LagosTime, type OpeningHours } from '../clock.ts'
import { cityRules } from '../cities/registry.ts'
import { venueFor } from '../cities/runtime.ts'
import { citySeason, daySeed, timeBand } from '../world-time.ts'
import { archetypeOf } from './archetype.ts'
import { CHRISTIAN_SHARE, CITY_ROUTINES, faithOf } from './cities.ts'
import { ROUTINES, SERVICE, WORSHIP } from './data.ts'
import type { Archetype, Exposure, Place, Plan, Presence, Routine, Sky, Week, Why } from './types.ts'

const QUARTER = 900000
/** How far ahead `nextChange` looks: eight days, enough to find the Monday after a closed weekend. */
const HORIZON = 8 * 96
const DRY: Sky = Object.freeze({ raining: false })
const DAY_KEYS = Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)

type Chrono = 'lark' | 'steady' | 'owl'
/** How early or late each kind of sleeper starts the day, in hours. */
const WAKE: Readonly<Record<Chrono, number>> = { lark: -0.5, steady: 0, owl: 0.75 }

/** Venue kinds where people stand in the weather, or under a roof that lets the weather in; a kind not listed is indoors. */
const OUTDOOR: ReadonlySet<string> = new Set(['park', 'walk', 'beach', 'hilltop', 'lakeside', 'quad', 'viewing', 'rooftop'])
const COVERED: ReadonlySet<string> = new Set(['market', 'hub', 'buka', 'shrine', 'statehouse', 'polling'])

interface Profile {
  /** False for a regular whose venue is not in the build or is not a place (home): no routine, always where the game puts them. */
  placed: boolean
  archetype: Archetype
  routine: Routine
  exposure: Exposure
  hours: OpeningHours | undefined
  chrono: Chrono
  /** The faith this person keeps (the city's main one for a stall that closes for service). */
  faith: 'christian' | 'muslim'
  /** Goes to the service of the day of rest. */
  attends: boolean
  key: number
  off: number
}

/** A small, fixed 32-bit hash of a text (FNV-1a): the same on every host, and far cheaper than a seeded generator. */
export function hash(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}

const profiles = new Map<string, Profile>()
const seeds = new Map<string, number>()

function restate(base: Week | undefined, tweak: Week): Week {
  return { ...('any' in tweak ? {} : base), ...tweak }
}

function build(npc: NpcDefinition, city: string): Profile {
  const venue = venueFor(city, npc.venue)
  const kind: string = venue?.scene.kind ?? '', variant: string = venue?.scene.variant ?? ''
  const archetype = archetypeOf(city, npc.id, npc.role, kind)
  const base = ROUTINES[archetype], tweak = CITY_ROUTINES[city]?.tweaks?.[archetype]
  const worship = kind === 'worship' ? (variant.includes('mosque') ? 'mosque' : 'church') : null
  let routine: Routine = tweak ? { ...base, days: tweak.days ? restate(base.days, tweak.days) : base.days, rain: tweak.rain ? restate(base.rain, tweak.rain) : base.rain } : base
  if (archetype === 'worshipper' && worship) routine = { ...routine, days: WORSHIP[worship] }
  const faith = faithOf(city), main = faith === 'muslim' ? 'muslim' : 'christian'
  const own = worship ? (worship === 'mosque' ? 'muslim' : 'christian') : hash(`faith|${npc.id}`) % 100 < CHRISTIAN_SHARE[faith] ? 'christian' : 'muslim'
  const roll = hash(`chrono|${npc.id}`) % 6
  const key = hash(npc.id)
  return {
    placed: Boolean(venue) && npc.venue !== 'home',
    archetype,
    routine,
    exposure: routine.exposure === 'venue' ? (OUTDOOR.has(kind) ? 'outdoor' : COVERED.has(kind) ? 'covered' : 'indoor') : routine.exposure,
    hours: venue?.hours,
    chrono: npc.age === 'elder' ? 'lark' : npc.age === 'young' ? (roll < 3 ? 'owl' : 'steady') : roll === 0 ? 'lark' : roll === 5 ? 'owl' : 'steady',
    faith: routine.service ? main : own,
    attends: !worship && (routine.service === true || hash(`devout|${npc.id}`) % 100 < 60),
    key,
    off: key % 7,
  }
}

function profileOf(npc: NpcDefinition, city: string): Profile {
  const id = `${city}|${npc.id}|${npc.venue}`
  let found = profiles.get(id)
  if (!found) { found = build(npc, city); profiles.set(id, found) }
  return found
}

/** The archetype of a regular in a city: for the tests and for whoever tunes the table. */
export const archetypeFor = (npc: NpcDefinition, city: string): Archetype => profileOf(npc, city).archetype

const weekPlan = (week: Week | undefined, weekday: number): Plan | undefined =>
  week?.[DAY_KEYS[weekday] ?? 'sun'] ?? (weekday === 0 || weekday === 6 ? week?.weekend : week?.weekday) ?? week?.any

/** The plan of a day for one person: the rotation, the day off, the rainy-day variant. */
function planOf(p: Profile, weekday: number, week: number, raining: boolean): Plan {
  const r = p.routine
  if (r.rota && weekday === p.off) return []
  if (raining) {
    const wet = weekPlan(r.rain, weekday)
    if (wet) return wet
    if (p.exposure === 'outdoor') return []
  }
  if (r.shifts) return r.shifts[(p.key + week) % r.shifts.length] ?? []
  return weekPlan(r.days, weekday) ?? []
}

function seedOf(city: string, day: number): number {
  const id = `${city}|${day}`
  let seed = seeds.get(id)
  if (seed === undefined) { if (seeds.size > 512) seeds.clear(); seed = daySeed(city, day); seeds.set(id, seed) }
  return seed
}

/** How far this person's day is moved today, in hours: their sleeping habit and the day's wobble (a quarter hour steps, never more than half an hour). */
const shiftOf = (p: Profile, city: string, day: number): number => WAKE[p.chrono] + ((Math.imul(p.key ^ seedOf(city, day), 2654435761) >>> 16) % 5 - 2) * 0.25

/** A plan on a day, moved by `shift`. A pinned span stays; on a cold harmattan morning people in the open start late and leave early. */
function moved(p: Profile, plan: Plan, shift: number, cold: boolean): [number, number][] {
  const spans: [number, number][] = []
  for (const [from, to, pinned] of plan) {
    const trim = cold && p.exposure === 'outdoor' ? 0.5 : 0
    const a = pinned ? from : from + shift + trim, b = pinned ? to : to + shift - trim
    if (b > a) spans.push([a, b])
  }
  return spans
}

function inPlan(p: Profile, city: string, t: LagosTime, h: number, raining: boolean, cold: boolean): boolean {
  if (moved(p, planOf(p, t.weekday, t.week, raining), shiftOf(p, city, t.day), cold).some(([a, b]) => h >= a && h < b)) return true
  // The tail of last night: a plan that ran past midnight is still going until it ends.
  const before = moved(p, planOf(p, (t.weekday + 6) % 7, t.weekday === 1 ? t.week - 1 : t.week, raining), shiftOf(p, city, t.day - 1), cold)
  return before.some(([a, b]) => b > 24 && h + 24 >= a && h + 24 < b)
}

/** The service of the day of rest a person keeps, if this moment is in it. On the Sunday a stall does not open before it ends; on the Friday it trades until it starts. */
function serviceAt(p: Profile, weekday: number, h: number): 'church' | 'mosque' | null {
  if (!p.attends) return null
  const place = p.faith === 'muslim' ? 'mosque' : 'church', service = SERVICE[place]
  return weekday === service.weekday && h >= (p.routine.service && service.shut ? 0 : service.from) && h < service.to ? place : null
}

/** Asleep by the clock of this sleeper: the lark sleeps early and wakes at first light, the owl is up after midnight. */
const asleep = (chrono: Chrono, h: number): boolean => chrono === 'owl' ? h >= 1 && h < 8 : chrono === 'lark' ? h >= 21.5 || h < 4.5 : h >= 22.5 || h < 5.5

const away = (place: Place, why: Why): { here: boolean; place: Place; why: Why } => ({ here: false, place, why })

/** The answer without the time band: what `nextChange` compares, a quarter of an hour at a time. */
function core(p: Profile, city: string, at: number, sky: Sky): { here: boolean; place: Place; why: Why } {
  if (!p.placed) return { here: true, place: 'venue', why: 'always' }
  const t = lagosTime(at), h = t.minuteOfDay / 60
  const service = serviceAt(p, t.weekday, h)
  if (service) return away(service, 'service')
  const cold = citySeason(cityRules(city)?.climate, at).harmattan
  if (inPlan(p, city, t, h, sky.raining, cold)) {
    return p.routine.staff || !p.hours || isOpen(p.hours, at) ? { here: true, place: 'venue', why: 'shift' } : away('home', 'closed')
  }
  if (sky.raining && inPlan(p, city, t, h, false, cold)) return away('home', 'rain')
  return away('home', asleep(p.chrono, h) ? 'asleep' : 'off')
}

const quarter = (ms: number): number => Number.isFinite(ms) ? ms - (((ms % QUARTER) + QUARTER) % QUARTER) : 0

/** Where a regular is at `now` in `city`, given the sky. Pure and deterministic. A regular with no venue to be at is always here. */
export function where(npc: NpcDefinition, now: number, city: string, sky: Sky = DRY): Presence {
  const at = quarter(now)
  return { ...core(profileOf(npc, city), city, at, sky), band: timeBand(at) }
}

/**
 * When the answer next changes, in server ms: the end of the shift, the end of the service, the time they are back. Null when it does not
 * within eight days, and while they are sheltering (the rain decides, not the clock). The sky is taken as it is now for the whole look ahead.
 */
export function nextChange(npc: NpcDefinition, now: number, city: string, sky: Sky = DRY): number | null {
  const p = profileOf(npc, city), start = quarter(now), first = core(p, city, start, sky)
  if (first.why === 'rain' || first.why === 'always') return null
  for (let i = 1; i <= HORIZON; i++) {
    const at = start + i * QUARTER, next = core(p, city, at, sky)
    if (next.here !== first.here || next.place !== first.place) return at
  }
  return null
}

const hourOf = (ms: number): string => formatHour(lagosTime(ms).minuteOfDay / 60)

function whenOf(ms: number, now: number): string {
  const then = lagosTime(ms), days = then.day - lagosTime(now).day
  return `${days <= 0 ? '' : days === 1 ? 'tomorrow ' : `${(WEEKDAYS[then.weekday] ?? '').slice(0, 3)} `}at ${hourOf(ms)}`
}

/** One plain line for the People panel and the venue panel: "At Balogun Market till 6PM", "Asleep, back at 5:30AM". */
export function whereLine(presence: Presence, venue: string, change: number | null, now: number): string {
  const back = change === null ? '' : `, back ${whenOf(change, now)}`
  if (presence.here) return change === null ? `At ${venue}` : `At ${venue} till ${hourOf(change)}`
  if (presence.why === 'rain') return 'Sheltering from the rain'
  if (presence.place === 'church') return change === null ? 'At church' : `At church till ${hourOf(change)}`
  if (presence.place === 'mosque') return change === null ? 'At Friday prayers' : `At Friday prayers till ${hourOf(change)}`
  if (presence.why === 'asleep') return `Asleep${back}`
  if (presence.why === 'closed') return `${venue} is closed${back}`
  return `Away from ${venue}${back}`
}
