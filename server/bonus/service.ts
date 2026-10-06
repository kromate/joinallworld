/**
 * OWNER: accounts
 * THE LAUNCH BONUS: the first LAUNCH_BONUS_PLACES players to sign up (a Google or an e-mail account with a verified address) get
 * LAUNCH_BONUS_AMOUNT naira in the game, once per ACCOUNT, ever. In-game naira only: there is no real money in the game.
 *
 * WHO: an account, never a guest (guest sessions are free and unlimited, so a script could spend all the places in minutes).
 * A guest who signs up is paid at that moment; an account that already exists is paid the next time it opens the game;
 * a banned account gets nothing.
 *
 * ONE TRANSACTION (claim): account → not already claimed (the marker is on the ACCOUNT, so another device, another character or a
 * restored one can never pay twice) → counter below the places → counter + 1 → credit the account's current character through the
 * rules engine (`wallet.bonus`: its own ledger line, never counted as earned from work, never taken by the ride debt's share of
 * earnings) → marker written. The store serialises transactions on both hosts, so two devices at once, a replay, and the last place
 * racing the one after it resolve to exactly the right count.
 *
 * HELD, NOT LOST. The place is reserved the moment the account first asks (the counter goes up and the marker says which number it
 * is), so a player is never told "you got it" and then loses it. The money waits for either of two things and is paid by a later call:
 *   held 'character'  the account has no started character yet (signed up before finishing the creator): paid when it has one;
 *   held 'address'    LAUNCH_BONUS_PER_ADDRESS_DAY (default 20) claims were already paid from this network address (an IPv4 address or an
 *                     IPv6 /64) today: paid on a later call from an address under the cap. A campus or shared network is slowed, never locked out.
 *
 * STORED (additive; accounts without these load unchanged):
 *   account.bonus        { at, amount, n, held?, told? }   the marker (server/types.ts AccountRecord)
 *   launchBonus          { claimed }                       the global counter, a collection of its own (never inside `social`)
 *   launchBonusSeen      { ids: { [salted hash of the account id]: n } }   so an account deleted and made again does not claim twice
 *
 * SETTINGS (environment, each also a runtime setting of the admin screen except the address cap):
 *   LAUNCH_BONUS on|off (default on) · LAUNCH_BONUS_AMOUNT (default 1000000) · LAUNCH_BONUS_PLACES (default 10000) ·
 *   LAUNCH_BONUS_PER_ADDRESS_DAY (default 20). An operator reverses a bonus with the ordinary admin debit.
 * Disposable e-mail domains are not blocked in this version.
 */
import { characterCity } from '../character.ts';
import { addressBucket } from '../host-context.ts';
import { hash53 } from '../protocol.ts';
import { accountOfBinding } from '../accounts/service.ts';
import { registerAdminSetting } from '../admin/settings.ts';
import { registerAdminStat } from '../admin/tools.ts';
import { socialService } from '../social/service.ts';
import type { PushList } from '../social/service.ts';
import type { AccountRecord, Db, RouteContext, SessionRecord } from '../types.ts';

export const BONUS_DEFAULTS = Object.freeze({ amount: 1_000_000, places: 10_000, perAddressDay: 20 });
const DAY_MS = 86400000;

export interface BonusConfig { on: boolean; amount: number; places: number; perAddressDay: number }
const whole = (text: string, fallback: number, least: number, most: number): number => {
  const raw = text.trim();
  const value = /^\d{1,10}$/.test(raw) ? Number(raw) : NaN;
  return Number.isSafeInteger(value) && value >= least && value <= most ? value : fallback;
};
/** The settings in force: a runtime setting of the admin screen when one was changed, else the environment, else the default. */
export function bonusConfig(ctx: Pick<RouteContext, 'env' | 'checks'>): BonusConfig {
  const setting = (key: string): boolean | number | undefined => ctx.checks?.setting?.(key);
  const env = (name: string): string => (typeof ctx.env === 'function' ? ctx.env(name) : '');
  const on = setting('launchBonus'), amount = setting('launchBonusAmount'), places = setting('launchBonusPlaces');
  return {
    on: typeof on === 'boolean' ? on : env('LAUNCH_BONUS').trim().toLowerCase() !== 'off',
    amount: typeof amount === 'number' ? amount : whole(env('LAUNCH_BONUS_AMOUNT'), BONUS_DEFAULTS.amount, 1, 1_000_000_000),
    places: typeof places === 'number' ? places : whole(env('LAUNCH_BONUS_PLACES'), BONUS_DEFAULTS.places, 1, 10_000_000),
    perAddressDay: whole(env('LAUNCH_BONUS_PER_ADDRESS_DAY'), BONUS_DEFAULTS.perAddressDay, 1, 100_000),
  };
}

interface Counter { claimed: number }
const isCounter = (value: unknown): value is Counter => value !== null && typeof value === 'object' && typeof (value as Counter).claimed === 'number';
/** Places taken so far. Reads only: nothing is created. */
export function claimedOf(db: Db): number {
  const found: unknown = Object.hasOwn(db, 'launchBonus') ? db['launchBonus'] : undefined;
  return isCounter(found) ? found.claimed : 0;
}
/** What the public route says: the offer, with `left` rounded down to a multiple of 10 above 100 (exact at 100 or fewer). */
export function publicOffer(config: BonusConfig, claimed: number): { on: boolean; amount: number; places: number; left: number } {
  const left = Math.max(0, config.places - claimed);
  return { on: config.on && left > 0, amount: config.amount, places: config.places, left: left > 100 ? Math.floor(left / 10) * 10 : left };
}

export type BonusState = 'none' | 'ended' | 'held' | 'paid';
export interface BonusAnswer {
  state: BonusState
  amount: number
  /** The place this account holds, 1..N. */
  n: number
  places: number
  held?: 'character' | 'address'
  /** Paid, and the moment has not been shown yet (the client says so with `seen`). */
  show: boolean
}
const NONE = (config: BonusConfig, state: BonusState = 'none'): BonusAnswer => ({ state, amount: config.amount, n: 0, places: config.places, show: false });
type Push = { push: PushList };

export const bonusReason = (places: number): string => `Launch bonus: one of the first ${places.toLocaleString('en-NG')} players`;

export function bonusService(ctx: RouteContext) {
  const social = socialService(ctx);
  const salt = 'allworld-launch-bonus';
  const seenId = (account: AccountRecord): string => hash53(`${salt}\n${account.id}`);

  /** The character of the account that can be paid now: stored, unexpired, past the creator. Null otherwise. */
  function playable(db: Db, account: AccountRecord): { session: SessionRecord; city: NonNullable<ReturnType<typeof characterCity>> } | null {
    const session = account.sessionKey ? db.sessions[account.sessionKey] : undefined;
    if (!session || session.account !== account.id || !(session.expiresAt > ctx.now())) return null;
    const city = characterCity(session), state = city ? session.cities[city]?.state : undefined;
    if (!city || !state || state.onboarding?.required === true) return null;
    return { session, city };
  }
  /** Inside a transaction. `binding` is the device binding of the caller. `seen` records that the player was told. Returns the answer and what to announce once committed. */
  function claim(db: Db, input: { binding: string | undefined; ip: string; seen?: boolean }): { answer: BonusAnswer; push: Push } {
    const config = bonusConfig(ctx), now = ctx.now();
    const account = accountOfBinding(db, input.binding, now);
    const nothing = { answer: NONE(config), push: { push: [] } as Push };
    if (!account) return nothing;
    const active = account.sessionKey ? db.sessions[account.sessionKey] : undefined;
    // A banned account gets nothing: neither a new place nor a held payment.
    if (ctx.checks?.banned?.(active?.account === account.id ? active.publicId : account.publicId ?? '', account.id)) return { ...nothing, answer: NONE(config, account.bonus ? (account.bonus.held ? 'held' : 'paid') : 'none') };
    let bonus = account.bonus;
    if (!bonus) {
      const counter = ctx.collection(db, 'launchBonus', { claimed: 0 }) as unknown as Counter, seen = ctx.collection(db, 'launchBonusSeen', { ids: {} }) as unknown as { ids: Record<string, number> };
      if (typeof counter.claimed !== 'number') counter.claimed = 0;
      if (seen.ids === undefined || typeof seen.ids !== 'object') seen.ids = {};
      if (Object.hasOwn(seen.ids, seenId(account))) return nothing;
      if (!config.on || counter.claimed >= config.places) return { ...nothing, answer: NONE(config, 'ended') };
      counter.claimed += 1;
      seen.ids[seenId(account)] = counter.claimed;
      bonus = account.bonus = { at: now, amount: config.amount, n: counter.claimed, held: 'character' };
    }
    const base = { amount: bonus.amount, n: bonus.n, places: config.places };
    let push: Push = { push: [] };
    if (bonus.held) {
      const found = playable(db, account);
      if (!found) bonus.held = 'character';
      else {
        // At most LAUNCH_BONUS_PER_ADDRESS_DAY payments a day from one network address: past it the payment waits. Looked at first so waiting counts nothing.
        const key = `bonus:address:${addressBucket(input.ip)}`;
        const open = typeof ctx.peek === 'function' ? ctx.peek(key, config.perAddressDay) : true;
        if (!open || !ctx.allow(key, config.perAddressDay, DAY_MS)) bonus.held = 'address';
        else {
          const life = ctx.settle(found.session, found.city);
          const result = ctx.act(life, { type: 'wallet.bonus', payload: { amount: bonus.amount, reason: bonusReason(config.places) }, cityId: found.city, stateGuard: 'The launch bonus marker on the account is written in this same transaction' });
          if (result.ok) {
            delete bonus.held; bonus.at = now;
            if (social.modKnows(db, found.session.publicId)) push = { push: social.modNote(db, found.session.publicId, `Launch bonus: ₦${bonus.amount.toLocaleString('en-NG')} in the game was added to your cash. You are player #${bonus.n.toLocaleString('en-NG')} of the first ${config.places.toLocaleString('en-NG')}.`).push };
          } else bonus.held = 'character';
        }
      }
    }
    if (bonus.held) return { answer: { ...base, state: 'held', held: bonus.held, show: false }, push };
    const news = bonus.told !== true;
    if (input.seen === true) bonus.told = true;
    return { answer: { ...base, state: 'paid', show: news }, push };
  }
  /** Runs claim in a transaction of its own and announces what it owes once committed. A failure here never reaches the caller's own work. */
  async function run(input: { binding: string | undefined; ip: string; seen?: boolean }): Promise<BonusAnswer> {
    const config = bonusConfig(ctx);
    // Nothing to do, found without a write: no account, or a bonus already settled and told. Most opens of the game end here.
    const quick = await ctx.store.read((db) => {
      const account = accountOfBinding(db, input.binding, ctx.now());
      if (!account) return 'none' as const;
      const bonus = account.bonus;
      if (!bonus) return config.on && claimedOf(db) < config.places ? 'work' as const : ('ended' as const);
      return bonus.held || (bonus.told !== true) || input.seen === true ? 'work' as const : { state: 'paid' as const, amount: bonus.amount, n: bonus.n };
    });
    if (quick === 'none') return NONE(config);
    if (quick === 'ended') return NONE(config, 'ended');
    if (quick !== 'work') return { state: 'paid', amount: quick.amount, n: quick.n, places: config.places, show: false };
    const done = await ctx.store.transact((db) => claim(db, input));
    social.deliver(done.push);
    return done.answer;
  }
  return { claim, run, config: () => bonusConfig(ctx) };
}

const linked = new WeakSet<object>();
/** The admin screen's side: three runtime settings that start at the environment's value, and the places taken. */
export function linkBonus(ctx: RouteContext): void {
  if (linked.has(ctx)) return;
  linked.add(ctx);
  const env = (name: string): string => (typeof ctx.env === 'function' ? ctx.env(name) : '');
  registerAdminSetting(ctx, { key: 'launchBonus', label: 'Launch bonus (on or off)', help: 'Starts at LAUNCH_BONUS (on unless the host says off). Off: nobody new is given a place; places already reserved are still paid.', kind: 'boolean', default: () => env('LAUNCH_BONUS').trim().toLowerCase() !== 'off' });
  registerAdminSetting(ctx, { key: 'launchBonusAmount', label: 'Launch bonus: naira each (in the game)', help: 'Starts at LAUNCH_BONUS_AMOUNT (1,000,000). Applies to places taken from now on.', kind: 'number', min: 1, max: 1_000_000_000, default: () => whole(env('LAUNCH_BONUS_AMOUNT'), BONUS_DEFAULTS.amount, 1, 1_000_000_000) });
  registerAdminSetting(ctx, { key: 'launchBonusPlaces', label: 'Launch bonus: places', help: 'Starts at LAUNCH_BONUS_PLACES (10,000). The offer ends when this many accounts have claimed.', kind: 'number', min: 1, max: 10_000_000, default: () => whole(env('LAUNCH_BONUS_PLACES'), BONUS_DEFAULTS.places, 1, 10_000_000) });
  const stat = (id: string, label: string, read: (db: Db) => number | string): void => registerAdminStat(ctx, { id: `bonus-${id}`, group: 'Launch bonus', label, cost: 'one small collection', read });
  stat('on', 'Offer open', (db) => (publicOffer(bonusConfig(ctx), claimedOf(db)).on ? 'yes' : 'no'));
  stat('claimed', 'Places taken', (db) => claimedOf(db));
  stat('left', 'Places left', (db) => Math.max(0, bonusConfig(ctx).places - claimedOf(db)));
}
