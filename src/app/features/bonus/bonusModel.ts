// The launch bonus as the page says it: the offer's words, when the guest chip may show, and what the moment of being paid says.
// Pure: the offer, the storage and the clock are passed in. The rules and the money are the server's (server/bonus/service.ts); in-game naira only.
import type { BonusClaimResponse, BonusOfferResponse } from '../../../types/account.ts'

export type Offer = Pick<BonusOfferResponse, 'on' | 'amount' | 'places' | 'left'>
export const naira = (value: number): string => `₦${Math.round(value).toLocaleString('en-NG')}`
const count = (value: number): string => Math.round(value).toLocaleString('en-NG')

/** Is it worth saying anything: the offer is open and has places left. */
export const open = (offer: Offer | null | undefined): offer is Offer => Boolean(offer && offer.on && offer.left > 0 && offer.amount > 0)

/** The landing screen's and the sign-up sheet's line. Honest: the first N to sign up, in-game naira, and only the true "N left". */
export function offerLine(offer: Offer | null | undefined): string | null {
  if (!open(offer)) return null
  return `Launch bonus: the first ${count(offer.places)} players to sign up get ${naira(offer.amount)} in the game. ${count(offer.left)} left.`
}
/** The guest's chip beside the sign-up button. */
export function chipText(offer: Offer | null | undefined): string | null {
  if (!open(offer)) return null
  return `Sign up to claim ${naira(offer.amount)} in the game · ${count(offer.left)} left`
}

export const CHIP_KEY = 'joinallworld-bonus-chip'
/** A dismissed chip comes back at most once a day. */
export const CHIP_AGAIN_MS = 24 * 3600 * 1000
type Reader = Pick<Storage, 'getItem'> | null | undefined
type Writer = Pick<Storage, 'setItem'> | null | undefined
export function chipHiddenUntil(storage: Reader): number {
  try { const value = Number(storage?.getItem(CHIP_KEY)); return Number.isFinite(value) ? value : 0 } catch { return 0 }
}
export function dismissChip(storage: Writer, now: number): number {
  const until = now + CHIP_AGAIN_MS
  try { storage?.setItem(CHIP_KEY, String(until)) } catch { /* hidden for this visit only: the caller holds it in memory too */ }
  return until
}
export interface ChipFacts { offer: Offer | null | undefined; /** The guest bar's conditions: a guest on a server with accounts, connected, nothing in front. */ eligible: boolean; hiddenUntil: number; now: number }
export const chipDue = (f: ChipFacts): boolean => f.eligible && open(f.offer) && f.now >= f.hiddenUntil

/** The toast of the moment: brief, and it says which place it was. */
export const momentToast = (answer: Pick<BonusClaimResponse, 'amount' | 'n' | 'places'>): string => `${naira(answer.amount)} launch bonus — you are player #${count(answer.n)} of the first ${count(answer.places)}`
/** What the companion says: one line, with what to do next. */
export const companionLine = (name: string, amount: number): string => `${name ? `${name}, ` : ''}${naira(amount)} just landed in your wallet. A home of your own, a stall, or a trip to another city are all good first moves. Where to?`
/** Why the money is not in the wallet yet, for the one line under the offer when it is held. */
export function heldLine(held: BonusClaimResponse['held']): string {
  return held === 'address' ? 'Your bonus is reserved and will arrive within a day.' : 'Your bonus is reserved. It arrives as soon as your character has started.'
}
