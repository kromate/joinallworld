// What the Groceries app decides, worked out from view.home.groceries. Pure, so it is tested
// without a browser. Every price is the amount the server will charge after discounts.
import type { HomeView } from '../../../types/view.ts'
import type { IngredientDefinition as IngredientContent } from '../../../types/content.ts'

export type Quote = { price: number; list: number }

export const MAX_PACKS = 9

/** The orders a quantity becomes: as many 3-packs as fit, then single packs — the two sizes the server quotes. */
export const split = (packs: number): number[] => [...Array<number>(Math.floor(packs / 3)).fill(3), ...Array<number>(packs % 3).fill(1)]

/** The server's quote for `packs` of an ingredient, else the catalogue price. */
export function quoteOf(groceries: HomeView['groceries'] | undefined, item: Pick<IngredientContent, 'id' | 'price'>, packs: number): Quote {
  return groceries?.[item.id]?.[packs] ?? { price: item.price * packs, list: item.price * packs }
}

/** What `packs` of an ingredient cost, in the pack sizes the server quotes. */
export const lineTotal = (groceries: HomeView['groceries'] | undefined, item: Pick<IngredientContent, 'id' | 'price'>, packs: number): number =>
  split(packs).reduce((sum, size) => sum + quoteOf(groceries, item, size).price, 0)

/** The one-tap "Buy 1 pack" decision: the price on the button, and why it cannot be sent ('' when it can). */
export function quickBuy(input: { quote: Pick<Quote, 'price'> | null | undefined; cash: number; connected: boolean; busy?: boolean; label?: string }): { price: number; blocked: string } {
  const { quote, cash, connected, busy = false, label = 'this' } = input
  const price = Math.max(0, Math.round(Number(quote?.price) || 0))
  let blocked = ''
  if (!connected) blocked = 'Not connected — ordering needs the server'
  else if (busy) blocked = 'Ordering…'
  else if (!quote || !Number.isFinite(Number(quote.price))) blocked = `No price for ${label} yet`
  else if (price > cash) blocked = `Need ₦${Math.round(price - cash).toLocaleString('en-NG')} more`
  return { price, blocked }
}

/** Why Order is disabled, or ''. */
export function orderReason(input: { units: number; offline: string; short: string; ordering: boolean; buying: boolean }): string {
  if (!input.units) return 'Add something with +'
  return input.offline || input.short || (input.ordering ? 'Ordering…' : input.buying ? 'Buying…' : '')
}

export const items = (count: number): string => `${count} item${count === 1 ? '' : 's'}`

/** What the basket's order says once it is done: nothing when nothing went through. */
export const orderedLine = (bought: number, refused: boolean): string => (!bought ? '' : refused ? `${items(bought)} delivered. The rest is still in your basket.` : `${items(bought)} delivered to your kitchen.`)

export const groceriesRules: string[] = [
  'Buy 1 pack: one tap buys one pack at the price on the button and delivers it at once.',
  'Basket: use − and + to choose packs of several things, then Order. The total is exactly what leaves your wallet.',
  'An order is sent pack by pack. If the server refuses one (the kitchen is full, the money ran out) ordering stops there and the rest stays in your basket.',
  'Ordering works from anywhere. Meals use ingredients only when they are finished — a cancelled cook costs nothing.',
  'Grocery prices and pack sizes are original beta values.',
]
