/**
 * OWNER: business
 * Player-owned shops: the shared record and everything that changes it. Portable (no Node imports), used by
 * server/routes/business.ts and server/routes/business-mod.ts. The shop rules are pure (src/game/business-model.ts);
 * the life's side is the server-only action 'business.server' (src/game/systems/business.ts). Design: docs/BUSINESS.md.
 *
 * db.business = {
 *   v: 1,
 *   shops:   { [ownerPublicId]: ShopRecord }      one business per player; the owner's id is the shop's id
 *   reports: [{ id, shop, name, by, reason, at }] at most BUSINESS.reports, oldest dropped
 *   seq:     number                                last report id
 * }
 * Only public ids and public names are stored here — never a session secret, an address or a device token.
 *
 * WRITES. A shop record is written only when a player does something to it. Reading computes what passers-by bought
 * since the record's own time (shopAt) and stores nothing, so a poll or an open screen never costs a row. The one read
 * that may write is the owner's own view, and only when rent was taken or fell overdue since the record was last written
 * (at most once a rent period): the owner is then told in Messages → Updates.
 *
 * MONEY. Every charge and payout is ctx.act(life, 'business.server') inside the transaction that changes the record
 * and under the caller's receipt (ctx.once), so both halves are saved or neither is, and a repeat changes nothing.
 * A buyer's naira goes into the shop's cash box, not to a life: the owner takes it with Collect, online or not at the
 * time of the sale.
 *
 * WHAT A SALE BETWEEN PLAYERS IS CHECKED AGAINST (in this order)
 *   the buyer stands in the shop's market · the shop is open and has the units · buyer ≠ owner · no block either way ·
 *   the buyer is not on a device the owner has used · per buyer per shop per day, and per shop per day (business-model
 *   saleBlock) · buyers behind one network address share one buyer's allowance at a shop (in memory, never stored) ·
 *   the buyer's own rules — earned from work, daily spend, the need is not already full (systems/business.ts buyBlock).
 */
import { cityContent, cityRules } from '../../src/game/cities/index.ts';
import { lagosTime } from '../../src/game/clock.ts';
import { naira } from '../../src/game/util.ts';
import { AD_COLOURS } from '../../src/game/content/civic.ts';
import { BUSINESS, BUSINESS_PRODUCTS, BUSINESS_TYPE_IDS, BUSINESS_UPGRADES } from '../../src/game/content/business.ts';
import { BAG_LIMIT, BUSINESS_BUYING } from '../../src/game/content/business-limits.ts';
import {
  businessVenue, capacityOf, closeValue, closesAt, customersOf, isBusinessType, isLocal, newShop, priceBand, priceBlock, productCost, productDoes, productLabel, productOf,
  rateShop, rentOf, saleBlock, sellToPlayer, settleShop, shopAt, starsOf, stockBlock, stockCost, stockUnits, tradeGoods, typeOf, upgradeBlock, upgradeOf, windUp,
} from '../../src/game/business-model.ts';
import type { ShopEvent } from '../../src/game/business-model.ts';
import type {
  BagLine, BusinessCollection, BusinessLimits, BusinessProduct, BusinessTypeId, BusinessVenue, MyBusinessResponse, MyShop, ProductView, ShopCard, ShopRecord, ShopReport,
  TypeView, VenueShopsResponse,
} from '../../src/types/business.ts';
import type { LifeState } from '../../src/types/life.ts';
import type { CityId, PlayerRef } from '../../src/types/protocol.ts';
import type { ActionOutcome, Db, RouteContext, RouteRequest, SessionRecord } from '../types.ts';
import { canOccupyVenue } from '../protocol.ts';
import { cleanLine } from '../civic/text.ts';
import { socialService } from '../social/service.ts';

const DAY_MS = 86400000;
export const REPORT_REASONS = Object.freeze(['name', 'scam', 'other'] as const);
type Refusal = { ok: false; code: string; reason: string };
type Done<C extends string = string> = { ok: true; code: C };
type Push = [string, unknown][];
const no = (code: string, reason: string): Refusal => ({ ok: false, code, reason });
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export const emptyBusiness = (): BusinessCollection => ({ v: 1, shops: {}, reports: [], seq: 0 });
/** The collection, created or repaired in place so damaged data cannot crash a route. */
export function businessOf(ctx: Pick<RouteContext, 'collection'>, db: Db): BusinessCollection {
  const found = ctx.collection(db, 'business', emptyBusiness()) as Partial<BusinessCollection>;
  if (!record(found.shops)) found.shops = {};
  if (!Array.isArray(found.reports)) found.reports = [];
  if (!whole(found.seq)) found.seq = 0;
  found.v = 1;
  return found as BusinessCollection;
}
/** The collection as a read sees it: nothing is created. */
const peekBusiness = (db: Db): BusinessCollection => { const found = db.business; return record(found) && record(found.shops) ? { v: 1, shops: found.shops, reports: Array.isArray(found.reports) ? found.reports : [], seq: whole(found.seq) ? found.seq : 0 } : emptyBusiness(); };
/** A stored shop that has every field the rules read; anything else is treated as absent. */
const sound = (shop: unknown): shop is ShopRecord => record(shop) && record(shop.by) && typeof shop.by.id === 'string' && isBusinessType(shop.type) && typeof shop.city === 'string' && typeof shop.venue === 'string'
  && record(shop.stock) && record(shop.prices) && record(shop.part) && record(shop.buyers) && Array.isArray(shop.raters) && Array.isArray(shop.upgrades) && record(shop.ratings) && record(shop.total)
  && [shop.at, shop.paidUntil, shop.owed, shop.till, shop.rep, shop.day, shop.paid].every((value) => typeof value === 'number' && Number.isFinite(value));

export const LIMITS: BusinessLimits = Object.freeze({
  perShop: BUSINESS.pairPerDay, itemsPerShop: BUSINESS.pairItemsPerDay, perDay: BUSINESS_BUYING.perDay, countPerDay: BUSINESS_BUYING.countPerDay, qtyMax: BUSINESS.qtyMax,
  bag: BAG_LIMIT, bandMin: BUSINESS.band.min, bandMax: BUSINESS.band.max, name: BUSINESS.name,
});

export type BusinessService = ReturnType<typeof buildService>;
const services = new WeakMap<RouteContext, BusinessService>();
export function businessService(ctx: RouteContext): BusinessService {
  const cached = services.get(ctx);
  if (cached) return cached;
  const service = buildService(ctx);
  services.set(ctx, service);
  return service;
}

function buildService(ctx: RouteContext) {
  const now = (): number => ctx.now();
  const social = socialService(ctx);
  const cityName = (city: string): string => cityRules(city)?.name ?? city;
  const venueOf = (shop: Pick<ShopRecord, 'city' | 'venue'>): BusinessVenue | null => businessVenue(shop.city, shop.venue);
  const blocked = (a: string, b: string): boolean => ctx.checks?.blocked?.(a, b) === true;
  const act = (life: LifeState, cityId: CityId, payload: Record<string, unknown>): ActionOutcome => ctx.act(life, { type: 'business.server', cityId, payload });
  const refuse = (outcome: ActionOutcome): Refusal => no(outcome.code, outcome.reason ?? 'That could not be done.');
  /** Is this life standing in that market right now? */
  const standsIn = (life: LifeState, city: string, venue: string): boolean => life.estate.city === city && canOccupyVenue(life, venue);

  // Naira spent today at one shop from one network address, all buyers together. In memory only: an address is never stored.
  const byAddress = new Map<string, number>();
  let addressDay = 0;
  function addressSpent(owner: string, ip: string, add = 0): number {
    const day = lagosTime(now()).day;
    if (day !== addressDay || byAddress.size > 50000) { byAddress.clear(); addressDay = day; }
    const key = `${owner}|${ip}`, total = (byAddress.get(key) ?? 0) + add;
    if (add) byAddress.set(key, total);
    return total;
  }
  /** The two players have used one device (the growth module keeps salted hashes of device tokens; read only). */
  function sharedDevice(db: Db, a: string, b: string): boolean {
    const mine = db.growth?.players?.[a]?.devices, theirs = db.growth?.players?.[b]?.devices;
    return Array.isArray(mine) && Array.isArray(theirs) && mine.some((hash) => theirs.includes(hash));
  }

  // ---- telling the owner -------------------------------------------------------------------------
  function tell(db: Db, to: string, text: string, push: Push): void {
    if (!social.modKnows(db, to)) return;
    push.push(...social.shopNote(db, to, text).push);
  }
  function tellEvents(db: Db, shop: ShopRecord, events: ShopEvent[], push: Push): void {
    for (const event of events) {
      if (event.kind === 'rent') tell(db, shop.by.id, `${shop.name}: this week’s rent (${naira(event.amount)}) was paid from the cash box.`, push);
      else if (event.kind === 'due') tell(db, shop.by.id, `${shop.name}: the cash box could not cover this week’s rent (${naira(event.amount)}). It will be taken from takings as they come in; pay it in Phone → Business within ${BUSINESS.graceDays} days or the market closes the stall.`, push);
      else tell(db, shop.by.id, `${shop.name} was closed by the market for unpaid rent. ${naira(event.claim)} is waiting for you in Phone → Business.`, push);
    }
  }
  /** Bring a stored shop to now, telling its owner what happened on the way. */
  function settle(db: Db, shop: ShopRecord, push: Push): ShopRecord {
    tellEvents(db, shop, settleShop(shop, now(), venueOf(shop)), push);
    return shop;
  }
  /** Drop what nobody will come back for: wound-up shops whose money has waited BUSINESS.claimDays, and damaged records. */
  function prune(b: BusinessCollection): void {
    for (const [id, shop] of Object.entries(b.shops)) {
      if (!sound(shop)) { delete b.shops[id]; continue; }
      if (shop.status === 'closed' && now() - (shop.closedAt ?? shop.at) > BUSINESS.claimDays * DAY_MS) delete b.shops[id];
    }
  }

  // ---- views -------------------------------------------------------------------------------------
  function productView(product: BusinessProduct, city: string): ProductView {
    const band = priceBand(product);
    return { id: product.id, label: productLabel(product, city), icon: product.icon, base: product.base, cost: productCost(product, city), local: isLocal(product, city), min: band.min, max: band.max,
      does: productDoes(product), trade: product.origin !== undefined };
  }
  function typeView(id: BusinessTypeId, venue: BusinessVenue): TypeView {
    const type = typeOf(id);
    return { id, label: type.label, icon: type.icon, icons: type.icons, setup: type.setup, rent: type.rent, customers: Math.round(customersOf({ type: id, upgrades: [], rep: BUSINESS.rep.start }, venue)),
      capacity: type.capacity, known: venue.known.includes(id), products: type.products.map((product) => productView(product, venue.city)) };
  }
  /** `shop` is already at now (a settled record or a shopAt copy). */
  function card(shop: ShopRecord, viewer: string | null): ShopCard {
    const type = typeOf(shop.type);
    return {
      id: shop.by.id, name: shop.name, type: shop.type, typeLabel: type.label, colour: shop.colour, icon: shop.icon, owner: { id: shop.by.id, name: shop.by.name }, status: shop.status,
      stars: starsOf(shop.rep), ratings: shop.ratings.n,
      items: type.products.map((product) => ({ id: product.id, label: productLabel(product, shop.city), icon: product.icon, price: shop.prices[product.id] ?? product.base, stock: shop.stock[product.id] ?? 0, does: productDoes(product) })),
      mine: viewer === shop.by.id, blocked: viewer !== null && viewer !== shop.by.id && blocked(viewer, shop.by.id), canRate: viewer !== null && shop.raters.includes(viewer),
    };
  }
  function alertOf(shop: ShopRecord): string {
    if (shop.status === 'closed') return shop.till > 0 ? `This stall has been closed. Collect the ${naira(shop.till)} it left you.` : 'This stall has been closed, and nothing was left after the rent. Clear it to rent a new one.';
    if (shop.owed > 0) return `Rent of ${naira(shop.owed)} is overdue. Takings go to it first; if it is still unpaid in ${Math.max(1, Math.ceil(((closesAt(shop) ?? now()) - now()) / 3600000))} h the market closes the stall.`;
    if (!stockUnits(shop)) return 'Nothing in stock. Customers are walking past and your stars will drop.';
    if (shop.till >= BUSINESS.tillCap) return 'The cash box is full, so passers-by cannot buy. Collect your takings.';
    return '';
  }
  function mineView(shop: ShopRecord, life: LifeState | null): MyShop {
    const venue = venueOf(shop), type = typeOf(shop.type);
    return {
      ...card(shop, shop.by.id), city: shop.city, cityName: cityName(shop.city), venue: shop.venue, venueName: venue?.name ?? shop.venue,
      here: life !== null && standsIn(life, shop.city, shop.venue),
      till: shop.till, tillCap: BUSINESS.tillCap, sold: shop.sold, capacity: capacityOf(shop), units: stockUnits(shop), rent: rentOf(shop), paidUntil: shop.paidUntil, owed: shop.owed, closesAt: closesAt(shop),
      customers: venue ? Math.round(customersOf(shop, venue)) : 0,
      today: { takings: shop.takings, sold: shop.served, came: Math.round(shop.came) }, total: { ...shop.total },
      upgrades: BUSINESS_UPGRADES.map((upgrade) => ({ id: upgrade.id, label: upgrade.label, cost: upgrade.cost, effect: upgrade.effect, owned: shop.upgrades.includes(upgrade.id) })),
      products: type.products.map((product) => ({ ...productView(product, shop.city), price: shop.prices[product.id] ?? product.base, stock: shop.stock[product.id] ?? 0 })),
      closeRefund: shop.status === 'closed' ? shop.till : closeValue(shop), alert: alertOf(shop),
    };
  }
  function bagView(life: LifeState | null, city: string): BagLine[] {
    return Object.entries(life?.business.bag ?? {}).flatMap(([id, n]) => { const product = BUSINESS_PRODUCTS.get(id); return product ? [{ id, label: productLabel(product, city), icon: product.icon, n }] : []; });
  }
  const ownShop = (b: BusinessCollection, id: string | null): ShopRecord | null => { const shop = id ? b.shops[id] : undefined; return sound(shop) ? shop : null; };
  function myNow(b: BusinessCollection, id: string | null, life: LifeState | null): MyShop | null {
    const shop = ownShop(b, id);
    return shop ? mineView(shopAt(shop, now(), venueOf(shop)), life) : null;
  }
  const shopsAt = (b: BusinessCollection, city: string, venue: string): ShopRecord[] => Object.values(b.shops).filter((shop): shop is ShopRecord => sound(shop) && shop.city === city && shop.venue === venue && shop.status !== 'closed');

  function openWhy(b: BusinessCollection, venue: BusinessVenue | null, who: PlayerRef | null, life: LifeState | null): string {
    if (!venue) return 'Stalls are rented at markets. Find one on the Map.';
    if (!who || !life) return 'Start playing to open a stall.';
    if (ownShop(b, who.id)) return 'You already run a business. One per player for now.';
    if (!standsIn(life, venue.city, venue.venue)) return `Go to ${venue.name} to rent a stall there.`;
    if (shopsAt(b, venue.city, venue.venue).length >= venue.stalls) return `Every stall at ${venue.name} is taken. Try another market, or come back when one frees up.`;
    return '';
  }
  function venueView(db: Db, cityId: CityId, venueId: string, who: PlayerRef | null, life: LifeState | null): VenueShopsResponse {
    const b = peekBusiness(db), venue = businessVenue(cityId, venueId), viewer = who?.id ?? null;
    const shops = venue ? shopsAt(b, cityId, venueId).map((shop) => shopAt(shop, now(), venue)).filter((shop) => shop.status !== 'closed') : [];
    return {
      city: cityId, venue: venueId, hosts: venue !== null, venueName: venue?.name ?? cityContent(cityId).venues.find((item) => item.id === venueId)?.name ?? venueId,
      stalls: { total: venue?.stalls ?? 0, taken: shops.length }, known: [...(venue?.known ?? [])], hours: venue?.hours ?? BUSINESS.hours,
      types: venue ? BUSINESS_TYPE_IDS.map((id) => typeView(id, venue)) : [],
      // The viewer's own stall first, then by stars; a stall with nothing to sell goes last.
      shops: shops.map((shop) => card(shop, viewer)).sort((a, z) => Number(z.mine) - Number(a.mine) || Number(z.items.some((item) => item.stock > 0)) - Number(a.items.some((item) => item.stock > 0)) || z.stars - a.stars || a.name.localeCompare(z.name)),
      mine: myNow(b, viewer, life), bag: bagView(life, cityId),
      wholesale: venue ? tradeGoods().filter((product) => isLocal(product, cityId)).map((product) => productView(product, cityId)) : [],
      limits: LIMITS, openWhy: openWhy(b, venue, who, life), colours: AD_COLOURS,
    };
  }
  const mineBody = (db: Db, cityId: CityId, who: PlayerRef, life: LifeState): MyBusinessResponse => ({ city: cityId, mine: myNow(peekBusiness(db), who.id, life), bag: bagView(life, cityId), limits: LIMITS });

  // ---- entering a request ------------------------------------------------------------------------
  function enter(db: Db, request: RouteRequest, cityId: CityId) {
    const session: SessionRecord = request.requireSession(db, { renew: true });
    const who = ctx.publicSession(session), life = ctx.settle(session, cityId), b = businessOf(ctx, db);
    prune(b);
    return { session, who, life, b };
  }
  /** The caller's own shop, settled, or a refusal. */
  function owned(db: Db, b: BusinessCollection, who: PlayerRef, push: Push): ShopRecord | Refusal {
    const shop = ownShop(b, who.id);
    if (!shop) return no('no_shop', 'You do not run a business yet. Rent a stall at any market.');
    shop.by.name = who.name;
    return settle(db, shop, push);
  }
  const isRefusal = (value: ShopRecord | Refusal): value is Refusal => 'ok' in value;
  /** For what needs the owner behind the counter. */
  function behindCounter(shop: ShopRecord, life: LifeState, what: string): Refusal | null {
    if (shop.status === 'closed') return no('shop_closed', 'The market closed this stall. Collect what it left you, then rent a new one.');
    if (!standsIn(life, shop.city, shop.venue)) return no('not_at_shop', `Go to ${venueOf(shop)?.name ?? 'your market'} in ${cityName(shop.city)} to ${what}.`);
    return null;
  }

  return {
    LIMITS,
    /** GET /api/business/venue — works signed out (the shops are public); nothing is written. */
    venue(db: Db, request: RouteRequest, cityId: CityId, venueId: string): VenueShopsResponse {
      const session = request.session(db);
      // A signed-in caller whose character is in another city still sees the market, as a visitor to the page would.
      let life: LifeState | null = null;
      if (session) { try { life = ctx.settle(session, cityId); } catch { life = null; } }
      return venueView(db, cityId, venueId, session ? ctx.publicSession(session) : null, life);
    },
    /** GET /api/business/mine — a read; `stale` asks the route to run `refresh` so the owner is told about rent. */
    mine(db: Db, request: RouteRequest, cityId: CityId): MyBusinessResponse & { stale: boolean } {
      const session = request.requireSession(db), who = ctx.publicSession(session), life = ctx.settle(session, cityId);
      const shop = ownShop(peekBusiness(db), who.id);
      const stale = shop !== null && settleShop(JSON.parse(JSON.stringify(shop)) as ShopRecord, now(), venueOf(shop)).length > 0;
      return { ...mineBody(db, cityId, who, life), stale };
    },
    /** Write what rent did to the caller's shop since it was last written, and tell them. */
    refresh(db: Db, request: RouteRequest, cityId: CityId) {
      const { who, life, b } = enter(db, request, cityId), push: Push = [];
      const shop = ownShop(b, who.id);
      if (shop) settle(db, shop, push);
      return { body: mineBody(db, cityId, who, life), push };
    },

    open(db: Db, request: RouteRequest, cityId: CityId, body: Record<string, unknown>) {
      const { session, who, life, b } = enter(db, request, cityId);
      const venue = businessVenue(cityId, body.venue), name = cleanLine(body.name, { min: BUSINESS.name.min, max: BUSINESS.name.max, what: 'The stall’s name' });
      const outcome: Refusal | Done<'opened'> | (Done<'opened'> & { duplicate: true }) = ctx.once(db, session, { id: body.requestId, kind: 'business.open', fingerprint: [cityId, body.venue, body.type, name.ok ? name.text : body.name, body.colour, body.icon].map((part) => String(part ?? '')) }, () => {
        const why = openWhy(b, venue, who, life);
        if (!venue || why) return no(venue ? 'cannot_open' : 'no_stalls_here', why);
        if (!isBusinessType(body.type)) return no('unknown_type', 'Choose what kind of stall to open.');
        const type = typeOf(body.type);
        const muted = ctx.checks?.muted?.(who.id);
        if (muted) return no(muted.code, muted.reason);
        if (!name.ok) return no(name.code, name.reason);
        if (typeof body.colour !== 'string' || !AD_COLOURS.some((colour) => colour.id === body.colour)) return no('invalid_colour', 'Choose one of the listed colours.');
        if (typeof body.icon !== 'string' || !type.icons.includes(body.icon)) return no('invalid_icon', 'Choose one of the listed icons.');
        const paid = act(life, cityId, { op: 'open', amount: type.setup, name: name.text, city: cityId, venue: venue.venue });
        if (!paid.ok) return refuse(paid);
        b.shops[who.id] = newShop({ by: who, city: cityId, venue: venue.venue, type: type.id, name: name.text, colour: body.colour, icon: body.icon }, now());
        return { ok: true, code: 'opened' };
      });
      return { body: { ...outcome, state: life, ...mineBody(db, cityId, who, life) }, push: [] as Push };
    },

    stock(db: Db, request: RouteRequest, cityId: CityId, body: Record<string, unknown>) {
      const { session, who, life, b } = enter(db, request, cityId), push: Push = [];
      const items: Record<string, number> = {};
      for (const [id, units] of Object.entries(record(body.items) ? body.items : {}).slice(0, 8)) if (typeof units === 'number') items[id] = units;
      const outcome = ctx.once(db, session, { id: body.requestId, kind: 'business.stock', fingerprint: [cityId, JSON.stringify(items)] }, () => {
        const shop = owned(db, b, who, push);
        if (isRefusal(shop)) return shop;
        const block = behindCounter(shop, life, 'buy stock') ?? stockBlock(shop, items);
        if (block) return no(block.code, block.reason);
        const paid = act(life, cityId, { op: 'spend', what: 'stock', amount: stockCost(shop, items), name: shop.name });
        if (!paid.ok) return refuse(paid);
        for (const [id, units] of Object.entries(items)) shop.stock[id] = (shop.stock[id] ?? 0) + units;
        return { ok: true as const, code: 'stocked' };
      });
      return { body: { ...outcome, state: life, ...mineBody(db, cityId, who, life) }, push };
    },

    /** Prices are set, not paid for: a repeat sets the same prices again. */
    price(db: Db, request: RouteRequest, cityId: CityId, body: Record<string, unknown>) {
      const { who, life, b } = enter(db, request, cityId), push: Push = [];
      const run = (): Refusal | Done => {
        const shop = owned(db, b, who, push);
        if (isRefusal(shop)) return shop;
        const prices = Object.entries(record(body.prices) ? body.prices : {}).slice(0, 8);
        const block = behindCounter(shop, life, 'change prices') ?? (prices.length ? null : no('nothing_chosen', 'Choose a price to change.')) ?? prices.map(([id, price]) => priceBlock(shop, id, price)).find((found) => found !== null) ?? null;
        if (block) return no(block.code, block.reason);
        for (const [id, price] of prices) shop.prices[id] = price as number;
        return { ok: true, code: 'priced' };
      };
      return { body: { ...run(), ...mineBody(db, cityId, who, life) }, push };
    },

    /** Take the cash box, from anywhere. A wound-up stall is paid out and its record removed. */
    collect(db: Db, request: RouteRequest, cityId: CityId, body: Record<string, unknown>) {
      const { session, who, life, b } = enter(db, request, cityId), push: Push = [];
      const outcome = ctx.once(db, session, { id: body.requestId, kind: 'business.collect', fingerprint: [cityId] }, () => {
        const shop = owned(db, b, who, push);
        if (isRefusal(shop)) return shop;
        if (shop.owed > 0) return no('rent_first', `Rent of ${naira(shop.owed)} is overdue, so the ${naira(shop.till)} in the cash box is being kept for it. Pay the rent, or wait for takings to cover it.`);
        if (shop.till <= 0 && shop.status !== 'closed') return no('nothing_to_collect', 'The cash box is empty. Customers come during market hours.');
        const amount = shop.till;
        const paid = act(life, cityId, shop.status === 'closed' ? { op: 'refund', amount, name: shop.name } : { op: 'collect', amount, sales: shop.sold, name: shop.name });
        if (!paid.ok) return refuse(paid);
        shop.till = 0; shop.sold = 0;
        if (shop.status === 'closed') delete b.shops[who.id];
        return { ok: true as const, code: 'collected', amount };
      });
      return { body: { ...outcome, state: life, ...mineBody(db, cityId, who, life) }, push };
    },

    /** Pay one rent period from the wallet, from anywhere: ahead of time, or the rent that is overdue. */
    rent(db: Db, request: RouteRequest, cityId: CityId, body: Record<string, unknown>) {
      const { session, who, life, b } = enter(db, request, cityId), push: Push = [];
      const outcome = ctx.once(db, session, { id: body.requestId, kind: 'business.rent', fingerprint: [cityId] }, () => {
        const shop = owned(db, b, who, push);
        if (isRefusal(shop)) return shop;
        if (shop.status === 'closed') return no('shop_closed', 'The market closed this stall. Collect what it left you, then rent a new one.');
        const period = BUSINESS.rentDays * DAY_MS;
        if (shop.owed <= 0 && shop.paidUntil - now() > (BUSINESS.rentAhead - 1) * period) return no('paid_ahead', `Rent is already paid ${BUSINESS.rentAhead} weeks ahead.`);
        const rent = shop.owed > 0 ? shop.owed : rentOf(shop);
        const paid = act(life, cityId, { op: 'spend', what: 'rent', amount: rent, name: shop.name });
        if (!paid.ok) return refuse(paid);
        shop.owed = 0; shop.paidUntil += period;
        return { ok: true as const, code: 'rent_paid' };
      });
      return { body: { ...outcome, state: life, ...mineBody(db, cityId, who, life) }, push };
    },

    upgrade(db: Db, request: RouteRequest, cityId: CityId, body: Record<string, unknown>) {
      const { session, who, life, b } = enter(db, request, cityId), push: Push = [];
      const outcome = ctx.once(db, session, { id: body.requestId, kind: 'business.upgrade', fingerprint: [cityId, String(body.upgrade ?? '')] }, () => {
        const shop = owned(db, b, who, push);
        if (isRefusal(shop)) return shop;
        const upgrade = upgradeOf(body.upgrade);
        const block = behindCounter(shop, life, 'upgrade your stall') ?? upgradeBlock(shop, body.upgrade);
        if (block || !upgrade) return no(block?.code ?? 'unknown_upgrade', block?.reason ?? 'Choose an upgrade from the list.');
        const paid = act(life, cityId, { op: 'spend', what: 'upgrade', amount: upgrade.cost, name: shop.name });
        if (!paid.ok) return refuse(paid);
        shop.upgrades.push(upgrade.id); shop.paid += upgrade.cost;
        return { ok: true as const, code: 'upgraded' };
      });
      return { body: { ...outcome, state: life, ...mineBody(db, cityId, who, life) }, push };
    },

    /** Close by choice, from anywhere: the refund and the cash box in one payment, and the stall is free for someone else. */
    close(db: Db, request: RouteRequest, cityId: CityId, body: Record<string, unknown>) {
      const { session, who, life, b } = enter(db, request, cityId), push: Push = [];
      const outcome = ctx.once(db, session, { id: body.requestId, kind: 'business.close', fingerprint: [cityId] }, () => {
        const shop = owned(db, b, who, push);
        if (isRefusal(shop)) return shop;
        const amount = shop.status === 'closed' ? shop.till : closeValue(shop);
        const paid = act(life, cityId, { op: 'refund', amount, name: shop.name });
        if (!paid.ok) return refuse(paid);
        delete b.shops[who.id];
        return { ok: true as const, code: 'closed', amount };
      });
      return { body: { ...outcome, state: life, ...mineBody(db, cityId, who, life) }, push };
    },

    /** Buy trade goods for the road, at a market of the city they come from. */
    bagBuy(db: Db, request: RouteRequest, cityId: CityId, body: Record<string, unknown>) {
      const { session, who, life, b } = enter(db, request, cityId), push: Push = [];
      const outcome = ctx.once(db, session, { id: body.requestId, kind: 'business.bag', fingerprint: [cityId, String(body.venue ?? ''), String(body.product ?? ''), String(body.units ?? '')] }, () => {
        const venue = businessVenue(cityId, body.venue), product = typeof body.product === 'string' ? BUSINESS_PRODUCTS.get(body.product) : undefined, units = body.units;
        if (!venue || !standsIn(life, cityId, venue.venue)) return no('not_at_market', 'Trade goods are bought at a market. Go to one first.');
        if (!product || !isLocal(product, cityId)) return no('not_sold_here', `The suppliers in ${cityName(cityId)} do not sell that for the road.`);
        if (typeof units !== 'number' || !Number.isSafeInteger(units) || units < 1 || units > BAG_LIMIT) return no('invalid_units', `Buy 1 to ${BAG_LIMIT} units.`);
        const shop = ownShop(b, who.id);
        if (!shop || shop.status === 'closed' || shop.type !== product.type) return no('no_shop_for_it', `Only the owner of a ${typeOf(product.type).label.toLowerCase()} can buy ${product.label.toLowerCase()} wholesale.`);
        const paid = act(life, cityId, { op: 'bag-add', product: product.id, units, amount: productCost(product, cityId) * units, label: product.label });
        if (!paid.ok) return refuse(paid);
        return { ok: true as const, code: 'bagged' };
      });
      return { body: { ...outcome, state: life, ...mineBody(db, cityId, who, life) }, push };
    },
    /** Put what is carried on the shelves: everything of the stall's type that fits. */
    bagStock(db: Db, request: RouteRequest, cityId: CityId, body: Record<string, unknown>) {
      const { session, who, life, b } = enter(db, request, cityId), push: Push = [];
      const outcome = ctx.once(db, session, { id: body.requestId, kind: 'business.bag-stock', fingerprint: [cityId] }, () => {
        const shop = owned(db, b, who, push);
        if (isRefusal(shop)) return shop;
        const block = behindCounter(shop, life, 'unpack your goods');
        if (block) return block;
        let room = capacityOf(shop) - stockUnits(shop);
        const items: Record<string, number> = {};
        for (const [id, carried] of Object.entries(life.business.bag)) {
          const units = productOf(shop.type, id) ? Math.min(carried, room) : 0;
          if (units > 0) { items[id] = units; room -= units; }
        }
        if (!Object.keys(items).length) return no('nothing_to_unpack', capacityOf(shop) - stockUnits(shop) > 0 ? 'Nothing you carry belongs on this stall.' : 'Your stall is full. Sell some stock first.');
        const taken = act(life, cityId, { op: 'bag-take', items });
        if (!taken.ok) return refuse(taken);
        for (const [id, units] of Object.entries(items)) shop.stock[id] = (shop.stock[id] ?? 0) + units;
        return { ok: true as const, code: 'unpacked', units: Object.values(items).reduce((sum, units) => sum + units, 0) };
      });
      return { body: { ...outcome, state: life, ...mineBody(db, cityId, who, life) }, push };
    },
    /** Sell the whole bag back to a supplier at BUSINESS.buyback of the origin price. */
    bagReturn(db: Db, request: RouteRequest, cityId: CityId, body: Record<string, unknown>) {
      const { session, who, life } = enter(db, request, cityId), push: Push = [];
      const outcome = ctx.once(db, session, { id: body.requestId, kind: 'business.bag-return', fingerprint: [cityId] }, () => {
        if (!businessVenue(cityId, life.location) || !canOccupyVenue(life, life.location)) return no('not_at_market', 'A supplier at any market buys goods back. Go to one first.');
        const amount = Object.entries(life.business.bag).reduce((sum, [id, units]) => { const product = BUSINESS_PRODUCTS.get(id); return sum + (product ? Math.floor(product.base * BUSINESS.originRate * BUSINESS.buyback) * units : 0); }, 0);
        const paid = act(life, cityId, { op: 'bag-return', amount });
        if (!paid.ok) return refuse(paid);
        return { ok: true as const, code: 'returned', amount };
      });
      return { body: { ...outcome, state: life, ...mineBody(db, cityId, who, life) }, push };
    },

    /** One player buys from another's stall. */
    buy(db: Db, request: RouteRequest, cityId: CityId, body: Record<string, unknown>) {
      const { session, who, life, b } = enter(db, request, cityId), push: Push = [];
      const shopId = typeof body.shop === 'string' ? body.shop : '';
      const outcome = ctx.once(db, session, { id: body.requestId, kind: 'business.buy', fingerprint: [cityId, shopId, String(body.product ?? ''), String(body.units ?? '')] }, () => {
        const shop = ownShop(b, shopId);
        if (!shop || shop.city !== cityId) return no('no_such_shop', 'That stall is not here any more.');
        settle(db, shop, push);
        if (!standsIn(life, shop.city, shop.venue)) return no('not_at_shop', `Go to ${venueOf(shop)?.name ?? 'the market'} to buy from ${shop.name}.`);
        if (who.id !== shop.by.id && blocked(who.id, shop.by.id)) return no('blocked', 'You cannot buy from this stall.');
        const block = saleBlock(shop, who.id, body.product, body.units);
        if (block) return no(block.code, block.reason);
        if (sharedDevice(db, who.id, shop.by.id)) return no('same_device', 'This stall was opened on a device you have used. Buying from your own stalls is not allowed.');
        const product = productOf(shop.type, body.product), units = body.units as number;
        if (!product) return no('unknown_product', 'That is not on this stall’s menu.');
        const amount = (shop.prices[product.id] ?? product.base) * units, label = productLabel(product, shop.city);
        if (addressSpent(shop.by.id, request.ip) + amount > BUSINESS.pairPerDay) return no('pair_limit', `Buyers on your network have spent all that one network may at this stall today (${naira(BUSINESS.pairPerDay)}). Try another stall.`);
        const paid = act(life, cityId, { op: 'buy', amount, units, label, shop: shop.name, effects: product.effects ?? {}, ...(product.need ? { need: product.need } : {}), ...(product.mood ? { mood: product.mood } : {}) });
        if (!paid.ok) return refuse(paid);
        sellToPlayer(shop, who.id, product.id, units);
        addressSpent(shop.by.id, request.ip, amount);
        tell(db, shop.by.id, `${who.name} bought ${units} × ${label} at ${shop.name} (${naira(amount)}).`, push);
        return { ok: true as const, code: 'bought', amount };
      });
      const venueId = ownShop(b, shopId)?.venue ?? life.location;
      return { body: { ...outcome, state: life, market: venueView(db, cityId, venueId, who, life) }, push };
    },

    /** A rating is its own guard: it uses up the buyer's place on the shop's list, so a repeat finds nothing to rate. */
    rate(db: Db, request: RouteRequest, cityId: CityId, body: Record<string, unknown>) {
      const { who, life, b } = enter(db, request, cityId), push: Push = [];
      const shop = ownShop(b, typeof body.shop === 'string' ? body.shop : null);
      const run = (): Refusal | Done => {
        if (!shop || shop.city !== cityId) return no('no_such_shop', 'That stall is not here any more.');
        settle(db, shop, push);
        if (typeof body.stars !== 'number' || !rateShop(shop, who.id, body.stars)) return no('nothing_to_rate', 'Buy something here first: one rating for each purchase.');
        return { ok: true, code: 'rated' };
      };
      const result = run();
      return { body: { ...result, market: venueView(db, cityId, shop?.venue ?? life.location, who, life) }, push };
    },

    report(db: Db, request: RouteRequest, cityId: CityId, body: Record<string, unknown>): { body: Refusal | Done; push: Push } {
      const { who, b } = enter(db, request, cityId);
      const shop = ownShop(b, typeof body.shop === 'string' ? body.shop : null), reason = REPORT_REASONS.find((item) => item === body.reason);
      if (!shop || !reason) return { body: no('invalid_report', 'Choose a stall and a reason.'), push: [] };
      if (shop.by.id === who.id) return { body: no('own_shop', 'This is your own stall.'), push: [] };
      if (!b.reports.some((item) => item.shop === shop.by.id && item.by === who.id)) {
        const entry: ShopReport = { id: (b.seq += 1), shop: shop.by.id, name: shop.name, by: who.id, reason, at: now() };
        b.reports.push(entry);
        if (b.reports.length > BUSINESS.reports) b.reports.splice(0, b.reports.length - BUSINESS.reports);
      }
      return { body: { ok: true, code: 'reported' }, push: [] };
    },

    // ---- the operator -----------------------------------------------------------------------------
    modReports(db: Db) {
      const b = peekBusiness(db);
      return { reports: b.reports.map((item) => ({ ...item, live: sound(b.shops[item.shop]), current: sound(b.shops[item.shop]) ? b.shops[item.shop]?.name : null })), shops: Object.values(b.shops).filter(sound).length };
    },
    /** Replace a stall's name with a neutral one. Returns the old name, or null when there is no such shop. */
    modRename(db: Db, shopId: unknown, push: Push): { old: string; by: PlayerRef } | null {
      const b = businessOf(ctx, db), shop = ownShop(b, typeof shopId === 'string' ? shopId : null);
      if (!shop) return null;
      const old = shop.name;
      shop.name = `${typeOf(shop.type).label} ${shop.by.id.slice(0, 4)}`;
      b.reports = b.reports.filter((item) => item.shop !== shop.by.id);
      tell(db, shop.by.id, 'A moderator removed your stall’s name. The stall is still open under a plain name.', push);
      return { old, by: { id: shop.by.id, name: shop.by.name } };
    },
    /** Close a stall. Its owner is owed what closing by choice would have paid, and collects it in the Business app. */
    modClose(db: Db, shopId: unknown, push: Push): { name: string; by: PlayerRef; owed: number } | null {
      const b = businessOf(ctx, db), shop = ownShop(b, typeof shopId === 'string' ? shopId : null);
      if (!shop || shop.status === 'closed') return null;
      settle(db, shop, push);
      const owed = windUp(shop, now(), Math.floor(shop.paid * BUSINESS.closeRefund));
      b.reports = b.reports.filter((item) => item.shop !== shop.by.id);
      tell(db, shop.by.id, `A moderator closed ${shop.name}. ${naira(owed)} is waiting for you in Phone → Business.`, push);
      return { name: shop.name, by: { id: shop.by.id, name: shop.by.name }, owed };
    },
    /** Send what a committed transaction owed. */
    deliver(push: Push): void { for (const [to, frame] of push) { try { ctx.push(to, frame as never); } catch { /* a socket that went away */ } } },
  };
}
