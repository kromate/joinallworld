// What the comeback e-mail controls say and decide, as pure functions (docs/COMEBACK-MAIL.md): the switches in Stay in
// touch and the "Nudge to come back" control on a friend's card. Rules live on the server; this only describes them.
import { PREF_KEYS, PREF_LABELS } from '../../../game/comeback-prefs.ts'
import type { PrefKey } from '../../../game/comeback-prefs.ts'
import type { ComebackView } from '../../../types/growth.ts'

const DAY = 86400000
export const NUDGE_AWAY_DAYS = 2, NUDGE_AGAIN_DAYS = 7
/** The sentence the server answers with, whether or not the friend has an address. */
export const NUDGE_SENTENCE = 'We’ll let them know if they’ve asked for e-mails.'

export const COMEBACK_HINTS: Readonly<Record<PrefKey, string>> = Object.freeze({
  needs: 'When your character is hungry, tired or lonely after you have been away.',
  friends: 'When a friend wrote to you, sent a gift, pinged you to join them, or asked for you to come back.',
  milestones: 'When something finished: a house upgrade, a shift, an election.',
  events: 'When something is on in your city tomorrow.',
  away: 'A note after 3 days, a week and four weeks away. The last is the last.',
  week: 'The Sunday summary of your week.',
})
export const comebackRows = (): { key: PrefKey; label: string; hint: string }[] => PREF_KEYS.map((key) => ({ key, label: PREF_LABELS[key], hint: COMEBACK_HINTS[key] }))

/** "Paused until Sat 10 Oct" or null. */
export function pausedWords(view: Pick<ComebackView, 'pausedUntil'>, now: number): string | null {
  if (view.pausedUntil <= now) return null
  const days = Math.max(1, Math.ceil((view.pausedUntil - now) / DAY))
  return `Paused for ${days} more day${days === 1 ? '' : 's'}.`
}

export interface NudgeControl { label: string; disabled: boolean; reason: string | null }
export interface NudgeInput {
  self: boolean
  friend: boolean
  blocked: boolean
  name: string
  /** 'online' | 'away' | 'offline' */
  status: string
  /** Server ms the friend was last heard from, when this server knows. */
  seenAt: number | undefined
  now: number
  /** When the player last nudged this friend (server ms), if within the week. */
  nudgedAt: number | null
  busy: boolean
}
/**
 * The control on a friend's card, or null when there should be none: not for yourself, a stranger, a blocked player, someone
 * online now, or a friend who was here less than two days ago (when that is known). It never says whether the friend has an
 * address: the only reason it is ever disabled is your own cooldown.
 */
export function nudgeControl(input: NudgeInput): NudgeControl | null {
  if (input.self || !input.friend || input.blocked || input.status === 'online') return null
  if (typeof input.seenAt === 'number' && input.now - input.seenAt < NUDGE_AWAY_DAYS * DAY) return null
  if (input.nudgedAt !== null && input.now - input.nudgedAt < NUDGE_AGAIN_DAYS * DAY) {
    const days = Math.max(1, Math.ceil((input.nudgedAt + NUDGE_AGAIN_DAYS * DAY - input.now) / DAY))
    return { label: 'Nudge to come back', disabled: true, reason: `You nudged ${input.name} recently. You can again in ${days} day${days === 1 ? '' : 's'}.` }
  }
  return { label: input.busy ? 'Nudging…' : 'Nudge to come back', disabled: input.busy, reason: null }
}
