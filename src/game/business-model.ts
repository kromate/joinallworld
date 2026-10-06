/**
 * OWNER: business
 * THE SHOP RULES. Pure: a shop record, a time and the market it stands in go in; the record is brought up to that
 * time. No I/O, no clock of its own, no random numbers — the same record and the same time always give the same shop,
 * so a screen that only reads and a request that writes agree on what the passers-by bought.
 *
 * Read by the servers (server/business/service.ts) and the simulation (scripts/economy-sim.ts). The page never
 * imports this file or content/business.ts: the routes answer with what a screen needs.
 *
 * HOW A SHOP MOVES THROUGH TIME (settleShop)
 *   The record's `at` is the time it is true for. Bringing it to `now` walks the hours in between:
 *     - in a trading hour, the hour's share of the day's customers arrives; each wants one product, chosen among what is
 *       in stock by the products' shares; a part of them buys, by the price (demandAt). Stock goes down, the cash box up.
 *     - at midnight (Lagos time) the day is closed: reputation moves by how many of the day's customers were served,
 *       and a part of unsold food spoils.
 *     - when the paid rent runs out, the next period is taken from the cash box. A box that cannot cover it leaves the
 *       rent overdue (`owed`): the stall keeps trading and the rent is taken the moment the box holds it. A stall whose
 *       rent is still overdue after BUSINESS.graceDays is wound up: its stock is bought back at BUSINESS.buyback of
 *       its cost, the rent is taken from that, and the rest stays in `till` for the owner to collect.
 *   Every naira a passer-by pays is one unit of stock the owner paid the supplier for: the faucet is bounded by the
 *   customers-a-day figure, the price band and the stall's capacity, whatever the length of the interval.
 */
import { cachedCityContent } from './cities/registry.ts';
import { lagosDayStart, lagosTime } from './clock.ts';
import { naira } from './util.ts';
import { BUSINESS, BUSINESS_PRODUCTS, BUSINESS_TYPES, BUSINESS_UPGRADES, BUSINESS_VENUES, LOCAL_PLATES } from './content/business.ts';
import type { BusinessProduct, BusinessType, BusinessTypeId, BusinessUpgradeId, BusinessVenue, ShopRecord } from '../types/business.ts';

const HOUR_MS = 3600000, DAY_MS = 86400000;
/** Something that happened to a shop while it was brought up to date; the server tells the owner. */
export type ShopEvent = { kind: 'rent'; amount: number; at: number } | { kind: 'due'; amount: number; at: number } | { kind: 'closed'; at: number; claim: number };

// ---- the catalogue -------------------------------------------------------------------------------

export const isBusinessType = (value: unknown): value is BusinessTypeId => typeof value === 'string' && Object.hasOwn(BUSINESS_TYPES, value);
export const typeOf = (id: BusinessTypeId): BusinessType => BUSINESS_TYPES[id];
/** A product of a type, or undefined. */
export const productOf = (type: BusinessTypeId, id: unknown): BusinessProduct | undefined => BUSINESS_TYPES[type].products.find((product) => product.id === id);
/** What a product is called in a city (a food stall's plate of the day has the city's own name). */
export const productLabel = (product: Pick<BusinessProduct, 'id' | 'label'>, city: string): string => (product.id === 'local-plate' ? cachedCityContent(city)?.business?.plate ?? LOCAL_PLATES[city] ?? product.label : product.label);
/** Does the supplier in this city sell the product at its origin price? */
export const isLocal = (product: BusinessProduct, city: string): boolean => product.origin?.includes(city) === true || cachedCityContent(city)?.business?.localProductIds.includes(product.id) === true;
/** The supplier's price of one unit in a city, in whole naira. */
export const productCost = (product: BusinessProduct, city: string): number => Math.round(product.base * (isLocal(product, city) ? BUSINESS.originRate : BUSINESS.costRate) / 10) * 10;
/** The lowest and highest price an owner may ask. */
export const priceBand = (product: BusinessProduct): { min: number; max: number } => ({ min: Math.ceil(product.base * BUSINESS.band.min / 10) * 10, max: Math.floor(product.base * BUSINESS.band.max / 10) * 10 });
/** What buying one does, in words. */
export function productDoes(product: BusinessProduct): string {
  const parts = Object.entries(product.effects ?? {}).map(([need, amount]) => `${amount > 0 ? '+' : ''}${amount} ${need}`);
  if (product.mood) parts.push(`${product.mood.label} (+${product.mood.value} mood, ${product.mood.hours} h)`);
  return parts.join(' · ');
}
/** Trade goods: products with an origin, which can be carried between cities. */
export const tradeGoods = (): (BusinessProduct & { type: BusinessTypeId })[] => [...BUSINESS_PRODUCTS.values()].filter((product) => product.origin !== undefined);

/** The market at a venue, or null when the venue rents no stalls (or the city's content is not loaded). */
export function businessVenue(city: unknown, venue: unknown): BusinessVenue | null {
  const content = cachedCityContent(city);
  const found = content?.venues.find((item) => item.id === venue);
  if (!content || !found || found.kind !== BUSINESS.hostKind) return null;
  const rule = content.business?.markets[found.id] ?? BUSINESS_VENUES[`${content.cityId}:${found.id}`];
  const hours = found.hours && found.hours.close > found.hours.open ? { open: found.hours.open, close: found.hours.close } : BUSINESS.hours;
  return { city: content.cityId, venue: found.id, name: found.name, known: rule?.known ?? [], footfall: rule?.footfall ?? 1, stalls: rule?.stalls ?? BUSINESS.stalls, hours };
}
/** Every market of a city, in content order. */
export function businessVenues(city: unknown): BusinessVenue[] {
  const content = cachedCityContent(city);
  return (content?.venues ?? []).flatMap((item) => { const market = businessVenue(city, item.id); return market ? [market] : []; });
}

// ---- one shop's figures --------------------------------------------------------------------------

const upgradesOf = (shop: Pick<ShopRecord, 'upgrades'>) => BUSINESS_UPGRADES.filter((upgrade) => shop.upgrades.includes(upgrade.id));
const times = (values: (number | undefined)[]): number => values.reduce<number>((total, value) => total * (value ?? 1), 1);
export const starsOf = (rep: number): number => Math.round((1 + Math.min(100, Math.max(0, rep)) / 25) * 10) / 10;
export const capacityOf = (shop: Pick<ShopRecord, 'type' | 'upgrades'>): number => Math.round(typeOf(shop.type).capacity * times(upgradesOf(shop).map((upgrade) => upgrade.capacity)));
export const rentOf = (shop: Pick<ShopRecord, 'type' | 'upgrades'>): number => Math.round(typeOf(shop.type).rent * times(upgradesOf(shop).map((upgrade) => upgrade.rent)));
export const spoilOf = (shop: Pick<ShopRecord, 'type' | 'upgrades'>): number => { const base = typeOf(shop.type).spoil; return base === undefined ? 0 : upgradesOf(shop).reduce((rate, upgrade) => upgrade.spoil ?? rate, base); };
export const stockUnits = (shop: Pick<ShopRecord, 'stock'>): number => Object.values(shop.stock).reduce((sum, units) => sum + units, 0);
const sizeOf = (shop: Pick<ShopRecord, 'upgrades'>): number => times(upgradesOf(shop).map((upgrade) => upgrade.customers));
/** Customers who want something on one whole trading day, with every multiplier. */
export function customersOf(shop: Pick<ShopRecord, 'type' | 'upgrades' | 'rep'>, venue: Pick<BusinessVenue, 'known' | 'footfall'>): number {
  const rep = BUSINESS.rep.low + (BUSINESS.rep.high - BUSINESS.rep.low) * Math.min(100, Math.max(0, shop.rep)) / 100;
  return typeOf(shop.type).customers * venue.footfall * (venue.known.includes(shop.type) ? BUSINESS.knownBonus : 1) * rep * sizeOf(shop);
}
/** The most units passers-by buy from this shop in one day, whatever its reputation, market or prices. */
export const dayCeiling = (shop: Pick<ShopRecord, 'type' | 'upgrades'>): number => Math.ceil(typeOf(shop.type).customers * sizeOf(shop) * BUSINESS.dayCeiling);
/** The part of the interested customers who buy at `price ÷ base`. */
export function demandAt(ratio: number): number {
  const curve = BUSINESS.demand;
  if (!(ratio > curve[0][0])) return curve[0][1];
  for (let index = 1; index < curve.length; index++) {
    const [x1, y1] = curve[index] as readonly [number, number], [x0, y0] = curve[index - 1] as readonly [number, number];
    if (ratio <= x1) return y0 + (y1 - y0) * (ratio - x0) / (x1 - x0);
  }
  return 0;
}
/** What is on the shelves at the lowest price any of it can have been bought for (the origin price), so that a buyback — BUSINESS.buyback of this — never pays what a unit cost. */
export const stockValue = (shop: Pick<ShopRecord, 'stock' | 'type'>): number => typeOf(shop.type).products.reduce((sum, item) => sum + (shop.stock[item.id] ?? 0) * Math.round(item.base * BUSINESS.originRate / 10) * 10, 0);
/** What closing by choice pays back now: part of setup and upgrades, part of the stock's cost, and the whole cash box. */
export const closeValue = (shop: Pick<ShopRecord, 'stock' | 'type' | 'paid' | 'till'>): number => Math.floor(shop.paid * BUSINESS.closeRefund) + Math.floor(stockValue(shop) * BUSINESS.buyback) + shop.till;

/** A new shop, open, paid for one period, at 3 stars, with every product at its base price and nothing in stock. */
export function newShop(input: { by: { id: string; name: string }; city: string; venue: string; type: BusinessTypeId; name: string; colour: string; icon: string }, now: number): ShopRecord {
  const type = typeOf(input.type);
  return {
    by: { id: input.by.id, name: input.by.name }, city: input.city, venue: input.venue, type: input.type, name: input.name, colour: input.colour, icon: input.icon,
    status: 'open', openedAt: now, at: now, paidUntil: now + BUSINESS.rentDays * DAY_MS,
    stock: Object.fromEntries(type.products.map((item) => [item.id, 0])), prices: Object.fromEntries(type.products.map((item) => [item.id, item.base])), part: {},
    owed: 0, till: 0, sold: 0, rep: BUSINESS.rep.start, ratings: { n: 0, sum: 0 }, upgrades: [], paid: type.setup,
    day: lagosTime(now).day, came: 0, served: 0, npc: 0, fromPlayers: 0, takings: 0, buyers: {}, raters: [], total: { sold: 0, takings: 0, rent: 0 },
  };
}

// ---- time ----------------------------------------------------------------------------------------

/** Close the day the counters belong to and start `day`. */
function turnDay(shop: ShopRecord, day: number): void {
  if (shop.came > 0) {
    const rule = BUSINESS.rep, ratio = shop.served / shop.came;
    const change = shop.served <= 0 ? -rule.empty : ratio >= rule.good ? rule.up : ratio < rule.poor ? -rule.down : 0;
    shop.rep = Math.min(100, Math.max(0, shop.rep + change));
  }
  const spoil = spoilOf(shop);
  if (spoil > 0) for (const item of typeOf(shop.type).products) shop.stock[item.id] = (shop.stock[item.id] ?? 0) - Math.floor((shop.stock[item.id] ?? 0) * spoil);
  shop.day = day; shop.came = 0; shop.served = 0; shop.npc = 0; shop.fromPlayers = 0; shop.takings = 0; shop.buyers = {};
}

/** Passers-by for `hours` of the hour `hour` (0–23). */
function sell(shop: ShopRecord, venue: BusinessVenue, hour: number, hours: number): void {
  const type = typeOf(shop.type);
  if (hour < venue.hours.open || hour >= venue.hours.close) return;
  let weights = 0;
  for (let h = venue.hours.open; h < venue.hours.close; h++) weights += type.hours[h] ?? 0;
  const weight = type.hours[hour] ?? 0;
  if (!(weights > 0) || !(weight > 0)) return;
  const came = customersOf(shop, venue) * (weight / weights) * hours;
  shop.came += came;
  if (shop.till >= BUSINESS.tillCap) return;
  const stocked = type.products.filter((item) => (shop.stock[item.id] ?? 0) > 0);
  const share = stocked.reduce((sum, item) => sum + item.share, 0);
  if (!(share > 0)) return;
  const served = came * (BUSINESS.rangeFloor + (1 - BUSINESS.rangeFloor) * Math.min(1, share));
  const ceiling = dayCeiling(shop);
  for (const item of stocked) {
    const price = shop.prices[item.id] ?? item.base;
    const wanted = (shop.part[item.id] ?? 0) + served * (item.share / share) * demandAt(price / item.base);
    const room = Math.min(shop.stock[item.id] ?? 0, Math.max(0, ceiling - shop.npc), price > 0 ? Math.ceil(Math.max(0, BUSINESS.tillCap - shop.till) / price) : 0);
    const units = Math.min(Math.floor(wanted), room);
    // What could not be sold (no stock, the day's ceiling, a full box) is not carried over as a sale waiting to happen.
    shop.part[item.id] = units < Math.floor(wanted) ? 0 : wanted - units;
    if (units <= 0) continue;
    shop.stock[item.id] = (shop.stock[item.id] ?? 0) - units;
    shop.till += units * price; shop.takings += units * price; shop.total.takings += units * price;
    shop.sold += units; shop.served += units; shop.npc += units; shop.total.sold += units;
  }
}

/** Wind a shop up: the stock is bought back, overdue rent is taken, and what is left for the owner (plus `refund`) waits in `till`. */
export function windUp(shop: ShopRecord, at: number, refund: number): number {
  shop.till = Math.max(0, shop.till + Math.floor(stockValue(shop) * BUSINESS.buyback) + refund - shop.owed);
  for (const id of Object.keys(shop.stock)) shop.stock[id] = 0;
  shop.status = 'closed'; shop.closedAt = at; shop.owed = 0; shop.at = Math.max(shop.at, at); shop.part = {};
  return shop.till;
}

/**
 * Bring a shop to `now` (mutates it). Returns what happened on the way, oldest first. A shop whose market no longer
 * exists stops where it is. Calling it twice with the same time changes nothing the second time.
 * One step is at most an hour (at most a day's 24 for each day away), and a stall nobody stocks is wound up
 * BUSINESS.graceDays after its paid rent runs out, so the walk is bounded by the rent paid ahead.
 */
export function settleShop(shop: ShopRecord, now: number, venue: BusinessVenue | null): ShopEvent[] {
  const events: ShopEvent[] = [];
  if (!(now > shop.at)) return events;
  if (!venue || shop.status === 'closed') { shop.at = now; return events; }
  const grace = BUSINESS.graceDays * DAY_MS, period = BUSINESS.rentDays * DAY_MS;
  while (shop.at < now) {
    const time = lagosTime(shop.at);
    if (time.day !== shop.day) turnDay(shop, time.day);
    // A step ends at the next hour, or sooner at the moment rent falls due or the grace runs out.
    const rentAt = shop.owed > 0 ? shop.paidUntil + grace : shop.paidUntil;
    let end = Math.min(now, lagosDayStart(time.day) + (time.hour + 1) * HOUR_MS);
    if (rentAt > shop.at && rentAt < end) end = rentAt;
    sell(shop, venue, time.hour, (end - shop.at) / HOUR_MS);
    shop.at = end;
    const fell = shop.owed <= 0 && shop.at >= shop.paidUntil;
    if (fell) shop.owed = rentOf(shop);
    if (shop.owed > 0 && shop.till >= shop.owed) {
      shop.till -= shop.owed; shop.total.rent += shop.owed; shop.paidUntil += period;
      events.push({ kind: 'rent', amount: shop.owed, at: shop.at });
      shop.owed = 0;
    } else if (fell) events.push({ kind: 'due', amount: shop.owed, at: shop.at });
    if (shop.owed > 0 && shop.at >= shop.paidUntil + grace) { events.push({ kind: 'closed', at: shop.at, claim: windUp(shop, shop.at, 0) }); shop.at = now; break; }
  }
  const today = lagosTime(now).day;
  if (shop.status === 'open' && today !== shop.day) turnDay(shop, today);
  return events;
}

/** The shop as it stands at `now`, without changing the stored record. */
export function shopAt(shop: ShopRecord, now: number, venue: BusinessVenue | null): ShopRecord {
  const copy = JSON.parse(JSON.stringify(shop)) as ShopRecord;
  settleShop(copy, now, venue);
  return copy;
}

/** When the market winds up a stall whose rent is overdue, or null for one that owes nothing. */
export const closesAt = (shop: Pick<ShopRecord, 'status' | 'owed' | 'paidUntil'>): number | null => (shop.status === 'open' && shop.owed > 0 ? shop.paidUntil + BUSINESS.graceDays * DAY_MS : null);

// ---- what an owner or a buyer does to a settled shop ---------------------------------------------

export type ShopBlock = { code: string; reason: string };

/** Why these units cannot be put on the shelves, or null. `items` is { productId: units }. */
export function stockBlock(shop: ShopRecord, items: Record<string, number>): ShopBlock | null {
  const entries = Object.entries(items);
  if (!entries.length) return { code: 'nothing_chosen', reason: 'Choose how many of something to buy.' };
  for (const [id, units] of entries) {
    if (!productOf(shop.type, id)) return { code: 'unknown_product', reason: `A ${typeOf(shop.type).label.toLowerCase()} does not sell that.` };
    if (!Number.isSafeInteger(units) || units <= 0) return { code: 'invalid_units', reason: 'Choose a whole number of units.' };
  }
  const room = capacityOf(shop) - stockUnits(shop), units = entries.reduce((sum, [, n]) => sum + n, 0);
  if (units > room) return { code: 'no_room', reason: room > 0 ? `Your stall has room for ${room} more unit${room === 1 ? '' : 's'}.` : 'Your stall is full. Sell some stock first, or add storage.' };
  return null;
}
/** The supplier's bill for `items` in the shop's city. */
export const stockCost = (shop: Pick<ShopRecord, 'type' | 'city'>, items: Record<string, number>): number => Object.entries(items).reduce((sum, [id, units]) => { const item = productOf(shop.type, id); return sum + (item ? productCost(item, shop.city) * units : 0); }, 0);

/** Why a price cannot be set, or null. */
export function priceBlock(shop: Pick<ShopRecord, 'type'>, id: unknown, price: unknown): ShopBlock | null {
  const item = productOf(shop.type, id);
  if (!item) return { code: 'unknown_product', reason: 'That is not on this stall’s menu.' };
  const band = priceBand(item);
  if (typeof price !== 'number' || !Number.isSafeInteger(price) || price < band.min || price > band.max) return { code: 'price_outside_band', reason: `${item.label} can be priced from ${naira(band.min)} to ${naira(band.max)}.` };
  return null;
}

/** Why `buyer` cannot buy `units` of a product here now, or null. The buyer's own limits are the rules engine's. */
export function saleBlock(shop: ShopRecord, buyer: string, id: unknown, units: unknown): ShopBlock | null {
  if (shop.status !== 'open') return { code: 'shop_closed', reason: `${shop.name} has closed.` };
  if (buyer === shop.by.id) return { code: 'own_shop', reason: 'This is your own stall. Its stock is for your customers.' };
  const item = productOf(shop.type, id);
  if (!item) return { code: 'unknown_product', reason: 'That is not on this stall’s menu.' };
  if (typeof units !== 'number' || !Number.isSafeInteger(units) || units < 1 || units > BUSINESS.qtyMax) return { code: 'invalid_units', reason: `Buy 1 to ${BUSINESS.qtyMax} at a time.` };
  const stock = shop.stock[item.id] ?? 0;
  if (stock < units) return { code: 'sold_out', reason: stock > 0 ? `Only ${stock} left.` : `${item.label} is sold out here.` };
  const amount = (shop.prices[item.id] ?? item.base) * units, mine = shop.buyers[buyer] ?? { s: 0, n: 0 };
  if (mine.n + units > BUSINESS.pairItemsPerDay) return { code: 'pair_limit', reason: `You can buy ${BUSINESS.pairItemsPerDay} items a day at one stall. Come back tomorrow, or try another stall.` };
  if (mine.s + amount > BUSINESS.pairPerDay) return { code: 'pair_limit', reason: `You can spend ${naira(BUSINESS.pairPerDay)} a day at one stall. ${naira(Math.max(0, BUSINESS.pairPerDay - mine.s))} is left here today.` };
  if (shop.fromPlayers + amount > BUSINESS.shopPerDay) return { code: 'shop_limit', reason: `${shop.name} has sold all it can to players today. Come back tomorrow.` };
  if (Object.keys(shop.buyers).length >= 400 && !shop.buyers[buyer]) return { code: 'shop_limit', reason: `${shop.name} has served all the players it can today.` };
  return null;
}
/** Record a sale to a player on a settled, open shop. Returns the naira paid. Call saleBlock first. */
export function sellToPlayer(shop: ShopRecord, buyer: string, id: string, units: number): number {
  const item = productOf(shop.type, id);
  if (!item) return 0;
  const amount = (shop.prices[item.id] ?? item.base) * units, mine = shop.buyers[buyer] ??= { s: 0, n: 0 };
  shop.stock[item.id] = (shop.stock[item.id] ?? 0) - units;
  shop.till += amount; shop.takings += amount; shop.fromPlayers += amount; shop.total.takings += amount;
  shop.sold += units; shop.served += units; shop.total.sold += units;
  mine.s += amount; mine.n += units;
  shop.raters = [...shop.raters.filter((other) => other !== buyer), buyer].slice(-BUSINESS.raters);
  return amount;
}
/** A buyer's rating, once per purchase. Returns false when this buyer has nothing to rate. */
export function rateShop(shop: ShopRecord, buyer: string, stars: number): boolean {
  if (!shop.raters.includes(buyer) || !Number.isSafeInteger(stars) || stars < 1 || stars > 5) return false;
  shop.raters = shop.raters.filter((other) => other !== buyer);
  shop.ratings = { n: shop.ratings.n + 1, sum: shop.ratings.sum + stars };
  shop.rep = Math.min(100, Math.max(0, Math.round((shop.rep + (stars * 20 - shop.rep) * BUSINESS.rep.rating) * 100) / 100));
  return true;
}
/** The next upgrade's block, or null. */
export function upgradeBlock(shop: Pick<ShopRecord, 'upgrades'>, id: unknown): ShopBlock | null {
  const upgrade = BUSINESS_UPGRADES.find((item) => item.id === id);
  if (!upgrade) return { code: 'unknown_upgrade', reason: 'Choose an upgrade from the list.' };
  if (shop.upgrades.includes(upgrade.id)) return { code: 'already_upgraded', reason: `Your stall already has: ${upgrade.label}.` };
  return null;
}
export const upgradeOf = (id: unknown) => BUSINESS_UPGRADES.find((item) => item.id === id);
export type { BusinessUpgradeId };
