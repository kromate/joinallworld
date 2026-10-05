// What the Bank app shows, worked out from the view. Pure, so it is tested without a browser.
import type { LifeState } from '../../../types/life.ts'
import type { EconomyView } from '../../../types/view.ts'
import type { PanelView } from '../../types/panel.ts'

/**
 * The red badge on the Bank icon: rent that is overdue or that the balance will not cover, and a
 * loan instalment the balance will not cover. From data already in the view, never a fetch.
 */
export function billsDue(_state: LifeState, view: Pick<PanelView, 'economy'>): number {
  const economy: Partial<EconomyView> = view.economy ?? {}
  const { rent, loan } = economy
  return (rent?.warning ? 1 : 0) + (loan && !loan.cleared && !loan.prepaid && loan.weekBlocked ? 1 : 0)
}
