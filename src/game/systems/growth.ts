/**
 * OWNER: growth
 * The life's side of table games and referrals: what a finished table game pays and counts, and
 * the two referral gifts. The matches themselves and who referred whom are shared state on the
 * server (server/growth/**); this system only ever credits a life and keeps the per-life caps.
 *
 * STATE — state.growth
 *   tables    { day, paid, bots, played, won } — today's paid wins and bot credits; lifetime games and wins
 *   welcomed  boolean — this life has received its one referral welcome gift
 *   referrals { week, paid, total } — referral rewards paid this Lagos week and for life
 *
 * ACTIONS — both SERVER ONLY (registry.js): run by server/routes/growth.js through ctx.act inside
 * the store transaction that records the other half (a finished match, a referral), so a player
 * can never call one directly.
 *   'growth.table-result' { game, label, won, human, counted }
 *       One finished table game. Pays TABLE_REWARDS.win when won against a real player, counted
 *       (the pair cap is the server's) and under today's paid-win cap. Emits 'table.played' for
 *       missions — always against a real player, and for the first bot games of a day.
 *   'growth.referral' { kind: 'welcome' | 'reward', name }
 *       'welcome': REFERRAL.welcome to a referred newcomer, once per life.
 *       'reward':  REFERRAL.reward and stars to the inviter, within the weekly and lifetime caps.
 * EMITS  'table.played' { game, won, human, paid }   'stars.granted'   'notice.posted'
 */
import { emit } from '../registry.ts';
import { cleanText, fail, finite, isId, isRecord, naira, ok, safeCount } from '../util.ts';
import { lagosTime } from '../clock.ts';
import { canCredit, credit } from '../api.ts';
import { REFERRAL, TABLE_REWARDS } from '../content/growth.ts';

const nowOf = (state, ctx) => (finite(ctx?.now) && ctx.now > 0 ? ctx.now : state.t);
const serverOnly = (run, where) => ({ serverOnly: true, run, refusal: `This is completed by the server ${where}. Nothing was changed.` });

function today(state, ctx) {
  const day = lagosTime(nowOf(state, ctx)).day, tables = state.growth.tables;
  if (tables.day !== day) { tables.day = day; tables.paid = 0; tables.bots = 0; }
  return tables;
}

export function tableResult(state, payload, ctx) {
  const tables = today(state, ctx);
  const game = isId(payload?.game) ? payload.game : 'game', label = cleanText(payload?.label, 24, 'a table game');
  const won = payload?.won === true, human = payload?.human === true, counted = payload?.counted === true;
  tables.played = Math.min(Number.MAX_SAFE_INTEGER, tables.played + 1);
  if (won) tables.won = Math.min(Number.MAX_SAFE_INTEGER, tables.won + 1);
  let paid = 0;
  if (won && human && counted && tables.paid < TABLE_REWARDS.paidWinsPerDay && canCredit(state, TABLE_REWARDS.win)) {
    tables.paid += 1; paid = TABLE_REWARDS.win;
    credit(state, paid, `Table win: ${label}`, ctx);
  }
  // Missions count a game against a real player (when the pair has not played too often today) and the first bot games of a day.
  let credited = human && counted;
  if (!human && tables.bots < TABLE_REWARDS.botCreditsPerDay) { tables.bots += 1; credited = true; }
  if (credited) emit(state, 'table.played', { game, won, human, paid }, ctx);
  state.message = paid ? `You won at ${label}: +${naira(paid)}.` : won ? `You won at ${label}.` : `Game over at ${label}.`;
  return ok(state, paid ? 'paid' : credited ? 'counted' : 'for_fun');
}

export function referralGift(state, payload, ctx) {
  const book = state.growth, name = cleanText(payload?.name, 24, 'a friend');
  if (payload?.kind === 'welcome') {
    if (book.welcomed) return fail(state, 'already_welcomed', 'This life already had its welcome gift.');
    if (!canCredit(state, REFERRAL.welcome)) return fail(state, 'balance_limit', 'Your saved balance has reached its supported limit.');
    book.welcomed = true;
    credit(state, REFERRAL.welcome, 'Welcome gift (invited by a friend)', ctx);
    emit(state, 'notice.posted', { kind: 'referral', text: `Welcome gift: ${naira(REFERRAL.welcome)} for joining through ${name}’s link and getting to work.` }, ctx);
    return ok(state, 'welcomed');
  }
  if (payload?.kind === 'reward') {
    const week = lagosTime(nowOf(state, ctx)).week, refs = book.referrals;
    if (refs.week !== week) { refs.week = week; refs.paid = 0; }
    if (refs.total >= REFERRAL.paidLifetime) return fail(state, 'referral_lifetime_cap', `You have been rewarded for ${REFERRAL.paidLifetime} friends, the most that pays. More still count for your titles.`);
    if (refs.paid >= REFERRAL.paidPerWeek) return fail(state, 'referral_week_cap', `You have been rewarded for ${REFERRAL.paidPerWeek} friends this week. More still count for your titles.`);
    if (!canCredit(state, REFERRAL.reward)) return fail(state, 'balance_limit', 'Your saved balance has reached its supported limit.');
    refs.paid += 1; refs.total += 1;
    credit(state, REFERRAL.reward, 'Referral reward (a friend you invited is playing)', ctx);
    emit(state, 'stars.granted', { amount: REFERRAL.rewardStars, reason: 'Referral' }, ctx);
    emit(state, 'notice.posted', { kind: 'referral', text: `${name} is playing because of you: +${naira(REFERRAL.reward)} and ${REFERRAL.rewardStars} stars.` }, ctx);
    return ok(state, 'rewarded');
  }
  return fail(state, 'invalid_gift', 'Unknown referral step.');
}

export default {
  id: 'growth',
  stateKeys: ['growth'],
  sanitize(input, state) {
    const saved = isRecord(input.growth) ? input.growth : {}, tables = isRecord(saved.tables) ? saved.tables : {}, refs = isRecord(saved.referrals) ? saved.referrals : {};
    const count = (value, max = Number.MAX_SAFE_INTEGER) => (safeCount(value) && value <= max ? value : 0);
    state.growth = {
      tables: { day: count(tables.day), paid: count(tables.paid, TABLE_REWARDS.paidWinsPerDay), bots: count(tables.bots, TABLE_REWARDS.botCreditsPerDay), played: count(tables.played), won: count(tables.won) },
      welcomed: saved.welcomed === true,
      referrals: { week: count(refs.week), paid: count(refs.paid, REFERRAL.paidPerWeek), total: count(refs.total, REFERRAL.paidLifetime) },
    };
  },
  actions: {
    'growth.table-result': serverOnly(tableResult, 'when a table game ends'),
    'growth.referral': serverOnly(referralGift, 'when a referral counts'),
  },
  view(state, ctx) {
    const day = lagosTime(nowOf(state, ctx)).day, week = lagosTime(nowOf(state, ctx)).week, book = state.growth;
    const paid = book.tables.day === day ? book.tables.paid : 0;
    return {
      tables: { win: TABLE_REWARDS.win, paidToday: paid, paidLeft: TABLE_REWARDS.paidWinsPerDay - paid, perDay: TABLE_REWARDS.paidWinsPerDay, played: book.tables.played, won: book.tables.won },
      referral: { welcomed: book.welcomed, paidThisWeek: book.referrals.week === week ? book.referrals.paid : 0, paidTotal: book.referrals.total, perWeek: REFERRAL.paidPerWeek, lifetime: REFERRAL.paidLifetime,
        welcome: REFERRAL.welcome, reward: REFERRAL.reward, rewardStars: REFERRAL.rewardStars },
    };
  },
};
