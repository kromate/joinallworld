// The exchange picker: pure and deterministic. The same city, venue, Lagos day and slot give the same exchange between the same two
// regulars on every device, so two players in one venue see the same talk. Pacing is part of the pick, not of the caller.
//
// Time is cut into slots of SLOT_MS. About SPEAK_RATE of the slots hold one exchange, which begins at a seeded moment inside the slot
// and stays due for START_WINDOW_MS: a poll that runs every few seconds never misses it, and one that arrives late does not replay it.
// So a venue hears an exchange every three minutes or so, not a stream. Which exchange: the ones that fit the place, the city and the
// band of the day are put in a seeded, weighted order and the slots of the band walk down it (the same cycle rule as src/moments/pick.ts),
// so a line does not repeat inside a cycle of the pool.
import { makeRng } from '../util.ts'
import { bandSpan, daySeed } from '../world-time.ts'
import type { Chosen, ChatterContext, Exchange, Regular } from './types.ts'

/** One slot of the clock. */
export const SLOT_MS = 90_000
/** The share of slots that hold an exchange. */
export const SPEAK_RATE = 0.55
/** How long an exchange stays due after it starts. */
export const START_WINDOW_MS = 20_000
/** The answer comes this long after the first line. */
export const REPLY_DELAY_MS = 3_200
/** The most exchanges one visit to a venue hears. */
export const VISIT_CAP = 10
/** Nothing is said in the first seconds of a visit, so talk never lands on the scene before it has settled. */
export const SETTLE_MS = 6_000

const LAGOS_OFFSET_MS = 3_600_000
const DAY_MS = 86_400_000

export const slotOf = (now: number): number => Math.floor((Number.isFinite(now) ? now : 0) / SLOT_MS)

/** The Lagos day number (days since 1970 on the Lagos wall clock) the day seed is keyed by. */
const lagosDay = (now: number): number => Math.floor(((Number.isFinite(now) ? now : 0) + LAGOS_OFFSET_MS) / DAY_MS)

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** The exchanges that may play at this place and city in this band, sorted by id. */
export function eligibleExchanges(bank: readonly Exchange[], context: ChatterContext, at: number): Exchange[] {
  const { band } = bandSpan(at)
  return bank.filter((exchange) =>
    (!exchange.placeKinds || exchange.placeKinds.includes(context.place.kind as never))
    && (!exchange.cityIds || exchange.cityIds.includes(context.cityId))
    && (!exchange.bands || exchange.bands.includes(band))).sort(byId)
}

/** A seeded, weighted shuffle without replacement (Efraimidis–Spirakis): the line with the largest log(u) / weight comes first. */
function order(pool: readonly Exchange[], seed: string): Exchange[] {
  const next = makeRng(seed)
  return pool.map((exchange) => ({ exchange, key: Math.log(next() || 1e-12) / Math.max(exchange.weight, 1e-6) }))
    .sort((a, b) => b.key - a.key || byId(a.exchange, b.exchange))
    .map((item) => item.exchange)
}

/** Two different regulars, in speaking order, from a seeded draw. Regulars are taken in id order so the list's own order never matters. */
function pair(regulars: readonly Regular[], next: () => number): [Regular, Regular] | null {
  const list = [...new Map(regulars.map((regular) => [regular.id, regular])).values()].sort(byId)
  if (list.length < 2) return null
  const i = Math.floor(next() * list.length)
  const j = (i + 1 + Math.floor(next() * (list.length - 1))) % list.length
  return [list[i] as Regular, list[j] as Regular]
}

/** The exchange held by one slot of this venue, or null when the slot is quiet or nothing fits. Pure. */
export function exchangeAt(bank: readonly Exchange[], context: ChatterContext, slot: number): Chosen | null {
  if (context.place.kind === 'home' || !Number.isInteger(slot)) return null
  const seed = `chatter|${daySeed(context.cityId, lagosDay(slot * SLOT_MS))}|${context.cityId}|${context.venueId}`
  const next = makeRng(`${seed}|slot|${slot}`)
  if (next() >= SPEAK_RATE) return null
  const startsAt = slot * SLOT_MS + 5_000 + Math.floor(next() * (SLOT_MS - START_WINDOW_MS - 10_000))
  const people = pair(context.regulars, next)
  if (!people) return null
  const pool = eligibleExchanges(bank, context, startsAt)
  if (!pool.length) return null
  const span = bandSpan(startsAt)
  const walk = Math.max(0, Math.floor((slot * SLOT_MS - span.from) / SLOT_MS))
  const cycle = Math.floor(walk / pool.length)
  const base = `${seed}|${span.from}|${pool.map((exchange) => exchange.id).join(',')}`
  const lines = order(pool, `${base}|${cycle}`)
  if (cycle > 0 && pool.length > 1) {
    const last = order(pool, `${base}|${cycle - 1}`)[pool.length - 1] as Exchange
    if ((lines[0] as Exchange).id === last.id) [lines[0], lines[1]] = [lines[1] as Exchange, lines[0] as Exchange]
  }
  const exchange = lines[walk - cycle * pool.length] as Exchange
  const [a, b] = people
  return {
    slot, startsAt, exchangeId: exchange.id, beta: exchange.beta,
    first: { npcId: a.id, name: a.name, text: exchange.lines[0] },
    second: { npcId: b.id, name: b.name, text: exchange.lines[1] },
  }
}
