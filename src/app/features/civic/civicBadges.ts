import { shallowRef } from 'vue'
import type { CivicNotice } from '../../../types/civic.ts'
import type { CivicStore } from './civicCore.ts'
import { pulseKey, unseenNews } from './civicBasics.ts'

/** The lazy civic client installs its store when a screen first needs it. */
export const civicBadgeStore = shallowRef<CivicStore | null>(null)

export function newestNotice(store: CivicStore, cityId: string): readonly Pick<CivicNotice, 'at'>[] {
  const own = (store.cache.get(pulseKey(cityId))?.data as { notices?: readonly CivicNotice[] } | null)?.notices
  return own ?? []
}

export function civicNews(view: { cityId: string }, state: { civic?: { since?: number | null } | null }, store = civicBadgeStore.value): number {
  return store ? unseenNews(newestNotice(store, view.cityId), { readAt: store.news.at(view.cityId), since: state.civic?.since ?? null }) : 0
}
