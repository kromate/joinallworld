/**
 * OWNER: world
 * The rules-side world: cities and how they connect, the local governments of a city, the estate
 * grid houses are built on, house designs and land prices. Plain data and pure helpers only.
 *
 * WHERE THE GEOMETRY IS. A local government's boundary on the map, and the rough real-world box
 * used to find it from a device's position, live in the city pack (src/map3d/cities/<city>.js) —
 * the map's single source of truth. This file holds what the RULES need: ids, names, prices and
 * capacities. src/map3d/map3d.test.js asserts that the two list exactly the same ids.
 *
 * PROVENANCE. Everything here is an original beta value (`beta: true`): none of it was observed in
 * the reference game. The local governments are the twenty real ones of Lagos State; their one-line
 * characters are our own words.
 *
 * ADDRESSES. Every local government has ESTATE.estates estates of ESTATE.streets streets with
 * ESTATE.plots plots each: 512 × 14 × 14 = 100,352 plots. A house's address is
 * `<lga>/<estate>/<street>/<plot>` (all zero-based numbers in storage, one-based when shown). The
 * server allocates it in O(1) (server/world/registry.ts) and it never changes. Where an estate
 * stands on the map is computed from the pack alone (src/map3d/estates.js) — no per-house data is
 * needed to draw a street.
 */

import { isRecord } from '../util.ts';
import type { HouseId, HouseStyle, HouseStyleField, HouseTierId, LgaId, WorldCityId } from '../../types/life.ts';
import type {
  CityLink, CityLinkFrom, CityRules, EstateGrid, HouseStyleContent, HouseTierDefinition, LgaDefinition, LgaRules, OwningRules,
} from '../../types/content.ts';

export const ESTATE: Readonly<EstateGrid> = Object.freeze({ beta: true, estates: 512, streets: 14, plots: 14 });
export const PLOTS_PER_ESTATE = ESTATE.streets * ESTATE.plots;
export const LGA_CAPACITY = ESTATE.estates * PLOTS_PER_ESTATE;

/**
 * The local governments of Lagos. `land` is how dear land is there, in naira (it scales the price
 * of every house upgrade: see tierCost — the plot itself is free); `zone` is the landmass
 * the travel system uses for fare bands when Home is a house built there; `district` lists the
 * rented-home districts (ids of content/housing.ts) that lie inside it.
 */
/** A local government as written below: `beta` and an empty `districts` are filled in. */
type LgaSeed = Omit<LgaDefinition, 'beta' | 'districts'> & { districts?: HouseId[] };

export const LAGOS_LGAS: LgaDefinition[] = ([
  { id: 'agege', name: 'Agege', zone: 'mainland', land: 120000, line: 'Bread at dawn, a stadium at dusk and a market that never quite closes.' },
  { id: 'ajeromi-ifelodun', name: 'Ajeromi-Ifelodun', zone: 'mainland', land: 100000, line: 'Ajegunle: crowded, loud and proud — where footballers and musicians come from.' },
  { id: 'alimosho', name: 'Alimosho', zone: 'mainland', land: 90000, line: 'The biggest of them all: Ikotun, Egbeda, Ipaja and estates as far as you can see.' },
  { id: 'amuwo-odofin', name: 'Amuwo-Odofin', zone: 'mainland', land: 150000, line: 'Festac’s wide avenues, the trade fair and creeks at the back door.' },
  { id: 'apapa', name: 'Apapa', zone: 'mainland', land: 280000, line: 'The port: containers, cranes and the long line of trucks.' },
  { id: 'badagry', name: 'Badagry', zone: 'mainland', land: 60000, line: 'The old coast town in the far west: coconut beaches, lagoons and a long history.' },
  { id: 'epe', name: 'Epe', zone: 'east', land: 60000, line: 'A fishing town on the far lagoon shore, famous for its fish market.' },
  { id: 'eti-osa', name: 'Eti-Osa', zone: 'island', land: 750000, line: 'Ikoyi, Victoria Island and Lekki: glass towers, the beach and the dearest land in the city.', districts: ['lekki', 'ikoyi', 'banana'] },
  { id: 'ibeju-lekki', name: 'Ibeju-Lekki', zone: 'east', land: 90000, line: 'The new frontier: the free zone, the refinery and land everyone says will boom.' },
  { id: 'ifako-ijaiye', name: 'Ifako-Ijaiye', zone: 'mainland', land: 110000, line: 'The northern edge: Ogba, Iju and the road out of town.' },
  { id: 'ikeja', name: 'Ikeja', zone: 'mainland', land: 500000, line: 'The state capital: the airport, Allen Avenue, Computer Village and the Secretariat.' },
  { id: 'ikorodu', name: 'Ikorodu', zone: 'mainland', land: 70000, line: 'Across the lagoon to the north-east: a town of its own, a ferry ride from the island.' },
  { id: 'kosofe', name: 'Kosofe', zone: 'mainland', land: 180000, line: 'Ketu, Ojota and Gbagada: fruit markets, motor parks and the foot of the long bridge.' },
  { id: 'lagos-island', name: 'Lagos Island', zone: 'island', land: 420000, line: 'Isale Eko: the old city, the big markets, Marina and Broad Street.' },
  { id: 'lagos-mainland', name: 'Lagos Mainland', zone: 'mainland', land: 240000, line: 'Yaba and Ebute Metta: the university, the tech hubs and the railway.', districts: ['yaba'] },
  { id: 'mushin', name: 'Mushin', zone: 'mainland', land: 130000, line: 'Dense, busy and resourceful: spare parts, tailors and a hustle on every corner.', districts: ['mushin'] },
  { id: 'ojo', name: 'Ojo', zone: 'mainland', land: 80000, line: 'Alaba market, the university by the lagoon and the road to the border.' },
  { id: 'oshodi-isolo', name: 'Oshodi-Isolo', zone: 'mainland', land: 160000, line: 'Oshodi interchange: every bus in Lagos passes through sooner or later.' },
  { id: 'somolu', name: 'Somolu', zone: 'mainland', land: 170000, line: 'Bariga and Somolu: printing presses, the lagoon front and long-settled streets.' },
  { id: 'surulere', name: 'Surulere', zone: 'mainland', land: 260000, line: 'The National Stadium, Adeniran Ogunsanya and the home of Nollywood.' },
] satisfies LgaSeed[]).map((lga) => Object.freeze({ beta: true, districts: [], ...lga }));

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

/** Changing your local government (original beta rule). Confirming the one the game guessed is free and immediate. */
export const LGA_RULES: Readonly<LgaRules> = Object.freeze({ beta: true, changeCooldownDays: 7 });

/**
 * Cities as the rules see them. `status`: 'open' (lives can be lived there) or 'soon'. `unit` is
 * what the city calls its districts. Lagos is the only open city; the others are data so that the
 * way cities connect is real before a second one opens.
 */
export const CITY_RULES: Readonly<Record<WorldCityId, CityRules>> = Object.freeze({
  lagos: { id: 'lagos', name: 'Lagos', status: 'open', unit: 'local government', units: LAGOS_LGAS, hub: { road: 'Ojota Motor Park', air: 'the airport at Ikeja' } },
  ibadan: { id: 'ibadan', name: 'Ibadan', status: 'soon', unit: 'local government', units: [], hub: { road: 'Iwo Road Motor Park', air: 'Ibadan airport at Alakia' } },
  abuja: { id: 'abuja', name: 'Abuja', status: 'soon', unit: 'district', units: [], hub: { road: 'Utako Motor Park', air: 'the airport on the Airport Road' } },
  'port-harcourt': { id: 'port-harcourt', name: 'Port Harcourt', status: 'soon', unit: 'local government', units: [], hub: { road: 'Waterlines Motor Park', air: 'the airport at Omagwa' } },
});

/**
 * How cities connect: `fare` in naira, `seconds` of real time the trip takes on the country map.
 * A link works in both directions. Original beta values.
 */
export const CITY_LINKS: readonly CityLink[] = Object.freeze([
  { a: 'lagos', b: 'ibadan', mode: 'road', beta: true, label: 'Bus on the Lagos–Ibadan Expressway', icon: '🚌', fare: 3500, seconds: 120, km: 130 },
  { a: 'lagos', b: 'abuja', mode: 'road', beta: true, label: 'Night bus through Lokoja', icon: '🚌', fare: 14000, seconds: 420, km: 760 },
  { a: 'lagos', b: 'abuja', mode: 'air', beta: true, label: 'Flight to Abuja', icon: '✈️', fare: 65000, seconds: 90, km: 520 },
  { a: 'lagos', b: 'port-harcourt', mode: 'road', beta: true, label: 'Bus through Benin and the East–West Road', icon: '🚌', fare: 12000, seconds: 360, km: 620 },
  { a: 'lagos', b: 'port-harcourt', mode: 'air', beta: true, label: 'Flight to Port Harcourt', icon: '✈️', fare: 60000, seconds: 90, km: 440 },
  { a: 'ibadan', b: 'abuja', mode: 'road', beta: true, label: 'Bus through Ilorin', icon: '🚌', fare: 12000, seconds: 360, km: 640 },
  { a: 'abuja', b: 'port-harcourt', mode: 'road', beta: true, label: 'Bus through Enugu', icon: '🚌', fare: 11000, seconds: 360, km: 600 },
  { a: 'abuja', b: 'port-harcourt', mode: 'air', beta: true, label: 'Flight to Port Harcourt', icon: '✈️', fare: 55000, seconds: 80, km: 450 },
]);

// The same tables read by an arbitrary (possibly unknown) id, as the callers do.
const cityRulesById: Readonly<Record<string, CityRules | undefined>> = CITY_RULES;
const tiersById: Readonly<Record<string, HouseTierDefinition | undefined>> = HOUSE_TIERS;
export const cityRules = (cityId: unknown): CityRules | null => (typeof cityId === 'string' && Object.hasOwn(CITY_RULES, cityId) ? cityRulesById[cityId] ?? null : null);
/** The local governments (or the local equivalent) of a city. */
export const lgasOf = (cityId: unknown): LgaDefinition[] => cityRules(cityId)?.units ?? [];
export const lgaOf = (cityId: unknown, id: unknown): LgaDefinition | null => (typeof id === 'string' ? lgasOf(cityId).find((lga) => lga.id === id) ?? null : null);
/** The local government a rented-home district lies in, or the city's first as a last resort. */
export function lgaOfDistrict(cityId: unknown, district: string): LgaDefinition | null {
  const units = lgasOf(cityId);
  return units.find((lga) => (lga.districts as readonly string[]).includes(district)) ?? null;
}
export const tierOf = (id: unknown): HouseTierDefinition | null => (typeof id === 'string' && Object.hasOwn(HOUSE_TIERS, id) ? tiersById[id] ?? null : null);
export const designOf = tierOf;
/** Links leaving a city: [{ to, mode, label, icon, fare, seconds, km }]. */
export function linksFrom(cityId: string): CityLinkFrom[] {
  return CITY_LINKS.filter((link) => link.a === cityId || link.b === cityId).map(({ a, b, ...link }) => ({ ...link, to: a === cityId ? b : a }));
}

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
