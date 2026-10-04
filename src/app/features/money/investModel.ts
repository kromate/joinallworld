// What the Invest app shows, worked out from view.economy.savings. Pure, so it is tested without a
// browser. The limits, rates and payouts are the engine's (systems/economy.js).
import type { SavingsCard } from '../../../types/view.ts'

export type AmountChoice = SavingsCard['amounts'][number]

/** The amount offered that matches the player's choice, else the first one. */
export function pickAmount(savings: Pick<SavingsCard, 'amounts'>, chosen: number): AmountChoice | undefined {
  return savings.amounts.find((item) => item.amount === chosen) ?? savings.amounts[0]
}

/** The rules under "How deposits work". */
export const investRules = (savings: Pick<SavingsCard, 'maxOpen' | 'cap'>, money: (value: number) => string): string[] => [
  'Lock some cash and get it back with a small fixed interest when the term ends — even if you are away. No risk and no luck involved.',
  `Limits: up to ${savings.maxOpen} deposits at once, and at most ${money(savings.cap)} locked in total.`,
  'The payout goes into your balance by itself on the day shown on each deposit.',
  'Closing a deposit early returns what you locked and gives up its interest.',
  'Rates and limits are original beta values.',
]
