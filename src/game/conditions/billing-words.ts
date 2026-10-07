// What the bills say, and how loud they get. Pure words and sums, no state and no money: the economy system decides what is owed and when,
// this file only decides how a missed Saturday is put to the player. Nothing here evicts anyone: the player keeps the home in this beta,
// and the text says so. Wage day is only a label: shifts still pay the minute they finish.
import { naira } from '../util.ts'
import type { LedgerDay } from '../../types/life.ts'

/** Thursday: two days' notice, so a short balance can still be fixed with a shift or two. The Friday reminder (in the economy system) follows it. */
export const headsUpLine = (parts: readonly string[], total: number, cash: number): string =>
  `Heads up: ${parts.join(' and ')} due Saturday. You have ${naira(cash)}${cash < total ? `, ${naira(total - cash)} short. Work a shift or two.` : '.'}`

/** A missed Saturday, louder each time it repeats in a row (`missed` counts Saturdays missed in a row, 1 or more). A notice is at most 160 characters. */
export const missedRentLine = (missed: number, amount: number, due: string, owed: number, fee: number): string =>
  missed < 2 ? `Rent missed: ${naira(amount)} was due ${due}. You owe ${naira(owed)}. Pay in Phone → Bank before next Saturday to avoid a late fee.`
    : missed === 2 ? `Rent missed again, second week running: you owe ${naira(owed)}, with a ${naira(fee)} late fee. Your landlord is asking after you.`
      : `Rent missed, ${missed} weeks running: you owe ${naira(owed)} and the fees grow. Your landlord is cross, but you keep your room in this beta.`

/** What the Bank shows beside rent that is owed, by how many Saturdays have gone by. */
export const arrearsWarning = (owed: number, missed: number, nextDue: string, fee: number): string =>
  `${missed > 1 ? `${missed} Saturdays missed in a row. ` : ''}You owe ${naira(owed)} in missed rent. Pay it before ${nextDue} or a ${naira(fee)} late fee is added; one is also taken on a Saturday when your balance covers it. You keep your home in this beta.${missed > 2 ? ' Your landlord has stopped being polite.' : missed > 1 ? ' Your landlord is asking after you.' : ''}`

/** The pay week that ended on the Friday before a Saturday bill day: what came in and what went out, from the day summaries the wallet already keeps. */
export function weekTotals(days: readonly LedgerDay[], billDay: number): { in: number; out: number } {
  const week = days.filter((day) => day.day >= billDay - 7 && day.day < billDay)
  return { in: week.reduce((sum, day) => sum + day.in, 0), out: week.reduce((sum, day) => sum + day.out, 0) }
}

/** The label that stands in for a wage day: shifts pay as they finish, so this only sums the week up. Empty on a week with no money moving. */
export function weekLine(totals: { in: number; out: number }, endLabel: string): string {
  if (totals.in <= 0 && totals.out <= 0) return ''
  return `Week ending ${endLabel}: ${naira(totals.in)} came in and ${naira(totals.out)} went out.`
}
