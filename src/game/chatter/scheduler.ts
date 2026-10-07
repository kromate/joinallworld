// What a visit does with the picker: asks now and then, hands back an exchange that is due, and keeps the visit to a few of them.
// Pure state (no timers, no DOM): the caller passes `now`, so the tests drive it with a clock of their own.
import { SETTLE_MS, START_WINDOW_MS, VISIT_CAP, exchangeAt, slotOf } from './pick.ts'
import type { Chosen, ChatterContext, Exchange } from './types.ts'

export interface Chatter {
  /** The exchange that is due at `now` for this venue, or null. A visit to a new venue starts afresh. */
  poll(context: ChatterContext, now: number): Chosen | null
  /** Forget the visit (the player left, or went home). */
  reset(): void
}

export function createChatter(bank: readonly Exchange[]): Chatter {
  let visit = '', enteredAt = 0, heard = 0, lastSlot = Number.NEGATIVE_INFINITY
  let cached: { key: string; slot: number; chosen: Chosen | null } | null = null
  return {
    reset() { visit = ''; heard = 0; lastSlot = Number.NEGATIVE_INFINITY; cached = null },
    poll(context, now) {
      const key = `${context.cityId}|${context.venueId}`
      if (key !== visit) { visit = key; enteredAt = now; heard = 0; lastSlot = Number.NEGATIVE_INFINITY; cached = null }
      if (heard >= VISIT_CAP || now - enteredAt < SETTLE_MS) return null
      const slot = slotOf(now)
      if (slot === lastSlot) return null
      // The regulars standing here may change between polls, so the slot is looked at again only for the same two people.
      const people = context.regulars.map((regular) => regular.id).sort().join(',')
      const cacheKey = `${key}|${people}`
      if (!cached || cached.key !== cacheKey || cached.slot !== slot) cached = { key: cacheKey, slot, chosen: exchangeAt(bank, context, slot) }
      const chosen = cached.chosen
      if (!chosen || now < chosen.startsAt || now >= chosen.startsAt + START_WINDOW_MS) return null
      lastSlot = slot
      heard += 1
      return chosen
    },
  }
}
