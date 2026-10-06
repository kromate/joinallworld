// The lines of the Invites screen. Fetched with it: the first download needs only the badge in referModel.ts.
import type { InvitedFriend, ReferralView } from '../../../types/growth.ts'

const STATE: Readonly<Record<string, string>> = { joined: 'Made a character · has not worked two days yet', counted: 'Playing · counted' }
export const friendState = (friend: Pick<InvitedFriend, 'state'>): string => STATE[friend.state] ?? friend.state
export const heroFigure = (counted: number): string => `${counted} friend${counted === 1 ? '' : 's'} playing because of you`
/** "Your title: Connector. 2 more for “Host”." */
export function heroNote(r: Pick<ReferralView, 'title' | 'nextTitle' | 'counted'>): string {
  return `${r.title ? `Your title: ${r.title}. ` : ''}${r.nextTitle ? `${r.nextTitle.count - r.counted} more for “${r.nextTitle.label}”.` : ''}`
}
/** What the screen shows before there is a referral view: the reason the hello failed, or the wait. */
export const waitingLine = (error: string | null): string => error ?? 'Loading your invites…'
export function byLine(by: NonNullable<ReferralView['by']>, rules: Pick<ReferralView['rules'], 'welcome' | 'workDays'>, money: (value: number) => string): string {
  return `${by.welcomed ? `Your ${money(rules.welcome)} welcome gift has been paid.` : `Finish a paid shift or gig and ${money(rules.welcome)} is yours.`} ${by.counted ? `${by.name} has been thanked.` : `Work on ${rules.workDays} different days and ${by.name} is rewarded too.`}`
}
export function paidLine(paid: NonNullable<ReferralView['paid']>, owed: number): string {
  return `Rewards paid: ${paid.paidThisWeek} of ${paid.perWeek} this week, ${paid.paidTotal} of ${paid.lifetime} for life.${owed ? ` ${owed} waiting for next week.` : ''} After that friends still count for your titles.`
}
export function referRules(rules: ReferralView['rules']): string[] {
  return [`A link counts in the first ${rules.linkWithinDays} days of your friend’s life, once, on their own phone.`, 'Nothing is paid for sharing itself, and nothing for an account that never plays.',
    `At most ${rules.perWeek} rewards a week and ${rules.lifetime} for life. Reward money cannot be gifted on.`, 'The game never messages your friends. You send the link yourself, to whoever you choose.']
}
