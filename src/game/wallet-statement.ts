// Full wallet reconstruction is needed by the Statement screen, support route and audits, not by
// the eager life view. Keeping it here leaves the normal HUD/venue startup with cash and recent
// ledger lines only; the lazy Statement screen downloads this arithmetic when opened.
import type { LedgerLine } from '../types/life.ts'
import { LEDGER_DAYS, LEDGER_LIMIT } from './systems/wallet.ts'
import type { WalletState } from './systems/wallet.ts'

export interface StatementDay { day: number; open: number; close: number; in: number; out: number; changes: number; groups: { group: string; net: number; count: number }[] }
export interface StatementTotals { in: number; out: number; changes: number; net: number }
export interface Statement {
  closing: number
  opening: { balance: number; day: number | null }
  days: StatementDay[]
  lines: LedgerLine[]
  linesOpening: number
  totals: StatementTotals
  reconciled: boolean
  problems: string[]
  kept: { lines: number; days: number }
}

/** The balance's kept opening, changes and closing, with both line and daily arithmetic checked. */
export function statementOf(state: WalletState): Statement {
  const lines = state.ledger.map((line) => ({ ...line }))
  const days: StatementDay[] = state.ledgerDays.map((day) => ({ day: day.day, open: day.open, close: day.close, in: day.in, out: day.out, changes: day.n,
    groups: Object.entries(day.by).map(([group, [net, count]]) => ({ group, net, count })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || (a.group < b.group ? -1 : 1)) }))
  const problems: string[] = []
  const first = lines[0], lastLine = lines.at(-1)
  const linesOpening = first ? first.balance - first.amount : state.cash
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i], before = lines[i - 1]
    if (line && before && line.balance - line.amount !== before.balance) problems.push(`Line ${i + 1} does not follow from the line before it.`)
  }
  if (lastLine && lastLine.balance !== state.cash) problems.push('The last recorded change does not end at the current balance.')
  for (let i = 0; i < days.length; i++) {
    const day = days[i], before = days[i - 1]
    if (!day) continue
    if (day.open + day.in - day.out !== day.close) problems.push(`Day ${day.day} does not add up.`)
    if (before && day.open !== before.close) problems.push(`Day ${day.day} does not open where the day before closed.`)
  }
  const firstDay = days[0], lastDay = days.at(-1)
  if (lastDay && lastDay.close !== state.cash) problems.push('The last day does not close at the current balance.')
  const opening = firstDay ? { balance: firstDay.open, day: firstDay.day } : { balance: linesOpening, day: null }
  const sums = firstDay
    ? { in: days.reduce((sum, day) => sum + day.in, 0), out: days.reduce((sum, day) => sum + day.out, 0), changes: days.reduce((sum, day) => sum + day.changes, 0) }
    : { in: lines.filter((line) => line.amount > 0).reduce((sum, line) => sum + line.amount, 0), out: -lines.filter((line) => line.amount < 0).reduce((sum, line) => sum + line.amount, 0), changes: lines.length }
  const totals: StatementTotals = { ...sums, net: sums.in - sums.out }
  if (opening.balance + totals.net !== state.cash) problems.push('Opening balance plus every change does not equal the closing balance.')
  return { closing: state.cash, opening, days, lines, linesOpening, totals, reconciled: problems.length === 0, problems, kept: { lines: LEDGER_LIMIT, days: LEDGER_DAYS } }
}
