// The person card without a DOM: why each control on it is off, in the card's own words. Every
// disabled control says why. Pure, so node --test reaches it.
import type { NpcSummary, SocialView } from '../../../types/view.ts'
import type { PersonCard } from '../../../types/social.ts'
import { money } from '../../ui/format.ts'

export type PlayerView = Pick<SocialView, 'dailyInteractions' | 'bae' | 'baeUnlock' | 'transfer'>

/** Why a person's interactions cannot start, or null. `base` is the NPC's content, `here` the regular at this venue. */
export function npcReason(input: { connected: boolean; cannot: string; here: Pick<NpcSummary, 'blocked'> | null; name: string; venueLabel: string; busy: boolean }): string | null {
  return !input.connected ? input.cannot
    : !input.here ? `${input.name} is at ${input.venueLabel}. Go there to interact.`
      : input.here.blocked ? input.here.blocked
        : input.busy ? 'Finish or cancel your current action first.' : null
}
/** Why one NPC action is off: the general reason first, else the price. */
export function npcActionReason(general: string | null, cost: number, cash: number): string | null {
  return general ?? (cost > cash ? `You need ${money(cost)} (you have ${money(cash)}).` : null)
}
/** The meter's top: the next tier, else the top of the scale; a stranger's is the first tier (5). */
export const npcMeterMax = (rel: { next: { min: number } | null } | undefined, maxCloseness: number): number => (rel?.next ? rel.next.min : rel ? maxCloseness : 5)

/** Why the interactions with a player are off, or null. */
export function interactReason(input: { card: Pick<PersonCard, 'blocked' | 'name'>; together: boolean; left: number; daily: number; busy: boolean }): string | null {
  const { card } = input
  return card.blocked ? 'You blocked this player.'
    : !input.together ? `${card.name} is not in this venue with you right now.`
      : !input.left ? `You have used today’s ${input.daily} interactions with ${card.name}.`
        : input.busy ? 'Working…' : null
}
/** Why "Ask to be my Bae" is off, or null. */
export function baeReason(input: { card: Pick<PersonCard, 'bae' | 'friend' | 'baeAsked'>; social: Pick<PlayerView, 'bae' | 'baeUnlock'>; meBae: boolean; points: number }): string | null {
  const { card, social } = input
  return card.bae ? null
    : social.bae || input.meBae ? 'You already have a Bae.'
      : !card.friend ? 'Become friends first.'
        : input.points < social.baeUnlock ? `Opens when you are closer (${input.points}/${social.baeUnlock}).`
          : card.baeAsked ? 'Asked. Waiting for an answer.' : null
}
/** Why "Send money" is off, or null. */
export function moneyReason(card: Pick<PersonCard, 'friend'>, t: PlayerView['transfer'], cash: number): string | null {
  return !card.friend ? 'You can only send money to friends.'
    : t.free > 0 && sendNow(t, cash) >= t.min ? null
    : t.earned < t.minEarned ? `Earn ${money(t.minEarned)} from paid work first (earned so far: ${money(t.earned)}).`
      : !t.giftsLeftToday ? `You have sent ${t.dailyCount} gifts today.`
        : t.leftToday < t.min ? 'You have given away all you may for now. You can only give money you earned from work.' : null
}
/** The most one gift can be now. */
/** The most one gift can be now: the unrestricted part (an admin's credit, no gift rules) plus what the ordinary rules allow in one gift, within the cash held. */
export const sendNow = (t: Pick<PlayerView['transfer'], 'free' | 'earned' | 'minEarned' | 'giftsLeftToday' | 'maxPerTransfer' | 'leftToday' | 'min'>, cash: number): number => {
  const ordinary = t.earned >= t.minEarned && t.giftsLeftToday > 0 ? Math.min(t.maxPerTransfer, t.leftToday) : 0
  return Math.max(0, Math.min(cash, Math.min(t.free, cash) + (ordinary >= t.min ? ordinary : 0)))
}
export const moneyCeiling = sendNow
/** The line under the gift amount: what can be sent now, and how much of it has no gift limits (an admin's credit; what a friend receives is ordinary money). */
export const sendLine = (t: Parameters<typeof sendNow>[0] & Pick<PlayerView['transfer'], 'dailyCount'>, cash: number): string => t.free > 0
  ? `You can send up to ${money(sendNow(t, cash))} now · ${money(Math.min(t.free, cash))} of it has no gift limits. Beyond that, gifts are capped at ${money(t.maxPerTransfer)} each, ${t.dailyCount} a day, and never more than you have earned from work. What a friend receives is ordinary money. You have ${money(cash)}.`
  : `Gifts are capped: ${money(t.maxPerTransfer)} each, ${t.dailyCount} a day, and never more than you have earned from work. You have ${money(cash)}.`

/** The three buttons for the friendship, as the card shows them. */
export type FriendControl = 'none' | 'unfriend' | 'accept' | 'sent' | 'add'
export function friendControl(card: Pick<PersonCard, 'blocked' | 'friend' | 'incoming' | 'requested'>): FriendControl {
  return card.blocked ? 'none' : card.friend ? 'unfriend' : card.incoming ? 'accept' : card.requested ? 'sent' : 'add'
}
