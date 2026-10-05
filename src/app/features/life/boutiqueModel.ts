// What the Boutique decides: which look the preview shows, and what each item offers. Pure, so it
// is tested without a browser. Rules and prices are the engine's (systems/onboarding.js,
// content/traits.js BOUTIQUE_PRICES — original beta prices).
import type { AccessoryId, Look } from '../../../types/life.ts'
import type { BoutiqueItem } from '../../../types/view.ts'

export const SECTIONS: readonly (readonly [BoutiqueItem['kind'], string])[] = [['hair', 'Hairstyles'], ['outfit', 'Outfits'], ['fabric', 'Fabrics'], ['accessories', 'Accessories']]

export interface Trying { kind: string; id: string }

/** `look` wearing `item`: a style replaces the one worn; an accessory is added (and replaces one in the same slot). */
export function wearing(look: Look, item: Pick<BoutiqueItem, 'kind' | 'id'>, withAccessory: (look: Look, id: AccessoryId) => AccessoryId[]): Look {
  return item.kind === 'accessories' ? { ...look, accessories: withAccessory(look, item.id as AccessoryId) } : { ...look, [item.kind]: item.id }
}

/** The item being tried on, while it is still on offer for this body and not already worn. */
export const triedItem = (boutique: readonly BoutiqueItem[], trying: Trying | null): BoutiqueItem | null =>
  (trying ? boutique.find((entry) => entry.kind === trying.kind && entry.id === trying.id && !entry.wearing) ?? null : null)

/** Pressing Try on again on the item being tried takes it off. */
export const nextTrying = (current: Trying | null, pressed: Trying | null): Trying | null => (pressed && current && current.kind === pressed.kind && current.id === pressed.id ? null : pressed)

export type ItemControl =
  | { kind: 'take-off'; why: string }
  | { kind: 'worn' }
  | { kind: 'wear'; why: string }
  | { kind: 'buy'; why: string }

/** What an item's one control is, and the reason it is disabled ('' when it can be pressed). `offline` is already worded for this app. */
export function itemControl(item: BoutiqueItem, input: { offline: string; done: boolean }): ItemControl {
  const unfinished = input.done ? '' : 'Finish creating your character first.'
  if (item.wearing && item.kind === 'accessories') return { kind: 'take-off', why: input.offline || unfinished }
  if (item.wearing) return { kind: 'worn' }
  if (item.owned) return { kind: 'wear', why: input.offline || unfinished }
  return { kind: 'buy', why: input.offline || item.blocked || '' }
}

/** The small line under an item's name. */
export function itemNote(item: Pick<BoutiqueItem, 'wearing' | 'owned' | 'price'>, money: (value: number) => string): string {
  return item.wearing ? 'On your character now' : item.owned ? (item.price ? 'In your wardrobe' : 'Free · yours') : money(item.price)
}
