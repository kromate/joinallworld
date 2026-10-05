/**
 * Businesses: the content tables, the stored shop record and what the routes under /api/business/ answer.
 * The rules are in src/game/business-model.ts and docs/BUSINESS.md.
 */
import type { NeedMap, NeedId } from './life.ts'
import type { LifeState } from './life.ts'
import type { CityId, HostErrorCode, JsonBodyErrorCode, Ok, OnceErrorCode, PlayerRef, SessionErrorCode, StorageErrorCode, TimedId } from './protocol.ts'

export type BusinessTypeId = 'food' | 'provisions' | 'fabric' | 'crafts'
export type BusinessUpgradeId = 'front' | 'display' | 'storage'
/** 'open' trades; 'closed' is wound up and holds only what the owner is owed. */
export type ShopStatus = 'open' | 'closed'

export interface BusinessProduct {
  id: string
  label: string
  icon: string
  /** The reference price in naira: the price band and the wholesale cost are fractions of it. */
  base: number
  /** This product's part of a type's customers; a type's shares add up to 1. */
  share: number
  /** What a player who buys one gets at once. */
  effects?: NeedMap
  /** The need this product restores: it is not sold to a life whose need is full. */
  need?: NeedId
  /** A mood that lasts `hours`; not sold again to a life that still has it. */
  mood?: { id: string; label: string; value: number; hours: number }
  /** Cities where the supplier sells it at the origin price; such a product can be carried between cities. */
  origin?: readonly string[]
}

export interface BusinessType {
  id: BusinessTypeId
  label: string
  icon: string
  /** Icons an owner may pick for the stall. */
  icons: readonly string[]
  /** One-off cost of opening, in naira; the first week's rent is paid with it. */
  setup: number
  /** Naira per seven days. */
  rent: number
  /** Passers-by who want something on one trading day, at 3 stars, before any multiplier. */
  customers: number
  /** Units of stock a stall holds. */
  capacity: number
  /** Part of the unsold stock lost at midnight (food). */
  spoil?: number
  /** Relative weight of each hour 0–23 of the day; only trading hours count. */
  hours: readonly number[]
  products: readonly BusinessProduct[]
}

export interface BusinessUpgrade {
  id: BusinessUpgradeId
  label: string
  cost: number
  effect: string
  customers?: number
  capacity?: number
  rent?: number
  /** Replaces a perishable type's `spoil`. */
  spoil?: number
}

/** What a market adds to the shared rule (content/business.ts BUSINESS_VENUES). */
export interface BusinessVenueRule {
  /** Types this market is known for. */
  known: readonly BusinessTypeId[]
  /** Multiplies customers; 1 when absent. */
  footfall?: number
  /** Stalls for rent; BUSINESS.stalls when absent. */
  stalls?: number
}

/** A market as the shop rules read it. */
export interface BusinessVenue {
  city: string
  venue: string
  name: string
  known: readonly BusinessTypeId[]
  footfall: number
  stalls: number
  hours: { open: number; close: number }
}

// ---- stored -------------------------------------------------------------------------------------

/** One shop in the `business` collection. Keyed by its owner's public id: one business per player. */
export interface ShopRecord {
  by: PlayerRef
  city: string
  venue: string
  type: BusinessTypeId
  name: string
  colour: string
  icon: string
  status: ShopStatus
  openedAt: number
  /** The time this record is true for: everything passers-by did before it is in the numbers below. */
  at: number
  /** Rent is paid up to here. */
  paidUntil: number
  /** Rent that fell due at `paidUntil` and the cash box could not cover; 0 when nothing is overdue. */
  owed: number
  /** When it was wound up (status 'closed'). */
  closedAt?: number
  /** Units in stock, by product id. */
  stock: Record<string, number>
  /** Price in naira, by product id. */
  prices: Record<string, number>
  /** Part of a sale not yet made, by product id (0 ≤ value < 1), so that reading often and reading rarely sell the same. */
  part: Record<string, number>
  /** Naira waiting for the owner. */
  till: number
  /** Units sold since the owner last collected. */
  sold: number
  /** 0–100; stars are 1 + rep / 25. */
  rep: number
  ratings: { n: number; sum: number }
  upgrades: BusinessUpgradeId[]
  /** Naira paid for setup and upgrades (what a closing refund is a part of). */
  paid: number
  /** The Lagos day the day counters below belong to. */
  day: number
  /** Today: customers who came, units sold (to anyone), units sold to passers-by, naira from players. */
  came: number
  served: number
  npc: number
  fromPlayers: number
  /** Today's takings, for the owner's screen. */
  takings: number
  /** Today's buyers: naira and items per public id. */
  buyers: Record<string, { s: number; n: number }>
  /** Buyers who may still rate their last purchase. */
  raters: string[]
  /** Lifetime: units sold, naira taken, and rent taken from the cash box. */
  total: { sold: number; takings: number; rent: number }
}

export interface ShopReport { id: number; shop: string; name: string; by: string; reason: string; at: number }

export interface BusinessCollection {
  v: 1
  shops: Record<string, ShopRecord>
  reports: ShopReport[]
  seq: number
}

// ---- the wire -----------------------------------------------------------------------------------

export interface ProductView {
  id: string
  label: string
  icon: string
  base: number
  /** The supplier's price here. */
  cost: number
  /** True when this city is where the product comes from (the lower cost). */
  local: boolean
  min: number
  max: number
  /** What buying one does, in words ("+45 hunger"). */
  does: string
  trade: boolean
}
export interface TypeView {
  id: BusinessTypeId
  label: string
  icon: string
  icons: readonly string[]
  setup: number
  rent: number
  customers: number
  capacity: number
  known: boolean
  products: ProductView[]
}
export interface ShopItem { id: string; label: string; icon: string; price: number; stock: number; does: string }
/** A shop as anybody at the market sees it. */
export interface ShopCard {
  id: string
  name: string
  type: BusinessTypeId
  typeLabel: string
  colour: string
  icon: string
  owner: PlayerRef
  status: ShopStatus
  stars: number
  ratings: number
  items: ShopItem[]
  mine: boolean
  /** The viewer and the owner have a block between them: no Buy and no Chat. */
  blocked: boolean
  /** The viewer bought here and has not rated since. */
  canRate: boolean
}
export interface UpgradeView { id: BusinessUpgradeId; label: string; cost: number; effect: string; owned: boolean }
/** The owner's own shop. */
export interface MyShop extends ShopCard {
  city: string
  cityName: string
  venue: string
  venueName: string
  /** The owner is standing in the shop's market: stocking, pricing and upgrades are open. */
  here: boolean
  till: number
  tillCap: number
  sold: number
  capacity: number
  units: number
  rent: number
  paidUntil: number
  /** Overdue rent being taken from takings; 0 when none. */
  owed: number
  /** When the market closes the stall if the overdue rent is still unpaid. */
  closesAt: number | null
  customers: number
  today: { takings: number; sold: number; came: number }
  total: { sold: number; takings: number; rent: number }
  upgrades: UpgradeView[]
  products: (ProductView & { price: number; stock: number })[]
  /** What closing now would pay back, the cash box included. */
  closeRefund: number
  /** Why trading is stopped or about to stop, in one sentence; '' when all is well. */
  alert: string
}
export interface BagLine { id: string; label: string; icon: string; n: number }
export interface BusinessLimits {
  perShop: number
  itemsPerShop: number
  perDay: number
  countPerDay: number
  qtyMax: number
  bag: number
  bandMin: number
  bandMax: number
  name: { min: number; max: number }
}
export interface VenueShopsResponse {
  city: string
  venue: string
  hosts: boolean
  venueName: string
  stalls: { total: number; taken: number }
  known: BusinessTypeId[]
  hours: { open: number; close: number }
  types: TypeView[]
  shops: ShopCard[]
  mine: MyShop | null
  bag: BagLine[]
  /** Trade goods the supplier here sells for the road. */
  wholesale: ProductView[]
  limits: BusinessLimits
  /** Why the viewer cannot open a stall here; '' when they can. */
  openWhy: string
  colours: { id: string; label: string; bg: string; ink: string }[]
}
export interface MyBusinessResponse {
  city: string
  mine: MyShop | null
  bag: BagLine[]
  limits: BusinessLimits
}

// ---- the routes (server/routes/business.ts, server/routes/business-mod.ts) ----------------------

/** What a write answers: the outcome, the life after it and the caller's shop. A refusal is HTTP 200 `{ ok: false, code, reason }` with the same view. */
export type ShopWriteResponse = { ok: boolean; code: string; reason?: string; duplicate?: true; amount?: number; units?: number; state?: LifeState } & MyBusinessResponse
export type ShopBuyResponse = { ok: boolean; code: string; reason?: string; duplicate?: true; amount?: number; state?: LifeState; market: VenueShopsResponse }
type BusinessRead = HostErrorCode | 'invalid_city' | 'business_rate_limited'
type BusinessWrite = BusinessRead | JsonBodyErrorCode | SessionErrorCode | StorageErrorCode
type Paid<B = object> = B & { cityId: CityId; requestId: TimedId }
type OperatorError = HostErrorCode | 'not_found' | 'moderator_token_required' | 'rate_limited'

export interface BusinessHttpRoutes {
  'GET /api/business/venue': { query: { city: CityId; venue: string }; response: Ok<VenueShopsResponse>; errors: BusinessRead | 'invalid_venue' }
  'GET /api/business/mine': { query: { city: CityId }; response: Ok<MyBusinessResponse>; errors: BusinessRead | SessionErrorCode | StorageErrorCode }
  'POST /api/business/open': { body: Paid<{ venue: string; type: BusinessTypeId; name: string; colour: string; icon: string }>; response: Ok<ShopWriteResponse>; errors: BusinessWrite | OnceErrorCode }
  'POST /api/business/stock': { body: Paid<{ items: Record<string, number> }>; response: Ok<ShopWriteResponse>; errors: BusinessWrite | OnceErrorCode }
  'POST /api/business/price': { body: { cityId: CityId; prices: Record<string, number> }; response: Ok<ShopWriteResponse>; errors: BusinessWrite }
  'POST /api/business/collect': { body: Paid; response: Ok<ShopWriteResponse>; errors: BusinessWrite | OnceErrorCode }
  'POST /api/business/rent': { body: Paid; response: Ok<ShopWriteResponse>; errors: BusinessWrite | OnceErrorCode }
  'POST /api/business/upgrade': { body: Paid<{ upgrade: BusinessUpgradeId }>; response: Ok<ShopWriteResponse>; errors: BusinessWrite | OnceErrorCode }
  'POST /api/business/close': { body: Paid; response: Ok<ShopWriteResponse>; errors: BusinessWrite | OnceErrorCode }
  'POST /api/business/bag': { body: Paid<{ venue: string; product: string; units: number }>; response: Ok<ShopWriteResponse>; errors: BusinessWrite | OnceErrorCode }
  'POST /api/business/bag/stock': { body: Paid; response: Ok<ShopWriteResponse>; errors: BusinessWrite | OnceErrorCode }
  'POST /api/business/bag/return': { body: Paid; response: Ok<ShopWriteResponse>; errors: BusinessWrite | OnceErrorCode }
  'POST /api/business/buy': { body: Paid<{ shop: string; product: string; units: number }>; response: Ok<ShopBuyResponse>; errors: BusinessWrite | OnceErrorCode }
  'POST /api/business/rate': { body: { cityId: CityId; shop: string; stars: number }; response: Ok<{ ok: boolean; code: string; reason?: string; market: VenueShopsResponse }>; errors: BusinessWrite }
  'POST /api/business/report': { body: { cityId: CityId; shop: string; reason: 'name' | 'scam' | 'other' }; response: Ok<{ ok: boolean; code: string; reason?: string }>; errors: BusinessWrite }
  'GET /api/mod/business/reports': { response: Ok<{ reports: (ShopReport & { live: boolean; current: string | null | undefined })[]; shops: number }>; errors: OperatorError }
  'POST /api/mod/business/rename': { body: { shop: string; reason?: string }; response: Ok<{ ok: true; code: 'renamed'; removed: string; by: PlayerRef }>; errors: OperatorError | JsonBodyErrorCode | 'unknown_shop' }
  'POST /api/mod/business/close': { body: { shop: string; reason?: string }; response: Ok<{ ok: true; code: 'closed'; name: string; by: PlayerRef; owed: number }>; errors: OperatorError | JsonBodyErrorCode | 'unknown_shop' }
}
