// The "While you were away" card and the inbox chip: what they show and where they sit. Pure, so
// it is tested without a browser. The card's rule is src/game/digest.js awayCard; its lines are the
// fresh ones of the Phone's notification list, with the live events and the missions.
import type { LifeView } from '../../../types/view.ts'
import type { PhoneNotification } from '../../types/panel.ts'
import type { SocialOverview } from '../../../types/social.ts'
import type { AwayCard } from './rulesBoundary.ts'
import { awayCard, upcomingEvents } from './rulesBoundary.ts'
import type { HelloOk } from './growthModel.ts'

export interface AwayInput {
  connected: boolean
  cityId: string
  now: number
  onboarding?: { required?: boolean } | null
  missions?: LifeView['missions'] | null
}
/** The card to show now, or null: not connected, not settled in, no hello yet, already dismissed, or nothing waiting. */
export function awayCardFor(view: AwayInput, hello: HelloOk | null, dismissed: boolean, lines: readonly PhoneNotification[]): AwayCard | null {
  if (!view.connected || view.onboarding?.required || !hello || dismissed) return null
  return awayCard({ hoursAway: hello.away.hours, lines: lines.filter((line) => line.fresh), missions: view.missions, events: upcomingEvents(view.now, 1, view.cityId) })
}
/** The card is only asked for once a connected player has settled in: a guest in their first minutes has nothing to come back to. */
export const awayWanted = (view: { connected: boolean; onboarding?: { required?: boolean; guest?: boolean } | null }): boolean =>
  Boolean(view.connected) && view.onboarding?.required !== true && view.onboarding?.guest !== true

// ---- the inbox chip --------------------------------------------------------------------------
export type InboxChipView =
  | { kind: 'offline'; short: string }
  | { kind: 'knock'; name: string }
  | { kind: 'hidden' }
  | { kind: 'inbox'; active: boolean; hint: string }

/** A knock at the door cannot wait in the tray: it is an alert. */
export const inboxSlot = (connected: boolean, me: Pick<SocialOverview, 'house'> | null): 'alert' | 'hud' => (connected && me?.house.knocks?.length ? 'alert' : 'hud')

export function inboxChip(input: {
  connected: boolean
  onboardingRequired: boolean
  me: Pick<SocialOverview, 'house' | 'requests'> | null
  error: string | null
  unreadChats: number
  unreadUpdates: number
  freshNotices: number
  /** The connection's short words ("No internet"), or ''. */
  short: string
}): InboxChipView {
  if (!input.connected) return { kind: 'offline', short: input.short || 'Not connected' }
  const knocks = input.me?.house.knocks ?? []
  const first = knocks[0]
  if (first) return { kind: 'knock', name: first.from.name }
  const chats = input.unreadChats
  const updates = input.unreadUpdates + (input.me?.requests.in.length ?? 0) + input.freshNotices
  if (input.onboardingRequired) return { kind: 'hidden' }
  const hint = !input.me ? (input.error ? 'Could not load · tap to retry' : 'Loading…')
    : chats || updates ? [chats ? `${chats} unread` : '', updates ? `${updates} update${updates === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') : 'No new messages'
  return { kind: 'inbox', active: Boolean(chats || updates), hint }
}
