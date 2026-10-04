// What the Goals tab says, worked out from view.goals. Pure, so it is tested without a browser.
// All rules live in src/game/systems/goals.js; this decides only the words and the reasons.
import type { EconomyView, PerkCard, WishCard } from '../../../types/view.ts'

/** Why nothing can change while the game is not connected; '' when connected. `short` is the connection's two or three words. */
export const offlineWhy = (connected: boolean, short: string | null | undefined): string => (connected ? '' : `${short ?? ''} — nothing can change right now`)

/** Why a perk cannot be unlocked, or ''. An owned perk needs no reason. */
export const perkReason = (perk: Pick<PerkCard, 'owned' | 'blocked'>, offline: string): string => (perk.owned ? '' : offline || perk.blocked || '')

export const perkState = (perk: Pick<PerkCard, 'owned'>, reason: string): 'is-owned' | 'is-locked' | 'is-ready' => (perk.owned ? 'is-owned' : reason ? 'is-locked' : 'is-ready')

/** Why a wish cannot be re-rolled, or ''. */
export const rerollReason = (offline: string, blocked: string | null): string => offline || blocked || ''

/** The line under the wishes: the reason none can be re-rolled, or how many are left. */
export const rerollLine = (reason: string, rerolls: { left: number; max: number }): string => reason || `Re-rolls left today: ${rerolls.left} of ${rerolls.max}`

/** '₦300 of ₦1,000' or '2 of 3'; '' for a wish with nothing to count. */
export function wishProgress(wish: Pick<WishCard, 'target' | 'progress' | 'money'>, money: (value: number) => string): string {
  if (wish.target <= 1) return ''
  return wish.money ? `${money(wish.progress)} of ${money(wish.target)}` : `${wish.progress} of ${wish.target}`
}

export interface LoanLine { label: string; left: number; weekly: number | null }
/** The loan card on the Goals tab: only while something is owed. The loan belongs to the economy; the card sends the player to the Bank. */
export function loanLine(loan: EconomyView['loan'] | undefined): LoanLine | null {
  if (!loan || typeof loan !== 'object') return null
  const raw = loan as unknown as Record<string, unknown>
  const left = Number(raw.left ?? raw.balance ?? raw.owed), weekly = Number(raw.weekly ?? raw.payment)
  if (!Number.isFinite(left) || left <= 0) return null
  return { label: typeof raw.label === 'string' && raw.label ? raw.label : 'Loan', left, weekly: Number.isFinite(weekly) && weekly > 0 ? weekly : null }
}
