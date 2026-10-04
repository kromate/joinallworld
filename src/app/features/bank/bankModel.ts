// What the Bank app shows, worked out from the view. Pure, so it is tested without a browser.
import type { LifeState } from '../../../types/life.ts'
import type { EconomyView, LoanCard, RentCard } from '../../../types/view.ts'
import type { PanelView } from '../../types/panel.ts'

export const OFFLINE_TEXT = 'Not connected: read-only until the connection is back.'

/**
 * The red badge on the Bank icon: rent that is overdue or that the balance will not cover, and a
 * loan instalment the balance will not cover. From data already in the view, never a fetch.
 */
export function billsDue(_state: LifeState, view: Pick<PanelView, 'economy'>): number {
  const economy: Partial<EconomyView> = view.economy ?? {}
  const { rent, loan } = economy
  return (rent?.warning ? 1 : 0) + (loan && !loan.cleared && !loan.prepaid && loan.weekBlocked ? 1 : 0)
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
