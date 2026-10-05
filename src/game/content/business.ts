/**
 * OWNER: business
 * Businesses: the shop types, their products, the upgrades, what each market is known for and every number
 * of the shop rules. Plain data only. Read by the servers and the simulation, never by the page (the routes
 * answer with what a screen needs). The rules are in src/game/business-model.ts; the design is docs/BUSINESS.md.
 *
 * Every figure is an original beta value, sized against wages by scripts/economy-sim.ts ("Businesses").
 * The products are things these markets are really known for; a product's `origin` is where it is made or
 * landed, and that is the one place its supplier price is lower.
 */
import type { BusinessProduct, BusinessType, BusinessTypeId, BusinessUpgrade, BusinessVenueRule } from '../../types/business.ts'

export const BUSINESS = Object.freeze({
  /** Businesses one player may own. */
  perPlayer: 1,
  /** The scene kind of a venue that rents stalls. */
  hostKind: 'market',
  /** Stalls a market rents out unless BUSINESS_VENUES says otherwise. */
  stalls: 12,
  /** Trading hours of a market whose venue names none (Lagos time, [open, close)). */
  hours: Object.freeze({ open: 7, close: 20 }),
  /** A stall's name. */
  name: Object.freeze({ min: 3, max: 24 }),

  /** The supplier's price as a part of a product's base price; and where the product comes from. */
  costRate: 0.6,
  originRate: 0.3,
  /** The price an owner may ask, as a part of the base price. */
  band: Object.freeze({ min: 0.7, max: 1.4 }),
  /** Part of the interested customers who buy at a price ratio, joined by straight lines. */
  demand: Object.freeze([[0.7, 1.25], [1, 1], [1.2, 0.7], [1.4, 0.3]] as const),
  /** Customers still served when only part of the range is in stock: floor + (1 − floor) × the share in stock. */
  rangeFloor: 0.55,
  /** A market draws this many more customers to a type it is known for. */
  knownBonus: 1.2,
  /** Units passers-by buy in one day never exceed customers × size × this. */
  dayCeiling: 1.65,
  /** Passers-by stop buying when the cash box holds this much. */
  tillCap: 50000,

  /** Reputation: 0–100 points, shown as 1 + points / 25 stars. */
  rep: Object.freeze({
    start: 50,
    /** Customers × (low + (high − low) × points / 100). */
    low: 0.75, high: 1.25,
    /** End of a trading day: served ÷ came at or above `good` gains `up`; below `poor` loses `down`; nothing sold loses `empty`. */
    good: 0.8, poor: 0.4, up: 4, down: 4, empty: 8,
    /** A rating moves the points this part of the way to stars × 20. */
    rating: 0.1,
  }),

  /** Rent is paid for this many days at a time, and at most this many periods ahead. */
  rentDays: 7,
  rentAhead: 4,
  /** A stall that could not pay is shut for this long before the market winds it up. */
  graceDays: 3,
  /** A wound-up stall's money waits this long for its owner. */
  claimDays: 30,
  /** Closing by choice returns this part of setup and upgrades, and this part of the stock's cost. */
  closeRefund: 0.5,
  buyback: 0.5,

  /** Player purchases: per buyer per shop per Lagos day, per shop per day, and per purchase. */
  pairPerDay: 5000,
  pairItemsPerDay: 6,
  shopPerDay: 15000,
  qtyMax: 3,
  /** Buyers remembered for a rating, and reports kept. */
  raters: 60,
  reports: 200,
});

const FOOD_HOURS = [0, 0, 0, 0, 0, 0, 0.7, 1.4, 1.4, 0.7, 0.7, 0.7, 1.8, 1.8, 0.7, 0.7, 0.7, 0.7, 1.5, 1.5, 0.7, 0.7, 0, 0];
const DAILY_HOURS = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.4, 1.4, 1.4, 1, 1, 0, 0];
const BROWSE_HOURS = [0, 0, 0, 0, 0, 0, 0.8, 0.8, 0.8, 0.8, 1.3, 1.3, 1.3, 1.3, 1.3, 1.3, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0, 0];
const CLOTH = { id: 'new-cloth', label: 'New cloth', value: 6, hours: 12 };
const HANDMADE = { id: 'handmade', label: 'Something handmade', value: 5, hours: 12 };

export const BUSINESS_TYPES: Readonly<Record<BusinessTypeId, BusinessType>> = Object.freeze({
  food: {
    id: 'food', label: 'Food stall', icon: '🍲', icons: ['🍲', '🍛', '🐟', '🔥'], setup: 15000, rent: 7000, customers: 30, capacity: 30, spoil: 0.3, hours: FOOD_HOURS,
    products: [
      { id: 'jollof', label: 'Jollof rice & chicken', icon: '🍛', base: 600, share: 0.45, effects: { hunger: 45, fun: 6 }, need: 'hunger' },
      { id: 'local-plate', label: 'Plate of the day', icon: '🍲', base: 500, share: 0.35, effects: { hunger: 50 }, need: 'hunger' },
      { id: 'puff-puff', label: 'Puff-puff', icon: '🍩', base: 200, share: 0.2, effects: { hunger: 15, fun: 4 }, need: 'hunger' },
    ],
  },
  provisions: {
    id: 'provisions', label: 'Provisions kiosk', icon: '🧺', icons: ['🧺', '🥤', '🧼', '🛒'], setup: 12000, rent: 6000, customers: 36, capacity: 40, hours: DAILY_HOURS,
    products: [
      { id: 'zobo', label: 'Chilled zobo', icon: '🥤', base: 250, share: 0.35, effects: { fun: 8, hunger: 6, energy: 4 }, need: 'fun' },
      { id: 'bread', label: 'Fresh bread', icon: '🍞', base: 400, share: 0.3, effects: { hunger: 25 }, need: 'hunger' },
      { id: 'soap', label: 'Bathing soap', icon: '🧼', base: 300, share: 0.2, effects: { hygiene: 30 }, need: 'hygiene' },
      { id: 'smoked-fish', label: 'Smoked fish', icon: '🐟', base: 800, share: 0.15, effects: { hunger: 30 }, need: 'hunger', origin: ['port-harcourt'] },
    ],
  },
  fabric: {
    id: 'fabric', label: 'Fabric stall', icon: '🧵', icons: ['🧵', '👗', '👕', '🧶'], setup: 25000, rent: 8000, customers: 5, capacity: 10, hours: BROWSE_HOURS,
    products: [
      { id: 'ankara', label: 'Ankara wax print', icon: '🧵', base: 2000, share: 0.34, effects: { social: 8 }, mood: CLOTH, origin: ['lagos'] },
      { id: 'adire', label: 'Adire cloth', icon: '👗', base: 2400, share: 0.26, effects: { social: 10 }, mood: CLOTH, origin: ['abeokuta'] },
      { id: 'aso-oke', label: 'Aso-oke strip cloth', icon: '🧶', base: 3000, share: 0.2, effects: { social: 12 }, mood: CLOTH, origin: ['ibadan'] },
      { id: 'indigo', label: 'Indigo-dyed cloth', icon: '👕', base: 2200, share: 0.2, effects: { social: 9 }, mood: CLOTH, origin: ['kano'] },
    ],
  },
  crafts: {
    id: 'crafts', label: 'Crafts stall', icon: '🎨', icons: ['🎨', '🎁', '📦', '👑'], setup: 20000, rent: 7000, customers: 6, capacity: 12, hours: BROWSE_HOURS,
    products: [
      { id: 'clay-pot', label: 'Hand-built clay pot', icon: '🎨', base: 1500, share: 0.3, effects: { fun: 10 }, mood: HANDMADE, origin: ['abuja'] },
      { id: 'leather-sandals', label: 'Leather sandals', icon: '📦', base: 2500, share: 0.25, effects: { fun: 12 }, mood: HANDMADE, origin: ['kano'] },
      { id: 'cap', label: 'Embroidered cap', icon: '👑', base: 1800, share: 0.25, effects: { social: 8 }, mood: HANDMADE, origin: ['kano'] },
      { id: 'basket', label: 'Woven basket', icon: '🧺', base: 1000, share: 0.2, effects: { fun: 8 }, mood: HANDMADE },
    ],
  },
});
export const BUSINESS_TYPE_IDS: readonly BusinessTypeId[] = Object.freeze(['food', 'provisions', 'fabric', 'crafts']);

/** What a food stall's "Plate of the day" is called in each city; a city without an entry keeps the shared name. */
export const LOCAL_PLATES: Readonly<Record<string, string>> = Object.freeze({
  lagos: 'Ewa agoyin & Agege bread',
  ibadan: 'Amala, gbegiri & ewedu',
  abeokuta: 'Ofada rice & ayamase',
  ota: 'Ofada rice & ayamase',
  sagamu: 'Ofada rice & ayamase',
  'ijebu-ode': 'Ikokore',
  'port-harcourt': 'Bole & fish',
  abuja: 'Grilled fish & yam',
  kano: 'Masa & suya',
});

export const BUSINESS_UPGRADES: readonly BusinessUpgrade[] = Object.freeze([
  { id: 'front', label: 'Shop front', cost: 40000, effect: 'Holds half as much again and draws 30% more customers. Rent goes up by half.', customers: 1.3, capacity: 1.5, rent: 1.5 },
  { id: 'display', label: 'Better display', cost: 15000, effect: 'Draws 10% more customers.', customers: 1.1 },
  { id: 'storage', label: 'Storage and cooler', cost: 10000, effect: 'Holds half as much again. Food keeps: only a tenth spoils overnight.', capacity: 1.5, spoil: 0.1 },
]);

/** What each market adds, keyed `<city>:<venue>`. A market with no entry is known for nothing in particular. */
export const BUSINESS_VENUES: Readonly<Record<string, BusinessVenueRule>> = Object.freeze({
  'lagos:market': { known: ['fabric'], footfall: 1.15, stalls: 16 },
  'ibadan:bodija-market': { known: ['food'], footfall: 1.05 },
  'ibadan:dugbe-market': { known: ['provisions'] },
  'ibadan:gbagi-market': { known: ['fabric'] },
  'abeokuta:itoku-market': { known: ['fabric'] },
  'abeokuta:kuto-market': { known: ['food'], footfall: 0.95 },
  'ota:sango-market': { known: ['provisions'], footfall: 0.95 },
  'ijebu-ode:ijebu-market': { known: ['food'], footfall: 0.9 },
  'sagamu:sagamu-market': { known: ['food'], footfall: 0.9 },
  'port-harcourt:mile-one-market': { known: ['provisions'], footfall: 1.05 },
  'port-harcourt:mile-three-market': { known: ['food'] },
  'port-harcourt:oil-mill-market': { known: ['food'] },
  'abuja:arts-village': { known: ['crafts'] },
  'abuja:wuse-market': { known: ['provisions'], footfall: 1.1 },
  'abuja:garki-market': { known: ['food'] },
  'abuja:gwagwalada-market': { known: ['food'], footfall: 0.9 },
  'kano:kurmi-market': { known: ['crafts'] },
  'kano:dye-pits': { known: ['fabric'], footfall: 0.9, stalls: 6 },
  'kano:kwari-market': { known: ['fabric'], footfall: 1.1 },
  'kano:sabon-market': { known: ['provisions'], footfall: 1.05 },
});

/** Every product by id, with the type it belongs to. */
export const BUSINESS_PRODUCTS: ReadonlyMap<string, BusinessProduct & { type: BusinessTypeId }> = new Map(
  BUSINESS_TYPE_IDS.flatMap((type) => BUSINESS_TYPES[type].products.map((product) => [product.id, { ...product, type }] as const)),
);
