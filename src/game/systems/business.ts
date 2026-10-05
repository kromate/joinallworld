/**
 * OWNER: business
 * The life's side of player-owned businesses. A shop is shared state on the server (server/business/service.ts, rules in
 * src/game/business-model.ts); this system only moves a life's money for it, applies what a bought product does and
 * keeps the per-life limits. The design is docs/BUSINESS.md.
 *
 * STATE — state.business
 *   opened  shops this life has opened        sales  units its shops sold (counted when takings are collected)
 *   spent   naira spent at players' shops, for life (with gifts sent, never more than social.earned)
 *   buys    { day, spent, count } — today's spending at players' shops
 *   bag     { [productId]: units } — trade goods carried between cities, at most BAG_LIMIT units
 *
 * ACTION — SERVER ONLY (registry.ts): 'business.server' { op, … }, run by server/business/service.ts through ctx.act inside
 * the store transaction that changes the shop, so the two are saved together and a player can never call it.
 *   open        { amount, name, city, venue }   pay the setup cost
 *   spend       { amount, what, name }           pay for stock, rent or an upgrade
 *   collect     { amount, sales, name }          take the cash box
 *   refund      { amount, name }                 what closing pays back
 *   buy         { amount, units, label, shop, effects?, need?, mood? }   buy from ANOTHER player's shop (buyBlock)
 *   bag-add     { product, units, amount, label }   buy trade goods for the road
 *   bag-take    { items: { [productId]: units } }   put carried goods on the shelves
 *   bag-return  { amount }                       sell the whole bag back to a supplier
 * A PURCHASE FOLLOWS THE GIFT RULE (content/npcs.ts TRANSFER_LIMITS): only a life that has earned TRANSFER_LIMITS.minEarned
 * from paid work may buy from a player, and gifts and purchases draw on ONE allowance — what the life has earned from
 * work, less what it already gave away or spent at players' shops (systems/social.ts transferBlock counts `spent` too).
 * So money a life did not work for can reach another player by neither road. A day's spending is capped as well
 * (content/business-limits.ts). Takings are not "earned from work".
 * EMITS  'business.opened' { city, venue }   'business.sale' {}   'business.bought' { amount }
 */
import { LEFT_OUT, PLAYS } from '../profile.ts';
import { emit } from '../registry.ts';
import { cleanText, fail, finite, isId, isRecord, naira, ok, safeCount } from '../util.ts';
import { lagosTime } from '../clock.ts';
import { addMoodlet, canAfford, canCredit, changeNeeds, credit, debit, NEEDS } from '../api.ts';
import { TRANSFER_LIMITS } from '../content/npcs.ts';
import { BAG_LIMIT, BUSINESS_BUYING, SALES_COUNTED_PER_COLLECT } from '../content/business-limits.ts';
import type { BusinessBlockCode } from '../../types/actions.ts';
import type { ActionFailure, BusinessState, LifeContext, LifeState, NeedMap } from '../../types/life.ts';
import type { ServerOnlyAction, SystemDefinition, TypedActionHandler } from '../../types/registry.ts';

type Payload = Record<string, unknown>;
type Refusal = ActionFailure<BusinessBlockCode>;
const nowOf = (state: LifeState, ctx: LifeContext): number => (finite(ctx?.now) && ctx.now > 0 ? ctx.now : state.t);
const amountOf = (value: unknown): number | null => (safeCount(value) ? value : null);
const bagUnits = (bag: BusinessState['bag']): number => Object.values(bag).reduce((sum, units) => sum + units, 0);
const today = (state: LifeState, ctx: LifeContext): { spent: number; count: number } => {
  const day = lagosTime(nowOf(state, ctx)).day, buys = state.business.buys;
  return buys.day === day ? buys : { spent: 0, count: 0 };
};

/** Naira of this life's earnings from work not yet passed to another player, by gift or by purchase: one allowance for both. */
export const allowance = (state: LifeState): number => Math.max(0, state.social.earned - state.social.transfer.total - state.business.spent);
/** Why this life may not buy at players' shops at all, in one sentence; '' when it may. Pure. */
export function buyingWhy(state: LifeState): string {
  const earned = state.social.earned, need = TRANSFER_LIMITS.minEarned;
  if (earned < need) return `Earn at least ${naira(need)} from paid work before you buy from other players (you have earned ${naira(earned)}).`;
  if (allowance(state) <= 0) return 'You can only spend money you have earned from work at other players’ shops. Work a shift to buy more.';
  return '';
}
/** Naira this life may still spend at players' shops today. Pure. */
export function buyingLeft(state: LifeState, ctx: LifeContext): number {
  if (buyingWhy(state)) return 0;
  return Math.max(0, Math.min(BUSINESS_BUYING.perDay - today(state, ctx).spent, allowance(state)));
}

/** The needs a product changes, bounded: only known needs, whole numbers, at most BUSINESS_BUYING.maxEffect either way. */
function effectsOf(value: unknown): NeedMap {
  const effects: NeedMap = {};
  if (!isRecord(value)) return effects;
  for (const need of NEEDS) {
    const amount = value[need];
    if (typeof amount === 'number' && Number.isSafeInteger(amount) && amount !== 0) effects[need] = Math.max(-BUSINESS_BUYING.maxEffect, Math.min(BUSINESS_BUYING.maxEffect, amount));
  }
  return effects;
}

/** Why this life cannot make this purchase (a failure result, its reason mirrored in state.message), or null. Nothing else is changed. */
export function buyBlock(state: LifeState, payload: Payload, ctx: LifeContext): Refusal | null {
  const amount = amountOf(payload.amount);
  if (amount === null || amount <= 0) return fail(state, 'invalid_amount', 'That purchase has no price.');
  const why = buyingWhy(state);
  if (why) return fail(state, state.social.earned < TRANSFER_LIMITS.minEarned ? 'earn_first' : 'spend_exceeds_earned', why);
  if (amount > allowance(state)) return fail(state, 'spend_exceeds_earned', `You can only spend money you have earned from work at other players’ shops. You can still spend ${naira(allowance(state))}.`);
  const day = today(state, ctx);
  if (day.count >= BUSINESS_BUYING.countPerDay) return fail(state, 'daily_shop_limit', `You have bought from players’ shops ${BUSINESS_BUYING.countPerDay} times today. The limit resets at midnight, Nigerian time.`);
  if (day.spent + amount > BUSINESS_BUYING.perDay) return fail(state, 'daily_shop_limit', `You can spend ${naira(BUSINESS_BUYING.perDay)} a day at players’ shops. ${naira(Math.max(0, BUSINESS_BUYING.perDay - day.spent))} is left today.`);
  const need = NEEDS.find((id) => id === payload.need);
  if (need && state.needs[need] >= BUSINESS_BUYING.fullNeed) return fail(state, 'not_needed', need === 'hunger' ? 'You are full. Come back when you are hungry.' : `Your ${need} is already full. Come back when you need it.`);
  const mood = isRecord(payload.mood) && isId(payload.mood.id) ? payload.mood.id : null;
  if (mood && state.moodlets.some((item) => item.id === `shop-${mood}` && (item.expiresAt === null || item.expiresAt > nowOf(state, ctx)))) return fail(state, 'already_have', 'You bought one of these today and still feel good about it. Come back tomorrow.');
  if (!canAfford(state, amount)) return fail(state, 'insufficient_funds', `You need ${naira(amount)}; you have ${naira(state.cash)}.`);
  return null;
}

const short = (state: LifeState, amount: number): Refusal => fail(state, 'insufficient_funds', `You need ${naira(amount)}; you have ${naira(state.cash)}.`);
const full = (state: LifeState): Refusal => fail(state, 'balance_limit', 'Your saved balance has reached its supported limit.');
const noAmount = (state: LifeState): Refusal => fail(state, 'invalid_amount', 'That amount is not a whole number of naira.');

const ops = {
  open(state: LifeState, payload: Payload, ctx: LifeContext) {
    const amount = amountOf(payload.amount), name = cleanText(payload.name, 24, 'your stall');
    if (amount === null) return noAmount(state);
    if (!debit(state, amount, `Shop setup: ${name}`, ctx)) return short(state, amount);
    state.business.opened = Math.min(Number.MAX_SAFE_INTEGER, state.business.opened + 1);
    state.message = `${name} is open. Stock it and set your prices.`;
    emit(state, 'business.opened', { city: cleanText(payload.city, 40, ''), venue: cleanText(payload.venue, 40, '') }, ctx);
    return ok(state, 'opened');
  },
  spend(state: LifeState, payload: Payload, ctx: LifeContext) {
    const amount = amountOf(payload.amount), name = cleanText(payload.name, 24, 'your stall');
    const what = payload.what === 'rent' ? 'rent' : payload.what === 'upgrade' ? 'upgrade' : 'stock';
    if (amount === null) return noAmount(state);
    if (!debit(state, amount, `Shop ${what}: ${name}`, ctx)) return short(state, amount);
    return ok(state, 'paid');
  },
  collect(state: LifeState, payload: Payload, ctx: LifeContext) {
    const amount = amountOf(payload.amount), sales = amountOf(payload.sales) ?? 0, name = cleanText(payload.name, 24, 'your stall');
    if (amount === null) return noAmount(state);
    if (!canCredit(state, amount)) return full(state);
    credit(state, amount, `Shop takings: ${name}`, ctx);
    state.business.sales = Math.min(Number.MAX_SAFE_INTEGER, state.business.sales + sales);
    for (let index = 0; index < Math.min(sales, SALES_COUNTED_PER_COLLECT); index++) emit(state, 'business.sale', {}, ctx);
    state.message = amount ? `Collected ${naira(amount)} from ${name}.` : `Nothing to collect at ${name} yet.`;
    return ok(state, 'collected');
  },
  refund(state: LifeState, payload: Payload, ctx: LifeContext) {
    const amount = amountOf(payload.amount), name = cleanText(payload.name, 24, 'your stall');
    if (amount === null) return noAmount(state);
    if (!canCredit(state, amount)) return full(state);
    credit(state, amount, `Shop closed: ${name}`, ctx);
    state.message = `${name} is closed. ${naira(amount)} came back to you.`;
    return ok(state, 'refunded');
  },
  buy(state: LifeState, payload: Payload, ctx: LifeContext) {
    const block = buyBlock(state, payload, ctx);
    if (block) return block;
    const amount = amountOf(payload.amount) ?? 0, units = safeCount(payload.units) && payload.units > 0 ? payload.units : 1;
    const label = cleanText(payload.label, 32, 'something'), shop = cleanText(payload.shop, 24, 'a stall');
    if (!debit(state, amount, `Bought at ${shop}: ${units} × ${label}`, ctx)) return short(state, amount);
    const book = state.business, day = lagosTime(nowOf(state, ctx)).day, effects = effectsOf(payload.effects);
    if (book.buys.day !== day) book.buys = { day, spent: 0, count: 0 };
    book.buys.spent += amount; book.buys.count += 1;
    book.spent = Math.min(Number.MAX_SAFE_INTEGER, book.spent + amount);
    for (let index = 0; index < units; index++) changeNeeds(state, effects);
    const mood = isRecord(payload.mood) && isId(payload.mood.id) ? payload.mood : null;
    if (mood) {
      const value = finite(mood.value) ? Math.max(1, Math.min(BUSINESS_BUYING.maxMood, Math.round(mood.value))) : 1;
      const seconds = finite(mood.hours) ? Math.max(60, Math.min(BUSINESS_BUYING.maxMoodSeconds, Math.round(mood.hours * 3600))) : 3600;
      addMoodlet(state, { id: `shop-${String(mood.id)}`, label: cleanText(mood.label, 40, 'Something new'), value, duration: seconds }, ctx);
    }
    state.message = `${units} × ${label} from ${shop}: −${naira(amount)}.`;
    emit(state, 'business.bought', { amount }, ctx);
    return ok(state, 'bought');
  },
  'bag-add'(state: LifeState, payload: Payload, ctx: LifeContext) {
    const amount = amountOf(payload.amount), units = payload.units, product = payload.product, label = cleanText(payload.label, 32, 'goods');
    if (amount === null || !isId(product) || !safeCount(units) || units <= 0) return fail(state, 'invalid_operation', 'Choose what to carry and how many.');
    const room = BAG_LIMIT - bagUnits(state.business.bag);
    if (units > room) return fail(state, 'bag_full', room > 0 ? `You can carry ${room} more unit${room === 1 ? '' : 's'} (${BAG_LIMIT} in all).` : `Your bag is full (${BAG_LIMIT} units). Stock your stall from it first.`);
    if (!debit(state, amount, `Shop goods: ${units} × ${label}`, ctx)) return short(state, amount);
    state.business.bag[product] = (state.business.bag[product] ?? 0) + units;
    state.message = `${units} × ${label} packed for the road.`;
    return ok(state, 'bagged');
  },
  'bag-take'(state: LifeState, payload: Payload) {
    const items = isRecord(payload.items) ? Object.entries(payload.items) : [];
    if (!items.length) return fail(state, 'invalid_operation', 'There is nothing to unpack.');
    for (const [product, units] of items) if (!safeCount(units) || units <= 0 || (state.business.bag[product] ?? 0) < units) return fail(state, 'bag_short', 'You are not carrying that many.');
    for (const [product, units] of items) {
      const left = (state.business.bag[product] ?? 0) - (units as number);
      if (left > 0) state.business.bag[product] = left; else delete state.business.bag[product];
    }
    return ok(state, 'unbagged');
  },
  'bag-return'(state: LifeState, payload: Payload, ctx: LifeContext) {
    const amount = amountOf(payload.amount);
    if (amount === null) return noAmount(state);
    if (!bagUnits(state.business.bag)) return fail(state, 'bag_short', 'Your bag is empty.');
    if (!canCredit(state, amount)) return full(state);
    state.business.bag = {};
    credit(state, amount, 'Shop goods returned', ctx);
    return ok(state, 'returned');
  },
} satisfies Record<string, (state: LifeState, payload: Payload, ctx: LifeContext) => ReturnType<TypedActionHandler<'business.server'>>>;

const isOp = (op: unknown): op is keyof typeof ops => typeof op === 'string' && Object.hasOwn(ops, op);
/** The body of 'business.server' (exported for tests). */
export const businessOp: TypedActionHandler<'business.server'> = (state, payload, ctx) => (isRecord(payload) && isOp(payload.op)
  ? ops[payload.op](state, payload, ctx)
  : fail(state, 'invalid_operation', 'That shop operation does not exist.'));

/**
 * What only a host that plays the game runs: player actions, settling time and event listeners. The browser reads lives, it never plays them,
 * so its build leaves this out (PLAYS is false there: src/game/profile.ts).
 */
const play = PLAYS ? {
  actions: {
    'business.server': { serverOnly: true, run: businessOp, refusal: 'This is completed by the server when a shop changes. Nothing was changed.' } satisfies ServerOnlyAction<'business.server'>,
  },
} satisfies Pick<SystemDefinition<'business'>, 'actions'> : LEFT_OUT;

export default {
  id: 'business',
  stateKeys: ['business'],
  sanitize(input, state) {
    const saved = isRecord(input.business) ? input.business : {}, buys = isRecord(saved.buys) ? saved.buys : {};
    const count = (value: unknown): number => (safeCount(value) ? value : 0);
    const bag: BusinessState['bag'] = {};
    let carried = 0;
    for (const [product, units] of Object.entries(isRecord(saved.bag) ? saved.bag : {}).slice(0, BAG_LIMIT)) {
      if (!isId(product) || !safeCount(units) || units <= 0 || carried + units > BAG_LIMIT) continue;
      bag[product] = units; carried += units;
    }
    state.business = { opened: count(saved.opened), sales: count(saved.sales), spent: count(saved.spent), buys: { day: count(buys.day), spent: count(buys.spent), count: count(buys.count) }, bag };
  },
  view(state, ctx) {
    const book = state.business;
    return { opened: book.opened, sales: book.sales, bag: Object.entries(book.bag), bagRoom: BAG_LIMIT - bagUnits(book.bag), canSpend: buyingLeft(state, ctx), buyWhy: buyingWhy(state) };
  },
  ...play,
} satisfies SystemDefinition<'business'>;
