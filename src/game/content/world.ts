/**
 * OWNER: world
 * The rules-side world: cities and how they connect, the local governments of a city, the estate
 * grid houses are built on, house designs and land prices. Plain data and pure helpers only.
 *
 * WHERE THE GEOMETRY IS. A local government's boundary on the map, and the rough real-world box
 * used to find it from a device's position, live in the city pack (src/map3d/cities/<city>.js) —
 * the map's single source of truth. This file holds what the RULES need: ids, names, prices and
 * capacities. src/map3d/map3d.test.ts asserts that the two list exactly the same ids.
 *
 * PROVENANCE. Everything here is an original beta value (`beta: true`): none of it is final. The local governments are the twenty real ones of Lagos State; their one-line
 * characters are our own words.
 *
 * ADDRESSES. Every local government has ESTATE.estates estates of ESTATE.streets streets with
 * ESTATE.plots plots each: 512 × 14 × 14 = 100,352 plots. A house's address is
 * `<lga>/<estate>/<street>/<plot>` (all zero-based numbers in storage, one-based when shown). The
 * server allocates it in O(1) (server/world/registry.ts) and it never changes. Where an estate
 * stands on the map is computed from the pack alone (src/map3d/estates.ts) — no per-house data is
 * needed to draw a street.
 */

import { isRecord } from '../util.ts';
import { cityRules as cityRulesFromRegistry, linksFrom as cityLinksFrom } from '../cities/registry.ts';
import type { HouseStyle, HouseStyleField, HouseTierId, LgaId } from '../../types/life.ts';
import type {
  EstateGrid, HouseStyleContent, HouseTierDefinition, LgaDefinition, LgaRules, OwningRules,
} from '../../types/content.ts';

export { CITY_LINKS, CITY_RULES } from '../cities/registry.ts';

export const ESTATE: Readonly<EstateGrid> = Object.freeze({ beta: true, estates: 512, streets: 14, plots: 14 });
export const PLOTS_PER_ESTATE = ESTATE.streets * ESTATE.plots;
export const LGA_CAPACITY = ESTATE.estates * PLOTS_PER_ESTATE;

/**
 * EVERYONE HAS A HOUSE. Each life is given a plot and the starter house on it, free, in its local
 * government. What a player buys is the size (the tier) and the look.
 *
 * HOUSE_TIERS: `grid` the room is grid × grid tiles, `cost` the base price of upgrading to it
 * (multiplied by the local government's rate — see tierCost), `buildSeconds` real server time the
 * upgrade takes (scaffolding stands on the plot meanwhile), `groundRent` naira a week once it
 * stands, collected on Saturdays. The starter is free and has no ground rent.
 */
export const HOUSE_TIERS: Readonly<Record<HouseTierId, HouseTierDefinition>> = Object.freeze({
  starter: { id: 'starter', beta: true, rank: 0, label: 'Starter house', icon: '🏠', grid: 6, cost: 0, buildSeconds: 0, groundRent: 0, blurb: 'One good room on your own plot. Everyone starts here.' },
  bq: { id: 'bq', beta: true, rank: 1, label: 'Two-room house', icon: '🏡', grid: 8, cost: 60000, buildSeconds: 600, groundRent: 400, blurb: 'A second room and a proper veranda.' },
  bungalow: { id: 'bungalow', beta: true, rank: 2, label: 'Bungalow', icon: '🏡', grid: 10, cost: 150000, buildSeconds: 1800, groundRent: 800, blurb: 'Three rooms on one floor behind your own gate.' },
  duplex: { id: 'duplex', beta: true, rank: 3, label: 'Duplex', icon: '🏘️', grid: 12, cost: 400000, buildSeconds: 5400, groundRent: 1500, blurb: 'Two floors, a balcony and room for every sofa.' },
  villa: { id: 'villa', beta: true, rank: 4, label: 'Villa', icon: '🏛️', grid: 14, cost: 1200000, buildSeconds: 14400, groundRent: 4000, blurb: 'The big house: columns, a compound and a view from the roof.' },
});
export const TIER_ORDER: readonly HouseTierId[] = Object.freeze(['starter', 'bq', 'bungalow', 'duplex', 'villa']);
/** Kept under the old name for the room lookup (content/housing.ts homeOf). */
export const HOUSE_DESIGNS = HOUSE_TIERS;

/**
 * The look of a house, as a few small numbers — one index per field into these lists — so that a
 * house is a single integer in storage (packStyle) and an estate of thousands can be drawn from
 * per-instance attributes. `price` is charged each time a field is CHANGED to that option; options
 * without one are free. All original beta values.
 */
export const HOUSE_STYLE: Readonly<HouseStyleContent> = Object.freeze({
  shape: [{ id: 'gable', label: 'Gable roof' }, { id: 'hip', label: 'Hip roof' }, { id: 'flat', label: 'Flat roof', price: 5000 }, { id: 'twin', label: 'Twin gables', price: 8000 }],
  wall: [{ id: 'cream', label: 'Cream', hex: '#f3ead6' }, { id: 'white', label: 'White', hex: '#f8f6ee' }, { id: 'sand', label: 'Sand', hex: '#e6cf9f' }, { id: 'mint', label: 'Mint', hex: '#bfe0c8' },
    { id: 'sky', label: 'Sky', hex: '#b8d8ea', price: 1000 }, { id: 'coral', label: 'Coral', hex: '#f0a58e', price: 1000 }, { id: 'lilac', label: 'Lilac', hex: '#cdbbe6', price: 1000 }, { id: 'sun', label: 'Sun yellow', hex: '#f6d76a', price: 1000 }],
  roof: [{ id: 'clay', label: 'Clay red', hex: '#a85c40' }, { id: 'brown', label: 'Brown', hex: '#7d5a45' }, { id: 'zinc', label: 'Zinc grey', hex: '#8d9399' }, { id: 'green', label: 'Green', hex: '#3f8a57' },
    { id: 'blue', label: 'Blue', hex: '#3f6fa8', price: 1000 }, { id: 'night', label: 'Charcoal', hex: '#3a3f47', price: 1000 }, { id: 'gold', label: 'Gold', hex: '#d9a53a', price: 1500 }, { id: 'teal', label: 'Teal', hex: '#2f8f8a', price: 1000 }],
  door: [{ id: 'wood', label: 'Wood', hex: '#6b4a2b' }, { id: 'green', label: 'Green', hex: '#256b45' }, { id: 'red', label: 'Red', hex: '#b23a2e' }, { id: 'blue', label: 'Blue', hex: '#2b5fa8' }],
  windows: [{ id: 'plain', label: 'Plain', hex: '#bfe0f0' }, { id: 'warm', label: 'Warm light', hex: '#ffe6ae' }, { id: 'tinted', label: 'Tinted', hex: '#4f6f86', price: 1000 }, { id: 'shutters', label: 'Shutters', hex: '#e9e2cf', price: 1500 }],
  fence: [{ id: 'none', label: 'No fence' }, { id: 'hedge', label: 'Hedge', hex: '#3f8a57', price: 2000 }, { id: 'pickets', label: 'White pickets', hex: '#f6f2e6', price: 3000 }, { id: 'wall', label: 'Block wall', hex: '#c9c2b0', price: 4000 }],
  yard: [{ id: 'none', label: 'Bare yard' }, { id: 'flowers', label: 'Flower bed', price: 1000 }, { id: 'tree', label: 'Mango tree', price: 1500 }, { id: 'palm', label: 'Palm', price: 2000 },
    { id: 'tank', label: 'Water tank', price: 2500 }, { id: 'gen', label: 'Generator hut', price: 3000 }, { id: 'car', label: 'Car port', price: 3500 }, { id: 'kiosk', label: 'Kiosk', price: 3000 }],
  sign: [{ id: 'off', label: 'No name sign' }, { id: 'on', label: 'Name sign at the gate' }],
});
// Object.keys is string[]; the keys of HOUSE_STYLE are exactly the HouseStyleField union.
export const STYLE_FIELDS: readonly HouseStyleField[] = Object.freeze(Object.keys(HOUSE_STYLE) as HouseStyleField[]);
const STYLE_BITS: Readonly<Record<HouseStyleField, number>> = Object.freeze({ shape: 2, wall: 3, roof: 3, door: 2, windows: 2, fence: 2, yard: 3, sign: 1 });
// Object.fromEntries is { [k: string]: number }; it has an entry for every HouseStyleField.
export const DEFAULT_STYLE: Readonly<HouseStyle> = Object.freeze(Object.fromEntries(STYLE_FIELDS.map((field) => [field, 0])) as HouseStyle);

/** A style object with every field a valid index (anything else becomes the default 0). */
export function cleanStyle(value: unknown): HouseStyle {
  const style: HouseStyle = { ...DEFAULT_STYLE };
  const record = isRecord(value) ? value : {};
  for (const field of STYLE_FIELDS) {
    const raw = record[field];
    style[field] = typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 && raw < HOUSE_STYLE[field].length ? raw : 0;
  }
  return style;
}
/** Style + tier as one integer (21 bits): what the registry stores per house and the map draws from. */
export function packStyle(style: Partial<HouseStyle> | null | undefined, tier: HouseTierId = 'starter'): number {
  let bits = HOUSE_TIERS[tier]?.rank ?? 0, shift = 3;
  for (const field of STYLE_FIELDS) { bits |= (style?.[field] ?? 0) << shift; shift += STYLE_BITS[field]; }
  return bits;
}
export function unpackStyle(bits: unknown): { tier: HouseTierId; style: HouseStyle } {
  const value = typeof bits === 'number' && Number.isSafeInteger(bits) && bits >= 0 ? bits : 0;
  const style: HouseStyle = { ...DEFAULT_STYLE };
  let shift = 3;
  for (const field of STYLE_FIELDS) { const index = (value >>> shift) & ((1 << STYLE_BITS[field]) - 1); style[field] = index < HOUSE_STYLE[field].length ? index : 0; shift += STYLE_BITS[field]; }
  // The index is clamped into TIER_ORDER, so the fallback is never used.
  return { tier: TIER_ORDER[Math.min(value & 7, TIER_ORDER.length - 1)] ?? 'starter', style };
}
/** What changing from one style to another costs: the price of every field that changes to a priced option. */
export function stylePrice(from: HouseStyle, to: HouseStyle): number {
  let total = 0;
  for (const field of STYLE_FIELDS) if (to[field] !== from[field]) total += HOUSE_STYLE[field][to[field]]?.price ?? 0;
  return total;
}

/** The rules of the house everyone has (all original beta values). */
export const OWNING: Readonly<OwningRules> = Object.freeze({
  beta: true,
  housesPerLife: 1,            // one plot and one house per life per city
  groundRentArrearsWeeks: 8,   // unpaid ground rent stops growing after this many weeks; nobody loses a house
  rateBase: 750000,            // an upgrade costs tier.cost × (1 + lga.land ÷ rateBase): dear land makes building dear
});

/**
 * A room at a guest house, for a life visiting a city where it has no home ('estate.lodge'). `fee` is charged once per
 * stay and the needs listed are brought up to `restoreTo`; nothing is sold while they are all at `restedFrom` or more.
 * Original beta values: change `fee` to make visiting dearer or cheaper.
 */
export const LODGING = Object.freeze({ beta: true, fee: 2500, needs: Object.freeze(['energy', 'hygiene'] as const), restoreTo: 100, restedFrom: 90 });

/**
 * ONE HOME, AND MORE BY CHOICE. The free starter house is given once, for a character's first home. In any other city a
 * visitor may BUY a home: a house of `tier` on a plot in the local unit it picks, at that tier's ordinary price there
 * (tierCost). The main home can be moved to another city at most once every `moveCooldownDays` days.
 */
export const SECOND_HOME = Object.freeze({ beta: true, tier: 'bq' as const, moveCooldownDays: 7 });

/** Changing your local government (original beta rule). Confirming the one the game guessed is free and immediate. */
export const LGA_RULES: Readonly<LgaRules> = Object.freeze({ beta: true, changeCooldownDays: 7 });

const tiersById: Readonly<Record<string, HouseTierDefinition | undefined>> = HOUSE_TIERS;
export const cityRules = cityRulesFromRegistry;
/** The local governments (or the local equivalent) of a city. */
export const lgasOf = (cityId: unknown): readonly LgaDefinition[] => cityRules(cityId)?.units ?? [];
export const lgaOf = (cityId: unknown, id: unknown): LgaDefinition | null => (typeof id === 'string' ? lgasOf(cityId).find((lga) => lga.id === id) ?? null : null);
/** Resolve the district's declared local government; an unknown district has no inferred location. */
export function lgaOfDistrict(cityId: unknown, district: string): LgaDefinition | null {
  const localUnitId = cityRules(cityId)?.districts.find(item => item.id === district)?.localUnitId;
  return lgaOf(cityId, localUnitId);
}
export const tierOf = (id: unknown): HouseTierDefinition | null => (typeof id === 'string' && Object.hasOwn(HOUSE_TIERS, id) ? tiersById[id] ?? null : null);
export const designOf = tierOf;
/** Links leaving a city: [{ to, mode, label, icon, fare, seconds, km }]. */
export const linksFrom = cityLinksFrom;

const whole = (value: unknown, max: number): boolean => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < max;
/** Is this a real plot? `estate` 0…511, `plot` 0…195 (street = plot ÷ 14, number on the street = plot mod 14). */
export const validPlot = (estate: unknown, plot: unknown): boolean => whole(estate, ESTATE.estates) && whole(plot, PLOTS_PER_ESTATE);
/** The address as it is stored and sent: `ikeja/41/2/6`. */
export const addressKey = (lga: string, estate: number, plot: number): string => `${lga}/${estate}/${Math.floor(plot / ESTATE.plots)}/${plot % ESTATE.plots}`;
/** The address as a person reads it: "Plot 7, Street 3, Estate 42, Ikeja". */
export function addressLabel(cityId: unknown, lga: string, estate: number, plot: number): string {
  const name = lgaOf(cityId, lga)?.name ?? lga;
  return `Plot ${(plot % ESTATE.plots) + 1}, Street ${Math.floor(plot / ESTATE.plots) + 1}, Estate ${estate + 1}, ${name}`;
}
/** What upgrading to `tier` costs in `lga`: the tier's base price scaled by how dear the land is, to the nearest ₦100. */
export function tierCost(cityId: unknown, lga: unknown, tier: unknown): number | null {
  const unit = lgaOf(cityId, lga), house = tierOf(tier);
  if (!unit || !house) return null;
  return Math.round((house.cost * (1 + unit.land / OWNING.rateBase)) / 100) * 100;
}
/** The levy for taking a house of `tier` from one local government to a dearer one (0 when it is not dearer). */
export function moveLevy(cityId: unknown, from: unknown, to: unknown, tier: unknown): number {
  const a = tierCost(cityId, from, tier), b = tierCost(cityId, to, tier);
  return a === null || b === null ? 0 : Math.max(0, b - a);
}
/** The cheapest upgrade there is in a city: { lga, tier, total }. */
export function cheapestUpgrade(cityId: unknown): { lga: LgaId; tier: HouseTierId; total: number | null } | null {
  const units = lgasOf(cityId);
  if (!units.length) return null;
  const lga = units.reduce((best, unit) => (unit.land < best.land ? unit : best));
  // TIER_ORDER[1] always exists; the fallback is never used.
  const tier = TIER_ORDER[1] ?? 'bq';
  return { lga: lga.id, tier, total: tierCost(cityId, lga.id, tier) };
}
