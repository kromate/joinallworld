// What the engine keeps of the city's conditions: a slot, and what to say while it is empty. The rules themselves (the grid, the go-slow and
// the words of the bills) are in ./pack.ts, a chunk of their own: a host that plays a life gets them with src/game/profile.ts, and the browser
// fetches them once the page is up (src/app/startExtras.ts). Until then a page shows an open road, the light on and the plain sentence.
import type { LedgerDay } from '../../types/life.ts'
import type { refuel, settlePower } from './generator.ts'

/** What the lazy pack gives the engine. Every member is pure. */
export interface ConditionsKit {
  /** Is the light on in a district, and until when is it off. */
  gridAt(cityId: string, district: string, now: number): { on: boolean; until: number | null }
  /** A trip's seconds, longer in the go-slow for a way of travelling that shares the road. */
  slowedSeconds(seconds: number, mode: unknown, cityId: string, now: number): number
  headsUp(parts: readonly string[], total: number, cash: number): string
  missedRent(missed: number, amount: number, due: string, owed: number, fee: number): string
  arrears(owed: number, missed: number, nextDue: string, fee: number): string
  weekTotals(days: readonly LedgerDay[], billDay: number): { in: number; out: number }
  weekLine(totals: { in: number; out: number }, endLabel: string): string
  /** 'home.refuel' and the grid settled over the seconds just passed (./generator.ts). */
  refuel: typeof refuel
  settlePower: typeof settlePower
}

let kit: ConditionsKit | null = null
/** Called by ./pack.ts when it loads. */
export function installConditionsKit(next: ConditionsKit): void { kit = next }
export const conditionsKit = (): ConditionsKit | null => kit

export const gridAt = (cityId: string, district: string, now: number): { on: boolean; until: number | null } => kit ? kit.gridAt(cityId, district, now) : { on: true, until: null }
export const slowedSeconds = (seconds: number, mode: unknown, cityId: string, now: number): number => kit ? kit.slowedSeconds(seconds, mode, cityId, now) : seconds
