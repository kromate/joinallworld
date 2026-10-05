// What the Business app says, worked out from what /api/business/ answers and the life's own view. Pure, so it is
// tested without a browser. The rules and every number are the server's (docs/BUSINESS.md): this file imports no
// rule and no catalogue, only the wire types.
import type { MyShop, ShopCard, ShopItem, TypeView, VenueShopsResponse } from '../../../types/business.ts'
import { money } from '../../ui/format.ts'

export const venueKey = (city: string, venue: string): string => `business:venue:${city}:${venue}`
export const venuePath = (city: string, venue: string): string => `/api/business/venue?city=${encodeURIComponent(city)}&venue=${encodeURIComponent(venue)}`
export const mineKey = (city: string): string => `business:mine:${city}`
export const minePath = (city: string): string => `/api/business/mine?city=${encodeURIComponent(city)}`

/** "4.2 stars · 12 ratings", for a label a screen reader reads whole. */
export const starsLabel = (stars: number, ratings: number): string => `${stars.toFixed(1)} stars${ratings ? ` · ${ratings} rating${ratings === 1 ? '' : 's'}` : ' · no ratings yet'}`
/** Five marks, filled to the nearest half star: '★★★★☆'. */
export const starMarks = (stars: number): string => '★'.repeat(Math.round(stars)) + '☆'.repeat(5 - Math.round(stars))

/** How long until `at`, in the largest unit that fits: "6 days", "5 h", "under an hour"; "now" when it has passed. */
export function untilWords(at: number, now: number): string {
  const left = at - now
  if (left <= 0) return 'now'
  if (left >= 2 * 86400000) return `${Math.floor(left / 86400000)} days`
  if (left >= 3600000) return `${Math.floor(left / 3600000)} h`
  return 'under an hour'
}

/** What the supplier would charge for an order `{ productId: units }`, and how many units it is. */
export function orderOf(shop: Pick<MyShop, 'products'>, order: Readonly<Record<string, number>>): { units: number; cost: number } {
  let units = 0, cost = 0
  for (const product of shop.products) { const wanted = Math.max(0, Math.floor(order[product.id] ?? 0)); units += wanted; cost += wanted * product.cost }
  return { units, cost }
}
/** Why the order cannot be bought, or '' when it can. */
export function orderWhy(shop: Pick<MyShop, 'products' | 'here' | 'venueName' | 'cityName' | 'capacity' | 'units' | 'status'>, order: Readonly<Record<string, number>>, cash: number, offline: string | null): string {
  if (offline) return offline
  if (shop.status === 'closed') return 'This stall has closed.'
  if (!shop.here) return `Go to ${shop.venueName} in ${shop.cityName} to restock.`
  const { units, cost } = orderOf(shop, order), room = shop.capacity - shop.units
  if (!units) return 'Choose how many of each to buy.'
  if (units > room) return room > 0 ? `Your stall has room for ${room} more.` : 'Your stall is full.'
  if (cost > cash) return `You need ${money(cost)}; you have ${money(cash)}.`
  return ''
}
/** The prices that differ from the stored ones: what "Save prices" sends. */
export function changedPrices(shop: Pick<MyShop, 'products'>, draft: Readonly<Record<string, number>>): Record<string, number> {
  const changed: Record<string, number> = {}
  for (const product of shop.products) { const price = draft[product.id]; if (typeof price === 'number' && Number.isFinite(price) && price !== product.price) changed[product.id] = price }
  return changed
}
export function pricesWhy(shop: Pick<MyShop, 'products' | 'here' | 'venueName' | 'cityName' | 'status'>, draft: Readonly<Record<string, number>>, offline: string | null): string {
  if (offline) return offline
  if (shop.status === 'closed') return 'This stall has closed.'
  if (!shop.here) return `Go to ${shop.venueName} in ${shop.cityName} to change prices.`
  const changed = changedPrices(shop, draft)
  if (!Object.keys(changed).length) return 'Change a price first.'
  for (const product of shop.products) {
    const price = changed[product.id]
    if (price !== undefined && (!Number.isInteger(price) || price < product.min || price > product.max)) return `${product.label}: ${money(product.min)} to ${money(product.max)}.`
  }
  return ''
}
/** How a price sits against the base price, in words a seller understands. */
export function priceWords(price: number, base: number): string {
  const ratio = price / base
  return ratio > 1.25 ? 'dear: few will buy' : ratio > 1.05 ? 'a little dear' : ratio < 0.85 ? 'cheap: more will buy' : 'fair'
}

export function collectWhy(shop: Pick<MyShop, 'till' | 'owed' | 'status'>, offline: string | null): string {
  if (offline) return offline
  if (shop.owed > 0) return `Takings go to the overdue rent (${money(shop.owed)}) first.`
  if (shop.till <= 0 && shop.status !== 'closed') return 'The cash box is empty.'
  return ''
}

/** Why the viewer cannot buy this item from this shop, or ''. `buyWhy` and `canSpend` are the life's own (view.business). */
export function buyWhy(card: Pick<ShopCard, 'mine' | 'blocked' | 'status'>, item: Pick<ShopItem, 'price' | 'stock'>, input: { cash: number; canSpend: number; buyWhy: string; offline: string | null }): string {
  if (input.offline) return input.offline
  if (card.mine) return 'Your own stall.'
  if (card.blocked) return 'You cannot buy from this stall.'
  if (card.status !== 'open') return 'Closed.'
  if (item.stock <= 0) return 'Sold out.'
  if (input.buyWhy) return input.buyWhy
  if (item.price > input.cash) return `You need ${money(item.price)}.`
  if (item.price > input.canSpend) return `You can spend ${money(input.canSpend)} more at players’ stalls today.`
  return ''
}

/** Why a stall cannot be opened here with this draft, or ''. */
export function openWhy(market: Pick<VenueShopsResponse, 'openWhy' | 'limits'>, type: Pick<TypeView, 'setup'> | undefined, name: string, cash: number, offline: string | null): string {
  if (offline) return offline
  if (market.openWhy) return market.openWhy
  if (!type) return 'Choose what to sell.'
  const length = [...name.trim()].length
  if (length < market.limits.name.min) return `Name your stall (at least ${market.limits.name.min} characters).`
  if (length > market.limits.name.max) return `The name can be ${market.limits.name.max} characters at most.`
  if (type.setup > cash) return `Opening costs ${money(type.setup)}; you have ${money(cash)}.`
  return ''
}

/** The Phone badge: 1 when the owner's stall needs them (the last answer this page was given). */
export const businessBadge = (mine: Pick<MyShop, 'alert'> | null | undefined): number => (mine?.alert ? 1 : 0)
