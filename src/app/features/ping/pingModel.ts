// Ping without a DOM: what the button says and why it is off, the words of each notice, and the text a player shares by
// their own hand. Pure, so node --test reaches it. The rules are the server's (server/social/ping.ts); this describes them.
import { waitWords } from '../../../game/ping.ts'
import type { PlayerRef } from '../../../types/protocol.ts'
import type { PingControl, PingNotice } from '../../../types/ping.ts'

/** The line under the button. */
export const PING_HINT = 'Tell them you are here. If they come, they land right where you are.'

/** Ping takes the place of Call for a friend who is not in the game (or is connected but nowhere): a call could not ring. */
export const pingInstead = (status: string | undefined | null): boolean => status === 'offline' || status === 'away'

export interface PingButtonInput {
  connected: boolean
  self: boolean
  friend: boolean
  /** The reader blocked them. */
  blocked: boolean
  name: string
  /** What the server said about this player, once it has answered. */
  control: PingControl | null
  busy: boolean
  /** Server time, for "you can ping again in …". */
  now: number
  compact?: boolean
}
export interface PingButtonView { label: string; disabled: boolean; reason: string | null; /** The reason is only a wait after the player's own ping: said calmly, not as something wrong. */ waiting?: true }
/** The Ping button for one player. Every reason it is off is said in words; none of them is about how the friend can be reached. */
export function pingButton(input: PingButtonInput): PingButtonView {
  const label = input.busy ? 'Pinging…' : input.compact ? 'Ping' : `Ping ${input.name}`
  const off = (reason: string): PingButtonView => ({ label: input.compact ? 'Ping' : `Ping ${input.name}`, disabled: true, reason })
  if (input.self) return off('This is you.')
  if (!input.connected) return off('Not connected.')
  if (input.blocked) return off('Unblock this player to ping them.')
  if (!input.friend) return off(`Add ${input.name} as a friend to ping them.`)
  const control = input.control
  if (control && !control.can) {
    if (control.code === 'cooldown' && control.again !== null) return control.again > input.now ? { ...off(`You pinged ${input.name}. You can ping again ${waitWords(control.again - input.now)}.`), waiting: true } : { label, disabled: input.busy, reason: null }
    return off(control.reason ?? 'You cannot ping them right now.')
  }
  return { label, disabled: input.busy, reason: null }
}

/** What a player sends a friend by their own hand (the share sheet, WhatsApp): their own words, with the join link after them. */
export const shareWords = (name: string, place: string | null): string => `${name}, I am in Allworld right now${place ? `, ${place}` : ''}. Come and join me. You land right where I am:`
/** WhatsApp's own share address: it opens the player's WhatsApp with the message written, for them to choose a chat and send. Nothing is sent by the game. */
export const whatsappUrl = (text: string, url: string): string => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`

/** What a notice offers. */
export type PingAction = 'join' | 'call' | 'chat' | 'knock'
/** One notice on screen. */
export type PingBanner =
  | { kind: 'incoming'; notice: PingNotice; busy: boolean; error: string | null }
  | { kind: 'joined'; from: PlayerRef; words: string; knock: boolean; present: boolean }
  | { kind: 'came'; by: PlayerRef; place: string; present: boolean }
  | { kind: 'left'; from: PlayerRef | null; words: string }
  | { kind: 'other' }
export interface PingBannerView { tone: 'good' | 'info'; title: string; text: string; actions: PingAction[]; who: PlayerRef | null; busy: boolean }

export function bannerView(banner: PingBanner): PingBannerView {
  switch (banner.kind) {
    case 'incoming': {
      const { notice } = banner, name = notice.from.name
      const title = notice.invite ? `${name} joined through your link` : `${name} is ${notice.place.label}`
      const text = banner.error ?? (banner.busy ? `Taking you to ${name}…` : notice.invite ? `They are ${notice.place.label} right now. Join them and you land right there.` : 'They pinged you to come. Join them and you land right there.')
      return { tone: banner.error ? 'info' : 'good', title, text, actions: ['join', 'call', 'chat'], who: notice.from, busy: banner.busy }
    }
    case 'joined': return { tone: 'good', title: banner.words, text: banner.knock ? 'They can let you in from their door.' : banner.present ? 'Say hello: chat, or call them.' : 'Say hello in a message.', actions: banner.knock ? ['knock', 'chat'] : banner.present ? ['chat', 'call'] : ['chat'], who: banner.from, busy: false }
    case 'came': return { tone: 'good', title: `${banner.by.name} joined you ${banner.place}`, text: banner.present ? 'Say hello: chat, or call them.' : 'Say hello in a message.', actions: banner.present ? ['chat', 'call'] : ['chat'], who: banner.by, busy: false }
    case 'left': return { tone: 'info', title: banner.words, text: banner.from ? 'Nothing was changed: you are where you were.' : 'You are where you were.', actions: banner.from ? ['chat'] : [], who: banner.from, busy: false }
    default: return { tone: 'info', title: 'That invitation was for another player', text: 'Nothing was changed. Log in as the player it was sent to, and open the link again.', actions: [], who: null, busy: false }
  }
}
/** A key for "this notice was closed": the same ping is not shown again, a later one is. */
export const noticeKey = (notice: PingNotice): string => `${notice.from.id}:${notice.at}`
