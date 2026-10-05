/**
 * Businesses in the economy simulation: scripted owners and buyers on the virtual clock, played through the real rules
 * engine (every naira moves through 'business.server' on a real life) and the real shop rules (src/game/business-model.ts).
 * The steps an owner takes here are the ones server/business/service.ts takes, in the same order.
 *
 *   node --experimental-strip-types scripts/business-sim.ts [--days 30]      (also printed by `npm run economy`)
 *
 * WHO PLAYS, each for `days` Lagos days with the same start (the birth lottery's richest outcome, so that capital is never
 * what limits a strategy), and no job unless said:
 *   diligent        a food stall at the Lagos market: fills the shelves each morning, tops up after lunch, collects, base prices
 *   average         the same stall visited once a day, in the morning
 *   diligent+       the same with every upgrade bought on day one — the ceiling of what one stall can make
 *   provisions      a provisions kiosk, the same routine
 *   absentee        the food stall, visited every fourth day
 *   never returns   opens, stocks once and never comes back: what rent does to an abandoned stall
 *   gouger          the diligent routine with every price at the top of the band
 *   discounter      the diligent routine with every price at the bottom of the band
 *   trader          a fabric stall in Lagos whose adire comes from Abeokuta in the bag, a trip whenever it runs low
 *   trader (local)  the same fabric stall, stocked from the Lagos supplier only
 *   colluding pair  the diligent owner, and a second player with a career whose only aim is to pass the owner money:
 *                   every day they buy as much as every rule allows, at the top of the band. The row shows what the
 *                   owner gained OVER the diligent owner, and what it cost the buyer.
 * and, for the comparison, the career player of the main table.
 *
 * WHAT IT CHECKS, for every shop: takings = cash box + collected + rent taken from the box (nothing appears or vanishes
 * inside a shop), and cash = seed + Σ ledger for every life. The assertions are in src/game/economy.test.ts.
 */
import { cachedCityContent, loadCityContent } from '../src/game/cities/registry.ts';
await Promise.all(['lagos', 'abeokuta'].map(loadCityContent));
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { BUSINESS, BUSINESS_PRODUCTS, BUSINESS_UPGRADES } from '../src/game/content/business.ts';
import {
  businessVenue, capacityOf, closeValue, newShop, priceBand, productCost, productOf, rentOf, saleBlock, sellToPlayer, settleShop, starsOf, stockCost, stockUnits, typeOf,
} from '../src/game/business-model.ts';
import { buyBlock } from '../src/game/systems/business.ts';
import { BAG_LIMIT } from '../src/game/content/business-limits.ts';
import { OWN, Player, SIM_START, STRATEGIES, categoryOf, simulate } from './economy-sim.ts';
import type { Strategy } from './economy-sim.ts';
import type { BusinessTypeId, BusinessVenue, ShopRecord } from '../src/types/business.ts';

const DAY = 86400000, HOUR = 3600000;
const must = <T>(value: T | null | undefined, what = 'value'): T => { if (value === null || value === undefined) throw new TypeError(`${what} is missing`); return value; };
const LOTTERY = 'ajebutter';
const CAREER: Strategy = STRATEGIES.career, CAREER_OPTIONS = { track: 'tech', budget: 300, mixBudget: 1800 };

/** One simulated shop with its owner: the service's steps, in the service's order. */
export class SimShop {
  shop: ShopRecord;
  venue: BusinessVenue;
  collected = 0;
  /** Naira of takings that came from players. */
  fromPlayers = 0;
  events: string[] = [];
  owner: Player;
  constructor(owner: Player, type: BusinessTypeId, city = 'lagos', venueId = 'market') {
    this.owner = owner;
    this.venue = must(businessVenue(city, venueId), 'market');
    const paid = owner.server('business.server', { op: 'open', amount: typeOf(type).setup, name: 'Sim stall', city, venue: venueId });
    if (!paid.ok) throw new Error(`open refused: ${paid.code}`);
    this.shop = newShop({ by: { id: 'owner', name: 'Owner' }, city, venue: venueId, type, name: 'Sim stall', colour: 'green', icon: typeOf(type).icon }, owner.now);
  }
  settle(now = this.owner.now): void { for (const event of settleShop(this.shop, now, this.venue)) this.events.push(event.kind); }
  /** Fill the shelves to `fill` of what they hold, in proportion to the products' shares (or with `only`), as far as the wallet goes. */
  restock(only?: string[], fill = 1): number {
    this.settle();
    if (this.shop.status !== 'open') return 0;
    const type = typeOf(this.shop.type), wanted = type.products.filter((item) => !only || only.includes(item.id));
    const share = wanted.reduce((sum, item) => sum + item.share, 0), capacity = Math.round(capacityOf(this.shop) * fill);
    const items: Record<string, number> = {};
    let room = capacity - stockUnits(this.shop);
    for (const item of wanted) {
      const target = Math.round(capacity * item.share / share), units = Math.min(room, Math.max(0, target - (this.shop.stock[item.id] ?? 0)));
      if (units > 0) { items[item.id] = units; room -= units; }
    }
    if (!Object.keys(items).length) return 0;
    const paid = this.owner.server('business.server', { op: 'spend', what: 'stock', amount: stockCost(this.shop, items), name: this.shop.name });
    if (!paid.ok) return 0;
    for (const [id, units] of Object.entries(items)) this.shop.stock[id] = (this.shop.stock[id] ?? 0) + units;
    return Object.values(items).reduce((sum, units) => sum + units, 0);
  }
  collect(): number {
    this.settle();
    const amount = this.shop.till;
    if (amount <= 0 || this.shop.owed > 0) return 0;
    const paid = this.owner.server('business.server', this.shop.status === 'closed' ? { op: 'refund', amount, name: this.shop.name } : { op: 'collect', amount, sales: this.shop.sold, name: this.shop.name });
    if (!paid.ok) return 0;
    this.shop.till = 0; this.shop.sold = 0; this.collected += amount;
    return amount;
  }
  priceAll(ratio: 'min' | 'max'): void { for (const item of typeOf(this.shop.type).products) this.shop.prices[item.id] = priceBand(item)[ratio]; }
  upgradeAll(): void {
    for (const upgrade of BUSINESS_UPGRADES) {
      if (!this.owner.server('business.server', { op: 'spend', what: 'upgrade', amount: upgrade.cost, name: this.shop.name }).ok) continue;
      this.shop.upgrades.push(upgrade.id); this.shop.paid += upgrade.cost;
    }
  }
  /** Buy trade goods for the road in the city the owner is in. */
  bagBuy(product: string, units: number): boolean {
    const item = must(BUSINESS_PRODUCTS.get(product));
    return this.owner.server('business.server', { op: 'bag-add', product, units, amount: productCost(item, this.owner.cityId) * units, label: item.label }).ok;
  }
  bagStock(): number {
    this.settle();
    let room = capacityOf(this.shop) - stockUnits(this.shop);
    const items: Record<string, number> = {};
    for (const [id, carried] of Object.entries(this.owner.state.business.bag)) { const units = productOf(this.shop.type, id) ? Math.min(carried, room) : 0; if (units > 0) { items[id] = units; room -= units; } }
    if (!Object.keys(items).length || !this.owner.server('business.server', { op: 'bag-take', items }).ok) return 0;
    for (const [id, units] of Object.entries(items)) this.shop.stock[id] = (this.shop.stock[id] ?? 0) + units;
    return Object.values(items).reduce((sum, units) => sum + units, 0);
  }
  /** `buyer` buys as the route would let them. Returns the naira paid (0 when any rule refused). */
  sellTo(buyer: Player, buyerId: string, product: string, units: number): number {
    this.settle(buyer.now);
    if (saleBlock(this.shop, buyerId, product, units)) return 0;
    const item = must(productOf(this.shop.type, product)), amount = (this.shop.prices[product] ?? item.base) * units;
    const paid = buyer.server('business.server', { op: 'buy', amount, units, label: item.label, shop: this.shop.name, effects: item.effects ?? {}, ...(item.need ? { need: item.need } : {}), ...(item.mood ? { mood: item.mood } : {}) });
    if (!paid.ok) return 0;
    this.fromPlayers += sellToPlayer(this.shop, buyerId, product, units);
    return amount;
  }
  /** takings = cash box + collected + rent taken from the box. (A wound-up stall's box also holds the buyback, less overdue rent: never more than that.) */
  balanced(): boolean {
    const held = this.shop.till + this.collected + this.rentFromBox();
    return this.shop.status === 'open' ? this.shop.total.takings === held : held <= this.shop.total.takings + this.shop.paid;
  }
  /** Rent the shop paid from its own box (the wallet's rent is in the ledger). */
  rentFromBox(): number { return this.shop.total.rent; }
}

export interface BusinessRow {
  label: string
  days: number
  /** The owner's cash change over the run, the cash box and what closing the stall would return added: what the business made. */
  profit: number
  perDay: number
  takings: number
  fromPlayers: number
  stock: number
  rent: number
  setup: number
  fares: number
  stars: number
  status: string
  activePerDay: number
  conserved: boolean
  note: string
}

const owner = (): Player => new Player({ lottery: LOTTERY, house: OWN });
const at = (day: number, hour: number): number => SIM_START + day * DAY + hour * HOUR;
/** Go to the market, do `work` there, and go home to eat and rest (free). */
function visit(player: Player, when: number, work: () => void): void {
  player.awayUntil(when);
  player.upkeep({ energy: 40, hunger: 45 });
  if (player.travel('market')) work();
  player.settle();
}
function finish(label: string, days: number, player: Player, sim: SimShop, startCash: number, note = ''): BusinessRow {
  sim.settle(SIM_START + days * DAY);
  player.settle();
  const flows: Record<string, number> = {};
  for (const line of player.lines) { const key = line.reason.split(':')[0] ?? ''; flows[key] = (flows[key] ?? 0) + line.amount; }
  const fares = player.lines.filter((line) => categoryOf(line) === 'transport').reduce((sum, line) => sum + line.amount, 0);
  const still = sim.shop.status === 'closed' ? sim.shop.till : closeValue(sim.shop);
  const bag = Object.entries(player.state.business.bag).reduce((sum, [id, units]) => sum + Math.floor(must(BUSINESS_PRODUCTS.get(id)).base * BUSINESS.originRate * BUSINESS.buyback) * units, 0);
  const profit = player.state.cash - startCash + still + bag;
  const ledger = player.lines.reduce((sum, line) => sum + line.amount, 0);
  return {
    label, days, profit, perDay: Math.round(profit / days), takings: sim.shop.total.takings, fromPlayers: sim.fromPlayers,
    stock: (flows['Shop stock'] ?? 0) + (flows['Shop goods'] ?? 0), rent: (flows['Shop rent'] ?? 0) - sim.rentFromBox(), setup: (flows['Shop setup'] ?? 0) + (flows['Shop upgrade'] ?? 0), fares,
    stars: starsOf(sim.shop.rep), status: sim.shop.status, activePerDay: Math.round(player.activeSeconds / days),
    conserved: sim.balanced() && player.seed + ledger === player.state.cash && !player.lines.some((line) => categoryOf(line) === 'other'), note,
  };
}

/** The routine of an owner who is there: twice a day, restock and collect. `every` > 1 visits only every nth day. */
function runOwner(label: string, days: number, { type = 'food' as BusinessTypeId, every = 1, price = null as 'min' | 'max' | null, upgrades = false, once = false, daily = false, note = '' } = {}): { row: BusinessRow; sim: SimShop; player: Player } {
  const player = owner(), startCash = player.state.cash;
  player.awayUntil(at(0, 7));
  must(player.travel('market') || null, 'the market');
  const sim = new SimShop(player, type);
  if (upgrades) sim.upgradeAll();
  if (price) sim.priceAll(price);
  sim.restock();
  for (let day = 0; day < days && !once; day++) {
    if (day % every) continue;
    // In the morning the shelves are filled; after lunch they are topped up to what the afternoon can sell (food left at midnight spoils).
    const perishable = typeOf(type).spoil !== undefined;
    visit(player, at(day, 7.5), () => { sim.collect(); sim.restock(); });
    if (every === 1 && !daily) visit(player, at(day, 14), () => { sim.collect(); sim.restock(undefined, perishable ? 0.5 : 1); });
  }
  player.awayUntil(at(days, 0));
  return { row: finish(label, days, player, sim, startCash, note), sim, player };
}

const OTHERS = ['ankara', 'aso-oke', 'indigo'], ADIRE_SHARE = 0.26;
/** The fabric stall: `trips` true stocks it from Abeokuta (adire at the origin price, carried in the bag), false from the Lagos supplier alone. */
function runTrader(label: string, days: number, trips: boolean): BusinessRow {
  const player = owner(), startCash = player.state.cash;
  player.awayUntil(at(0, 7));
  must(player.travel('market') || null, 'the market');
  const sim = new SimShop(player, 'fabric');
  if (trips) sim.restock(OTHERS, 1 - ADIRE_SHARE); else sim.restock();
  const go = (to: string): void => { player.settle(); player.must('estate.relocate', { to, mode: 'road' }); player.settle(); };
  let tripCount = 0, tripCost = 0;
  for (let day = 0; day < days; day++) {
    // A trip when the adire is nearly gone: a full bag each time.
    sim.settle(at(day, 8));
    if (trips && (sim.shop.stock.adire ?? 0) <= 2 && !Object.keys(player.state.business.bag).length) {
      player.awayUntil(at(day, 8));
      player.upkeep({ energy: 40, hunger: 45 });
      const before = player.state.cash;
      go('abeokuta');
      sim.bagBuy('adire', BAG_LIMIT);
      go('lagos');
      tripCount += 1; tripCost += before - player.state.cash;
    }
    // The shelf keeps adire's place (its share of the range) for what is in the bag; the Lagos supplier fills the rest.
    visit(player, at(day, 15), () => { sim.collect(); if (trips) { sim.restock(OTHERS, 1 - ADIRE_SHARE); sim.bagStock(); } else sim.restock(); });
  }
  player.awayUntil(at(days, 0));
  return finish(label, days, player, sim, startCash, trips ? `${tripCount} trips to Abeokuta, a full bag of adire each time (${BAG_LIMIT} units); fares and goods cost ₦${tripCost.toLocaleString('en-NG')}` : '');
}

/** The diligent owner and a buyer with a career who buys all the rules allow, at the top of the band, every day. */
function runColluders(days: number, baseline: BusinessRow): BusinessRow[] {
  const player = owner(), startCash = player.state.cash;
  const buyer = new Player({ lottery: LOTTERY, house: OWN });
  CAREER.first?.(buyer, CAREER_OPTIONS);
  const buyerStart = buyer.state.cash;
  player.awayUntil(at(0, 7));
  must(player.travel('market') || null, 'the market');
  const sim = new SimShop(player, 'food');
  sim.priceAll('max');
  sim.restock();
  let spent = 0, refused = 0;
  for (let day = 0; day < days; day++) {
    visit(player, at(day, 7.5), () => { sim.collect(); sim.restock(); });
    // The buyer works first (only money earned from work may be spent at a player's shop), then goes to the market.
    buyer.awayUntil(at(day, 9));
    CAREER.day(buyer, day, CAREER_OPTIONS);
    buyer.settle();
    buyer.awayUntil(at(day, 16));
    if (buyer.travel('market')) {
      for (let tries = 0; tries < 12; tries++) {
        // Whatever is dearest and still allowed, three at a time.
        const dearest = typeOf(sim.shop.type).products.slice().sort((a, b) => (sim.shop.prices[b.id] ?? 0) - (sim.shop.prices[a.id] ?? 0));
        const paid = dearest.reduce((got, item) => got || sim.sellTo(buyer, 'buyer', item.id, BUSINESS.qtyMax) || sim.sellTo(buyer, 'buyer', item.id, 1), 0);
        if (!paid) { refused += 1; break; }
        spent += paid;
      }
    }
    buyer.settle();
    visit(player, at(day, 18), () => { sim.collect(); sim.restock(undefined, 0.5); });
  }
  player.awayUntil(at(days, 0));
  buyer.awayUntil(at(days, 0));
  const row = finish('colluding pair: the owner', days, player, sim, startCash);
  const career = simulate({ lottery: LOTTERY, house: OWN, strategy: 'career', days });
  const buyerNet = buyer.state.cash - buyerStart, careerNet = must(career.final).cash - career.startCash;
  row.note = `owner made ₦${(row.profit - baseline.profit).toLocaleString('en-NG')} more than the gouger alone over ${days} days; the buyer paid ₦${spent.toLocaleString('en-NG')} for it`;
  const ledger = buyer.lines.reduce((sum, line) => sum + line.amount, 0);
  const buyerRow: BusinessRow = { label: 'colluding pair: the buyer (career)', days, profit: buyerNet, perDay: Math.round(buyerNet / days), takings: 0, fromPlayers: -spent, stock: 0, rent: 0, setup: 0, fares: 0, stars: 0, status: '—',
    activePerDay: Math.round(buyer.activeSeconds / days), conserved: buyer.seed + ledger === buyer.state.cash && buyBlock(buyer.state, { amount: 1 }, { now: buyer.now, cityId: 'lagos', rng: () => 0 }) === null,
    note: `a career alone nets ₦${careerNet.toLocaleString('en-NG')}; this buyer ₦${buyerNet.toLocaleString('en-NG')} (${refused} days ended on a limit)` };
  return [row, buyerRow];
}

export function runBusiness({ days = 30 }: { days?: number } = {}): BusinessRow[] {
  const career = simulate({ lottery: LOTTERY, house: OWN, strategy: 'career', days });
  const careerNet = must(career.final).cash - career.startCash;
  const careerRow: BusinessRow = { label: 'career (tech), for comparison', days, profit: careerNet, perDay: Math.round(careerNet / days), takings: 0, fromPlayers: 0, stock: 0, rent: 0, setup: 0, fares: 0, stars: 0, status: '—',
    activePerDay: career.activePerDay, conserved: career.conserved === true, note: `wages ₦${Math.round(must(career.flows).wages ?? 0).toLocaleString('en-NG')}` };
  const gouger = runOwner('gouger (top of the band)', days, { price: 'max' }).row;
  return [
    careerRow,
    runOwner('diligent food stall', days).row,
    runOwner('average owner (food, one visit a day)', days, { daily: true }).row,
    runOwner('diligent food stall, every upgrade', days, { upgrades: true }).row,
    runOwner('diligent provisions kiosk', days, { type: 'provisions' }).row,
    runOwner('absentee (every fourth day)', days, { every: 4 }).row,
    runOwner('never returns', days, { once: true }).row,
    gouger,
    runOwner('discounter (bottom of the band)', days, { price: 'min' }).row,
    runTrader('fabric stall, Lagos supplier', days, false),
    runTrader('fabric trader, adire from Abeokuta', days, true),
    ...runColluders(days, gouger),
  ];
}

const short = (value: number): string => (Math.abs(value) >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(Math.round(value)));
export function formatBusiness(rows: BusinessRow[]): string {
  const head = ['who', 'made', 'a day', 'takings', 'players', 'stock', 'rent', 'setup', 'fares', 'stars', 'ends', 'act s/d', 'ok'];
  const lines = rows.map((row) => [row.label, short(row.profit), short(row.perDay), short(row.takings), short(row.fromPlayers), short(row.stock), short(row.rent), short(row.setup), short(row.fares),
    row.stars ? row.stars.toFixed(1) : '—', row.status, String(row.activePerDay), row.conserved ? 'yes' : 'NO']);
  const widths = head.map((title, column) => Math.max(title.length, ...lines.map((line) => (line[column] ?? '').length)));
  const format = (cells: string[]): string => cells.map((cell, column) => (column < 1 ? cell.padEnd(widths[column] ?? 0) : cell.padStart(widths[column] ?? 0))).join('  ');
  return [format(head), widths.map((width) => '-'.repeat(width)).join('  '), ...lines.map(format), ...rows.filter((row) => row.note).map((row) => `  ${row.label}: ${row.note}`)].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), index = args.indexOf('--days'), days = index >= 0 ? Number(args[index + 1]) : 30;
  if (!cachedCityContent('lagos')) throw new Error('Lagos content did not load');
  console.log(`Businesses · ${days} Lagos days from Monday 5 January 2026 · "made" = cash change + cash box + what closing would return`);
  console.log(formatBusiness(runBusiness({ days })));
}
