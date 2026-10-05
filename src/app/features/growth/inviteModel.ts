// What the invite share sheet says about the link and about what the inviter gets, worked out from
// the referral rules the server reports (server/growth/referral.ts; numbers: src/game/content/growth.ts).
// Pure, so it is tested without a browser. Rewards are in-game only, and each condition is stated.
import type { ReferralView } from '../../../types/growth.ts'

export type InviteRules = Pick<ReferralView['rules'], 'welcome' | 'reward' | 'stars' | 'perWeek' | 'lifetime' | 'workDays' | 'linkWithinDays'>

/** The surfaces a share sheet is opened from (telemetry: share_opened). */
export type ShareSurface = 'hud' | 'prompt' | 'phone' | 'table' | 'other'
export const SHARE_SURFACES: readonly ShareSurface[] = Object.freeze(['hud', 'prompt', 'phone', 'table', 'other'])
/** The channels the sheet offers (telemetry: share_channel). */
export type ShareChannel = 'copy' | 'native' | 'whatsapp' | 'x' | 'telegram' | 'qr'

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

/** The surface a share was opened from, or 'other'. */
export const surfaceOf = (value: unknown): ShareSurface => SHARE_SURFACES.find((surface) => surface === value) ?? 'other'

/** Share kinds the sheet treats as an invitation (it shows the reward, progress, channels and code for these). */
export const isInviteSheet = (kind: string | undefined): boolean => kind === 'invite' || kind === 'house' || kind === 'table'
