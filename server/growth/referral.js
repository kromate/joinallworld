/**
 * OWNER: growth
 * Referral: who came through whose link, and paying both sides — only once the newcomer has
 * really played. Every share link is also a referral link. Runs inside a store transaction.
 *
 * THE RULES (numbers in src/game/content/growth.js)
 *   LINK      A life at most REFERRAL.linkWithinDays Lagos days old may be attached to the owner of
 *             a share code, once and for good. Refused: your own link; a second link; the link of
 *             someone you invited yourself; a life that
 *             is too old; the same device as the inviter or as a friend they already brought; and
 *             more than REFERRAL.perAddressPerWeek links to one inviter from one network address in
 *             seven days.
 *   WELCOME   The newcomer is paid REFERRAL.welcome once their life has been paid for work on
 *             REFERRAL.welcomeWorkDays Lagos day(s).
 *   COUNT     When the newcomer has been paid for work on REFERRAL.countWorkDays different Lagos
 *             days — the bar the election already sets for a vote — the referral counts, and the
 *             inviter is owed REFERRAL.reward. It is paid the next time the inviter is here,
 *             within REFERRAL.paidPerWeek a week and REFERRAL.paidLifetime for life (the life's
 *             own counters, src/game/systems/growth.js). Past the lifetime cap a friend still
 *             counts for titles.
 *
 * WHAT STOPS FARMING, and what does not
 *   - An unplayed account pays nobody: both gifts wait for paid work on real Lagos days.
 *   - Each gift is recorded (`welcomed`, the `owed` list) in the same transaction that credits the
 *     life, and the life itself refuses a second welcome and a reward past its caps, so a replayed
 *     or repeated request cannot pay twice.
 *   - The device token is something the browser sends: clearing site data makes a new one. It stops
 *     the casual case (start a new life on the same phone through your own link), not a determined
 *     one. The address rule is held in memory, per server process, and never stored. What bounds a
 *     determined farmer is the price: two real days of shifts per account for ₦1,500, twenty times.
 *   - Reward money cannot be passed on: gifts between players only move money earned from work.
 */
import { lagosTime } from '../../src/game/clock.ts';
import { REFERRAL } from '../../src/game/content/growth.ts';
import { isShareCode } from '../../src/game/share-model.ts';
import { keyed, LIMITS, playerOf } from './data.js';
import { findShare } from './share.js';
import { count } from './metrics.js';

const DEVICE = /^[A-Za-z0-9-]{16,64}$/;
const WEEK_MS = 7 * 86400000;
const no = (code, reason) => ({ ok: false, code, reason });
const ready = (state) => Boolean(state) && !(state.onboarding?.required === true && state.onboarding.done !== true);

export function referralService(ctx) {
  // Links per (inviter, address) in the last seven days. In memory only: an address is never stored.
  const recent = new Map();
  function addressCount(key, now, add) {
    const list = (recent.get(key) ?? []).filter((at) => now - at < WEEK_MS);
    if (add) list.push(now);
    if (list.length) recent.set(key, list); else recent.delete(key);
    if (recent.size > 20000) for (const [other, times] of recent) if (!times.some((at) => now - at < WEEK_MS)) recent.delete(other);
    return list.length;
  }

  /** Remember this browser's device token (as a salted hash) for the caller. */
  function noteDevice(g, player, device) {
    if (typeof device !== 'string' || !DEVICE.test(device)) return null;
    const hash = keyed(g, `device|${device}`);
    if (!player.devices.includes(hash)) { player.devices.push(hash); if (player.devices.length > LIMITS.devices) player.devices.shift(); }
    return hash;
  }

  /** Attach the caller's young life to the owner of a share code. */
  function link(g, session, state, body, ip) {
    const now = ctx.now(), id = session.publicId;
    if (!isShareCode(body?.code)) throw ctx.fail(400, 'invalid_share_code');
    if (typeof body.device !== 'string' || !DEVICE.test(body.device)) throw ctx.fail(400, 'device_required');
    const me = playerOf(g, id);
    if (!me) return no('server_full', 'Invites are not available right now. Try again later.');
    const refuse = (code, reason) => { count(g, now, `referral.refused.${code.replace(/_/g, '-')}`); return no(code, reason); };
    if (me.ref) return me.ref.code === body.code ? { ok: true, code: 'linked', duplicate: true } : refuse('already_linked', 'This life already came through a friend’s link. That cannot be changed.');
    const share = findShare(g, body.code, now);
    if (!share) return refuse('unknown_link', 'That invite link has expired or does not exist.');
    if (share.by === id) return refuse('own_link', 'That is your own link. Send it to a friend.');
    const inviter = playerOf(g, share.by, { create: false });
    if (!inviter) return refuse('unknown_link', 'That invite link has expired or does not exist.');
    if (inviter.ref?.by === id) return refuse('mutual_link', 'You invited this friend, so their link cannot count for you too.');
    if (ctx.checks?.blocked?.(id, share.by) === true) return refuse('unknown_link', 'That invite link has expired or does not exist.');
    const age = lagosTime(now).day - lagosTime(Number.isFinite(state.civic?.since) ? state.civic.since : now).day;
    if (age > REFERRAL.linkWithinDays) return refuse('too_late', `An invite link counts in the first ${REFERRAL.linkWithinDays} days of a life. You can still visit your friend.`);
    const device = noteDevice(g, me, body.device);
    if (inviter.devices.includes(device) || Object.values(inviter.invited).some((friend) => friend.device === device)) {
      return refuse('same_device', 'This phone has already been used with that link. An invite counts for a friend on their own phone.');
    }
    const address = `${share.by}|${keyed(g, `address|${ip}`)}`;
    if (addressCount(address, now, false) >= REFERRAL.perAddressPerWeek) {
      return refuse('address_limit', `Too many friends joined through that link from this network this week (${REFERRAL.perAddressPerWeek}). You can still play together; the invite just does not count.`);
    }
    if (Object.keys(inviter.invited).length >= LIMITS.invited) return refuse('inviter_full', 'Your friend’s invite list is full. You can still play together.');
    addressCount(address, now, true);
    me.ref = { by: share.by, code: body.code, at: now, welcomed: false, counted: false };
    inviter.invited[id] = { name: session.name, at: now, state: 'joined', device };
    share.joined = Math.min(Number.MAX_SAFE_INTEGER, (share.joined ?? 0) + 1);
    // One act, one counter: the share keeps its own `joined` number; the day's total is referral.linked.
    count(g, now, 'referral.linked');
    return { ok: true, code: 'linked', by: share.facts?.name ?? 'a friend' };
  }

  /**
   * Pay what is due now, for the caller as a newcomer and as an inviter. Returns true when a life
   * or another player's record changed (the caller's request must then be saved before it is answered).
   */
  function settle(g, session, state, cityId) {
    const now = ctx.now(), id = session.publicId, me = playerOf(g, id, { create: false });
    if (!me || !ready(state)) return false;
    let material = false;
    const worked = state.civic?.work?.days ?? 0;
    const act = (kind, name) => ctx.act(state, { type: 'growth.referral', cityId, payload: { kind, name },
      stateGuard: 'the referral record (welcomed flag, owed list) is written in this same transaction' });
    if (me.ref && !me.ref.welcomed && worked >= REFERRAL.welcomeWorkDays) {
      const inviter = playerOf(g, me.ref.by, { create: false });
      const result = act('welcome', inviter?.invited?.[id] ? (g.shares[me.ref.code]?.facts?.name ?? 'a friend') : 'a friend');
      if (result.ok || result.code === 'already_welcomed') { me.ref.welcomed = true; material = true; if (result.ok) count(g, now, 'referral.welcomed'); }
    }
    if (me.ref && !me.ref.counted && worked >= REFERRAL.countWorkDays) {
      me.ref.counted = true; material = true;
      const inviter = playerOf(g, me.ref.by, { create: false });
      if (inviter?.invited?.[id]) {
        inviter.invited[id].state = 'counted'; inviter.invited[id].name = session.name;
        inviter.counted = Math.min(Number.MAX_SAFE_INTEGER, inviter.counted + 1);
        if (inviter.owed.length < LIMITS.owed && !inviter.owed.includes(id)) inviter.owed.push(id);
        count(g, now, 'referral.counted');
      }
    }
    // As an inviter: collect what is owed, a few at a time, until a cap says stop.
    for (let paid = 0; me.owed.length && paid < 6; paid++) {
      const result = act('reward', me.invited[me.owed[0]]?.name ?? 'A friend');
      if (result.ok) { me.owed.shift(); material = true; count(g, now, 'referral.paid'); continue; }
      if (result.code === 'referral_lifetime_cap') { me.owed.length = 0; material = true; } // they still count for titles
      break; // the weekly cap or a full wallet: it stays owed
    }
    return material;
  }

  /** What the caller sees about their own referrals. Names only; never an id of a device or an address. */
  function view(g, id, growthView) {
    const me = playerOf(g, id, { create: false });
    const invited = Object.entries(me?.invited ?? {}).sort((a, b) => b[1].at - a[1].at).slice(0, 30).map(([friend, entry]) => ({ id: friend, name: entry.name, state: entry.state, at: entry.at }));
    const counted = me?.counted ?? 0;
    return {
      by: me?.ref ? { name: g.shares[me.ref.code]?.facts?.name ?? 'a friend', id: me.ref.by, welcomed: me.ref.welcomed, counted: me.ref.counted } : null,
      invited, counted, waiting: invited.filter((friend) => friend.state === 'joined').length, owed: me?.owed.length ?? 0,
      title: [...REFERRAL.titles].reverse().find((title) => counted >= title.count)?.label ?? null,
      nextTitle: REFERRAL.titles.find((title) => counted < title.count) ?? null,
      rules: { welcome: REFERRAL.welcome, reward: REFERRAL.reward, stars: REFERRAL.rewardStars, perWeek: REFERRAL.paidPerWeek, lifetime: REFERRAL.paidLifetime, workDays: REFERRAL.countWorkDays, linkWithinDays: REFERRAL.linkWithinDays },
      paid: growthView?.referral ?? null,
    };
  }

  return { link, settle, view, noteDevice };
}
