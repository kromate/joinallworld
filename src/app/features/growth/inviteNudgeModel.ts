// When to invite, and what to say. The moments the game offers a player the invite link, and the
// rule that keeps it from nagging. Pure: the memory comes in and goes out as a value, so all of it
// is tested without a browser. The memory is kept on the device, like the settle-in nudge's
// (src/quick-start/model.ts nudgeMemory).
//
// THE RULES
//   once        each moment is offered at most once, ever.
//   cooldown    a prompt is never within COOLDOWN_MS of the one before it.
//   backoff     each dismissal pushes the next prompt further away (BACKOFF_MS); after MAX_DISMISSALS
//               the game stops prompting for good. The Invite button stays.
//   acted       a player who opened the share sheet from a prompt knows the way: no more prompts.
//   busy        never during an activity (a trip, a shift, a table game, a sheet open).
//   guest       never for a guest who has not pressed Play.
import { isRecord } from '../../../game/util.ts'

export type InviteMoment = 'first-goal' | 'home' | 'empty-venue' | 'table-win'
export const INVITE_MOMENTS: readonly InviteMoment[] = Object.freeze(['first-goal', 'home', 'empty-venue', 'table-win'])
const isMoment = (value: unknown): value is InviteMoment => typeof value === 'string' && (INVITE_MOMENTS as readonly string[]).includes(value)

export const INVITE_KEY = 'allworld-invite-nudge'
export const COOLDOWN_MS = 15 * 60000
/** The wait after the first, second and third dismissal. */
export const BACKOFF_MS: readonly [number, number, number] = Object.freeze([86400000, 3 * 86400000, 7 * 86400000] as [number, number, number])
export const MAX_DISMISSALS = 3
/** A prompt that is not answered leaves by itself after this long; that is not a dismissal. */
export const PROMPT_MS = 20000

export interface InviteMemory {
  /** The time each moment was offered. */
  shown: Partial<Record<InviteMoment, number>>
  dismissed: number
  /** The time of the last prompt, or null. */
  last: number | null
  /** No prompt before this time (set by a dismissal). */
  hushUntil: number
  acted: boolean
}
export const freshMemory = (): InviteMemory => ({ shown: {}, dismissed: 0, last: null, hushUntil: 0, acted: false })

const time = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)

/** Whatever was stored, as a memory: unknown fields are dropped and bad values become the defaults. */
export function inviteMemory(saved: unknown): InviteMemory {
  const kept: Record<string, unknown> = isRecord(saved) ? saved : {}
  const shown: Partial<Record<InviteMoment, number>> = {}
  const raw: Record<string, unknown> = isRecord(kept.shown) ? kept.shown : {}
  for (const key of Object.keys(raw)) { const at = time(raw[key]); if (isMoment(key) && at !== null) shown[key] = at }
  const dismissed = typeof kept.dismissed === 'number' && Number.isSafeInteger(kept.dismissed) && kept.dismissed > 0 ? Math.min(kept.dismissed, 99) : 0
  return { shown, dismissed, last: time(kept.last), hushUntil: time(kept.hushUntil) ?? 0, acted: kept.acted === true }
}

export type InviteWhy = 'ok' | 'once' | 'acted' | 'silenced' | 'hushed' | 'cooldown' | 'busy' | 'guest'
export interface InviteDecision { show: boolean; which: InviteMoment | null; why: InviteWhy }

export interface InviteInput {
  moment: InviteMoment
  memory: InviteMemory
  now: number
  /** An activity is running: a trip, a shift, a table game, or a sheet is open. */
  activity: boolean
  /** A guest who has not pressed Play (or no life yet). */
  guestNotPlaying: boolean
}
/** Should this moment prompt now? */
export function decideInvite({ moment, memory, now, activity, guestNotPlaying }: InviteInput): InviteDecision {
  const no = (why: InviteWhy): InviteDecision => ({ show: false, which: null, why })
  if (guestNotPlaying) return no('guest')
  if (memory.acted) return no('acted')
  if (memory.dismissed >= MAX_DISMISSALS) return no('silenced')
  if (memory.shown[moment] !== undefined) return no('once')
  if (activity) return no('busy')
  if (now < memory.hushUntil) return no('hushed')
  if (memory.last !== null && now - memory.last < COOLDOWN_MS) return no('cooldown')
  return { show: true, which: moment, why: 'ok' }
}

/** The memory after a prompt was shown. */
export const promptShown = (memory: InviteMemory, moment: InviteMoment, now: number): InviteMemory => ({ ...memory, shown: { ...memory.shown, [moment]: now }, last: now })
/** The memory after the player dismissed a prompt: the next one waits longer each time. */
export function promptDismissed(memory: InviteMemory, now: number): InviteMemory {
  const dismissed = memory.dismissed + 1
  const wait = BACKOFF_MS[Math.min(dismissed, BACKOFF_MS.length) - 1] ?? 0
  return { ...memory, dismissed, hushUntil: now + wait }
}
/** The memory after the player took the prompt up. */
export const promptActed = (memory: InviteMemory): InviteMemory => ({ ...memory, acted: true })

export interface InviteWords { title: string; text: string; action: string }
const WORDS: Readonly<Record<InviteMoment, InviteWords>> = Object.freeze({
  'first-goal': { title: 'Playing is better with friends', text: 'Bring one: send them your link.', action: 'Invite a friend' },
  'home': { title: 'Show a friend your house', text: 'Send your link and they can come and knock.', action: 'Invite a friend' },
  'empty-venue': { title: 'Nobody here yet', text: 'Invite someone to join you.', action: 'Invite someone' },
  'table-win': { title: 'Nice win', text: 'Send your link and play a friend next.', action: 'Invite a friend' },
})
export const inviteWords = (moment: InviteMoment): InviteWords => WORDS[moment]

/** How long a room must have held only the player before "Nobody here yet" is said. */
export const EMPTY_ROOM_MS = 45000
