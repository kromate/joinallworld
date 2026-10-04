/**
 * OWNER: growth
 * Numbers for the growth features that pay or count: table-game wins and referrals.
 * Plain data only. Every figure is an original design and is played through the balance
 * simulation (scripts/economy-sim.ts, strategy "social") before it ships.
 */

/** Table games (src/tables/**). There are NO stakes: a win is paid by the game, never by the loser. */
import type { ReferralRules, TableRewards } from '../../types/content.ts'

export const TABLE_REWARDS: Readonly<TableRewards> = Object.freeze({
  /** Naira for a counted win against at least one real player. A loss, a draw or a bot game pays nothing. */
  win: 150,
  /** Paid wins per Lagos day, per life. */
  paidWinsPerDay: 4,
  /** Finished games against bots that count toward missions per Lagos day (they never pay). */
  botCreditsPerDay: 1,
  /** The same two players' games count (pay, rating, missions) this many times a Lagos day; more are for fun. */
  pairGamesPerDay: 3,
});

/** Referral: both sides are rewarded only after the newcomer has really played. */
export const REFERRAL: Readonly<ReferralRules> = Object.freeze({
  /** To the newcomer, once they have been paid for work on `welcomeWorkDays` Lagos day(s). */
  welcome: 1000, welcomeWorkDays: 1,
  /** To the inviter, once the newcomer has been paid for work on `countWorkDays` different Lagos days. */
  reward: 1500, rewardStars: 2, countWorkDays: 2,
  /** Paid referrals per inviter: per Lagos week and for life. Beyond these a referral still counts for titles. */
  paidPerWeek: 5, paidLifetime: 20,
  /** A link can only be attached to a life this young (Lagos days since it began). */
  linkWithinDays: 3,
  /** Links one network address may attach to one inviter in seven days (hostels and carriers share addresses). */
  perAddressPerWeek: 3,
  titles: [{ id: 'connector', count: 3, label: 'Connector' }, { id: 'area-mayor', count: 10, label: 'Area Mayor' }, { id: 'big-name', count: 25, label: 'Lagos Big Name' }],
});
