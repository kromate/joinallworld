// Paying to arrive now, without a DOM: what the Skip button says and whether it can be pressed. Everything comes from
// view.travel.skip (src/game/trip-skip.ts): the price as the trip stands, whether this one is free, why it is off.
import type { TripSkipOffer } from '../../../types/view.ts'
import { money } from '../../ui/format.ts'

export interface SkipButton {
  /** On the button: "Skip the trip · ₦1,300". */
  label: string
  /** For a screen reader: the same, said in full. */
  aria: string
  disabled: boolean
  /** The line under the button: what a skip does (until the character has skipped once), or why the button is off. */
  note: string
  /** The price is large: the first press asks, the second pays. */
  confirm: boolean
  /** The price to send as the quote. */
  fee: number
}

/** What a skip does, said once: until the character has skipped a trip between cities. */
export const SKIP_EXPLAINED = 'Arrive now. The rest of the journey is skipped.'

/**
 * The button for the trip in progress, or null when nothing is offered.
 * `known` is true once the character has skipped before (state.travel.skipped): the explanation is then left out.
 */
export function skipButton(offer: TripSkipOffer | null | undefined, { known, pending, connected }: { known: boolean; pending: boolean; connected: boolean }): SkipButton | null {
  if (!offer) return null
  const price = offer.free ? 'Free' : money(offer.fee)
  const base = { confirm: offer.confirm && !offer.free, fee: offer.fee }
  if (pending) return { ...base, label: 'Arriving…', aria: 'Skipping the rest of the trip', disabled: true, note: '' }
  if (offer.blocked?.code === 'almost_there') return { ...base, label: 'Arriving in a moment', aria: 'You arrive in a moment. Waiting is free.', disabled: true, note: '' }
  if (offer.blocked) {
    return { ...base, label: `Skip the trip · ${price}`, aria: `Skip the trip for ${price}. ${offer.blocked.reason}.`, disabled: true, note: `${offer.blocked.reason}. The price falls as you get closer.` }
  }
  if (!connected) return { ...base, label: `Skip the trip · ${price}`, aria: `Skip the trip for ${price}. Not connected.`, disabled: true, note: 'Reconnect to skip the trip.' }
  const note = offer.free ? `${SKIP_EXPLAINED} Your first skip between cities is free.` : known ? '' : SKIP_EXPLAINED
  return { ...base, label: `Skip the trip · ${price}`, aria: offer.free ? 'Skip the trip and arrive now. This one is free.' : `Skip the trip and arrive now for ${money(offer.fee)}`, disabled: false, note }
}
