// The cart survives closing the app, but never carries over to a different character.
import { reactive } from 'vue'

export const basket = reactive<Record<string, number>>({})
export const grocerySession = reactive<{ owner: string | null; version: number; ordering: boolean; buying: string | null; fuelling: boolean }>({ owner: null, version: 0, ordering: false, buying: null, fuelling: false })
export function bindBasket(owner: string | null): void {
  if (owner === grocerySession.owner) return
  for (const id of Object.keys(basket)) delete basket[id]
  Object.assign(grocerySession, { owner, version: grocerySession.version + 1, ordering: false, buying: null, fuelling: false })
}
