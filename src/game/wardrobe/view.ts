import { AVATAR_WEARABLE_IDS, AVATAR_STARTER_WEARABLES } from '../../types/avatar.ts'
import type { OnboardingState } from '../../types/life.ts'
import type { BoutiqueItem } from '../../types/view.ts'
import { AVATAR_WEARABLES } from './catalogue.ts'
import { AVATAR_WEARABLE_PRICES } from './prices.ts'

/** Shared by the authoritative view and the on-demand Boutique, not initial client startup. */
export function wearableCards(o: Pick<OnboardingState, 'look' | 'wardrobe' | 'done'>, cash: number, notYet: string): BoutiqueItem[] {
  const ownedIds = new Set([...AVATAR_STARTER_WEARABLES, ...(o.wardrobe.wearables ?? [])])
  return AVATAR_WEARABLE_IDS.map(id => {
    const owned = ownedIds.has(id), price = AVATAR_WEARABLE_PRICES[id]
    return { kind: 'wearables', id, label: AVATAR_WEARABLES[id].label, price, owned, wearing: (o.look.wearables ?? []).includes(id), blocked: !o.done ? notYet : owned || cash >= price ? null : `Costs ₦${price.toLocaleString('en-NG')}; you have ₦${Math.floor(cash).toLocaleString('en-NG')}.` }
  })
}
