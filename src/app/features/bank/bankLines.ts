// The lines and small rules of the Bank app. Fetched with it: the first download needs only the badge in bankModel.ts.
import type { EconomyView, LoanCard, RentCard } from '../../../types/view.ts'

/** The loan's rule, split: the penalty (the late fee) stays on the card, the rest folds away under "How it works". */
export function loanRule(rule: string | null | undefined): { penalty: string; rest: string[] } {
  const sentences = String(rule ?? '').split(/(?<=\.)\s+/).filter(Boolean)
  const penalty = sentences.filter((line) => /fee|penalt/i.test(line))
  return { penalty: penalty.join(' '), rest: sentences.filter((line) => !penalty.includes(line)) }
}
export type RentStanding = { tone: 'bad'; label: 'Overdue' } | { tone: 'warn'; label: 'At risk' } | { tone: 'good'; label: 'Up to date' }
export function rentStanding(rent: Pick<RentCard, 'arrears' | 'warning'>): RentStanding {
  if (rent.arrears > 0) return { tone: 'bad', label: 'Overdue' }
  return rent.warning ? { tone: 'warn', label: 'At risk' } : { tone: 'good', label: 'Up to date' }
}
/** The reasons the loan buttons are disabled, each said once. */
export function loanReasons(loan: Pick<LoanCard, 'weekBlocked' | 'allBlocked'>, offline: string | null): string[] {
  return [...new Set([offline || loan.weekBlocked, offline || loan.allBlocked].filter((reason): reason is string => Boolean(reason)))]
}
/** The line under the balance about what is due each Saturday. */
export function billsLine(economy: Pick<EconomyView, 'weeklyBills'>, career: { weeklyPay?: number | null; employed: boolean }): { due: boolean; tail: string } {
  if (!(economy.weeklyBills > 0)) return { due: false, tail: '' }
  if (career.weeklyPay) return { due: true, tail: 'pay' }
  return { due: true, tail: career.employed ? '' : 'no-job' }
}
