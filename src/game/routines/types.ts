// The shapes of the daily routines of the regulars. Data and types only: no clock, no content, no imports of the engine.
//
// A routine is a table, not code (the way Stardew Valley keeps a schedule per day of the week with a rainy-day variant): hours of
// the Lagos wall clock for each day, and the few facts the resolver needs to bend them (is the place outdoors, does the person open
// the stall or only visit it). Every number is an original beta value, written to feel right, not measured.
import type { TimeBand } from '../world-time.ts'

/** The kinds of regular. The role text of a regular ("Mama Put cook", "Student") and the kind of its venue decide which one it is (archetype.ts). */
export const ARCHETYPES = Object.freeze([
  'trader', 'cook', 'maker', 'diner', 'shopper', 'visitor', 'resident', 'walker', 'fan', 'creative',
  'clerk', 'teacher', 'student', 'medic', 'duty', 'transit', 'guide', 'keeper', 'worshipper', 'nightlife', 'athlete',
] as const)
export type Archetype = (typeof ARCHETYPES)[number]

/** The days a plan is written for. A day by name wins over `weekday` / `weekend`, which win over `any`. */
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun' | 'weekday' | 'weekend' | 'any'

/**
 * One stretch of presence in Lagos hours (6.5 = 06:30). `to` above 24 runs past midnight into the next morning (28 = 04:00).
 * A third member `true` pins it: no early riser, late riser or daily wobble moves it (a bar's closing time is not a mood).
 */
export type Span = readonly [from: number, to: number, fixed?: true]
export type Plan = readonly Span[]
export type Week = Partial<Record<DayKey, Plan>>

/** Where the person stands while at the place: out in the weather, under a roof of sheets and umbrellas, or inside. */
export type Exposure = 'outdoor' | 'covered' | 'indoor'

export interface Routine {
  /** One line for the person who edits the table. */
  note: string
  /** 'venue': the kind of the venue decides (a park is outdoors, a market is covered, an office is inside). */
  exposure: Exposure | 'venue'
  /** Opens or runs the place: present whether or not the venue's own opening hours say it is open. A visitor only comes when it is open. */
  staff?: true
  /** Keeps the day of rest of the city: away at church on a Sunday morning, at Friday prayers in the north, whatever the plan says. */
  service?: true
  days: Week
  /** The rainy-day variant: a day written here replaces the same day of `days` while it rains. With none, people in the open go home and the rest stay. */
  rain?: Week
  /** Rotating shifts: one plan is chosen for each person and week from this list, and `days` is not read. */
  shifts?: readonly Plan[]
  /** One day off a week (a different one for each person) on top of the plan. */
  rota?: true
}

/**
 * What a city changes in the shared table: the plan of an archetype on some days, and the archetype of single regulars.
 * A tweak replaces the days it names; one that names `any` restates the whole week, so no narrower day of the shared table is left behind.
 */
export interface CityRoutine {
  note: string
  tweaks?: Partial<Record<Archetype, { days?: Week; rain?: Week }>>
  /** A regular (by id) that the role text would put in the wrong box. */
  archetypes?: Record<string, Archetype>
}

/** The faith most people of a city keep, which decides the day its stalls close for service. */
export type Faith = 'christian' | 'muslim' | 'mixed'

/** Where a regular is: at the venue, or somewhere else. */
export type Place = 'venue' | 'home' | 'church' | 'mosque'

/** Why a regular is not at the venue. 'shift' and 'always' are the reasons for being there. */
export type Why = 'shift' | 'always' | 'rain' | 'service' | 'closed' | 'asleep' | 'off'

export interface Presence {
  here: boolean
  place: Place
  why: Why
  /** The time band of the moment asked about (src/game/world-time.ts). */
  band: TimeBand
}

/** The sky at the moment: all the resolver needs to know of the weather. The caller reads it (weatherAt) so the resolver stays pure. */
export interface Sky { raining: boolean }
