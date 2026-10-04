// What the venue panel shows for one activity, worked out from its card. Pure, so it is tested
// without a browser.
import type { LifeState, NeedId } from '../../../types/life.ts'
import type { ActivityCard } from '../../../types/view.ts'
import { cap, money } from '../../ui/format.ts'

export interface EffectTag { text: string; cost?: boolean; beta?: boolean }
/** What an activity gives and takes: need changes, need gains per second, XP, and the beta mark. */
export function effectTags(card: Pick<ActivityCard, 'effects' | 'effectsPerSecond' | 'xp' | 'beta'>): EffectTag[] {
  const tags: EffectTag[] = []
  for (const [need, amount] of Object.entries(card.effects ?? {})) {
    if (!amount) continue
    tags.push(amount > 0 ? { text: `+${amount} ${cap(need)}` } : { text: `−${-amount} ${cap(need)}`, cost: true })
  }
  for (const [need, rate] of Object.entries(card.effectsPerSecond ?? {})) if (rate && rate > 0) tags.push({ text: `+${rate} ${cap(need)}/s` })
  for (const [skill, amount] of Object.entries(card.xp ?? {})) tags.push({ text: `+${amount} ${cap(skill)} XP` })
  if (card.beta) tags.push({ text: 'Beta', beta: true })
  return tags
}

export interface ActivityFace {
  price: string
  priceTone: 'earn' | 'cost' | 'free'
  /** The one reason it cannot be started, as shown on the card ('' when it can). */
  why: string
  /** The full sentence for the tooltip and the screen-reader label. */
  full: string
  disabled: boolean
  state: 'ready' | 'unavailable' | 'blocked' | 'busy'
  label: string
}
/**
 * One activity card: time and price, then either what it gives or — when it cannot be started —
 * the one reason why. The card shows the short line; `full` carries the server's sentence.
 */
export function activityFace(card: ActivityCard, state: Pick<LifeState, 'activeAction' | 'needs'>, connected: boolean): ActivityFace {
  const blocked = card.blocked
  const unavailable = blocked?.code === 'unavailable'
  const busy = Boolean(state.activeAction), offline = !connected
  const price = card.reward > 0 ? `+${money(card.reward)}` : card.cost > 0 ? money(card.cost) : 'Free'
  const unmet = Object.entries(card.minimumNeeds ?? {}).filter(([need, minimum]) => state.needs[need as NeedId] < (minimum ?? 0))
    .map(([need, minimum]) => `${cap(need)} ${Math.floor(state.needs[need as NeedId])}/${minimum}`)
  const why = unavailable ? (card.requiresSkill ? `Needs ${cap(card.requiresSkill.id)} level ${card.requiresSkill.level}` : 'Unavailable in this preview')
    : unmet.length ? `Needs ${unmet.join(', ')}` : blocked?.code === 'gig_limit' ? 'Today’s gigs are done · back at midnight' : blocked ? blocked.reason : offline ? 'Not connected — cannot start now' : ''
  const busyWhy = !why && busy ? 'Finish or cancel what you are doing first' : ''
  const full = blocked?.code === 'gig_limit' ? blocked.reason : why || busyWhy
  return {
    price, priceTone: card.reward > 0 ? 'earn' : card.cost > 0 ? 'cost' : 'free', why, full,
    disabled: Boolean(blocked) || busy || offline,
    state: unavailable ? 'unavailable' : why ? 'blocked' : busy ? 'busy' : 'ready',
    label: `${card.label}, ${card.duration} seconds, ${price}${full ? `. ${full}` : ''}`,
  }
}

/** Is this timed action a trip (it takes the player out of the venue)? */
export const isTrip = (active: { kind: string } | null | undefined): boolean => active?.kind === 'travel' || active?.kind === 'commute'
