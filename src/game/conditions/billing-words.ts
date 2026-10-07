// What the bills say, and how loud they get. Pure words and sums, no state and no money: the economy system decides what is owed and when,
// this file only decides how a missed Saturday is put to the player. Nothing here evicts anyone: the player keeps the home in this beta,
// and the text says so. Wage day is only a label: shifts still pay the minute they finish.
import { naira } from '../util.ts'
import type { LedgerDay } from '../../types/life.ts'

const ORDINALS = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth']

/** Thursday: two days' notice, so a short balance can still be fixed with a shift or two. The Friday reminder (in the economy system) follows it. */
export function headsUpLine(parts: readonly string[], total: number, cash: number): string {
  const short = cash < total
  return `Heads up: ${parts.join(' and ')} due Saturday, in two days. You have ${naira(cash)}${short ? `, ${naira(total - cash)} short. Work a shift or two before then.` : '.'}`
}

/** A missed Saturday, louder each time it repeats in a row (`missed` counts Saturdays missed in a row, 1 or more). A notice is at most 160 characters. */
export function missedRentLine(missed: number, amount: number, due: string, owed: number, fee: number): string {
  if (missed <= 1) return `Rent missed: ${naira(amount)} was due ${due}. You owe ${naira(owed)}; pay it in Phone → Bank before next Saturday to avoid a late fee.`
  if (missed === 2) return `Rent missed again: ${naira(amount)} was due ${due}, second week running. You owe ${naira(owed)} with a ${naira(fee)} late fee. Your landlord is asking after you.`
  const nth = ORDINALS[missed] ?? `${missed}th`
  return `Rent missed, ${nth} week running: ${naira(amount)} due ${due}. You owe ${naira(owed)}; fees grow. Your landlord is cross, but you keep your room in this beta.`
}

/** What the Bank shows beside rent that is owed, by how many Saturdays have gone by. */
export function arrearsWarning(owed: number, missed: number, nextDue: string, fee: number): string {
  const base = `You owe ${naira(owed)} in missed rent. Pay it before ${nextDue} or a ${naira(fee)} late fee is added. It is collected automatically on a Saturday when your balance covers it. You keep your home in this beta.`
  if (missed <= 1) return base
  if (missed === 2) return `Two Saturdays missed. ${base} Your landlord is asking after you.`
  return `${missed} Saturdays missed in a row. ${base} Your landlord has stopped being polite, and the fees only grow, to a limit.`
}

/** The pay week that ended on the Friday before a Saturday bill day: what came in and what went out, from the day summaries the wallet already keeps. */
export function weekTotals(days: readonly LedgerDay[], billDay: number): { in: number; out: number } {
  let inn = 0, out = 0
  for (const day of days) if (day.day >= billDay - 7 && day.day < billDay) { inn += day.in; out += day.out }
  return { in: inn, out }
}

/** The label that stands in for a wage day: shifts pay as they finish, so this only sums the week up. Empty on a week with no money moving. */
export function weekLine(totals: { in: number; out: number }, endLabel: string): string {
  if (totals.in <= 0 && totals.out <= 0) return ''
  return `Week ending ${endLabel}: ${naira(totals.in)} came in and ${naira(totals.out)} went out.`
}
