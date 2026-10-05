// What Stay in touch says and decides. The Phone app where a player decides whether the game may
// reach them outside the game, and reads exactly what it would say. Pure, so it is tested without
// a browser. Rules: server/growth/outreach.ts and src/game/outreach.ts; the words: src/game/digest.ts.
import type { ConsentView, OutreachMine } from '../../../types/growth.ts'
import type { PushKind } from './boundary.ts'

export type AgeCard = 'ask' | 'minor' | 'none'
/** The age question comes first; under 18, no outside message is offered at all. */
export const ageCard = (consent: ConsentView | null): AgeCard => (!consent ? 'ask' : consent.age === 'minor' ? 'minor' : 'none')
/** Channels (notifications, e-mail) are offered only to a player who said they are 18 or older. */
export const showsChannels = (consent: ConsentView | null): boolean => consent?.age === 'adult'

export type PushCard = 'on' | 'needs-install' | 'unsupported' | 'blocked' | 'intro' | 'ask'
/** Which notification card to draw: on, why it cannot be, the introduction, or the explicit question. */
export function pushCard(consent: ConsentView | null, kind: PushKind | null, asking: boolean): PushCard {
  if (consent?.push === true) return 'on'
  if (kind === 'needs-install') return 'needs-install'
  if (kind === 'unsupported') return 'unsupported'
  if (kind === 'blocked') return 'blocked'
  return asking ? 'ask' : 'intro'
}
export function devicesLine(devices: number): string {
  return `${devices} phone${devices === 1 ? '' : 's'} or browser${devices === 1 ? '' : 's'}. At most one a day and three a week, never between 10 pm and 7 am.`
}

export type EmailCard = 'on' | 'confirm' | 'form'
export const emailCard = (mine: OutreachMine['email'] | undefined): EmailCard => (mine?.confirmed ? 'on' : mine ? 'confirm' : 'form')

/** Why "Send the confirmation" cannot be pressed, or null. */
export function emailReason(input: { busy: boolean; tick: boolean; email: string }): string | null {
  if (input.busy) return null
  if (!input.email) return 'Enter your e-mail address first.'
  if (!input.tick) return 'Tick the box to agree first.'
  return null
}
export const emailDisabled = (input: { busy: boolean; tick: boolean; email: string }): boolean => input.busy || !input.tick || !input.email

/** What the toast says when notifications could not be switched on. */
export function pushDeclinedWords(code: string): string {
  return code === 'blocked' ? 'This browser has notifications blocked for the game. Allow them in the browser’s site settings to switch this on.'
    : code === 'declined' ? 'No problem. Nothing was switched on.'
      : 'Notifications could not be switched on in this browser.'
}
export const COMEBACK_SENTENCE = 'We’ll send you a few e-mails a week at most about your character, and a note when a friend pings you to join them. Change this any time.'
/** Said where an account is made, and again where the character's e-mails are switched. */
export const COMEBACK_ACCOUNT_SENTENCE = 'You can turn this off any time.'
export const emailSavedWords = (dryRun: boolean): string => (dryRun ? 'Address saved. E-mail is not switched on for this server yet, so nothing was sent.' : 'Check your inbox and press the button in the e-mail to confirm.')

export const WEEKLY_RULES: readonly string[] = ['E-mail: at most one a day and three a week, never between 9 pm and 8 am Nigerian time, and none within 12 hours of a visit. Notifications: at most one a day and three a week, never between 10 pm and 7 am.', 'A message says what happened and what you could do. It never says you lost something by being away.',
  'If e-mails do not bring you back they slow down (one every 14 days after three) and stop for good after a last note.', 'Switching a channel off deletes what was stored for it: your address, or this phone’s subscription.', 'Your address is shown to nobody, and never appears in a share, a profile or a list.']
