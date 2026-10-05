// The lines of the invite sheet. Fetched with it: the first download needs only the share surfaces in inviteModel.ts.
import type { ReferralView } from '../../../types/growth.ts'

export type InviteRules = Pick<ReferralView['rules'], 'welcome' | 'reward' | 'stars' | 'perWeek' | 'lifetime' | 'workDays' | 'linkWithinDays'>
/** What the inviter gets, with its condition. */
export const inviterRewardLine = (rules: InviteRules, money: (value: number) => string): string =>
  `When a friend you invite has been paid for work on ${rules.workDays} different days, you get ${money(rules.reward)} and ${rules.stars} stars in the game.`
/** The limits that go with it. */
export const inviterLimitLine = (rules: InviteRules): string =>
  `At most ${rules.perWeek} rewards a week and ${rules.lifetime} for life. Nothing is paid for sharing the link, or for a friend who never plays.`
/** What the friend gets. */
export const friendGetsLine = (rules: InviteRules, money: (value: number) => string): string =>
  `They get ${money(rules.welcome)} in the game after their first paid day. The link counts in the first ${rules.linkWithinDays} days of their life.`
/** "1 friend joined", "3 friends joined · 1 counted", or the plain wait. */
export function progressLine(referral: Pick<ReferralView, 'invited' | 'counted'> | null | undefined): string {
  if (!referral) return ''
  const joined = referral.invited.length
  if (!joined) return 'No friends have joined yet'
  return `${joined} friend${joined === 1 ? '' : 's'} joined${referral.counted ? ` · ${referral.counted} counted` : ''}`
}
/** Where one friend who joined has got to: joined, had a first paid day, or counted. */
export const joinedState = (friend: Pick<ReferralView['invited'][number], 'state' | 'welcomed'>): string => (friend.state === 'counted' ? 'Counted' : friend.welcomed ? 'First paid day' : 'Joined')
/** Share kinds the sheet treats as an invitation (it shows the reward, progress, channels and code for these). */
export const isInviteSheet = (kind: string | undefined): boolean => kind === 'invite' || kind === 'house' || kind === 'table'
